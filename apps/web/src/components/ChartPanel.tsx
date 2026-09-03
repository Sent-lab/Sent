"use client";

/**
 * SENT — chart panel.
 *
 * The client half of the chart: holds the selected timeframe, fetches candles
 * for it, and hands them to the pure `Chart` renderer.
 *
 * WHY THE SPLIT
 * -------------
 * `Chart` takes candles and draws them. Everything about WHICH candles — the
 * timeframe, the request, the loading and error states — lives here. That keeps
 * the drawing code free of effects, which is what makes its scale maths, its
 * geometry and its formatting reviewable on their own.
 *
 * THE PREVIOUS BARS STAY UP WHILE NEW ONES LOAD
 * ---------------------------------------------
 * Switching from 1m to 1h blanks the chart in most implementations. Here the
 * old series stays rendered and dims until the new one lands: an empty plot
 * reads as "this market has no history", which is a different and wrong claim.
 *
 * THE GRADUATION MARKER IS PLACED, NOT GUESSED (§57)
 * --------------------------------------------------
 * The API serves the chain timestamp of the block a market graduated in, and the
 * marker goes in the bucket that CONTAINS that timestamp — floored to the
 * interval, exactly as the aggregator buckets trades. Any other placement would
 * put a precise-looking claim next to the wrong bar.
 *
 * It is omitted entirely when the moment falls outside the visible window. A
 * marker clamped to the edge of the chart would say "it happened here" about a
 * bar it did not happen in.
 */

import { useEffect, useState } from "react";
import type { JSX } from "react";

import { getCandles, isOk, type CandleResponse } from "../lib/api.ts";
import { Chart } from "./Chart.tsx";

import styles from "./ChartPanel.module.css";

export interface ChartPanelProps {
  readonly token: string;
  readonly quoteSymbol: string;
  readonly quoteDecimals: number;
  readonly graduated: boolean;
  /** Chain timestamp of the graduating block, or null. */
  readonly graduatedAt: number | null;
}

export function ChartPanel({
  token,
  quoteSymbol,
  quoteDecimals,
  graduated,
  graduatedAt,
}: ChartPanelProps): JSX.Element {
  // Five minutes: long enough that a quiet market still shows shape, short
  // enough that an active one moves.
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [data, setData] = useState<CandleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);

    void (async () => {
      try {
        const result = await getCandles(token, intervalSeconds, 200, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (isOk(result)) {
          setData(result.data);
          setError(null);
        } else {
          // The previous series is kept: a failed refresh should not erase
          // history that is still perfectly valid to look at.
          setError(result.message);
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Market data is reconnecting. Your funds and on-chain position are unchanged.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [token, intervalSeconds]);

  return (
    <div className={styles.root}>
      {error !== null && <p className={styles.error}>{error}</p>}

      <div className={loading && data !== null ? styles.dim : styles.plain}>
        <Chart
          candles={data?.candles ?? []}
          // From the response, so the axis is drawn at the market's own scale
          // even if the page's own market load and this one ever disagreed.
          quoteDecimals={data?.quoteDecimals ?? quoteDecimals}
          quoteSymbol={quoteSymbol}
          intervalSeconds={intervalSeconds}
          onIntervalChange={setIntervalSeconds}
          loading={loading}
          {...(graduated ? { venue: "Pool" as const } : { venue: "Curve" as const })}
          {...markerFor(graduatedAt, intervalSeconds, data?.candles ?? [])}
        />
      </div>
    </div>
  );
}

/**
 * Which bucket to mark, if any.
 *
 * Floors the graduation timestamp to the interval — the same rule the candle
 * aggregator uses, so the marker lands on the bar that actually contains the
 * event rather than beside it.
 *
 * Returns nothing when the bucket is outside the loaded window. Clamping it to
 * an edge would assert that graduation happened in a bar it did not.
 */
function markerFor(
  graduatedAt: number | null,
  intervalSeconds: number,
  candles: readonly { t: number }[],
): { graduatedAtBucket?: number } {
  if (graduatedAt === null || candles.length === 0) return {};

  const bucket = Math.floor(graduatedAt / intervalSeconds) * intervalSeconds;

  const first = candles[0]?.t ?? 0;
  const last = candles[candles.length - 1]?.t ?? 0;
  if (bucket < first || bucket > last) return {};

  return { graduatedAtBucket: bucket };
}
