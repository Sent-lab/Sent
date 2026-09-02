/**
 * SENT — canonical pre-graduation fee waterfall.
 *
 * LOCKED RATES (§0, §11, §314, §407) — an implementation agent may not tune these.
 *
 *   Core trading fee        1.00% of trade notional
 *     -> Creator            65% of the core fee   (0.65% of notional)
 *     -> Platform           35% of the core fee   (0.35% of notional)
 *
 *   Stockback contribution  BUY  +1.00% of notional
 *                           SELL +2.00% of notional
 *     -> HolderRewardVault  100%, entirely to eligible holders
 *
 *   Target effective cost   BUY 2%   SELL 3%
 *
 * CONVENTION — FREEZE F1, resolves C-04 (docs/ECONOMICS-CONVENTIONS.md)
 * ---------------------------------------------------------------------
 * §315 requires the fee-before-curve vs fee-after-quote convention to be
 * deterministic and documented, and requires quote() and execute() to use the
 * identical convention. The convention is not a free choice: §9 and §10 fix it
 * by step ordering.
 *
 *   BUY  — notional = GROSS QUOTE INPUT. Fees are removed first (§9 steps 2-5),
 *          and only the remainder reaches the curve.
 *          netToCurve = grossIn - coreFee - stockback
 *
 *   SELL — notional = GROSS QUOTE OUTPUT from the curve. The curve runs first
 *          (§10 step 1), then fees are deducted from its output (§10 steps 2-4).
 *          netToSeller = grossOut - coreFee - stockback
 *
 * Both match the worked examples in §315 exactly: 100 NVDAx in -> 1.00 core
 * (0.65 creator / 0.35 platform) + 1.00 Stockback; 100 NVDAx gross out -> 1.00
 * core + 2.00 Stockback.
 *
 * Neither fee ever enters curve collateral (§8, §12).
 *
 * This is the ONLY canonical implementation of fee math off-chain (§1064).
 */

import { BPS, mulBpsFloor } from "./wad.ts";

/** Core trading fee: 1.00% = 100 bps. LOCKED. */
export const CORE_FEE_BPS = 100n;

/** Creator share of the CORE FEE: 65%. LOCKED — never reduced by Stockback. */
export const CREATOR_SHARE_BPS = 6_500n;

/** Platform share of the CORE FEE: 35%. LOCKED. */
export const PLATFORM_SHARE_BPS = 3_500n;

/** Stockback contribution on BUY: 1.00% of notional. LOCKED. */
export const STOCKBACK_BUY_BPS = 100n;

/** Stockback contribution on SELL: 2.00% of notional. LOCKED. */
export const STOCKBACK_SELL_BPS = 200n;

export type Side = "BUY" | "SELL";

export interface FeeBreakdown {
  /** The amount the rates are applied to. BUY: gross in. SELL: gross curve out. */
  readonly notional: bigint;
  /** Total core trading fee (1% of notional). */
  readonly coreFee: bigint;
  /** Creator's 65% of the core fee -> FeeVault. */
  readonly creatorFee: bigint;
  /** Platform's 35% of the core fee -> FeeVault. */
  readonly platformFee: bigint;
  /** Stockback contribution -> HolderRewardVault, 100% to holders. */
  readonly stockback: bigint;
  /** coreFee + stockback. */
  readonly totalFee: bigint;
  /** BUY: amount reaching the curve. SELL: amount reaching the seller. */
  readonly net: bigint;
}

/**
 * Split the core fee 65/35.
 *
 * Rounding (D-003, revised): the creator share rounds UP and the platform takes
 * the remainder, so creator + platform === coreFee exactly with no dust escaping.
 *
 * The direction is deliberate. Flooring the creator left the aggregate creator
 * share permanently a wei or two below 65%, because a sum of floors is not the
 * floor of a sum. §314.2 is explicit that the creator's share may never be
 * reduced, so rounding dust lands on the platform — the party that agreed to the
 * split — never on the creator. Surfaced by an on-chain invariant.
 */
export function splitCoreFee(coreFee: bigint): { creator: bigint; platform: bigint } {
  let creator = (coreFee * CREATOR_SHARE_BPS + BPS - 1n) / BPS;
  if (creator > coreFee) creator = coreFee;
  return { creator, platform: coreFee - creator };
}

/**
 * Compute the full fee waterfall for one trade.
 *
 * `notional` is the gross quote amount on the xStock side of the trade:
 * the gross input for a BUY, the gross curve output for a SELL.
 */
export function computeFees(side: Side, notional: bigint): FeeBreakdown {
  if (notional < 0n) throw new RangeError("computeFees: negative notional");

  const coreFee = mulBpsFloor(notional, CORE_FEE_BPS);
  const { creator, platform } = splitCoreFee(coreFee);
  const stockback = mulBpsFloor(
    notional,
    side === "BUY" ? STOCKBACK_BUY_BPS : STOCKBACK_SELL_BPS,
  );

  const totalFee = coreFee + stockback;

  return {
    notional,
    coreFee,
    creatorFee: creator,
    platformFee: platform,
    stockback,
    totalFee,
    net: notional - totalFee,
  };
}

/** Effective total fee rate in bps for a side. BUY 200 (2%), SELL 300 (3%). */
export function effectiveFeeBps(side: Side): bigint {
  return CORE_FEE_BPS + (side === "BUY" ? STOCKBACK_BUY_BPS : STOCKBACK_SELL_BPS);
}

/**
 * Post-graduation platform-side split of paired-xStock-denominated fee revenue.
 *
 * LOCKED (§396-B, §407): of creator-eligible LP fee revenue,
 *   65%  -> creator          (never diluted)
 *   35%  -> platform side, and of that platform side, when the fee asset is the
 *           official paired xStock:  50% -> Stockback, 50% -> platform retained
 * Net: 65.00% creator / 17.50% Stockback / 17.50% platform.
 *
 * TOKEN-denominated platform-side revenue is 100% platform with NO automatic
 * conversion (§397, §407) — the protocol never sells TOKEN to fund rewards.
 */
export const POST_GRAD_PLATFORM_STOCKBACK_SHARE_BPS = 5_000n;

export interface PostGradSplit {
  readonly creator: bigint;
  readonly stockback: bigint;
  readonly platform: bigint;
}

export function splitPostGradFee(
  creatorEligibleRevenue: bigint,
  assetIsPairedXStock: boolean,
): PostGradSplit {
  if (creatorEligibleRevenue < 0n) throw new RangeError("splitPostGradFee: negative revenue");

  const creator = mulBpsFloor(creatorEligibleRevenue, CREATOR_SHARE_BPS);
  const platformSide = creatorEligibleRevenue - creator;

  if (!assetIsPairedXStock) {
    // TOKEN-denominated: 100% platform, 0% automatic Stockback conversion.
    return { creator, stockback: 0n, platform: platformSide };
  }

  const stockback = mulBpsFloor(platformSide, POST_GRAD_PLATFORM_STOCKBACK_SHARE_BPS);
  return { creator, stockback, platform: platformSide - stockback };
}

export { BPS };
