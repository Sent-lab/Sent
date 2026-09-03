/**
 * SENT — the finalizer's metrics (§146).
 *
 * §146 names two things only this service can report: Stockback finalization
 * lag/failure, and distribution-root publication freshness. They are not the
 * same measurement and conflating them hides the failure that matters.
 *
 * LAG IS NOT FRESHNESS
 * --------------------
 * Finalization LAG is how far the newest computed epoch is behind the epoch
 * that should have been computed by now. It says "we are falling behind".
 *
 * Publication FRESHNESS is how long it has been since a dataset was written at
 * all. It says "we have stopped".
 *
 * A finalizer wedged on one market keeps producing datasets for the others, so
 * freshness stays healthy while lag climbs on the market nobody is watching.
 * A finalizer that has crashed shows no lag movement at all — every market's
 * lag is frozen at whatever it was — while freshness climbs. Neither metric
 * catches both cases, which is why §146 lists them separately.
 *
 * SKIPS ARE NOT FAILURES
 * ----------------------
 * A quiet market produces NO_CLOSED_EPOCH or NO_NEW_EPOCHS on every pass, and
 * that is the system working. Counting them as errors would make a healthy
 * deployment look permanently broken and would train whoever is on call to
 * ignore the metric. They are counted under their own name, by reason, because
 * a market that is suddenly always NOT_DISTRIBUTABLE is worth seeing.
 */

import { Registry } from "@sent/observability/metrics";

export const RUNS_TOTAL = "sent_finalizer_runs_total";
export const RUN_SECONDS = "sent_finalizer_run_seconds";
export const MARKET_SECONDS = "sent_finalizer_market_seconds";
export const DATASETS_TOTAL = "sent_finalizer_datasets_total";
export const SKIPS_TOTAL = "sent_finalizer_skips_total";
export const FAILURES_TOTAL = "sent_finalizer_failures_total";
export const HOLDERS = "sent_finalizer_holders";

export const PUBLICATION_AGE = "sent_finalizer_publication_age_seconds";
export const LAST_RUN_AGE = "sent_finalizer_last_run_age_seconds";

export interface FinalizerMetricSources {
  /** Unix seconds of the newest dataset written by this process, or null. */
  readonly lastPublishedAt: () => number | null;
  /** Unix seconds the last full pass completed, or null before the first. */
  readonly lastRunAt: () => number | null;
  readonly now?: () => number;
}

export function createFinalizerRegistry(sources: FinalizerMetricSources): Registry {
  const registry = new Registry();
  const now = sources.now ?? ((): number => Math.floor(Date.now() / 1000));

  registry.counter(RUNS_TOTAL, "Finalizer passes, by outcome.");
  registry.histogram(RUN_SECONDS, "Duration of one full pass, in seconds.");

  /*
   * Per-market, separately from the pass.
   *
   * The pass timing hides the market that is slow: one market taking sixty
   * seconds and twelve taking five look identical in the aggregate. This is
   * also where the quadratic proof builder showed up — 70 seconds for 2,500
   * holders, inside a write transaction — and it would have been visible here
   * long before it was visible to anyone.
   */
  registry.histogram(MARKET_SECONDS, "Time to finalize one market, in seconds.");

  registry.counter(DATASETS_TOTAL, "Datasets computed and stored.");
  registry.counter(SKIPS_TOTAL, "Markets skipped, by reason. Not failures.");
  registry.counter(FAILURES_TOTAL, "Markets that threw during finalization.");

  // Buckets in holders, not seconds: this is a size distribution, and the tail
  // is what predicts when the per-market timing will start to hurt.
  registry.histogram(HOLDERS, "Holders in each computed dataset.", [
    1, 10, 100, 500, 1_000, 5_000, 25_000, 100_000,
  ]);

  registry.gauge(
    PUBLICATION_AGE,
    "Seconds since this process last wrote a dataset (§146 root publication freshness).",
    () => {
      const at = sources.lastPublishedAt();
      // Null until the first publication rather than zero. Zero would read as
      // "just published" for a process that has never published anything.
      return at === null ? null : Math.max(now() - at, 0);
    },
  );

  registry.gauge(LAST_RUN_AGE, "Seconds since the last completed pass.", () => {
    const at = sources.lastRunAt();
    return at === null ? null : Math.max(now() - at, 0);
  });

  return registry;
}
