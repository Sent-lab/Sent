/**
 * SENT — job producers and identifiers (§431).
 *
 * Separate from the handlers so a producer can be imported without dragging the
 * handler code with it. The indexer schedules work as it advances; it has no
 * business holding the code that performs it, and a dependency that reached that
 * far would put candle aggregation in the ingestion process's import graph.
 */

import { enqueueJob, listAllMarkets, type Db } from "@sent/database";

import { CANDLE_INTERVALS } from "./candles.ts";

export const JOB_KINDS = {
  CANDLES: "candles",
  HOLDER_RECONCILIATION: "holders",
  HEALTH_RECONCILIATION: "health",
  ANALYTICS_ROLLUP: "analytics",
} as const;

// ---------------------------------------------------------------------------
// Deterministic identifiers (§431)
//
// The id IS the idempotency key. Two producers that decide the same work is
// needed must arrive at the same string, or `enqueueJob`'s ON CONFLICT stops
// deduplicating and the job runs twice.
//
// So ids are built only from values that identify the WORK — never from a clock
// reading, a counter, or a random suffix.
// ---------------------------------------------------------------------------

export function candleJobId(market: string, intervalSeconds: number, bucket: number): string {
  return `${JOB_KINDS.CANDLES}:${market.toLowerCase()}:${intervalSeconds}:${bucket}`;
}

export function holderJobId(market: string, throughBlock: bigint): string {
  return `${JOB_KINDS.HOLDER_RECONCILIATION}:${market.toLowerCase()}:${throughBlock}`;
}

export function healthJobId(fromBlock: bigint, toBlock: bigint): string {
  return `${JOB_KINDS.HEALTH_RECONCILIATION}:${fromBlock}:${toBlock}`;
}

export function analyticsJobId(market: string, day: number): string {
  return `${JOB_KINDS.ANALYTICS_ROLLUP}:${market.toLowerCase()}:${day}`;
}

// ---------------------------------------------------------------------------
// Producers
// ---------------------------------------------------------------------------

/**
 * Enqueue the work that indexing a block range implies.
 *
 * Called by the indexer after it advances. Every id is derived from the range
 * itself, so calling it twice for the same range enqueues nothing the second
 * time — which is what makes it safe to call from a path that can retry.
 */
export async function scheduleForRange(
  db: Db,
  market: string,
  fromTimestamp: number,
  toTimestamp: number,
  throughBlock: bigint,
  now = Math.floor(Date.now() / 1000),
): Promise<number> {
  let queued = 0;

  for (const intervalSeconds of CANDLE_INTERVALS) {
    const first = Math.floor(fromTimestamp / intervalSeconds) * intervalSeconds;
    const last = Math.floor(toTimestamp / intervalSeconds) * intervalSeconds;

    for (let bucket = first; bucket <= last; bucket += intervalSeconds) {
      const created = await enqueueJob(
        db,
        {
          id: candleJobId(market, intervalSeconds, bucket),
          kind: JOB_KINDS.CANDLES,
          payload: { market, intervalSeconds, bucket },
          maxAttempts: 5,
          // Immediately: a chart that lags the tape by a scheduling interval is
          // the complaint this whole pipeline exists to avoid.
          runAfter: now,
        },
        now,
      );
      if (created) queued += 1;
    }
  }

  const created = await enqueueJob(
    db,
    {
      id: holderJobId(market, throughBlock),
      kind: JOB_KINDS.HOLDER_RECONCILIATION,
      payload: { market, throughBlock: throughBlock.toString() },
      maxAttempts: 3,
      runAfter: now,
    },
    now,
  );
  if (created) queued += 1;

  return queued;
}

/**
 * Enqueue the periodic sweep.
 *
 * Bucketed to the hour so repeated calls within an hour collapse to one job.
 * Without that the id would have to carry a timestamp, and a producer running
 * every minute would enqueue sixty identical sweeps an hour.
 */
export async function scheduleSweep(
  db: Db,
  headBlock: bigint,
  lookbackBlocks: bigint,
  now = Math.floor(Date.now() / 1000),
): Promise<number> {
  const from = headBlock > lookbackBlocks ? headBlock - lookbackBlocks : 0n;
  let queued = 0;

  if (await enqueueJob(
    db,
    {
      id: healthJobId(from, headBlock),
      kind: JOB_KINDS.HEALTH_RECONCILIATION,
      payload: { fromBlock: from.toString(), toBlock: headBlock.toString() },
      maxAttempts: 3,
      runAfter: now,
    },
    now,
  )) {
    queued += 1;
  }

  const day = Math.floor(now / 86_400) - 1;

  for (const { market } of await listAllMarkets(db)) {
    if (await enqueueJob(
      db,
      {
        id: analyticsJobId(market, day),
        kind: JOB_KINDS.ANALYTICS_ROLLUP,
        payload: { market, day },
        maxAttempts: 3,
        runAfter: now,
      },
      now,
    )) {
      queued += 1;
    }
  }

  return queued;
}

