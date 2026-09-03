/**
 * SENT — the indexer's metrics (§146).
 *
 * §146 names five things only this service can report: indexer lag, event
 * delay, missed-block recovery, graduation success, and RPC health as the
 * component that actually depends on it sees it.
 *
 * LAG AND DELAY ARE DIFFERENT QUESTIONS
 * -------------------------------------
 * Lag is `head - indexed`, in blocks. It answers "how far behind are we".
 *
 * Delay is wall-clock now minus the timestamp of the newest block written. It
 * answers "how old is the data we are serving", which is the one a user
 * experiences — and the two disagree in the case that matters most. On a chain
 * that has stopped producing blocks, lag is zero and stays zero: the indexer is
 * perfectly caught up with a chain that is not moving. Only delay grows.
 *
 * REORGS AND REINDEXES ARE COUNTERS, NOT A FLAG
 * ---------------------------------------------
 * §146 asks for missed-block recovery. A boolean "recovering" would be true for
 * milliseconds and missed by every scrape; a monotonic counter shows the rate,
 * and a rate is what distinguishes a chain with normal reorg depth from one
 * that is in trouble.
 */

import { Registry } from "@sent/observability/metrics";

export const TICKS_TOTAL = "sent_indexer_ticks_total";
export const TICK_SECONDS = "sent_indexer_tick_seconds";
export const RANGE_SECONDS = "sent_indexer_range_seconds";
export const LOGS_TOTAL = "sent_indexer_logs_total";
export const EVENTS_TOTAL = "sent_indexer_events_total";
export const REORGS_TOTAL = "sent_indexer_reorgs_total";
export const REINDEXES_TOTAL = "sent_indexer_reindexes_total";
export const RPC_FAILURES = "sent_indexer_rpc_failures_total";

export const LAG_BLOCKS = "sent_indexer_lag_blocks";
export const EVENT_DELAY_SECONDS = "sent_indexer_event_delay_seconds";
export const INDEXED_BLOCK = "sent_indexer_indexed_block";
export const HEAD_BLOCK = "sent_indexer_head_block";
export const CONNECTED = "sent_indexer_rpc_connected";

export interface IndexerMetricSources {
  readonly headBlock: () => bigint;
  readonly indexedBlock: () => bigint;
  readonly connected: () => boolean;
  /** Chain timestamp of the newest block written, or null before the first. */
  readonly newestBlockTimestamp: () => number | null;
  readonly now?: () => number;
}

export function createIndexerRegistry(sources: IndexerMetricSources): Registry {
  const registry = new Registry();
  const now = sources.now ?? ((): number => Math.floor(Date.now() / 1000));

  registry.counter(TICKS_TOTAL, "Indexer passes, by outcome.");
  registry.histogram(TICK_SECONDS, "Duration of one indexer pass, in seconds.");
  registry.histogram(RANGE_SECONDS, "Duration of one getLogs range, in seconds.");
  registry.counter(LOGS_TOTAL, "Chain logs read.");
  registry.counter(EVENTS_TOTAL, "Normalized events written, by kind.");

  // §146's missed-block recovery, as rates rather than as a state.
  registry.counter(REORGS_TOTAL, "Reorgs detected and rolled back.");
  registry.counter(REINDEXES_TOTAL, "Full reindexes required.");
  registry.counter(RPC_FAILURES, "Ticks that failed against the RPC.");

  registry.gauge(LAG_BLOCKS, "Blocks behind the chain head.", () => {
    const head = sources.headBlock();
    // Null before the first successful head read. Zero would say "caught up",
    // which is the reassuring reading of "we have never spoken to the chain".
    if (head === 0n) return null;

    const indexed = sources.indexedBlock();
    return Number(head > indexed ? head - indexed : 0n);
  });

  registry.gauge(
    EVENT_DELAY_SECONDS,
    "Seconds between now and the newest indexed block's own timestamp.",
    () => {
      const newest = sources.newestBlockTimestamp();
      if (newest === null) return null;

      // Clamped at zero. A node whose clock is ahead of this process would
      // otherwise report negative delay, which no alert rule expects.
      return Math.max(now() - newest, 0);
    },
  );

  registry.gauge(INDEXED_BLOCK, "Highest block written to the projection.", () =>
    Number(sources.indexedBlock()),
  );

  registry.gauge(HEAD_BLOCK, "Chain head as last observed.", () => {
    const head = sources.headBlock();
    return head === 0n ? null : Number(head);
  });

  registry.gauge(CONNECTED, "1 when the last tick reached the RPC, 0 when it did not.", () =>
    sources.connected() ? 1 : 0,
  );

  return registry;
}
