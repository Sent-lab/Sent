/**
 * SENT — job queue and worker queries (§431).
 *
 * Split from `repository.ts` because these serve a different consumer. That file
 * is the projection's own read/write surface, used by the indexer and the API;
 * this one exists for background work that runs on its own schedule and answers
 * to nobody's request.
 *
 * Same rules apply: visible SQL, no ORM, and every quantity crosses the boundary
 * as a string rather than a JS number (§424).
 */

import { big, addr, toBytes } from "./client.ts";
import type { Db } from "./repository.ts";

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export type JobStatus = "PENDING" | "RUNNING" | "DONE" | "DEAD";

export interface JobRecord {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/**
 * Enqueue, keyed on the job's deterministic id.
 *
 * The conflict clause carries the whole idempotency story, and `DO NOTHING`
 * would be wrong. Deterministic ids mean a bucket that was already computed has
 * a row sitting at DONE — so a later trade landing in that same bucket would be
 * deduplicated against completed work and the candle would silently stay stale.
 *
 * So a DONE job is RE-ARMED: back to PENDING with its attempt count reset,
 * because this is new work that happens to have the same name. PENDING and
 * RUNNING rows are left alone, since the work is already scheduled or underway.
 *
 * DEAD rows are also left alone. Reviving one would quietly retry something that
 * already failed its way out of the queue, and the dead letter exists precisely
 * so that failure stays visible until someone looks at it.
 *
 * Returns whether the job is now scheduled as a result of this call.
 */
export async function enqueueJob(
  db: Db,
  job: {
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    maxAttempts: number;
    runAfter: number;
  },
  now: number,
): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO jobs (id, kind, payload, status, attempts, max_attempts, run_after, created_at, updated_at)
     VALUES ($1,$2,$3,'PENDING',0,$4,$5,$6,$6)
     ON CONFLICT (id) DO UPDATE SET
       status = 'PENDING',
       attempts = 0,
       payload = EXCLUDED.payload,
       run_after = EXCLUDED.run_after,
       updated_at = EXCLUDED.updated_at
     WHERE jobs.status = 'DONE'
     RETURNING id`,
    [job.id, job.kind, JSON.stringify(job.payload), job.maxAttempts, job.runAfter, now],
  );
  return rows.length === 1;
}

/**
 * Claim one job for execution.
 *
 * `FOR UPDATE SKIP LOCKED` is load-bearing. Without it two workers reading the
 * same pending row would both run it; skipping locked rows lets the second
 * worker take the next job instead of blocking behind the first.
 */
export async function claimJob(db: Db, now: number): Promise<JobRecord | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    `UPDATE jobs SET status = 'RUNNING', attempts = attempts + 1, updated_at = $1
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'PENDING' AND run_after <= $1 AND attempts < max_attempts
       ORDER BY run_after, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, kind, payload, attempts, max_attempts`,
    [now],
  );
  if (row === null) return null;

  return {
    id: String(row.id),
    kind: String(row.kind),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
  };
}

export async function completeJob(db: Db, id: string, now: number): Promise<void> {
  await db.query(
    "UPDATE jobs SET status = 'DONE', last_error = NULL, updated_at = $2 WHERE id = $1",
    [id, now],
  );
}

/**
 * Record a failure — back to PENDING with backoff, or DEAD once out of attempts.
 *
 * The error is stored either way. A job that retried three times and then
 * succeeded still leaves behind the reason it needed to.
 */
export async function failJob(
  db: Db,
  id: string,
  error: string,
  retryAt: number | null,
  now: number,
): Promise<JobStatus> {
  const status: JobStatus = retryAt === null ? "DEAD" : "PENDING";

  await db.query(
    `UPDATE jobs SET status = $2, last_error = $3,
       run_after = COALESCE($4, run_after), updated_at = $5
     WHERE id = $1`,
    [id, status, error.slice(0, 2000), retryAt, now],
  );

  return status;
}

/** Dead letters, newest first — the queue's error visibility surface (§431). */
export async function listDeadJobs(
  db: Db,
  limit: number,
): Promise<{ id: string; kind: string; attempts: number; lastError: string | null }[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id, kind, attempts, last_error FROM jobs
     WHERE status = 'DEAD' ORDER BY updated_at DESC LIMIT $1`,
    [Math.max(1, Math.min(limit, 500))],
  );

  return rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    attempts: Number(r.attempts),
    lastError: r.last_error === null ? null : String(r.last_error),
  }));
}

export async function countJobsByStatus(db: Db): Promise<Record<JobStatus, number>> {
  const rows = await db.query<{ status: string; count: string }>(
    "SELECT status, COUNT(*)::TEXT AS count FROM jobs GROUP BY status",
  );

  const counts: Record<JobStatus, number> = { PENDING: 0, RUNNING: 0, DONE: 0, DEAD: 0 };
  for (const row of rows) counts[row.status as JobStatus] = Number(row.count);
  return counts;
}

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

export interface TradePoint {
  readonly timestamp: number;
  readonly priceAfter: bigint;
  readonly notional: bigint;
}

/** Trades in a half-open window, in execution order. */
export async function listTradesInRange(
  db: Db,
  market: string,
  fromTimestamp: number,
  toTimestamp: number,
): Promise<TradePoint[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT timestamp, price_after, notional FROM trades
     WHERE market = $1 AND timestamp >= $2 AND timestamp < $3
     ORDER BY block_number, log_index`,
    [toBytes(market), fromTimestamp, toTimestamp],
  );

  return rows.map((r) => ({
    timestamp: Number(big(r.timestamp, "timestamp")),
    priceAfter: big(r.price_after, "price_after"),
    notional: big(r.notional, "notional"),
  }));
}

/**
 * Price left behind by the last trade before a timestamp.
 *
 * A candle opens where the market already was, not where its first trade landed.
 * Without this a quiet period would render as a gap and every bucket would open
 * at a price that had already moved.
 */
export async function priceBefore(
  db: Db,
  market: string,
  timestamp: number,
): Promise<bigint | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT price_after FROM trades
     WHERE market = $1 AND timestamp < $2
     ORDER BY block_number DESC, log_index DESC LIMIT 1`,
    [toBytes(market), timestamp],
  );
  return row === null ? null : big(row.price_after, "price_after");
}

/**
 * Write candles, replacing whatever was there.
 *
 * Replace, never accumulate. An aggregation that added to the existing row would
 * double every value on a retry, and retries are normal queue behaviour rather
 * than an exception.
 */
export async function upsertCandles(
  db: Db,
  market: string,
  candles: readonly {
    intervalSeconds: number;
    bucket: number;
    open: bigint;
    high: bigint;
    low: bigint;
    close: bigint;
    volume: bigint;
    tradeCount: number;
  }[],
): Promise<void> {
  for (const c of candles) {
    await db.query(
      `INSERT INTO candles (market, interval_s, bucket, open, high, low, close, volume, trade_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (market, interval_s, bucket) DO UPDATE SET
         open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
         close = EXCLUDED.close, volume = EXCLUDED.volume,
         trade_count = EXCLUDED.trade_count`,
      [
        toBytes(market),
        c.intervalSeconds,
        c.bucket,
        c.open.toString(),
        c.high.toString(),
        c.low.toString(),
        c.close.toString(),
        c.volume.toString(),
        c.tradeCount,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** Balances as the projection currently believes them. */
export async function listBalances(
  db: Db,
  market: string,
): Promise<{ account: `0x${string}`; balance: bigint }[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT account, balance FROM balances WHERE market = $1 ORDER BY account",
    [toBytes(market)],
  );
  return rows.map((r) => ({
    account: addr(r.account, "account"),
    balance: big(r.balance, "balance"),
  }));
}

/**
 * Balances recomputed from the event log.
 *
 * This is the derived truth. `balances` is a running total maintained during
 * ingestion, and a running total is exactly the kind of value that drifts — one
 * missed event and it is wrong forever, with nothing to notice it.
 */
export async function foldBalancesFromEvents(
  db: Db,
  market: string,
): Promise<{ account: `0x${string}`; balance: bigint }[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT account, SUM(delta)::TEXT AS balance
     FROM balance_events WHERE market = $1
     GROUP BY account HAVING SUM(delta) <> 0
     ORDER BY account`,
    [toBytes(market)],
  );
  return rows.map((r) => ({
    account: addr(r.account, "account"),
    balance: big(r.balance, "balance"),
  }));
}

export async function setBalance(
  db: Db,
  market: string,
  account: string,
  balance: bigint,
  lastBlock: bigint,
): Promise<void> {
  if (balance === 0n) {
    await db.query("DELETE FROM balances WHERE market = $1 AND account = $2", [
      toBytes(market),
      toBytes(account),
    ]);
    return;
  }

  await db.query(
    `INSERT INTO balances (market, account, balance, last_block)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (market, account) DO UPDATE SET
       balance = EXCLUDED.balance, last_block = EXCLUDED.last_block`,
    [toBytes(market), toBytes(account), balance.toString(), lastBlock.toString()],
  );
}

/**
 * Record drift found by reconciliation.
 *
 * Kept even when repaired. A worker that quietly fixes the projection destroys
 * the only evidence that ingestion produced a wrong value, and repeated drift on
 * one market is a bug rather than noise.
 */
export async function recordFinding(
  db: Db,
  f: {
    kind: string;
    market: string | null;
    subject: string;
    expected: string;
    observed: string;
    repaired: boolean;
    foundAt: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO reconciliation_findings (kind, market, subject, expected, observed, repaired, found_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      f.kind,
      f.market === null ? null : toBytes(f.market),
      f.subject,
      f.expected,
      f.observed,
      f.repaired,
      f.foundAt,
    ],
  );
}

export async function listFindings(
  db: Db,
  limit: number,
): Promise<{ kind: string; subject: string; expected: string; observed: string; repaired: boolean }[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT kind, subject, expected, observed, repaired FROM reconciliation_findings
     ORDER BY found_at DESC LIMIT $1`,
    [Math.max(1, Math.min(limit, 500))],
  );

  return rows.map((r) => ({
    kind: String(r.kind),
    subject: String(r.subject),
    expected: String(r.expected),
    observed: String(r.observed),
    repaired: Boolean(r.repaired),
  }));
}

/** Block numbers missing from an indexed range — a gap the projection cannot see. */
export async function findBlockGaps(
  db: Db,
  fromBlock: bigint,
  toBlock: bigint,
  limit: number,
): Promise<bigint[]> {
  const rows = await db.query<{ missing: string }>(
    `SELECT n::TEXT AS missing
     FROM generate_series($1::BIGINT, $2::BIGINT) AS n
     WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.number = n)
     ORDER BY n LIMIT $3`,
    [fromBlock.toString(), toBlock.toString(), limit],
  );
  return rows.map((r) => big(r.missing, "missing_block"));
}

/** Every market, for workers that sweep all of them. */
export async function listAllMarkets(
  db: Db,
): Promise<{ market: `0x${string}`; launchedAt: number }[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT market, launched_at FROM markets ORDER BY market",
  );
  return rows.map((r) => ({
    market: addr(r.market, "market"),
    launchedAt: Number(big(r.launched_at, "launched_at")),
  }));
}
