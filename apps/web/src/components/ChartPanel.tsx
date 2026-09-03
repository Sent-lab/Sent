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
 * NO GRADUATION MARKER YET
 * ------------------------
 * §57 requires one, and `Chart` can draw it — but the API does not yet serve the
 * timestamp at which a market graduated, and there is no way to place the marker
 * correctly without it. Drawing it at the first visible bar would put a precise
 * claim in an arbitrary position, which is worse than leaving it out.
 *
 * The venue indicator, which §57 also requires, IS correct and is passed here:
 * it says whether the price is coming from the curve or the pool, which is the
 * part that changes how the numbers should be read.
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
}

export function ChartPanel({
  token,
  quoteSymbol,
  quoteDecimals,
  graduated,
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
        />
      </div>
    </div>
  );
}
