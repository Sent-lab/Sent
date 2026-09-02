/**
 * SENT — differential test fixture generator.
 *
 * Masterplan §1064 requires exactly ONE canonical source for curve and fee math.
 * `packages/economics` and `contracts/src/lib` are two implementations of that one
 * source, and the claim "they cannot drift" is only worth anything if something
 * mechanically enforces it.
 *
 * This writes cases computed by the TypeScript implementation; the Solidity suite
 * reads them back and asserts its own results match wei for wei. The two reach
 * their answers by DIFFERENT routes — TypeScript uses arbitrary-precision BigInt
 * on the full discriminant, Solidity must rescale to survive uint256 — so
 * agreement is evidence, not tautology.
 *
 * Run: pnpm fixtures
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { WAD } from "../src/wad.ts";
import {
  makeCurve,
  p0FromReferenceMarketCap,
  collateralAt,
  marginalPrice,
  tokensOutForNetIn,
  netInForTokensOut,
  grossOutForTokensIn,
  type CurveParams,
} from "../src/curve.ts";
import { computeFees, splitPostGradFee } from "../src/fees.ts";

const OUT = "contracts/test/fixtures/economics.json";

/**
 * Quote-asset prices spanning the whole realistic range, deliberately including
 * the regime where a naive uint256 port of the closed form overflows (below
 * roughly $93/xStock). Awkward, non-round values throughout.
 */
const XSTOCK_PRICES = [
  1_000n * WAD,
  613_770_000_000_000_000_000n, // $613.77
  200n * WAD,
  137_420_000_000_000_000_000n, // $137.42
  99_990_000_000_000_000_000n, // $99.99 — just under the naive overflow line
  50n * WAD,
  23_170_000_000_000_000_000n, // $23.17
  7n * WAD,
  1_010_000_000_000_000_000n, // $1.01
];

const REFERENCE_MC = 2_000n * WAD;

const p0: string[] = [];
const q: string[] = [];
const netIn: string[] = [];
const expectTokensOut: string[] = [];
const expectQuoteIn: string[] = [];
const expectGrossOut: string[] = [];
const expectCollateral: string[] = [];
const expectPrice: string[] = [];

function pushCurveCase(c: CurveParams, at: bigint, input: bigint): void {
  const out = tokensOutForNetIn(c, at, input);

  p0.push(c.p0.toString());
  q.push(at.toString());
  netIn.push(input.toString());
  expectTokensOut.push(out.toString());
  expectQuoteIn.push(netInForTokensOut(c, at, out).toString());
  expectGrossOut.push(grossOutForTokensIn(c, at + out, out).toString());
  expectCollateral.push(collateralAt(c, at).toString());
  expectPrice.push(marginalPrice(c, at).toString());
}

for (const price of XSTOCK_PRICES) {
  const curve = makeCurve(p0FromReferenceMarketCap(REFERENCE_MC, price));

  // Sample the whole curve, from an empty market to one wei short of the endpoint.
  const positions = [
    0n,
    curve.qG / 1000n,
    curve.qG / 7n,
    curve.qG / 3n,
    curve.qG / 2n,
    (curve.qG * 3n) / 4n,
    (curve.qG * 99n) / 100n,
    curve.qG - 1n,
  ];

  for (const at of positions) {
    const headroom = netInForTokensOut(curve, at, curve.qG - at);
    if (headroom === 0n) continue;

    // Trade sizes from dust to the entire remaining reserve.
    const sizes = [
      1n,
      headroom / 1_000_000n,
      headroom / 997n, // prime-ish divisor: avoids accidentally round numbers
      headroom / 3n,
      (headroom * 7n) / 11n,
      headroom - 1n,
      headroom,
    ];

    for (const size of sizes) {
      if (size <= 0n) continue;
      pushCurveCase(curve, at, size);
    }
  }
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

const notional: string[] = [];
const buyCore: string[] = [];
const buyCreator: string[] = [];
const buyPlatform: string[] = [];
const buyStockback: string[] = [];
const buyNet: string[] = [];
const sellCore: string[] = [];
const sellCreator: string[] = [];
const sellPlatform: string[] = [];
const sellStockback: string[] = [];
const sellNet: string[] = [];

const FEE_CASES: bigint[] = [
  0n,
  1n,
  99n,
  100n, // the exact point where net(g) is non-monotonic
  101n,
  9_999n,
  10_000n,
  10_001n,
  1_000_000n,
  123_456_789n,
  100n * WAD,
  137_429_999_999_999_999_999n,
  1_000_000n * WAD,
  10n ** 30n,
];

for (const value of FEE_CASES) {
  const b = computeFees("BUY", value);
  const s = computeFees("SELL", value);

  notional.push(value.toString());
  buyCore.push(b.coreFee.toString());
  buyCreator.push(b.creatorFee.toString());
  buyPlatform.push(b.platformFee.toString());
  buyStockback.push(b.stockback.toString());
  buyNet.push(b.net.toString());
  sellCore.push(s.coreFee.toString());
  sellCreator.push(s.creatorFee.toString());
  sellPlatform.push(s.platformFee.toString());
  sellStockback.push(s.stockback.toString());
  sellNet.push(s.net.toString());
}

// ---------------------------------------------------------------------------
// Post-graduation split
// ---------------------------------------------------------------------------

const pgRevenue: string[] = [];
const pgCreatorX: string[] = [];
const pgStockbackX: string[] = [];
const pgPlatformX: string[] = [];
const pgCreatorT: string[] = [];
const pgStockbackT: string[] = [];
const pgPlatformT: string[] = [];

for (const value of [0n, 1n, 3n, 1_000n * WAD, 777_777_777n, 10n ** 28n]) {
  const x = splitPostGradFee(value, true);
  const t = splitPostGradFee(value, false);

  pgRevenue.push(value.toString());
  pgCreatorX.push(x.creator.toString());
  pgStockbackX.push(x.stockback.toString());
  pgPlatformX.push(x.platform.toString());
  pgCreatorT.push(t.creator.toString());
  pgStockbackT.push(t.stockback.toString());
  pgPlatformT.push(t.platform.toString());
}

// ---------------------------------------------------------------------------

const fixture = {
  generatedBy: "packages/economics — canonical TypeScript implementation",
  curve: {
    p0,
    q,
    netIn,
    expectTokensOut,
    expectQuoteIn,
    expectGrossOut,
    expectCollateral,
    expectPrice,
  },
  fees: {
    notional,
    buyCore,
    buyCreator,
    buyPlatform,
    buyStockback,
    buyNet,
    sellCore,
    sellCreator,
    sellPlatform,
    sellStockback,
    sellNet,
  },
  postGrad: {
    revenue: pgRevenue,
    creatorXStock: pgCreatorX,
    stockbackXStock: pgStockbackX,
    platformXStock: pgPlatformX,
    creatorToken: pgCreatorT,
    stockbackToken: pgStockbackT,
    platformToken: pgPlatformT,
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(fixture, null, 2));

console.log(`\nDifferential fixtures written to ${OUT}`);
console.log(`  curve cases      ${p0.length}`);
console.log(`  fee cases        ${notional.length}`);
console.log(`  post-grad cases  ${pgRevenue.length}`);
console.log(`  xStock prices    ${XSTOCK_PRICES.length} (spanning the uint256 overflow regime)`);
console.log("");
