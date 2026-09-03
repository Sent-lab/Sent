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
  TIMEFRAMES,
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

    // A single bar occupies the whole width.
    const only = scale.barAt(0, 1);
    check("one bar starts at the left padding", only.x >= PAD_L - 0.01);
    check("and does not cross the price axis", only.x + only.w <= VIEW_W - PAD_R + 0.01);

    // Adjacent bars must not overlap, or a rising bar paints over its neighbour.
    const a = scale.barAt(10, 100);
    const b = scale.barAt(11, 100);
    check("adjacent bars do not overlap", a.x + a.w <= b.x + 0.01);

    // At the maximum series length the bars must still have positive width. A
    // fixed gutter would go negative here and every bar would vanish.
    const dense = scale.barAt(499, 500);
    check("500 bars still have width", dense.w > 0);
    check("and the last one is inside the plot", dense.x + dense.w <= VIEW_W - PAD_R + 0.01);

    // Bars span the plot end to end rather than bunching at one side.
    const first = scale.barAt(0, 50);
    const last = scale.barAt(49, 50);
    check(
      "the series spans the plot",
      first.x >= PAD_L - 0.01 && last.x + last.w >= PAD_L + plotW - 1,
    );
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

    check("no label is empty", scale.ticks.every((t) => t.label.length > 0));
  }
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
