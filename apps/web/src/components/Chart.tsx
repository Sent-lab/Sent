"use client";

/**
 * SENT — price chart (§57).
 *
 * §57 rules out a generic embedded widget: this must feel like a professional
 * trading terminal. It is hand-drawn SVG rather than a charting library, for
 * three reasons that matter more than the convenience one gives up.
 *
 *   1. Prices are BigInt in raw quote units. Every charting library takes
 *      `number`, so handing one a uint256 price means dividing by 10^decimals in
 *      floating point first — the exact conversion §424 forbids everywhere else
 *      in this codebase. Scaling to pixels is the ONLY place a float is
 *      acceptable, because a pixel is a float, and that conversion happens here
 *      once, after all comparison and range maths is done in integers.
 *
 *   2. §57 wants a graduation marker and a venue indicator. Both are domain
 *      concepts no library knows about, and bolting them on as annotations is
 *      more code than the axis.
 *
 *   3. Bundle. A candlestick library is 40-150 kB for a component that draws
 *      rectangles and lines.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * No zoom, no pan, no drawing tools, no indicators. §57 calls mature chart
 * controls mandatory and these are not them — but a half-built zoom that fights
 * the crosshair is worse than a chart that renders one clean window. Timeframe
 * selection, the crosshair, the tooltip and volume are here; the rest is marked
 * NEXT on the roadmap rather than stubbed.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import { formatFixed, formatCompact, placesFor } from "../lib/format.ts";
import {
  buildScale,
  TIMEFRAMES,
  type Candle,
  VIEW_W,
  VIEW_H,
  PAD_L,
  PAD_R,
  PAD_T,
  PAD_B,
} from "../lib/chart-scale.ts";

import styles from "./Chart.module.css";

export type { Candle };
export { TIMEFRAMES };

export interface ChartProps {
  readonly candles: readonly Candle[];
  readonly quoteDecimals: number;
  readonly quoteSymbol: string;
  readonly intervalSeconds: number;
  readonly onIntervalChange: (seconds: number) => void;
  /**
   * Bucket the market graduated in, for the §57 marker.
   *
   * Optional, and omitted rather than guessed. Callers that do not know the
   * exact bucket must leave it out — a marker at an approximate position states
   * something precise about a moment it did not happen in.
   */
  readonly graduatedAtBucket?: number;
  /** Which venue the prices came from (§57). */
  readonly venue: "Curve" | "Pool";
  readonly loading?: boolean;
}

export function Chart({
  candles,
  quoteDecimals,
  quoteSymbol,
  intervalSeconds,
  onIntervalChange,
  graduatedAtBucket,
  venue,
  loading = false,
}: ChartProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const scale = useMemo(() => buildScale(candles, quoteDecimals), [candles, quoteDecimals]);

  /**
   * Map a pointer position to a bar index.
   *
   * Derived from the SVG's own bounding box rather than from a stored width, so
   * it stays correct through a resize without a ResizeObserver (§57: responsive
   * resizing).
   */
  const onMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (svg === null || scale === null) return;

      const box = svg.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * VIEW_W;
      const plotW = VIEW_W - PAD_L - PAD_R;
      const index = Math.floor(((x - PAD_L) / plotW) * candles.length);

      setHover(index >= 0 && index < candles.length ? index : null);
    },
    [candles.length, scale],
  );

  const active = hover !== null ? candles[hover] : undefined;
  const last = candles[candles.length - 1];

  return (
    <div className={styles.root}>
      <header className={styles.controls}>
        <div className={styles.timeframes} role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((frame) => (
            <button
              key={frame.seconds}
              type="button"
              className={frame.seconds === intervalSeconds ? styles.frameActive : styles.frame}
              aria-pressed={frame.seconds === intervalSeconds}
              onClick={() => onIntervalChange(frame.seconds)}
            >
              {frame.label}
            </button>
          ))}
        </div>

        {/*
          §57's current venue indicator. Which venue a price came from is not a
          detail: before graduation it is the curve, after it is the pool, and a
          chart that does not say so implies one continuous book.
        */}
        <span className={styles.venue}>{venue}</span>
      </header>

      <div className={styles.plot}>
        {scale === null ? (
          <p className={styles.empty}>
            {loading
              ? "Loading candles."
              : "No trades in this window yet. The first one draws the first bar."}
          </p>
        ) : (
          <svg
            ref={svgRef}
            className={styles.svg}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Price chart, ${candles.length} bars`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {/* Horizontal guides at the axis ticks, so the eye can carry a level
                across without a crosshair. */}
            {scale.ticks.map((tick) => (
              <g key={tick.value.toString()}>
                <line
                  className={styles.grid}
                  x1={PAD_L}
                  x2={VIEW_W - PAD_R}
                  y1={tick.y}
                  y2={tick.y}
                />
                <text className={styles.axisLabel} x={VIEW_W - PAD_R + 6} y={tick.y + 3}>
                  {tick.label}
                </text>
              </g>
            ))}

            {/* Volume, in the band below the price. Same x positions as the
                candles, so a bar and its volume always line up. */}
            {candles.map((candle, index) => {
              const geo = scale.barAt(index, candles.length);
              const vol = scale.volumeHeight(BigInt(candle.v));
              const rising = BigInt(candle.c) >= BigInt(candle.o);

              return (
                <rect
                  key={`v${candle.t}`}
                  className={rising ? styles.volUp : styles.volDown}
                  x={geo.x}
                  width={geo.w}
                  y={VIEW_H - PAD_B - vol}
                  height={vol}
                />
              );
            })}

            {/* Candles. Wick then body, so a doji's body still shows over its
                own wick. */}
            {candles.map((candle, index) => {
              const geo = scale.barAt(index, candles.length);
              const o = scale.y(BigInt(candle.o));
              const c = scale.y(BigInt(candle.c));
              const h = scale.y(BigInt(candle.h));
              const l = scale.y(BigInt(candle.l));
              const rising = BigInt(candle.c) >= BigInt(candle.o);

              const top = Math.min(o, c);
              // A flat bar would render as a zero-height rect and vanish; one
              // pixel keeps it visible as the doji it is.
              const height = Math.max(Math.abs(c - o), 1);

              return (
                <g key={candle.t} className={rising ? styles.up : styles.down}>
                  <line
                    className={styles.wick}
                    x1={geo.x + geo.w / 2}
                    x2={geo.x + geo.w / 2}
                    y1={h}
                    y2={l}
                  />
                  <rect className={styles.body} x={geo.x} width={geo.w} y={top} height={height} />
                </g>
              );
            })}

            {/* §57's graduation marker. A labelled rule, not a colour change:
                the moment a market changed venue is a fact about the data. */}
            {graduatedAtBucket !== undefined &&
              (() => {
                const index = candles.findIndex((candle) => candle.t >= graduatedAtBucket);
                if (index < 0) return null;
                const geo = scale.barAt(index, candles.length);

                return (
                  <g>
                    <line
                      className={styles.graduation}
                      x1={geo.x}
                      x2={geo.x}
                      y1={PAD_T}
                      y2={VIEW_H - PAD_B}
                    />
                    <text className={styles.graduationLabel} x={geo.x + 4} y={PAD_T + 10}>
                      Graduated
                    </text>
                  </g>
                );
              })()}

            {/* Crosshair. Only the vertical rule: a horizontal one at the
                pointer implies a price the pointer is not actually on. */}
            {hover !== null && active !== undefined && (
              <line
                className={styles.crosshair}
                x1={scale.barAt(hover, candles.length).x + scale.barAt(hover, candles.length).w / 2}
                x2={scale.barAt(hover, candles.length).x + scale.barAt(hover, candles.length).w / 2}
                y1={PAD_T}
                y2={VIEW_H - PAD_B}
              />
            )}

            {/* Last price, marked on the axis. */}
            {last !== undefined && (
              <g>
                <line
                  className={styles.lastLine}
                  x1={PAD_L}
                  x2={VIEW_W - PAD_R}
                  y1={scale.y(BigInt(last.c))}
                  y2={scale.y(BigInt(last.c))}
                />
                <text
                  className={styles.lastLabel}
                  x={VIEW_W - PAD_R + 6}
                  y={scale.y(BigInt(last.c)) + 3}
                >
                  {formatFixed(BigInt(last.c), quoteDecimals, {
                    places: placesFor(BigInt(last.c), quoteDecimals),
                    pad: true,
                  })}
                </text>
              </g>
            )}
          </svg>
        )}

        {/*
          Tooltip in HTML rather than SVG text: it needs the design system's type
          and spacing, and an SVG one would need every rule restated in
          presentation attributes.
        */}
        {active !== undefined && (
          <div className={styles.tooltip} role="status">
            <span className={styles.tooltipTime}>{formatBucket(active.t, intervalSeconds)}</span>
            <dl className={styles.tooltipRows}>
              <Row label="O" value={price(active.o, quoteDecimals)} />
              <Row label="H" value={price(active.h, quoteDecimals)} />
              <Row label="L" value={price(active.l, quoteDecimals)} />
              <Row label="C" value={price(active.c, quoteDecimals)} />
              <Row label="Vol" value={`${formatCompact(BigInt(active.v), quoteDecimals)} ${quoteSymbol}`} />
              <Row label="Trades" value={String(active.n)} />
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={styles.tooltipRow}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function price(raw: string, decimals: number): string {
  const value = BigInt(raw);
  return formatFixed(value, decimals, { places: placesFor(value, decimals), pad: true });
}

/**
 * Bucket label.
 *
 * Fixed to UTC so the server and the browser agree: a locale-formatted time
 * differs between them and React reports a hydration mismatch. Coarse intervals
 * show the date, fine ones the time — a 1m chart labelled with dates is useless
 * and a 1D chart labelled with times is noise.
 */
function formatBucket(bucket: number, intervalSeconds: number): string {
  const date = new Date(bucket * 1000);

  if (intervalSeconds >= 86_400) {
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  return `${date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })} ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}
