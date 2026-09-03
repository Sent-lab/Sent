/**
 * SENT — canonical pre-graduation bonding curve.
 *
 * LOCKED (Masterplan §8):
 *
 *   S    = 1_000_000_000 TOKEN                 fixed supply
 *   P(q) = P0 + k*q                            linear in the xStock quote unit
 *   PG   = 25 * P0                             graduation marginal price
 *   qG   = (2 * PG * S) / (P0 + 3 * PG)        graduation endpoint
 *        = 50/76 * S  ~= 65.7894737% of supply
 *
 * The endpoint is chosen so curve collateral exactly equals the value of the
 * remaining (undistributed) supply at the final marginal price PG — which is
 * what lets the HyperSwap V3 position be seeded without any creator or
 * treasury top-up (§8, §17).
 *
 * PRECISION NOTE (D-002)
 * ----------------------
 * `k` is never materialised. Storing k = (PG - P0)/qG would divide away most of
 * the significant digits (k is on the order of 1e-16 quote units per token^2).
 * Instead every equation below is multiplied through by qG, so the curve is
 * parameterised by the exact integers (P0, dP, qG) where dP = PG - P0 = 24*P0.
 * All arithmetic is exact until a single final floor division.
 *
 * UNITS
 * -----
 *   token amounts  : token wei      (18 decimals)
 *   quote amounts  : normalized quote wei (18 decimals, via XStockAssetAdapter)
 *   price (wad)    : quote wei per 1e18 token wei
 *
 * This is the ONLY canonical implementation of curve math off-chain (§1064).
 * It is differential-tested against the Solidity implementation; neither is
 * permitted to drift from the other.
 */

import { WAD, sqrtFloor, divFloor } from "./wad.ts";

/** Fixed total supply — LOCKED at 1B TOKEN, 18 decimals (§2, §5). */
export const TOTAL_SUPPLY: bigint = 1_000_000_000n * WAD;

/** Graduation price multiple — LOCKED at 25x ($2K -> $50K reference MC, §0). */
export const GRADUATION_MULTIPLE = 25n;

/**
 * The locked reference anchors, in USD wad (§18).
 *
 * $2,000 at launch, $50,000 at graduation. They are a REFERENCE path, not a
 * live valuation: the curve runs in the quote asset's own units and the
 * launch-time xStock/USD snapshot is what ties the two together, once, forever.
 */
export const REFERENCE_MC_START: bigint = 2_000n * WAD;
export const REFERENCE_MC_GRADUATION: bigint = 50_000n * WAD;

/**
 * Graduation endpoint as an exact rational of supply: qG/S = 50/76.
 * Derived from qG = 2*PG*S/(P0 + 3*PG) with PG = 25*P0 — P0 cancels, so the
 * endpoint is a pure fraction of supply and is independent of the xStock pair.
 */
export const QG_NUMERATOR = 50n;
export const QG_DENOMINATOR = 76n;

export interface CurveParams {
  /** Starting marginal price, wad quote per token. Fixed at launch, immutable. */
  readonly p0: bigint;
  /** Graduation marginal price = 25 * p0. */
  readonly pg: bigint;
  /** dP = pg - p0 = 24 * p0. The exact numerator of k*qG. */
  readonly dP: bigint;
  /** Graduation endpoint in token wei. */
  readonly qG: bigint;
  /** Fixed supply in token wei. */
  readonly supply: bigint;
}

/**
 * Build curve parameters from the launch-time starting price.
 *
 * `p0` is derived by the market from the $2,000 reference market cap and the
 * launch-time xStock/USD reference snapshot (§8, §402). It is fixed for the
 * life of the market; the live USD feed never re-anchors it.
 */
export function makeCurve(p0: bigint, supply: bigint = TOTAL_SUPPLY): CurveParams {
  if (p0 <= 0n) throw new RangeError("makeCurve: p0 must be positive");

  const pg = p0 * GRADUATION_MULTIPLE;
  const dP = pg - p0; // == 24 * p0

  // qG = 50/76 * S, floored. Flooring the endpoint means graduation triggers a
  // hair early rather than a hair late, which keeps the LP seed fully funded.
  const qG = divFloor(supply * QG_NUMERATOR, QG_DENOMINATOR);

  return { p0, pg, dP, qG, supply };
}

/**
 * Derive p0 from the locked $2,000 reference market cap.
 *
 * referenceMcUsdWad : reference market cap in USD, wad (e.g. 2000e18)
 * xStockUsdWad      : launch-time xStock/USD reference snapshot, wad
 *
 * p0 = (referenceMc / xStockUsd) / supply, expressed as wad quote per token.
 */
export function p0FromReferenceMarketCap(
  referenceMcUsdWad: bigint,
  xStockUsdWad: bigint,
  supply: bigint = TOTAL_SUPPLY,
): bigint {
  if (xStockUsdWad <= 0n) throw new RangeError("p0FromReferenceMarketCap: bad xStock price");

  // quoteMc (quote wei) = referenceMcUsd * WAD / xStockUsd
  const quoteMc = divFloor(referenceMcUsdWad * WAD, xStockUsdWad);

  // p0 (wad quote per token) = quoteMc * WAD / supply
  return divFloor(quoteMc * WAD, supply);
}

/**
 * Reference market cap in USD, from the price alone (§18, §403).
 *
 * NO ORACLE IS INVOLVED, AND THAT IS THE POINT
 * --------------------------------------------
 * The launch anchor is already baked into `p0` — it was derived from the
 * $2,000 reference cap and the launch-time xStock/USD snapshot. So the ratio
 * `price / p0` is the market's movement along its own reference path, and
 * multiplying the $2,000 anchor by it recovers the reference cap exactly:
 *
 *   price = p0   -> $2,000
 *   price = 25p0 -> $50,000
 *
 * which is §18's anchors, reproduced rather than restated.
 *
 * This is NOT the live USD market cap. §403 requires the two to be
 * distinguishable, because the paired xStock moves after launch and the live
 * figure at the graduation endpoint will not be exactly $50,000. Graduation
 * follows this number; the live one is valuation context and follows nothing.
 */
export function referenceMarketCapUsd(p0: bigint, price: bigint): bigint {
  if (p0 <= 0n) throw new RangeError("referenceMarketCapUsd: p0 must be positive");
  return divFloor(REFERENCE_MC_START * price, p0);
}

/** Marginal price at distributed amount q: P(q) = p0 + dP * q / qG. */
export function marginalPrice(c: CurveParams, q: bigint): bigint {
  assertQ(c, q);
  return c.p0 + divFloor(c.dP * q, c.qG);
}

/**
 * Exact collateral required to move the curve from 0 to q.
 *
 *   ∫₀^q P(x) dx = [p0*q + dP*q²/(2*qG)] / WAD
 *
 * Floored: the curve never claims to hold more collateral than it does.
 */
export function collateralAt(c: CurveParams, q: bigint): bigint {
  assertQ(c, q);
  const numerator = c.p0 * c.qG * 2n * q + c.dP * q * q;
  return divFloor(numerator, 2n * c.qG * WAD);
}

/**
 * BUY — quote TOKEN out for a given net quote input.
 *
 * `netIn` is the amount that reaches the curve AFTER the core fee and the
 * Stockback contribution have been removed (§9 steps 2-5). Fees never enter
 * curve collateral, so this function must never see gross input.
 *
 * Solving ∫_q^{q+Δ} P dx = netIn, multiplied through by qG*WAD:
 *
 *   (dP/2)Δ² + BΔ - netIn*qG*WAD = 0,   B = p0*qG + dP*q
 *   Δ = (sqrt(B² + 2*dP*netIn*qG*WAD) - B) / dP
 *
 * The sqrt is floored and the final division is floored, so TOKEN out is
 * always rounded DOWN — in the protocol's favour (D-003).
 */
export function tokensOutForNetIn(c: CurveParams, q: bigint, netIn: bigint): bigint {
  assertQ(c, q);
  if (netIn < 0n) throw new RangeError("tokensOutForNetIn: negative input");
  if (netIn === 0n) return 0n;

  const remaining = c.qG - q;
  if (remaining === 0n) return 0n;

  // Clamp first: nobody can buy more than the reserve holds, and this also keeps
  // the Solidity mirror's rescaled intermediates inside uint256.
  const maxIn = netInForTokensOut(c, q, remaining);
  if (netIn >= maxIn) return remaining;

  const b = c.p0 * c.qG + c.dP * q;
  const discriminant = b * b + 2n * c.dP * netIn * c.qG * WAD;
  let delta = divFloor(sqrtFloor(discriminant) - b, c.dP);
  if (delta > remaining) delta = remaining;

  // Correct to the exact floor of the SPECIFICATION:
  //   tokensOutForNetIn(q, netIn) = max { Δ : netInForTokensOut(q, Δ) <= netIn }
  //
  // The Solidity implementation reaches the same answer by a different route (it
  // must rescale to avoid overflow). Both are corrected against the same forward
  // function, which is what lets the differential test prove they agree rather
  // than merely observe it.
  let steps = 0;
  while (delta > 0n && netInForTokensOut(c, q, delta) > netIn) {
    delta -= 1n;
    if (++steps > 32) throw new Error("tokensOutForNetIn: correction did not converge");
  }
  while (delta < remaining && netInForTokensOut(c, q, delta + 1n) <= netIn) {
    delta += 1n;
    if (++steps > 32) throw new Error("tokensOutForNetIn: correction did not converge");
  }

  return delta;
}

/**
 * BUY — exact net quote input required to receive `delta` TOKEN.
 *
 * Inverse of the above; rounded UP so the trader is never undercharged.
 */
export function netInForTokensOut(c: CurveParams, q: bigint, delta: bigint): bigint {
  assertQ(c, q);
  if (delta < 0n) throw new RangeError("netInForTokensOut: negative delta");
  if (q + delta > c.qG) throw new RangeError("netInForTokensOut: past graduation endpoint");

  const numerator = c.p0 * c.qG * 2n * delta + c.dP * (2n * q * delta + delta * delta);
  const denominator = 2n * c.qG * WAD;
  return (numerator + denominator - 1n) / denominator; // ceil
}

/**
 * SELL — gross quote output for `delta` TOKEN returned to the curve.
 *
 * This is the amount BEFORE the core fee and Stockback contribution are
 * deducted (§10 steps 1-4). Collateral is reduced by this curve liability, not
 * by the raw contract balance (§10 step 5, §12).
 *
 *   ∫_{q-Δ}^{q} P dx = [p0*Δ + dP*(qΔ - Δ²/2)/qG] / WAD
 *
 * Floored, so the curve never pays out more than it owes.
 */
export function grossOutForTokensIn(c: CurveParams, q: bigint, delta: bigint): bigint {
  assertQ(c, q);
  if (delta < 0n) throw new RangeError("grossOutForTokensIn: negative delta");
  if (delta > q) throw new RangeError("grossOutForTokensIn: more TOKEN than distributed");

  const numerator = c.p0 * c.qG * 2n * delta + c.dP * (2n * q * delta - delta * delta);
  return divFloor(numerator, 2n * c.qG * WAD);
}

/** True once the curve has reached the graduation endpoint (§13). */
export function hasReachedGraduation(c: CurveParams, q: bigint): boolean {
  return q >= c.qG;
}

/**
 * Reference outcome at the graduation endpoint (§8 table).
 *
 * The defining property — and the reason the LP needs no top-up — is:
 *
 *     collateral(qG) == (S - qG) * PG
 *
 * i.e. curve collateral exactly equals the value of the remaining supply at the
 * final marginal price. Both sides seed the HyperSwap V3 position.
 */
export function graduationSnapshot(c: CurveParams) {
  const distributed = c.qG;
  const remaining = c.supply - c.qG;
  const collateral = collateralAt(c, c.qG);
  const remainingValue = divFloor(remaining * c.pg, WAD);

  return {
    distributed,
    remaining,
    collateral,
    remainingValue,
    /** Reference initial LP TVL = collateral + remaining supply at PG. */
    lpTvl: collateral + remainingValue,
    finalMarginalPrice: marginalPrice(c, c.qG),
  };
}

function assertQ(c: CurveParams, q: bigint): void {
  if (q < 0n) throw new RangeError("curve: negative q");
  if (q > c.qG) throw new RangeError("curve: q past graduation endpoint");
}
