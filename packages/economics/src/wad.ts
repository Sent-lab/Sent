/**
 * SENT — fixed-point primitives.
 *
 * Masterplan §249.3 leaves exact fixed-point precision as an implementation
 * (CHOOSE) decision; §8 leaves rounding direction implementation-level.
 * Decision D-002 / D-003 (docs/DECISION-LOG.md) fix both:
 *
 *   - WAD = 1e18 external representation for prices and normalized quote amounts.
 *   - All intermediate curve arithmetic is exact-integer (no division until the
 *     final step), so no precision is lost to an intermediate `k`.
 *   - Rounding always favours protocol solvency. Never the trader.
 *
 * This module is the ONLY place fixed-point helpers are defined for the
 * canonical economics package (§1064: one canonical source for curve/fee math).
 */

export const WAD = 1_000_000_000_000_000_000n; // 1e18

/** Basis points denominator. 10_000 bps = 100%. */
export const BPS = 10_000n;

/**
 * Floor integer square root (Newton's method) for arbitrary-precision BigInt.
 *
 * Returns the largest r such that r*r <= n.
 * Flooring here is the conservative direction for buy sizing: a smaller root
 * yields fewer TOKEN out, never more. See D-003.
 */
export function sqrtFloor(n: bigint): bigint {
  if (n < 0n) throw new RangeError("sqrtFloor: negative input");
  if (n < 2n) return n;

  // Initial guess: 2^(ceil(bitLength/2)) — always >= sqrt(n), so Newton descends.
  let x = 1n << (BigInt(n.toString(2).length + 1) >> 1n);

  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) break;
    x = next;
  }

  // Guard against off-by-one from the descent.
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;

  return x;
}

/** Floor division for non-negative operands. Explicit for auditability. */
export function divFloor(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new RangeError("divFloor: non-positive divisor");
  if (a < 0n) throw new RangeError("divFloor: negative numerator");
  return a / b;
}

/** Ceil division for non-negative operands. Used where charging must round up. */
export function divCeil(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new RangeError("divCeil: non-positive divisor");
  if (a < 0n) throw new RangeError("divCeil: negative numerator");
  return (a + b - 1n) / b;
}

/** Multiply by a basis-point rate, rounding down. */
export function mulBpsFloor(amount: bigint, bps: bigint): bigint {
  return divFloor(amount * bps, BPS);
}
