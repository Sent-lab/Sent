/**
 * SENT — chart scale and geometry.
 *
 * The pure layer under `Chart.tsx`: price range, axis ticks, volume band and bar
 * placement. No JSX, no React, no DOM — so it can be exercised directly by
 * `sim/chart.ts`, which is where the parts that are easy to get subtly wrong
 * actually get checked.
 *
 * INTEGERS UNTIL THE LAST POSSIBLE MOMENT (§424)
 * ----------------------------------------------
 * Prices arrive as BigInt in raw quote units. Min, max, the range and every tick
 * value are computed with integer arithmetic; the ONLY float is the final map to
 * a y coordinate, because a pixel is a float and there is nowhere else for it to
 * go. Nothing a user reads passes through that conversion — every label is
 * formatted from the BigInt.
 */

import { formatFixed, placesFor } from "./format.ts";

/** One OHLCV bar, exactly as the API sends it: every quantity a decimal string. */
export interface Candle {
  /** Bucket start, unix seconds. */
  readonly t: number;
  readonly o: string;
  readonly h: string;
  readonly l: string;
  readonly c: string;
  readonly v: string;
  readonly n: number;
}

/** Must match the API's served set exactly, or a request 400s. */
export const TIMEFRAMES = [
  { seconds: 60, label: "1m" },
  { seconds: 300, label: "5m" },
  { seconds: 900, label: "15m" },
  { seconds: 3_600, label: "1h" },
  { seconds: 14_400, label: "4h" },
  { seconds: 86_400, label: "1D" },
] as const;

/** Drawing geometry. A viewBox, so resizing is free and needs no listener. */
export const VIEW_W = 1000;
export const VIEW_H = 400;
export const PAD_L = 8;
export const PAD_R = 74; // price axis
export const PAD_T = 12;
export const PAD_B = 28; // time axis
export const VOL_H = 60; // volume band, inside the plot's lower edge

export interface Scale {
  readonly ticks: readonly { value: bigint; y: number; label: string }[];
  y(value: bigint): number;
  volumeHeight(value: bigint): number;
  barAt(index: number, total: number): { x: number; w: number };
}

/**
 * Build the price and volume scales.
 *
 * The RANGE is computed in BigInt — min, max and the tick steps are all integer
 * arithmetic on raw quote units. Only the final mapping to a y coordinate
 * becomes a float, because a pixel is a float and there is nowhere else for it
 * to go. Nothing that a user reads as a number passes through that conversion:
 * every label is formatted from the BigInt directly.
 */
export function buildScale(candles: readonly Candle[], quoteDecimals: number): Scale | null {
  if (candles.length === 0) return null;

  let low = BigInt(candles[0]!.l);
  let high = BigInt(candles[0]!.h);
  let maxVolume = 0n;

  for (const candle of candles) {
    const l = BigInt(candle.l);
    const h = BigInt(candle.h);
    const v = BigInt(candle.v);
    if (l < low) low = l;
    if (h > high) high = h;
    if (v > maxVolume) maxVolume = v;
  }

  // A flat market has zero range and would divide by zero. Padding it by a
  // twentieth of the price gives the line somewhere to sit, centred.
  if (high === low) {
    const pad = high / 20n === 0n ? 1n : high / 20n;
    high += pad;
    low = low > pad ? low - pad : 0n;
  }

  const range = high - low;
  const plotTop = PAD_T;
  const plotBottom = VIEW_H - PAD_B - VOL_H;
  const plotHeight = plotBottom - plotTop;

  const y = (value: bigint): number => {
    // Ratio computed in integers scaled by 10^6, then divided once. Converting
    // both operands to Number first would lose precision on a uint256 before the
    // division ever happened.
    const scaled = ((high - value) * 1_000_000n) / range;
    return plotTop + (Number(scaled) / 1_000_000) * plotHeight;
  };

  const ticks: { value: bigint; y: number; label: string }[] = [];
  const TICK_COUNT = 5;

  // Precision from the axis MAXIMUM, applied to every tick. Choosing per tick
  // would give each label a different decimal count and the axis would fail to
  // line up; choosing from the minimum would round the top of the range flat.
  const places = Math.min(placesFor(high, quoteDecimals), 6);

  for (let i = 0; i <= TICK_COUNT; i++) {
    const value = low + (range * BigInt(i)) / BigInt(TICK_COUNT);
    ticks.push({
      value,
      y: y(value),
      // Formatted from the BigInt at the market's OWN decimals, never from the
      // pixel position and never at an assumed eighteen.
      label: formatFixed(value, quoteDecimals, { places, pad: true }),
    });
  }

  return {
    ticks,
    y,
    volumeHeight(value: bigint): number {
      if (maxVolume === 0n) return 0;
      const scaled = (value * 1_000_000n) / maxVolume;
      return (Number(scaled) / 1_000_000) * VOL_H;
    },
    barAt(index: number, total: number): { x: number; w: number } {
      const plotW = VIEW_W - PAD_L - PAD_R;
      const slot = plotW / total;
      // A one-unit gutter, but never wider than the slot itself — at 500 bars a
      // fixed gutter would leave negative width and the bars would disappear.
      const gap = Math.min(1, slot * 0.2);
      return { x: PAD_L + index * slot + gap / 2, w: Math.max(slot - gap, 0.5) };
    },
  };
}
