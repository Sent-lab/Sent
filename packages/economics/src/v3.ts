/**
 * SENT — Uniswap V3 concentrated-liquidity math, for the graduation geometry proof.
 *
 * Masterplan §416 is explicit: HyperSwap V3 minting uses tick/range-specific
 * liquidity math, NOT a generic constant-product reserve deposit, and it is
 * forbidden to "pretend V2 reserve-ratio math is exact V3 mint math."
 *
 * This module implements the real V3 relations so the §8 analytic endpoint can be
 * checked against them (C-03 / V-08). It is deliberately independent of any
 * on-chain library: an independent re-derivation is what makes the check
 * meaningful. It is an ANALYTIC proof — the fork proof against the actual deployed
 * NonfungiblePositionManager is a separate, still-outstanding obligation (V-06/V-09).
 *
 * All arithmetic is exact-integer BigInt. No floating point anywhere.
 */

import { sqrtFloor } from "./wad.ts";

/** Q96 = 2^96, the Uniswap V3 sqrt-price fixed-point scale. */
export const Q96 = 1n << 96n;

/** Uniswap V3 tick bounds. */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/** Internal working scale for tick exponentiation: 2^192. */
const SCALE = 1n << 192n;

/** 1.0001 at 2^192, floored. The tick base. */
const TICK_BASE = SCALE + SCALE / 10_000n;

/**
 * sqrtPriceX96 at a tick: floor(sqrt(1.0001^tick) * 2^96).
 *
 * Computed by exponentiation-by-squaring at 2^192 scale, then a single integer
 * sqrt. Since a value stored at scale 2^192 has sqrt at scale 2^96, the sqrt of
 * the stored integer IS the X96 representation — no extra scaling step, and no
 * intermediate rounding beyond the squarings themselves.
 */
export function sqrtPriceX96AtTick(tick: number): bigint {
  if (!Number.isInteger(tick)) throw new RangeError("sqrtPriceX96AtTick: non-integer tick");
  if (tick < MIN_TICK || tick > MAX_TICK) throw new RangeError("sqrtPriceX96AtTick: tick out of range");

  const negative = tick < 0;
  let exponent = BigInt(Math.abs(tick));

  let result = SCALE; // 1.0 at scale
  let base = TICK_BASE;

  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) / SCALE;
    base = (base * base) / SCALE;
    exponent >>= 1n;
  }

  // For a negative tick, invert: 1.0001^-t = SCALE^2 / (SCALE * 1.0001^t).
  if (negative) result = (SCALE * SCALE) / result;

  return sqrtFloor(result);
}

/** Largest tick <= `tick` that is a multiple of `spacing`. Floors toward -inf. */
export function floorTickToSpacing(tick: number, spacing: number): number {
  if (spacing <= 0) throw new RangeError("floorTickToSpacing: spacing must be positive");
  return Math.floor(tick / spacing) * spacing;
}

/** Smallest tick >= `tick` that is a multiple of `spacing`. */
export function ceilTickToSpacing(tick: number, spacing: number): number {
  if (spacing <= 0) throw new RangeError("ceilTickToSpacing: spacing must be positive");
  return Math.ceil(tick / spacing) * spacing;
}

/** The usable full range for a given tick spacing. */
export function fullRange(spacing: number): { tickLower: number; tickUpper: number } {
  return {
    tickLower: ceilTickToSpacing(MIN_TICK, spacing),
    tickUpper: floorTickToSpacing(MAX_TICK, spacing),
  };
}

/**
 * Liquidity supported by a given amount of token0, for a range whose current
 * price sits inside it.
 *
 *   amount0 = L * (sb - sp) * Q96 / (sb * sp)
 *   =>   L  = amount0 * sb * sp / ((sb - sp) * Q96)
 *
 * Floored: never claim more liquidity than the amount actually supports.
 */
export function liquidityForAmount0(
  sqrtP: bigint,
  sqrtB: bigint,
  amount0: bigint,
): bigint {
  if (sqrtB <= sqrtP) throw new RangeError("liquidityForAmount0: upper must exceed current");

  // Two steps, not one exact expression. Solidity CANNOT evaluate this directly:
  // at full range the product `amount0·sb·sp` reaches ~1e100, far past uint256.
  // The on-chain implementation therefore uses Uniswap's two-step form, and this
  // mirror must floor at the same points or the two disagree by a wei — which
  // would make the differential test measure the wrong thing.
  const intermediate = (sqrtP * sqrtB) / Q96;
  return (amount0 * intermediate) / (sqrtB - sqrtP);
}

/**
 * Liquidity supported by a given amount of token1.
 *
 *   amount1 = L * (sp - sa) / Q96
 *   =>   L  = amount1 * Q96 / (sp - sa)
 */
export function liquidityForAmount1(
  sqrtA: bigint,
  sqrtP: bigint,
  amount1: bigint,
): bigint {
  if (sqrtP <= sqrtA) throw new RangeError("liquidityForAmount1: current must exceed lower");
  return (amount1 * Q96) / (sqrtP - sqrtA);
}

/** Token0 required to mint `liquidity` over [sp, sb]. Rounded up (the pool takes it). */
export function amount0ForLiquidity(sqrtP: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtB <= sqrtP) return 0n;
  // Uniswap's two-step form, mirroring the on-chain implementation exactly.
  return ((liquidity << 96n) * (sqrtB - sqrtP)) / sqrtB / sqrtP;
}

/** Token1 required to mint `liquidity` over [sa, sp]. Rounded up. */
export function amount1ForLiquidity(sqrtA: bigint, sqrtP: bigint, liquidity: bigint): bigint {
  if (sqrtP <= sqrtA) return 0n;
  const numerator = liquidity * (sqrtP - sqrtA);
  return (numerator + Q96 - 1n) / Q96;
}

export interface MintResult {
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: bigint;
  /** Amount of token0 actually consumed by the mint. */
  readonly used0: bigint;
  /** Amount of token1 actually consumed by the mint. */
  readonly used1: bigint;
  /** Leftover token0 that the mint could not absorb. */
  readonly dust0: bigint;
  /** Leftover token1 that the mint could not absorb. */
  readonly dust1: bigint;
  /** Which side bound the liquidity. */
  readonly limitedBy: "token0" | "token1";
}

/**
 * Simulate minting a position with the assets available at graduation.
 *
 * The liquidity is the largest that BOTH sides can support; whatever the binding
 * side leaves on the other side is dust, whose destination is governed by §417
 * (add to locked liquidity if possible, otherwise a dedicated non-withdrawable
 * graduation-dust account — never credited to creator or platform).
 */
export function simulateMint(
  sqrtP: bigint,
  tickLower: number,
  tickUpper: number,
  available0: bigint,
  available1: bigint,
): MintResult {
  const sqrtA = sqrtPriceX96AtTick(tickLower);
  const sqrtB = sqrtPriceX96AtTick(tickUpper);

  if (sqrtP <= sqrtA || sqrtP >= sqrtB) {
    throw new RangeError("simulateMint: current price must sit strictly inside the range");
  }

  const l0 = liquidityForAmount0(sqrtP, sqrtB, available0);
  const l1 = liquidityForAmount1(sqrtA, sqrtP, available1);
  const liquidity = l0 < l1 ? l0 : l1;

  const used0 = amount0ForLiquidity(sqrtP, sqrtB, liquidity);
  const used1 = amount1ForLiquidity(sqrtA, sqrtP, liquidity);

  return {
    tickLower,
    tickUpper,
    liquidity,
    used0,
    used1,
    dust0: available0 > used0 ? available0 - used0 : 0n,
    dust1: available1 > used1 ? available1 - used1 : 0n,
    limitedBy: l0 < l1 ? "token0" : "token1",
  };
}

/**
 * sqrtPriceX96 for a price expressed as a wad ratio of token1 per token0,
 * assuming both tokens carry 18 decimals.
 *
 *   sqrtPriceX96 = sqrt(priceWad / 1e18) * 2^96
 *                = sqrt(priceWad * 2^192 / 1e18)
 */
export function sqrtPriceX96FromWadPrice(priceWad: bigint): bigint {
  if (priceWad <= 0n) throw new RangeError("sqrtPriceX96FromWadPrice: non-positive price");
  return sqrtFloor((priceWad * SCALE) / 1_000_000_000_000_000_000n);
}

/** Nearest tick at or below the price implied by a sqrtPriceX96, by binary search. */
export function tickAtSqrtPriceX96(sqrtP: bigint): number {
  let lo = MIN_TICK;
  let hi = MAX_TICK;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (sqrtPriceX96AtTick(mid) <= sqrtP) lo = mid;
    else hi = mid - 1;
  }

  return lo;
}
