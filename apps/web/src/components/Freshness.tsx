/**
 * SENT — freshness indicator (§211).
 *
 * Five states, shown contextually beside the data they describe rather than as a
 * global banner. §211 is explicit about that: a page-wide warning for one stale
 * panel teaches people to dismiss the warning.
 *
 * WHY THIS IS NOT DECORATION
 * --------------------------
 * §87 gives every value a provenance and §211 gives every view a freshness
 * state. Together they are the promise that the interface never presents a
 * number as more certain than it is. A component that renders a price without
 * saying how old it is looks identical whether the socket is live or died four
 * minutes ago — and the user acts on it either way.
 *
 * THE CLIENT DOES NOT CLASSIFY
 * ----------------------------
 * The envelope arrives with `state` already decided by the producer, which owns
 * the thresholds and knows whether its chain connection is up. Re-deriving it
 * here from `lagBlocks` would be a second implementation of a rule that must
 * have one — and it would be the WEAKER one, because a browser cannot see that
 * the API lost its RPC. The UI would then render LIVE over a reconnecting
 * service, which is precisely the misleading state §451 blocks a release for.
 */

import type { FreshnessEnvelope, FreshnessState } from "@sent/realtime";

import styles from "./Freshness.module.css";
import type { JSX } from "react";

/**
 * Copy per state, written to §42: contextual, recovery-oriented, never bare.
 *
 * "No data." and "Failed." are named in §42 as what to avoid. Each of these says
 * what is true and, where the user can do something, what.
 */
const COPY: Record<FreshnessState, { label: string; detail: string }> = {
  LIVE: {
    label: "Live",
    detail: "Streaming from the chain.",
  },
  SYNCING: {
    label: "Syncing",
    detail: "Catching up on recent blocks. Values settle within seconds.",
  },
  DELAYED: {
    label: "Delayed",
    detail:
      "Market data is behind the chain. Quotes are still read live, so a trade prices correctly.",
  },
  RECONNECTING: {
    label: "Reconnecting",
    detail: "Market data is reconnecting. Your funds and on-chain position are unchanged.",
  },
  STALE: {
    label: "Stale",
    detail:
      "This data is too far behind to trade on. Wait for it to recover before acting on these figures.",
  },
};

export interface FreshnessBadgeProps {
  readonly envelope: FreshnessEnvelope;
  /** Compact form for dense rows: the dot and nothing else. */
  readonly compact?: boolean;
}

export function FreshnessBadge({ envelope, compact = false }: FreshnessBadgeProps): JSX.Element {
  const state = envelope.state;
  const copy = COPY[state];

  return (
    <span
      className={`${styles.badge} ${styles[state.toLowerCase()]} ${compact ? styles.compact : ""}`}
      // The tooltip explains the timestamp and source per §211. `title` alone
      // would be hover-only, which §227 forbids depending on — so the text is
      // also in the accessible label.
      title={`${copy.label}. ${copy.detail}`}
      aria-label={`Data freshness: ${copy.label}. ${copy.detail}`}
      data-state={state}
    >
      <span className={styles.dot} aria-hidden="true" />
      {!compact && <span className={styles.label}>{copy.label}</span>}
    </span>
  );
}

/**
 * The blocking form, for a surface that must not be acted on.
 *
 * Returns null unless the state actually warrants interrupting. §211 forbids a
 * giant global warning for anything short of a system-wide issue, so this is
 * used on the trade panel and nowhere else.
 */
export function FreshnessNotice({ envelope }: { envelope: FreshnessEnvelope }): JSX.Element | null {
  const state = envelope.state;
  if (state !== "STALE" && state !== "RECONNECTING") return null;

  return (
    <div className={`${styles.notice} ${styles[state.toLowerCase()]}`} role="status">
      <span className={styles.dot} aria-hidden="true" />
      <span>{COPY[state].detail}</span>
    </div>
  );
}

export type { FreshnessState, FreshnessEnvelope };
