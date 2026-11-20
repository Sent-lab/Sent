import type { FreshnessEnvelope } from "@sent/realtime";

/**
 * A launch decision needs a connected API and a recent chain/indexer view.
 * SYNCING remains usable; delayed, stale and reconnecting states fail closed.
 */
export function isActionableFreshness(freshness: FreshnessEnvelope): boolean {
  return freshness.state === "LIVE" || freshness.state === "SYNCING";
}

/**
 * Delayed projections may still accompany a quote read directly from chain.
 * Stale and reconnecting envelopes explicitly forbid trading in the UI.
 */
export function isTradeableFreshness(freshness: FreshnessEnvelope): boolean {
  return freshness.state !== "STALE" && freshness.state !== "RECONNECTING";
}
