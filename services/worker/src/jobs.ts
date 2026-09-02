/**
 * SENT — worker job definitions (§431).
 *
 * §431 lists ten worker classes. Four are already services in their own right
 * and are NOT duplicated here, because a second implementation of any of them
 * would be a second answer to a question that must have exactly one:
 *
 *   chain backfill              → services/indexer
 *   Stockback TWAB              → packages/stockback + services/stockback
 *   Merkle dataset generation   → services/finalizer
 *   attestation verification    → the attestors, who hold the keys (§594)
 *
 * Two are deferred rather than stubbed, and the reason is recorded so the gap
 * stays visible instead of looking finished:
 *
 *   share image generation      → needs the rendering surface from apps/web
 *   metadata processing         → needs the media pipeline decision (C-11)
 *
 * That leaves the four below.
 *
 * EVERY HANDLER RECOMPUTES; NONE ADJUST
 * -------------------------------------
 * The queue is at-least-once (see runner.ts), so any handler can run twice on
 * the same input. Recompute-and-replace converges; read-modify-write does not.
 * Candles overwrite the bucket. Reconciliation derives balances by folding the
 * event log rather than nudging the running total. Neither cares how many times
 * it has run before.
 */

import {
  Database,
  listTradesInRange,
  priceBefore,
  upsertCandles,
  listBalances,
  foldBalancesFromEvents,
  setBalance,
  recordFinding,
  findBlockGaps,
  refreshHolderCount,
  headBlockIndexed,
  getCursor,
} from "@sent/database";

import { aggregate, bucketWindow } from "./candles.ts";
import { JOB_KINDS } from "./schedule.ts";
import { logLine, type JobHandler } from "./runner.ts";

// ---------------------------------------------------------------------------
// Payload parsing
//
// A payload arrives from JSONB, so it is untyped by construction. Parsing it is
// not ceremony: a job enqueued by an older deployment can carry a shape this
// binary does not expect, and reading a field off `undefined` inside a handler
// turns that into an unexplained dead letter.
// ---------------------------------------------------------------------------

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new TypeError(`job payload: "${key}" must be a string, got ${typeof value}`);
  }
  return value;
}

function requireNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`job payload: "${key}" must be an integer, got ${String(value)}`);
  }
  return value;
}

/**
 * Block heights cross JSONB as strings.
 *
 * A uint256 block height would not survive a JSON number, and while HyperEVM
 * heights are nowhere near 2^53 today, the rule that quantities never touch
 * floating point (§424) is not worth carving an exception into.
 */
function requireBigint(payload: Record<string, unknown>, key: string): bigint {
  const value = payload[key];
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new TypeError(`job payload: "${key}" must be a decimal string, got ${String(value)}`);
  }
  return BigInt(value);
}

// ---------------------------------------------------------------------------
// Candle aggregation
// ---------------------------------------------------------------------------

/**
 * Recompute one candle bucket from trades.
 *
 * Scoped to a single bucket so a retry rewrites exactly the same row. A handler
 * that recomputed "everything since last time" would produce a different result
 * depending on when it ran, which is the opposite of idempotent.
 */
export function candleHandler(db: Database): JobHandler {
  return async (payload) => {
    const market = requireString(payload, "market");
    const intervalSeconds = requireNumber(payload, "intervalSeconds");
    const bucket = requireNumber(payload, "bucket");

    const { from, to } = bucketWindow(bucket, intervalSeconds);
    const trades = await listTradesInRange(db, market, from, to);

    // No trades means no candle. Writing a flat one would fabricate a data point
    // that the schema has no way to mark as synthetic.
    if (trades.length === 0) return;

    const prior = await priceBefore(db, market, from);
    const candles = aggregate(trades, intervalSeconds, prior);

    await upsertCandles(db, market, candles);
  };
}

// ---------------------------------------------------------------------------
// Holder checkpoint reconciliation
// ---------------------------------------------------------------------------

/**
 * Compare the running balance table against the event log, and repair.
 *
 * `balances` is maintained incrementally during ingestion, and an incremental
 * total is the classic silent-drift shape: one missed or double-applied event
 * and it is wrong from then on, with nothing that would ever notice.
 *
 * The event log is the derived truth — it is what a full reindex would produce —
 * so it wins, and every disagreement is recorded before being fixed.
 */
export function holderReconciliationHandler(db: Database): JobHandler {
  return async (payload) => {
    const market = requireString(payload, "market");
    const throughBlock = requireBigint(payload, "throughBlock");
    const now = Math.floor(Date.now() / 1000);

    const [stored, derived] = await Promise.all([
      listBalances(db, market),
      foldBalancesFromEvents(db, market),
    ]);

    const storedMap = new Map(stored.map((b) => [b.account.toLowerCase(), b.balance]));
    const derivedMap = new Map(derived.map((b) => [b.account.toLowerCase(), b.balance]));

    // Union of both sides: an account present in only one is drift too, and the
    // more dangerous kind — a holder the projection forgot, or one it invented.
    const accounts = new Set([...storedMap.keys(), ...derivedMap.keys()]);
    let repaired = 0;

    await db.transaction(async (tx) => {
      for (const account of accounts) {
        const expected = derivedMap.get(account) ?? 0n;
        const observed = storedMap.get(account) ?? 0n;
        if (expected === observed) continue;

        await recordFinding(tx, {
          kind: "holder_balance",
          market,
          subject: account,
          expected: expected.toString(),
          observed: observed.toString(),
          repaired: true,
          foundAt: now,
        });

        await setBalance(tx, market, account, expected, throughBlock);
        repaired += 1;
      }

      // The holder count is derived from `balances`, so it can only be trusted
      // after the balances themselves have been corrected.
      await refreshHolderCount(tx, market);
    });

    if (repaired > 0) {
      console.warn(
        logLine({
          level: "warn",
          event: "reconciliation.drift",
          kind: "holder_balance",
          market,
          accounts: repaired,
        }),
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Health reconciliation
// ---------------------------------------------------------------------------

/**
 * Look for holes in the indexed block range.
 *
 * The indexer advances one range at a time and refuses gaps, so this should
 * never find anything. That is exactly why it runs: a check that only fires when
 * an invariant has already broken is the one worth having, and §138's claim that
 * the projection is rebuildable is false the moment a block is missing.
 */
export function healthReconciliationHandler(db: Database): JobHandler {
  return async (payload) => {
    const fromBlock = requireBigint(payload, "fromBlock");
    const toBlock = requireBigint(payload, "toBlock");
    const now = Math.floor(Date.now() / 1000);

    const gaps = await findBlockGaps(db, fromBlock, toBlock, 100);

    for (const missing of gaps) {
      await recordFinding(db, {
        kind: "block_gap",
        market: null,
        subject: missing.toString(),
        expected: "indexed",
        observed: "missing",
        // Not repairable from here. Filling a gap means re-reading the chain,
        // which is the indexer's job — claiming otherwise would make the finding
        // look handled when nothing has happened.
        repaired: false,
        foundAt: now,
      });
    }

    if (gaps.length > 0) {
      console.error(
        logLine({
          level: "error",
          event: "reconciliation.block_gap",
          count: gaps.length,
          first: gaps[0]?.toString(),
        }),
      );
    }

    // The cursor is what the indexer will resume from. If it has drifted above
    // the highest block actually recorded, a restart would skip the difference
    // and never come back for it.
    const cursor = await getCursor(db);
    const head = await headBlockIndexed(db);

    if (cursor !== null && cursor.lastBlock > head) {
      await recordFinding(db, {
        kind: "cursor_ahead_of_blocks",
        market: null,
        subject: "indexer_state",
        expected: `<= ${head}`,
        observed: cursor.lastBlock.toString(),
        repaired: false,
        foundAt: now,
      });

      console.error(
        logLine({
          level: "error",
          event: "reconciliation.cursor_ahead",
          cursor: cursor.lastBlock.toString(),
          head: head.toString(),
        }),
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Analytics rollup
// ---------------------------------------------------------------------------

/**
 * Daily volume and trade count per market, stored as a 24h candle.
 *
 * Reuses the candle table rather than introducing a parallel rollup table with
 * its own drift. A day IS a candle interval, and two tables holding the same
 * daily volume would eventually disagree about it.
 */
export function analyticsRollupHandler(db: Database): JobHandler {
  return async (payload) => {
    const market = requireString(payload, "market");
    const day = requireNumber(payload, "day");

    const from = day * 86_400;
    const to = from + 86_400;

    const trades = await listTradesInRange(db, market, from, to);
    if (trades.length === 0) return;

    const prior = await priceBefore(db, market, from);
    await upsertCandles(db, market, aggregate(trades, 86_400, prior));
  };
}

/** Wire every handler this service owns onto a runner. */
export function registerAll(
  db: Database,
  register: (kind: string, handler: JobHandler) => void,
): void {
  register(JOB_KINDS.CANDLES, candleHandler(db));
  register(JOB_KINDS.HOLDER_RECONCILIATION, holderReconciliationHandler(db));
  register(JOB_KINDS.HEALTH_RECONCILIATION, healthReconciliationHandler(db));
  register(JOB_KINDS.ANALYTICS_ROLLUP, analyticsRollupHandler(db));
}
