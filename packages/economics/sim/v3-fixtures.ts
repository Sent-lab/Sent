/**
 * SENT — graduation geometry differential fixtures.
 *
 * `packages/economics/src/v3.ts` proved on Day 1 that the §8 endpoint consumes
 * both sides of a full-range V3 mint with 0 ppb dust, across every enabled fee
 * tier and both token orderings.
 *
 * `contracts/src/lib/GraduationMath.sol` is the on-chain half of the same math,
 * and §1064 allows one canonical source. These fixtures make the two provably
 * equal rather than similar.
 *
 * The TypeScript computes tick→sqrtPrice, so the fixture carries the resulting
 * sqrt prices directly. Solidity is fed the same inputs and must produce the same
 * liquidity, the same consumed amounts, and the same dust — to the wei.
 *
 * Run: pnpm fixtures:v3
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { WAD } from "../src/wad.ts";
import { makeCurve, p0FromReferenceMarketCap, graduationSnapshot } from "../src/curve.ts";
import {
  fullRange,
  simulateMint,
  sqrtPriceX96AtTick,
  sqrtPriceX96FromWadPrice,
} from "../src/v3.ts";

const OUT = "contracts/test/fixtures/v3.json";

/** Fee tiers and spacings, VERIFIED on-chain (V-07). */
const TIERS: ReadonlyArray<readonly [number, number]> = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10000, 200],
];

/** Prices spanning the realistic range, including the uint256 danger zone. */
const XSTOCK_PRICES = [
  1_000n * WAD,
  613_770_000_000_000_000_000n,
  137_420_000_000_000_000_000n,
  99_990_000_000_000_000_000n,
  23_170_000_000_000_000_000n,
  1_010_000_000_000_000_000n,
];

interface Case {
  label: string;
  sqrtP: string;
  sqrtA: string;
  sqrtB: string;
  available0: string;
  available1: string;
  expectLiquidity: string;
  expectUsed0: string;
  expectUsed1: string;
  expectDust0: string;
  expectDust1: string;
  expectWadPrice: string;
}

const cases: Case[] = [];

for (const price of XSTOCK_PRICES) {
  const curve = makeCurve(p0FromReferenceMarketCap(2_000n * WAD, price));
  const snap = graduationSnapshot(curve);

  // V3 orders token0/token1 by address, and the CREATE2 vanity suffix decides
  // which side TOKEN lands on — so both orderings must be exercised.
  const orderings = [
    {
      name: "TOKEN=token0",
      priceWad: curve.pg,
      amount0: snap.remaining,
      amount1: snap.collateral,
    },
    {
      name: "xStock=token0",
      priceWad: (WAD * WAD) / curve.pg,
      amount0: snap.collateral,
      amount1: snap.remaining,
    },
  ] as const;

  for (const ordering of orderings) {
    const sqrtP = sqrtPriceX96FromWadPrice(ordering.priceWad);

    for (const [fee, spacing] of TIERS) {
      const { tickLower, tickUpper } = fullRange(spacing);
      const sqrtA = sqrtPriceX96AtTick(tickLower);
      const sqrtB = sqrtPriceX96AtTick(tickUpper);

      const mint = simulateMint(sqrtP, tickLower, tickUpper, ordering.amount0, ordering.amount1);

      cases.push({
        label: `${price / WAD} ${ordering.name} fee${fee}`,
        sqrtP: sqrtP.toString(),
        sqrtA: sqrtA.toString(),
        sqrtB: sqrtB.toString(),
        available0: ordering.amount0.toString(),
        available1: ordering.amount1.toString(),
        expectLiquidity: mint.liquidity.toString(),
        expectUsed0: mint.used0.toString(),
        expectUsed1: mint.used1.toString(),
        expectDust0: mint.dust0.toString(),
        expectDust1: mint.dust1.toString(),
        expectWadPrice: ordering.priceWad.toString(),
      });
    }
  }
}

// Narrow ranges too: they must NOT be used in production, but the math has to be
// right for the comparison that shows why.
{
  const curve = makeCurve(p0FromReferenceMarketCap(2_000n * WAD, 137_420_000_000_000_000_000n));
  const snap = graduationSnapshot(curve);
  const sqrtP = sqrtPriceX96FromWadPrice(curve.pg);

  for (const halfWidth of [2000, 10000, 50000]) {
    const spacing = 200;
    const centre = 0;
    const tickLower = Math.floor((centre - halfWidth) / spacing) * spacing;
    const tickUpper = Math.ceil((centre + halfWidth) / spacing) * spacing;

    // Only include ranges that actually contain the price.
    const sqrtA = sqrtPriceX96AtTick(tickLower - 200000);
    const sqrtB = sqrtPriceX96AtTick(tickUpper - 100000);
    if (sqrtP <= sqrtA || sqrtP >= sqrtB) continue;

    const mint = simulateMint(sqrtP, tickLower - 200000, tickUpper - 100000, snap.remaining, snap.collateral);

    cases.push({
      label: `narrow +/-${halfWidth}`,
      sqrtP: sqrtP.toString(),
      sqrtA: sqrtA.toString(),
      sqrtB: sqrtB.toString(),
      available0: snap.remaining.toString(),
      available1: snap.collateral.toString(),
      expectLiquidity: mint.liquidity.toString(),
      expectUsed0: mint.used0.toString(),
      expectUsed1: mint.used1.toString(),
      expectDust0: mint.dust0.toString(),
      expectDust1: mint.dust1.toString(),
      expectWadPrice: curve.pg.toString(),
    });
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ cases }, null, 2));

console.log(`\nV3 geometry fixtures written to ${OUT}`);
console.log(`  cases          ${cases.length}`);
console.log(`  prices         ${XSTOCK_PRICES.length}`);
console.log(`  fee tiers      ${TIERS.length} (the VERIFIED on-chain set)`);
console.log("  both token orderings, plus narrow ranges for comparison");
console.log("");
