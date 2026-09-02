/**
 * SENT — display formatting.
 *
 * §41 requires the interface to show `$12,842.38`, `1.24M`, `+18.42%`, `0x84...21AF`
 * rather than raw 18-decimal blockchain output. This module is the only place
 * that conversion happens.
 *
 * NOTHING HERE DIVIDES BY 10^18 IN FLOATING POINT (§424)
 * ------------------------------------------------------
 * The obvious implementation is `Number(wei) / 1e18`, and it is wrong in a way
 * that is invisible until it matters. A uint256 above 2^53 loses precision on
 * the conversion, so a balance of 1234567890123456789012345678 wei renders as a
 * number that is close to right and is not right. Users compare these figures
 * against their own fills.
 *
 * So every conversion is integer arithmetic on BigInt, and the decimal point is
 * inserted into a STRING. The only place a JS number appears is the final glyph
 * count for grouping separators, which cannot affect a value.
 *
 * PRECISION FOLLOWS CONTEXT, NOT THE CHAIN (§41)
 * ----------------------------------------------
 * A price near zero needs more decimals than a market cap in the millions.
 * Showing 18 decimals everywhere is not precision, it is noise; showing two
 * everywhere renders a $0.000042 token as $0.00. Both are covered below.
 *
 * WIDTH IS RESERVED, NOT DISCOVERED (§41, §80)
 * --------------------------------------------
 * Values are formatted to a stable glyph count wherever they update live, so a
 * price ticking from 9.99 to 10.01 does not reflow the row it sits in. Zero
 * layout shift is §80 and it is mandatory.
 */

/** Grouping separator inserted every three digits of the integer part. */
const GROUP = ",";

/**
 * Split a fixed-point integer into its integer and fractional digits.
 *
 * Pure string surgery on the decimal representation — no division, so nothing
 * can round. Returns the fraction padded to `decimals` places.
 */
function split(value: bigint, decimals: number): {
  negative: boolean;
  integer: string;
  fraction: string;
} {
  if (decimals < 0) throw new RangeError(`format: decimals must not be negative, got ${decimals}`);

  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");

  return {
    negative,
    integer: decimals === 0 ? digits : digits.slice(0, digits.length - decimals),
    fraction: decimals === 0 ? "" : digits.slice(digits.length - decimals),
  };
}

/** Insert thousands separators into a run of digits. */
function group(integer: string): string {
  let out = "";
  for (let i = 0; i < integer.length; i++) {
    if (i > 0 && (integer.length - i) % 3 === 0) out += GROUP;
    out += integer[i];
  }
  return out;
}

/**
 * Round a fraction string to `places`, carrying into the integer part.
 *
 * Half-up on the decimal digits, done as string comparison rather than
 * arithmetic. Returns the carry so the caller can apply it to the integer.
 */
function round(fraction: string, places: number): { fraction: string; carry: boolean } {
  if (places >= fraction.length) {
    return { fraction: fraction.padEnd(places, "0"), carry: false };
  }

  const kept = fraction.slice(0, places);
  const next = fraction.charCodeAt(places) - 48;

  if (next < 5) return { fraction: kept, carry: false };

  // Carry by hand, right to left. `Number(kept) + 1` would lose digits for a
  // long fraction, which is the whole failure this module exists to avoid.
  const digits = kept.split("");
  let i = digits.length - 1;

  while (i >= 0) {
    if (digits[i] === "9") {
      digits[i] = "0";
      i -= 1;
      continue;
    }
    digits[i] = String(Number(digits[i]) + 1);
    return { fraction: digits.join(""), carry: false };
  }

  // Every kept digit was a nine: the carry leaves the fraction entirely.
  return { fraction: "0".repeat(places), carry: true };
}

export interface FixedOptions {
  /** Decimal places to show. */
  readonly places: number;
  /** Keep trailing zeros so the glyph count is stable (§80). */
  readonly pad?: boolean;
  /** Insert thousands separators. */
  readonly grouped?: boolean;
}

/**
 * Format a fixed-point integer for display.
 *
 * `formatFixed(1234567890123456789n, 18, { places: 4 })` → `"1.2346"`.
 */
export function formatFixed(
  value: bigint,
  decimals: number,
  options: FixedOptions,
): string {
  const { negative, integer, fraction } = split(value, decimals);
  const rounded = round(fraction, Math.max(0, options.places));

  let whole = integer;
  if (rounded.carry) {
    // The fraction rolled over: 9.9999 at two places is 10.00, not 9.100.
    whole = (BigInt(integer) + 1n).toString();
  }

  let shown = rounded.fraction;
  if (options.pad !== true) shown = shown.replace(/0+$/, "");

  const head = (options.grouped === true ? group(whole) : whole);
  const body = shown.length > 0 ? `${head}.${shown}` : head;

  // A value that rounds to zero must not carry a negative sign. "-0.00" reads
  // as a loss that did not happen.
  const isZero = /^[0.,]*$/.test(body);

  return negative && !isZero ? `-${body}` : body;
}

/**
 * Significant decimal places for a value's magnitude.
 *
 * §41: precision follows the user's context. A price of 0.0000421 shown to two
 * places is "0.00", which is not a price; a market cap of 4,281,033 shown to six
 * is noise wearing a lab coat.
 */
export function placesFor(value: bigint, decimals: number): number {
  const { integer } = split(value < 0n ? -value : value, decimals);

  if (integer !== "0") {
    const magnitude = integer.length;
    if (magnitude > 6) return 0; // millions and up
    if (magnitude > 3) return 2; // thousands
    if (magnitude > 1) return 2; // tens
    return 4; // units
  }

  // Below one: show four significant digits, wherever they start.
  const { fraction } = split(value < 0n ? -value : value, decimals);
  let leadingZeros = 0;
  while (leadingZeros < fraction.length && fraction[leadingZeros] === "0") leadingZeros += 1;

  // All zeros, or a value so small nothing meaningful survives.
  if (leadingZeros === fraction.length) return 2;

  return Math.min(leadingZeros + 4, decimals);
}

/** Format with the precision the magnitude calls for. */
export function formatAmount(value: bigint, decimals: number): string {
  return formatFixed(value, decimals, {
    places: placesFor(value, decimals),
    pad: false,
    grouped: true,
  });
}

/**
 * Compact notation for large values: `1.24M`, `4.28B`.
 *
 * Used where the exact figure is not the point — a card in a grid, a heat
 * indicator. Anything a user might act on shows the full value.
 */
export function formatCompact(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const { integer } = split(magnitude, decimals);

  const units: [number, string][] = [
    [13, "T"],
    [10, "B"],
    [7, "M"],
    [4, "K"],
  ];

  for (const [length, suffix] of units) {
    if (integer.length >= length) {
      // Shift the decimal point rather than dividing: appending zeros to the
      // scale keeps this in integer space.
      const shift = (length - 1) - ((length - 1) % 3);
      // Padded: a column of "1.24M" beside "50M" does not scan, and the width
      // changes as a value crosses a round number (§41, §80).
      const scaled = formatFixed(magnitude, decimals + shift, { places: 2, pad: true });
      return `${negative ? "-" : ""}${scaled}${suffix}`;
    }
  }

  return formatAmount(value, decimals);
}

/**
 * A USD-style figure.
 *
 * Always two decimals and always grouped, because a column of prices with
 * varying decimal counts cannot be scanned and re-flows as values change.
 */
export function formatUsd(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const body = formatFixed(negative ? -value : value, decimals, {
    places: 2,
    pad: true,
    grouped: true,
  });
  return `${negative ? "-" : ""}$${body}`;
}

/** Market cap and volume: compact above a million, exact below. */
export function formatUsdCompact(value: bigint, decimals: number): string {
  const { integer } = split(value < 0n ? -value : value, decimals);
  if (integer.length > 6) return `${value < 0n ? "-" : ""}$${formatCompact(value < 0n ? -value : value, decimals)}`;
  return formatUsd(value, decimals);
}

/**
 * Basis points as a percentage: `1842n` → `"+18.42%"`.
 *
 * The sign is explicit on both directions. A percentage change with no sign is
 * read as positive, and a silent minus is how a loss gets missed.
 */
export function formatBps(bps: bigint, options: { signed?: boolean } = {}): string {
  const body = formatFixed(bps < 0n ? -bps : bps, 2, { places: 2, pad: true });
  const sign = bps < 0n ? "-" : options.signed === true ? "+" : "";
  return `${sign}${body}%`;
}

/**
 * Percentage from a ratio of two integers, without leaving integer space.
 *
 * `percentOf(657n, 1000n)` → `"65.70%"`. Used for graduation progress, where the
 * numbers are token quantities in wei and dividing them as floats would be both
 * lossy and unnecessary.
 */
export function percentOf(part: bigint, whole: bigint, places = 2): string {
  if (whole === 0n) return "0.00%";

  // Scale before dividing so the fraction survives integer division.
  const scale = 10n ** BigInt(places + 2);
  const scaled = (part * scale) / whole;

  return `${formatFixed(scaled, places, { places, pad: true })}%`;
}

/**
 * Truncate an address consistently (§41).
 *
 * One shape everywhere. Two different truncations of the same address in one
 * interface read as two different addresses.
 */
export function truncateAddress(address: string, lead = 6, tail = 4): string {
  if (!address.startsWith("0x")) return address;
  // Short enough that truncating would not save anything and would only hide
  // characters the user could otherwise verify.
  if (address.length <= lead + tail + 3) return address;
  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}

/** Transaction hashes get a longer head; the leading bytes are what people match on. */
export function truncateHash(hash: string): string {
  return truncateAddress(hash, 10, 8);
}

/**
 * Relative time, coarse on purpose.
 *
 * "3 minutes ago" and not "3 minutes 12 seconds ago": a tape that re-renders
 * every second to update a label costs more than the precision is worth, and the
 * shifting glyph count breaks §80.
 */
export function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, now - timestamp);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

/**
 * Parse user input into a fixed-point integer.
 *
 * The inverse of `formatFixed`, and the more dangerous direction: this is what
 * a trade is built from. `parseUnits`-by-float would let a user type an amount
 * and sign a different one.
 *
 * Returns null rather than throwing, because this runs on every keystroke and a
 * half-typed "1." is not an error — it is someone mid-way through typing.
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (trimmed === "" || trimmed === ".") return null;

  if (!/^\d*\.?\d*$/.test(trimmed)) return null;

  const [whole = "", fraction = ""] = trimmed.split(".");

  // More decimals than the asset has. Truncating silently would sign an amount
  // the user did not type; refusing lets the input reject the keystroke.
  if (fraction.length > decimals) return null;

  return BigInt(`${whole === "" ? "0" : whole}${fraction.padEnd(decimals, "0")}`);
}
