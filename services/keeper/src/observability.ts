/**
 * SENT — the keeper's metrics (§146, §437).
 *
 * There is one number here that matters more than the rest, and it is not the
 * one a keeper's dashboard would normally lead with.
 *
 * `sent_keeper_worst_wait_blocks` is how long the longest-waiting market has
 * been sitting with a closed curve and no pool. In that state its holders
 * cannot sell, cannot buy, and cannot do anything but wait, so the wait is not
 * a queue-depth statistic — it is the duration of an outage for one market's
 * users. Everything else on this page is context for it.
 *
 * WHY `can_send` IS A GAUGE AND NOT A STARTUP CHECK
 * -------------------------------------------------
 * This process is also the thing that notices stalled graduations. If it
 * refused to run without a usable key, a deployment with no key would have no
 * alerting either — and "nobody is finalising" would present as silence, which
 * is what a healthy keeper also produces. So it runs watch-only, reports what
 * it can see, and says plainly that it cannot act.
 *
 * FAILURES ARE COUNTED; LOST RACES ARE NOT
 * ----------------------------------------
 * `finalizeGraduation` is permissionless by design, so another keeper, a
 * holder, or someone clicking a button in the UI winning the race is the system
 * working. Those are recorded as ALREADY_DONE and never reach the failure
 * gauge. Alerting on them would make a healthy protocol page an operator, and
 * an alert that fires when nothing is wrong is one that stops being read.
 */

import { Registry } from "@sent/observability/metrics";

export const PENDING = "sent_keeper_pending_graduations";
export const WORST_WAIT = "sent_keeper_worst_wait_blocks";
export const STALL_THRESHOLD = "sent_keeper_stall_threshold_blocks";
export const FAILED = "sent_keeper_last_sweep_failures";
export const CAN_SEND = "sent_keeper_can_send";
export const BALANCE = "sent_keeper_balance_wei";
export const SWEEP_AGE = "sent_keeper_seconds_since_sweep";

export interface KeeperMetricSources {
  /**
   * Null before the first sweep, and null again after one fails.
   *
   * Zero would be indistinguishable from "no markets are waiting", which is the
   * reassuring reading of a keeper that cannot see the database at all.
   */
  readonly pending: () => number | null;
  readonly worstWaitBlocks: () => bigint | null;
  readonly failed: () => number | null;
  /** Exported so an alert rule can compare against it instead of hardcoding. */
  readonly stalledThreshold: bigint;
  readonly canSend: () => boolean;
  /** Null when watch-only, or when the balance could not be read. */
  readonly balanceWei: () => bigint | null;
  readonly lastSweepAt: () => number | null;
}

export function createKeeperRegistry(sources: KeeperMetricSources): Registry {
  const registry = new Registry();

  registry.gauge(
    PENDING,
    "Markets whose curve has closed and whose HyperSwap position is not minted.",
    sources.pending,
  );

  registry.gauge(
    WORST_WAIT,
    "Blocks the longest-waiting market has spent with no venue. The one to alert on.",
    () => {
      const value = sources.worstWaitBlocks();
      return value === null ? null : Number(value);
    },
  );

  registry.gauge(
    STALL_THRESHOLD,
    "Wait beyond which a pending graduation is a fault rather than a lane wait.",
    () => Number(sources.stalledThreshold),
  );

  registry.gauge(
    FAILED,
    "Finalise attempts that failed in the last sweep. Lost races are NOT counted.",
    sources.failed,
  );

  registry.gauge(
    CAN_SEND,
    "1 when the keeper holds a key and can pay; 0 when watch-only or underfunded.",
    () => (sources.canSend() ? 1 : 0),
  );

  registry.gauge(
    BALANCE,
    "Keeper account balance in wei. Null when watch-only or unreadable.",
    () => {
      const value = sources.balanceWei();
      return value === null ? null : Number(value);
    },
  );

  registry.gauge(
    SWEEP_AGE,
    "Seconds since the last sweep completed. Rises without bound if the loop dies.",
    () => {
      const at = sources.lastSweepAt();
      return at === null ? null : (Date.now() - at) / 1_000;
    },
  );

  return registry;
}
