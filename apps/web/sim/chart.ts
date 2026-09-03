/**
 * SENT — chart scale simulation.
 *
 * The chart draws rectangles, and getting rectangles wrong is obvious. What is
 * NOT obvious is the scale underneath them: a price range computed in floating
 * point looks perfectly fine on a $1 token and silently collapses on one priced
 * in raw uint256 units.
 *
 * So this tests the part that has no pixels in it — the integer range maths, the
 * axis labels, the degenerate cases — and the one boundary where an integer does
 * become a float.
 */

import {
  buildScale,
  VIEW_H,
  VIEW_W,
  PAD_T,
  PAD_B,
  PAD_L,
  PAD_R,
  VOL_H,
  MAX_SLOT,
  TIMEFRAMES,
  TOTAL_SUPPLY,
  marketCapOf,
  inMode,
  clampWindow,
  zoomWindow,
  panWindow,
  isAtLiveEdge,
  MIN_VISIBLE,
  type Candle,
} from "../src/lib/chart-scale.ts";

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

function bar(t: number, o: bigint, h: bigint, l: bigint, c: bigint, v = 100n): Candle {
  return { t, o: o.toString(), h: h.toString(), l: l.toString(), c: c.toString(), v: v.toString(), n: 1 };
}

const PLOT_TOP = PAD_T;
const PLOT_BOTTOM = VIEW_H - PAD_B - VOL_H;

// ---------------------------------------------------------------------------

section("Prices beyond floating point still map correctly");

{
  // Raw 18-decimal quote units, well past 2^53. A scale that converted to
  // Number before comparing would find these two values equal.
  const low = 1_000_000_000_000_000_000_000n;
  const high = 1_000_000_000_000_000_000_001n;

  const scale = buildScale([bar(0, low, high, low, high)], 18);
  check("a scale is built", scale !== null);

  if (scale !== null) {
    // One wei apart, and they must NOT land on the same pixel row after the
    // range is padded — the padding is what gives a flat market its height.
    check("the high maps above the low", scale.y(high) < scale.y(low));
  }
}

{
  // A full-width uint256 must not overflow or produce NaN anywhere.
  const huge = 2n ** 200n;
  const scale = buildScale([bar(0, huge / 2n, huge, 1n, huge / 3n)], 18);

  check("an enormous range builds", scale !== null);
  if (scale !== null) {
    check("the top of the range is finite", Number.isFinite(scale.y(huge)));
    check("the bottom is finite", Number.isFinite(scale.y(1n)));
    check("no label is NaN", scale.ticks.every((t) => !t.label.includes("NaN")));
  }
}

section("The plot stays inside its box");

{
  const candles = [
    bar(0, 100n, 140n, 90n, 120n),
    bar(60, 120n, 130n, 110n, 115n),
    bar(120, 115n, 160n, 100n, 155n),
  ];

  const scale = buildScale(candles, 18);
  check("built", scale !== null);

  if (scale !== null) {
    // The extremes map to the plot edges, and nothing escapes them — a bar drawn
    // outside the box would overlap the axis or the volume band.
    check("the highest price sits at the top of the plot", Math.abs(scale.y(160n) - PLOT_TOP) < 0.01);
    check("the lowest sits at the bottom", Math.abs(scale.y(90n) - PLOT_BOTTOM) < 0.01);

    const ys = candles.flatMap((c) => [scale.y(BigInt(c.h)), scale.y(BigInt(c.l))]);
    check("every bar is within the plot", ys.every((y) => y >= PLOT_TOP - 0.01 && y <= PLOT_BOTTOM + 0.01));

    // Higher price, smaller y. Getting this backwards draws the chart upside
    // down, which is obvious on a trending market and not on a flat one.
    check("y decreases as price rises", scale.y(160n) < scale.y(90n));
  }
}

section("Degenerate inputs do not divide by zero");

{
  check("no candles yields no scale", buildScale([], 18) === null);

  // A market that has not moved has zero range. Without padding this divides by
  // zero and every bar becomes NaN.
  const flat = buildScale([bar(0, 100n, 100n, 100n, 100n)], 18);
  check("a completely flat market builds", flat !== null);

  if (flat !== null) {
    check("its price is finite", Number.isFinite(flat.y(100n)));
    // Centred rather than pinned to an edge: a flat line drawn along the top of
    // the plot reads as a market at its high.
    const y = flat.y(100n);
    check("and sits inside the plot, not on an edge", y > PLOT_TOP + 1 && y < PLOT_BOTTOM - 1);
  }

  // A market at zero — nothing has traded above zero — must not underflow when
  // the padding is subtracted.
  const zero = buildScale([bar(0, 0n, 0n, 0n, 0n)], 18);
  check("a zero-priced market builds", zero !== null);
  if (zero !== null) check("without a negative coordinate", zero.y(0n) >= 0);
}

section("Volume scales independently of price");

{
  const candles = [bar(0, 100n, 110n, 90n, 105n, 0n), bar(60, 105n, 115n, 100n, 110n, 500n)];
  const scale = buildScale(candles, 18);

  if (scale !== null) {
    check("the largest volume fills the band", Math.abs(scale.volumeHeight(500n) - VOL_H) < 0.01);
    check("zero volume has no height", scale.volumeHeight(0n) === 0);
    check("half the maximum is half the band", Math.abs(scale.volumeHeight(250n) - VOL_H / 2) < 0.01);
  }

  // Every bar having zero volume must not divide by zero.
  const silent = buildScale([bar(0, 100n, 110n, 90n, 105n, 0n)], 18);
  if (silent !== null) {
    check("an all-zero volume band is flat, not NaN", silent.volumeHeight(0n) === 0);
  }
}

section("Bars fill the plot without overlapping");

{
  const scale = buildScale([bar(0, 1n, 2n, 1n, 2n)], 18);

  if (scale !== null) {
    const plotW = VIEW_W - PAD_L - PAD_R;

    // A single bar is capped and sits at the RIGHT edge. Letting it divide the
    // plot evenly renders one trade as a slab across the whole chart — a correct
    // layout that does not look like a chart.
    const only = scale.barAt(0, 1);
    check("a lone bar is not wider than the cap", only.w <= MAX_SLOT);
    check("and sits against the price axis", only.x + only.w >= VIEW_W - PAD_R - MAX_SLOT);
    check("still inside the plot", only.x >= PAD_L - 0.01 && only.x + only.w <= VIEW_W - PAD_R + 0.01);

    // A short series clusters at the right rather than stretching.
    const short = [scale.barAt(0, 3), scale.barAt(1, 3), scale.barAt(2, 3)];
    check("a three-bar series stays narrow", short.every((b) => b.w <= MAX_SLOT));
    check(
      "and ends at the right edge",
      (short[2]?.x ?? 0) + (short[2]?.w ?? 0) >= VIEW_W - PAD_R - 1,
    );
    check("leaving its empty space on the left", (short[0]?.x ?? 0) > PAD_L + 100);

    // Adjacent bars must not overlap, or a rising bar paints over its neighbour.
    const a = scale.barAt(10, 100);
    const b = scale.barAt(11, 100);
    check("adjacent bars do not overlap", a.x + a.w <= b.x + 0.01);

    // At the maximum series length the bars must still have positive width. A
    // fixed gutter would go negative here and every bar would vanish.
    const dense = scale.barAt(499, 500);
    check("500 bars still have width", dense.w > 0);
    check("and the last one is inside the plot", dense.x + dense.w <= VIEW_W - PAD_R + 0.01);

    // A full series fills the plot: at 500 bars the slot is well under the cap,
    // so the whole width is used and the left edge is reached.
    const first = scale.barAt(0, 500);
    const last = scale.barAt(499, 500);
    check("a full series starts at the left padding", first.x >= PAD_L - 0.01 && first.x < PAD_L + 5);
    check("and ends at the price axis", last.x + last.w >= PAD_L + plotW - 1);
  }
}

section("Axis labels come from the integers, not the pixels");

{
  // Six decimals, like a real xStock. Labels formatted at eighteen would be a
  // trillion times too small — the bug already fixed on the explore cards.
  const scale = buildScale([bar(0, 1_000_000n, 2_000_000n, 500_000n, 1_500_000n)], 6);
  check("built at six decimals", scale !== null);

  if (scale !== null) {
    check("six ticks", scale.ticks.length === 6);

    // Ticks ascend in value and descend in y.
    const ascending = scale.ticks.every((t, i) => i === 0 || t.value > scale.ticks[i - 1]!.value);
    check("tick values ascend", ascending);
    check(
      "tick positions descend",
      scale.ticks.every((t, i) => i === 0 || t.y < scale.ticks[i - 1]!.y),
    );

    // At six decimals, 2_000_000 raw is 2.0 — not 0.000000000002.
    const top = scale.ticks[scale.ticks.length - 1];
    check("the top label reads at the market's own scale", top?.label.startsWith("2") === true);

    // Every label must have the same decimal count, or the axis will not align.
    const decimals = scale.ticks.map((t) => t.label.split(".")[1]?.length ?? 0);
    check("every label has the same precision", new Set(decimals).size === 1);
  }
}

{
  // A market-cap axis runs to fifteen digits. `378684037160000` is not a number
  // anyone parses off an axis (§41).
  const big = 378_684_037_160_000n * 10n ** 6n;
  const scale = buildScale([bar(0, big, big * 2n, big, big * 2n)], 6);

  if (scale !== null) {
    const label = scale.ticks[scale.ticks.length - 1]?.label ?? "";
    check("a large axis value is compact", /[KMBT]$/.test(label));
    check("and short enough to read", label.length <= 10);

    // Small values keep their exact figure, which is more useful when it fits.
    const small = buildScale([bar(0, 1_000_000n, 2_000_000n, 1_000_000n, 2_000_000n)], 6);
    const smallLabel = small?.ticks[small.ticks.length - 1]?.label ?? "";
    check("a small axis value stays exact", !/[KMBT]$/.test(smallLabel));

    check("no label is empty", scale.ticks.every((t) => t.label.length > 0));
  }
}

section("Market cap is the curve's own definition, inverted");

{
  // p = quoteMc * WAD / supply, so quoteMc = p * supply / WAD. A price of one
  // whole quote unit per token across a billion tokens is a billion.
  const oneUnit = 10n ** 18n;
  check("one unit of price is a billion of market cap", marketCapOf(oneUnit) === 1_000_000_000n * oneUnit);

  check("zero price is zero market cap", marketCapOf(0n) === 0n);

  // Monotonic: a higher price is always a higher market cap on fixed supply.
  check(
    "market cap rises with price",
    marketCapOf(oneUnit * 2n) > marketCapOf(oneUnit),
  );

  // Past floating point. A market cap is money on screen.
  const huge = 10n ** 30n;
  check(
    "a price beyond 2^53 converts exactly",
    marketCapOf(huge) === (huge * TOTAL_SUPPLY) / 10n ** 18n,
  );

  check("PRICE mode leaves the value alone", inMode(12_345n, "PRICE") === 12_345n);
  check("MCAP mode converts it", inMode(oneUnit, "MCAP") === marketCapOf(oneUnit));
}

section("The zoom window can never reach an impossible state");

{
  // Every one of these renders as an empty chart, which is indistinguishable
  // from a market with no history.
  check("an empty series yields an empty window", clampWindow({ offset: 5, count: 20 }, 0).count === 0);

  check(
    "a negative offset is clamped to the start",
    clampWindow({ offset: -50, count: 20 }, 100).offset === 0,
  );

  check(
    "a count larger than the series is clamped to it",
    clampWindow({ offset: 0, count: 500 }, 100).count === 100,
  );

  check(
    "a window past the end is pulled back",
    clampWindow({ offset: 95, count: 20 }, 100).offset === 80,
  );

  check(
    "it never zooms below the minimum",
    clampWindow({ offset: 0, count: 1 }, 100).count === MIN_VISIBLE,
  );

  // A series that shrank under a window — a reorg removing bars — must not
  // leave the window pointing past the end.
  check("a shrunk series pulls the window back", clampWindow({ offset: 90, count: 20 }, 30).offset === 10);

  const clamped = clampWindow({ offset: 10, count: 20 }, 100);
  check("a valid window is unchanged", clamped.offset === 10 && clamped.count === 20);
}

section("Zoom keeps the focal bar under the pointer");

{
  const total = 200;
  const start = { offset: 50, count: 100 };

  // Zooming in about bar 100 must keep bar 100 at the same relative position, so
  // the bar under the pointer does not slide away and need a corrective pan.
  const zoomed = zoomWindow(start, total, 0.5, 100);

  const before = (100 - start.offset) / start.count;
  const after = (100 - zoomed.offset) / zoomed.count;

  check("zooming in halves the span", zoomed.count === 50);
  check("and the focal bar holds its position", Math.abs(before - after) < 0.05);
  check("the window stays inside the series", zoomed.offset >= 0 && zoomed.offset + zoomed.count <= total);

  const out = zoomWindow(zoomed, total, 2, 100);
  check("zooming back out restores the span", out.count === 100);

  // Zooming out past the whole series must stop at the series.
  const way = zoomWindow(start, total, 100, 100);
  check("zooming out is bounded by the data", way.count === total && way.offset === 0);

  // Zooming in past the floor stops at the floor rather than inverting.
  const tight = zoomWindow(start, total, 0.0001, 100);
  check("zooming in is bounded by the minimum", tight.count === MIN_VISIBLE);
}

section("Panning and the live edge");

{
  const total = 200;

  check("panning right moves forward", panWindow({ offset: 50, count: 50 }, total, 10).offset === 60);
  check("panning left moves back", panWindow({ offset: 50, count: 50 }, total, -10).offset === 40);
  check("panning past the start stops", panWindow({ offset: 5, count: 50 }, total, -100).offset === 0);
  check(
    "panning past the end stops at the newest bar",
    panWindow({ offset: 100, count: 50 }, total, 500).offset === 150,
  );

  // The live edge is what a chart must hold as new bars arrive, or it drifts
  // away from the price while the market moves.
  check("a window at the end is at the live edge", isAtLiveEdge({ offset: 150, count: 50 }, total));
  check("a window in the middle is not", !isAtLiveEdge({ offset: 50, count: 50 }, total));
  check("a full-series window is at the live edge", isAtLiveEdge({ offset: 0, count: total }, total));
}

section("Timeframes match what the API serves");

{
  // The API validates against its own list and refuses anything else, so a
  // mismatch here is a button that always 400s.
  const served = [60, 300, 900, 3_600, 14_400, 86_400];

  check("six timeframes", TIMEFRAMES.length === 6);
  check(
    "every timeframe is one the API serves",
    TIMEFRAMES.every((frame) => served.includes(frame.seconds)),
  );
  check(
    "and every served interval has a button",
    served.every((seconds) => TIMEFRAMES.some((frame) => frame.seconds === seconds)),
  );
  check("they ascend", TIMEFRAMES.every((f, i) => i === 0 || f.seconds > TIMEFRAMES[i - 1]!.seconds));
}

console.log(failures === 0 ? "\nchart: all checks passed" : `\nchart: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
