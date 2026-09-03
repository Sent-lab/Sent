/**
 * SENT — the worker's metrics (§146, §437).
 *
 * The runner already kept counters and already wrote one JSON line per event.
 * What it had no way to do was let anything else SEE them: `runner.metrics` was
 * printed at shutdown, which is the one moment an operator is not watching.
 *
 * COUNTERS ARE MIRRORED, NOT MOVED
 * --------------------------------
 * The runner's own counters stay where they are. They are read by
 * `tests/load/concurrency.ts` to prove four workers claim two hundred jobs
 * without duplication, and rewriting the runner to increment a registry instead
 * would mean that proof now depends on a metrics library rather than on the
 * queue. So the registry reads them as gauges at scrape time.
 *
 * That makes them monotonic within a process lifetime and reset on restart,
 * which is exactly what a Prometheus counter is — the semantics match even
 * though the mechanism is a gauge.
 *
 * DEAD LETTERS ARE THE ONE THAT MATTERS
 * -------------------------------------
 * A retry is the system working. A dead letter is work that will never happen
 * unless a person intervenes, and §146's "missed-block recovery" depends on the
 * sweep job actually running. It is the metric worth an alert.
 */

import { Registry } from "@sent/observability/metrics";

export const CLAIMED = "sent_worker_jobs_claimed_total";
export const SUCCEEDED = "sent_worker_jobs_succeeded_total";
export const RETRIED = "sent_worker_jobs_retried_total";
export const DEAD_LETTERED = "sent_worker_jobs_dead_lettered_total";
export const UNKNOWN_KIND = "sent_worker_jobs_unknown_kind_total";
export const HANDLER_SECONDS = "sent_worker_handler_seconds_total";
export const PENDING = "sent_worker_jobs_pending";
export const DEAD = "sent_worker_jobs_dead";

export interface WorkerMetricSources {
  readonly claimed: () => number;
  readonly succeeded: () => number;
  readonly retried: () => number;
  readonly deadLettered: () => number;
  readonly unknownKind: () => number;
  readonly handlerMs: () => number;
  /**
   * Queue depth, from the database.
   *
   * Null when the last refresh failed. A depth of zero during a database
   * outage is the reassuring reading of "we cannot see the queue at all".
   */
  readonly pending: () => number | null;
  readonly dead: () => number | null;
}

export function createWorkerRegistry(sources: WorkerMetricSources): Registry {
  const registry = new Registry();

  registry.gauge(CLAIMED, "Jobs claimed since this process started.", sources.claimed);
  registry.gauge(SUCCEEDED, "Jobs that completed successfully.", sources.succeeded);
  registry.gauge(RETRIED, "Jobs returned to the queue after a failure.", sources.retried);

  registry.gauge(
    DEAD_LETTERED,
    "Jobs that exhausted their attempts. Work that will not happen without a person.",
    sources.deadLettered,
  );

  registry.gauge(
    UNKNOWN_KIND,
    "Jobs whose kind has no registered handler — a deploy mismatch, not a job failure.",
    sources.unknownKind,
  );

  registry.gauge(
    HANDLER_SECONDS,
    "Cumulative handler time. Divide by the succeeded count for a mean.",
    () => sources.handlerMs() / 1_000,
  );

  registry.gauge(PENDING, "Jobs waiting in the queue.", sources.pending);
  registry.gauge(DEAD, "Jobs in the dead letter queue.", sources.dead);

  return registry;
}
