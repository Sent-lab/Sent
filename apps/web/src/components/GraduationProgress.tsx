/**
 * SENT — graduation progress (§199).
 *
 * Percentage, visual progress, current status, endpoint context. Updates live
 * without layout shift.
 *
 * WHAT §199 FORBIDS, AND WHY EACH ONE IS EASY TO DO BY ACCIDENT
 * -------------------------------------------------------------
 * No casino flashing. Emphasis near the endpoint is allowed, so the temptation
 * is a pulse that speeds up as the bar fills — which turns a market state into
 * a slot machine. Here the only change near the endpoint is a steady glow.
 *
 * No misleading urgency. The bar never implies a deadline, because there is not
 * one: §-level rule, markets do not expire. Nothing here says "hurry".
 *
 * No fake countdown. There is no time component at all. Graduation happens when
 * the curve reaches qG and not before, so a countdown would be fiction.
 *
 * PROGRESS IS A RATIO OF INTEGERS
 * -------------------------------
 * The API sends basis points as a string. Rendering it means dividing by 100,
 * which is done in `formatBps` on a BigInt — not `Number(bps) / 100`, which is
 * fine at these magnitudes and would still be the wrong habit in the one module
 * a reader checks to learn how this codebase treats numbers.
 */

import { formatBps } from "../lib/format.ts";

import styles from "./GraduationProgress.module.css";
import type { JSX } from "react";

/** The milestones §199 names. Purely presentational — nothing on-chain changes. */
const MILESTONES = [2_500n, 5_000n, 7_500n, 9_000n] as const;

export type MarketStatus = "PRE_GRAD" | "GRADUATING" | "GRADUATED";

export interface GraduationProgressProps {
  /** Progress in basis points, as the API sends it. */
  readonly progressBps: string;
  readonly status: MarketStatus;
  /** Quote symbol, for the endpoint context §199 asks for. */
  readonly quoteSymbol?: string;
  readonly size?: "sm" | "md" | "lg";
}

export function GraduationProgress({
  progressBps,
  status,
  quoteSymbol,
  size = "md",
}: GraduationProgressProps): JSX.Element {
  const bps = clampBps(progressBps);
  const percent = Number(bps) / 100;

  // Emphasis rises only in the last tenth, and only as a steady glow.
  const nearEndpoint = bps >= 9_000n && status === "PRE_GRAD";

  return (
    <div
      className={`${styles.root} ${styles[size]} ${nearEndpoint ? styles.near : ""}`}
      data-status={status}
    >
      <div className={styles.header}>
        <span className={styles.label}>{statusLabel(status)}</span>
        {/* Tabular figures and a reserved width: this ticks live, and a
            proportional 1 next to a proportional 7 shifts the row (§41, §80). */}
        <span className={`${styles.percent} num`}>
          {status === "GRADUATED" ? "100.00%" : formatBps(bps)}
        </span>
      </div>

      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Graduation progress: ${formatBps(bps)}`}
      >
        <div
          className={styles.fill}
          // The only inline style in the component, because it is the one value
          // that genuinely changes per render.
          style={{ width: `${percent}%` }}
        />

        {MILESTONES.map((milestone) => (
          <span
            key={String(milestone)}
            className={`${styles.milestone} ${bps >= milestone ? styles.passed : ""}`}
            style={{ left: `${Number(milestone) / 100}%` }}
            aria-hidden="true"
          />
        ))}
      </div>

      {quoteSymbol !== undefined && size !== "sm" && (
        <p className={styles.context}>
          {status === "GRADUATED"
            ? `Liquidity is permanently locked in the ${quoteSymbol} pool.`
            : `At 100% the market graduates to a permanently locked ${quoteSymbol} pool.`}
        </p>
      )}
    </div>
  );
}

/**
 * Parse basis points defensively.
 *
 * The value comes off the wire. A malformed one must render as zero rather than
 * throw inside a card in a grid, and must never exceed 10000 — a bar drawn past
 * its track is a rendering bug that looks like a market state.
 */
function clampBps(value: string): bigint {
  if (!/^\d+$/.test(value)) return 0n;
  const bps = BigInt(value);
  return bps > 10_000n ? 10_000n : bps;
}

/** §228: consistent terminology. Graduating and Graduated, never "migrated". */
function statusLabel(status: MarketStatus): string {
  switch (status) {
    case "GRADUATED":
      return "Graduated";
    case "GRADUATING":
      return "Graduating";
    default:
      return "Graduation progress";
  }
}
