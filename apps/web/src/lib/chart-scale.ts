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

import { formatCompact, formatFixed, placesFor } from "./format.ts";

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

/**
 * Fixed supply, in token wei. 1,000,000,000 × 10^18 (LOCKED, §97).
 *
 * Restated here rather than imported so this module stays free of workspace
 * dependencies. It is a locked economic constant, not a tunable — if it ever
 * changed, every other assumption in the product would change with it.
 */
export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

const WAD = 10n ** 18n;

/**
 * Market capitalisation implied by a marginal price.
 *
 *   p = quoteMc · WAD / supply      (the curve's own definition of p0)
 *   ⇒ quoteMc = p · supply / WAD
 *
 * Inverted from `p0FromReferenceMarketCap`, so the toggle shows the same figure
 * the launch was anchored against rather than a second definition of what a
 * market is worth. Integer throughout: a market cap is a quantity a user reads
 * as money, and floating point has no business in it (§424).
 */
/**
 * A tick label.
 *
 * Compact past six integer digits. A market cap runs to fifteen, and an axis
 * reading `378684037160000` is not a number anyone parses — §41 asks for
 * `1.24M` for exactly this reason, and an axis is the densest place on the
 * screen. Below that threshold the exact figure fits and is more useful.
 */
function axisLabel(value: bigint, decimals: number, places: number): string {
  const whole = value / 10n ** BigInt(decimals);

  return whole.toString().length > 6
    ? formatCompact(value, decimals)
    : formatFixed(value, decimals, { places, pad: true, grouped: true });
}

export function marketCapOf(price: bigint): bigint {
  return (price * TOTAL_SUPPLY) / WAD;
}

/** What the price axis is showing. §57 allows a Price / MC toggle. */
export type PriceMode = "PRICE" | "MCAP";

/** Convert a candle's four prices for display in the selected mode. */
export function inMode(value: bigint, mode: PriceMode): bigint {
  return mode === "MCAP" ? marketCapOf(value) : value;
}

export interface Viewport {
  /** Index of the first visible bar. */
  readonly offset: number;
  /** How many bars are visible. */
  readonly count: number;
}

/** Fewer than this and a chart is a handful of slabs rather than a shape. */
export const MIN_VISIBLE = 8;

/**
 * Clamp a window to a series.
 *
 * Zoom and pan are the two controls most likely to produce an impossible state —
 * a negative offset, a count larger than the data, a window that has scrolled
 * off the end after the series shrank. Every one of those renders as an empty
 * chart, which is indistinguishable from a market with no history.
 *
 * So the window is never trusted and always clamped, and it anchors to the
 * RIGHT: new bars arrive at the newest end, and a chart that drifts away from
 * the live edge as data arrives is the one complaint every trader has.
 */
export function clampWindow(viewport: Viewport, total: number): Viewport {
  if (total <= 0) return { offset: 0, count: 0 };

  const count = Math.max(MIN_VISIBLE, Math.min(Math.round(viewport.count), total));
  const maxOffset = total - count;
  const offset = Math.max(0, Math.min(Math.round(viewport.offset), maxOffset));

  return { offset, count };
}

/**
 * Zoom about a focal point, keeping the bar under the pointer where it is.
 *
 * Zooming about the centre is easier and wrong: the bar a user is pointing at
 * moves away from the pointer, so every zoom needs a corrective pan.
 */
export function zoomWindow(
  viewport: Viewport,
  total: number,
  factor: number,
  focusIndex: number,
): Viewport {
  const current = clampWindow(viewport, total);
  const count = Math.max(MIN_VISIBLE, Math.min(Math.round(current.count * factor), total));

  // Where the focal bar sits within the visible span, as a fraction.
  const position =
    current.count === 0 ? 0.5 : (focusIndex - current.offset) / current.count;

  const offset = Math.round(focusIndex - position * count);

  return clampWindow({ offset, count }, total);
}

/** Pan by a number of bars, clamped to the series. */
export function panWindow(viewport: Viewport, total: number, bars: number): Viewport {
  const current = clampWindow(viewport, total);
  return clampWindow({ offset: current.offset + Math.round(bars), count: current.count }, total);
}

/** True when the window sits against the newest bar. */
export function isAtLiveEdge(viewport: Viewport, total: number): boolean {
  const current = clampWindow(viewport, total);
  return current.offset + current.count >= total;
}

/** Drawing geometry. A viewBox, so resizing is free and needs no listener. */
export const VIEW_W = 1000;
export const VIEW_H = 400;
export const PAD_L = 8;
export const PAD_R = 74; // price axis
export const PAD_T = 12;
export const PAD_B = 28; // time axis
export const VOL_H = 60; // volume band, inside the plot's lower edge

/**
 * Widest a single candle may be drawn, in viewBox units.
 *
 * Without a cap, a market with three trades renders as three slabs spanning the
 * whole plot. The cap is what keeps a young market looking like a young market.
 */
export const MAX_SLOT = 24;

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
      label: axisLabel(value, quoteDecimals, places),
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

      // Capped. Dividing the plot evenly is the obvious implementation and it
      // renders a market with three trades as three enormous slabs filling the
      // screen — technically a correct layout and visibly not a chart.
      const slot = Math.min(plotW / total, MAX_SLOT);

      // Right-aligned, so the newest bar sits against the price axis where a
      // reader looks for it, and a short series leaves its empty space on the
      // left rather than stretching to fill.
      const left = PAD_L + (plotW - slot * total);

      // A one-unit gutter, but never wider than the slot itself — at 500 bars a
      // fixed gutter would leave negative width and the bars would disappear.
      const gap = Math.min(1, slot * 0.2);

      return { x: left + index * slot + gap / 2, w: Math.max(slot - gap, 0.5) };
    },
  };
}
