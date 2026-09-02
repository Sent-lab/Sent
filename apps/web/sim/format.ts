/**
 * SENT — display formatting simulation.
 *
 * These are the numbers a user compares against their own fill. The failure this
 * suite exists to catch is not a crash — it is a figure that is close to right.
 *
 * The reference case: 1234567890123456789012345678 wei. Through
 * `Number(wei) / 1e18` that renders as 1234567890.1234567 and the last nine
 * digits are invented. Everything here stays in integer space, and the tests
 * below prove it by using values well past 2^53.
 */

import {
  formatFixed,
  formatAmount,
  formatCompact,
  formatUsd,
  formatUsdCompact,
  formatBps,
  percentOf,
  placesFor,
  truncateAddress,
  truncateHash,
  formatRelativeTime,
  parseAmount,
} from "../src/lib/format.ts";

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

function eq(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}: expected "${expected}", got "${actual}"`);
    failures += 1;
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const WAD = 10n ** 18n;

// ---------------------------------------------------------------------------

section("Precision survives values that floating point cannot hold");

{
  // The reference case. Past 2^53, so Number() would round it.
  const huge = 1_234_567_890_123_456_789_012_345_678n;

  eq(
    "a 28-digit value keeps every integer digit",
    formatFixed(huge, 18, { places: 0, grouped: true }),
    "1,234,567,890",
  );

  eq(
    "and its fraction is exact, not approximated",
    formatFixed(huge, 18, { places: 18, pad: true }),
    "1234567890.123456789012345678",
  );

  // What the naive implementation produces, kept here so the difference is a
  // number in the test output rather than an assertion in a comment.
  const naive = (Number(huge) / 1e18).toString();
  check("the float route disagrees with the exact one", !naive.includes("123456789012345678"));
  console.log(`       float route: ${naive}`);

  // A full uint256. Nothing may overflow or silently saturate.
  const max = 2n ** 256n - 1n;
  check("a max uint256 formats without throwing", formatFixed(max, 18, { places: 2 }).length > 50);
}

section("Rounding carries correctly");

{
  eq("half rounds up", formatFixed(1_255n, 3, { places: 2, pad: true }), "1.26");
  eq("below half rounds down", formatFixed(1_254n, 3, { places: 2, pad: true }), "1.25");

  // The carry that a naive implementation gets wrong: 9.999 at two places is
  // 10.00, not 9.100 and not 9.00.
  eq("a carry out of the fraction increments the integer", formatFixed(9_999n, 3, { places: 2, pad: true }), "10.00");
  eq("and cascades through nines", formatFixed(99_999n, 4, { places: 3, pad: true }), "10.000");

  // Long fractions must carry digit by digit; Number(kept) + 1 loses precision.
  eq(
    "a long fraction carries without losing digits",
    formatFixed(1_999_999_999_999_999_999n, 18, { places: 17, pad: true }),
    "2.00000000000000000",
  );

  eq("zero places truncates to the integer", formatFixed(1_999n, 3, { places: 0 }), "2");
  eq("trailing zeros are dropped when not padding", formatFixed(1_500n, 3, { places: 3 }), "1.5");
  eq("and kept when padding, for stable width", formatFixed(1_500n, 3, { places: 3, pad: true }), "1.500");
}

section("A value that rounds to zero is not negative");

{
  // "-0.00" reads as a loss that did not happen.
  eq("a tiny negative does not render as -0.00", formatFixed(-1n, 18, { places: 2, pad: true }), "0.00");
  eq("a real negative keeps its sign", formatFixed(-1n * WAD, 18, { places: 2, pad: true }), "-1.00");
  eq("zero is zero", formatFixed(0n, 18, { places: 2, pad: true }), "0.00");
}

section("Precision follows magnitude (§41)");

{
  // 0.0000421 at two places is "0.00", which is not a price.
  const tiny = 42_100_000_000_000n; // 0.0000421
  check("a sub-cent price gets significant digits", placesFor(tiny, 18) > 2);
  eq("and renders them", formatAmount(tiny, 18), "0.0000421");

  const millions = 4_281_033n * WAD;
  check("a seven-figure value drops decimals", placesFor(millions, 18) === 0);
  eq("and is grouped", formatAmount(millions, 18), "4,281,033");

  const units = 12n * WAD + WAD / 2n;
  eq("a small value keeps two places", formatAmount(units, 18), "12.5");

  eq("zero renders plainly", formatAmount(0n, 18), "0");
}

section("Compact notation");

{
  eq("thousands", formatCompact(12_842n * WAD, 18), "12.84K");
  eq("millions", formatCompact(1_240_000n * WAD, 18), "1.24M");
  eq("billions", formatCompact(4_281_000_000n * WAD, 18), "4.28B");
  eq("below a thousand stays exact", formatCompact(842n * WAD, 18), "842");
  eq("a negative keeps its sign", formatCompact(-1_240_000n * WAD, 18), "-1.24M");
}

section("Currency");

{
  eq("the §41 reference figure", formatUsd(12_842_38n, 2), "$12,842.38");
  eq("always two places, for a scannable column", formatUsd(5n * WAD, 18), "$5.00");
  eq("a negative sign precedes the symbol", formatUsd(-5n * WAD, 18), "-$5.00");
  eq("market caps go compact above a million", formatUsdCompact(50_000_000n * WAD, 18), "$50.00M");
  eq("and stay exact below it", formatUsdCompact(50_000n * WAD, 18), "$50,000.00");
}

section("Percentages");

{
  eq("the §41 reference figure", formatBps(1_842n, { signed: true }), "+18.42%");
  eq("a loss is signed", formatBps(-1_842n), "-18.42%");
  eq("unsigned by default", formatBps(82n), "0.82%");
  eq("a full percent", formatBps(10_000n), "100.00%");

  // Graduation progress: token quantities in wei, divided without leaving
  // integer space.
  eq("a ratio of wei quantities", percentOf(657_894_736n * WAD, 10n ** 9n * WAD), "65.78%");
  eq("an empty market is zero, not NaN", percentOf(0n, 0n), "0.00%");
  eq("a complete curve is one hundred", percentOf(5n, 5n), "100.00%");

  // The qG constant. If this drifts, the graduation bar is lying.
  const qG = (50n * 10n ** 9n * WAD) / 76n;
  eq("qG renders as the locked 65.78%", percentOf(qG, 10n ** 9n * WAD), "65.78%");
}

section("Addresses truncate to one shape");

{
  const address = "0x84AbCdEf0123456789AbCdEf0123456789A21AF0";

  eq("the §41 shape", truncateAddress(address, 4, 4), "0x84...1AF0");
  eq("the default shape", truncateAddress(address), "0x84Ab...1AF0");

  // Two truncations of the same address in one interface read as two different
  // addresses, so the default must be stable.
  check(
    "the same address always truncates the same way",
    truncateAddress(address) === truncateAddress(address),
  );

  eq("a hash keeps a longer head", truncateHash(`0x${"a".repeat(64)}`), "0xaaaaaaaa...aaaaaaaa");
  eq("something too short is left alone", truncateAddress("0x1234"), "0x1234");
  eq("a non-address passes through", truncateAddress("sent.hl"), "sent.hl");
}

section("Relative time is coarse on purpose");

{
  const now = 1_700_000_000;

  eq("seconds", formatRelativeTime(now - 3, now), "just now");
  eq("under a minute", formatRelativeTime(now - 42, now), "42s ago");
  eq("minutes", formatRelativeTime(now - 180, now), "3m ago");
  eq("hours", formatRelativeTime(now - 7_200, now), "2h ago");
  eq("days", formatRelativeTime(now - 172_800, now), "2d ago");
  eq("months", formatRelativeTime(now - 5_184_000, now), "2mo ago");
  eq("years", formatRelativeTime(now - 63_072_000, now), "2y ago");

  // Clock skew between the browser and the server must not produce "in -4s".
  eq("a future timestamp does not go negative", formatRelativeTime(now + 60, now), "just now");
}

section("Parsing is the dangerous direction");

{
  check("a whole number parses", parseAmount("5", 18) === 5n * WAD);
  check("a decimal parses exactly", parseAmount("1.5", 18) === 1_500_000_000_000_000_000n);
  check("grouping separators are tolerated", parseAmount("12,842.38", 2) === 1_284_238n);
  check("a leading dot parses", parseAmount(".5", 18) === 500_000_000_000_000_000n);
  check("whitespace is trimmed", parseAmount("  2  ", 18) === 2n * WAD);

  // Mid-typing states are not errors.
  check("an empty input is null, not zero", parseAmount("", 18) === null);
  check("a lone dot is null", parseAmount(".", 18) === null);

  check("letters are refused", parseAmount("1e18", 18) === null);
  check("hex is refused", parseAmount("0x10", 18) === null);
  check("a negative is refused", parseAmount("-1", 18) === null);

  // Truncating silently would sign an amount the user did not type.
  check("more decimals than the asset has is refused", parseAmount("1.123", 2) === null);
  check("exactly as many as it has is accepted", parseAmount("1.12", 2) === 112n);

  // Round trip: what is displayed must parse back to what was displayed.
  const original = 1_234_567_890_123_456_789n;
  const shown = formatFixed(original, 18, { places: 18, pad: true });
  check("format and parse round-trip exactly", parseAmount(shown, 18) === original);

  const grouped = formatFixed(original, 18, { places: 18, pad: true, grouped: true });
  check("even with grouping separators", parseAmount(grouped, 18) === original);
}

section("Width is stable where values tick (§80)");

{
  // A price crossing a power of ten must not change glyph count, or the row
  // reflows on every update.
  const before = formatFixed(9_990_000_000_000_000_000n, 18, { places: 2, pad: true, grouped: true });
  const after = formatFixed(10_010_000_000_000_000_000n, 18, { places: 2, pad: true, grouped: true });

  eq("before", before, "9.99");
  eq("after", after, "10.01");
  // The integer part legitimately grows here; what must NOT vary is the decimal
  // count, which is what padding guarantees.
  check(
    "the decimal count is identical either side",
    before.split(".")[1]?.length === after.split(".")[1]?.length,
  );

  const series = [1n, 999n, 1_000n, 1_000_000n].map((v) =>
    formatFixed(v * WAD, 18, { places: 2, pad: true }),
  );
  check("every padded value has two decimals", series.every((s) => s.split(".")[1]?.length === 2));
}

section("Malformed input is refused, not guessed");

{
  let threw = false;
  try {
    formatFixed(1n, -1, { places: 2 });
  } catch (error) {
    threw = error instanceof RangeError;
  }
  check("negative decimals are refused", threw);

  eq("zero decimals is a plain integer", formatFixed(1_234n, 0, { places: 0, grouped: true }), "1,234");
  eq("negative places are clamped to zero", formatFixed(1_234n, 2, { places: -5 }), "12");
}

console.log(failures === 0 ? "\nformat: all checks passed" : `\nformat: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
