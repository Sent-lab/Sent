/**
 * SENT — graduation geometry proof against real Uniswap V3 mint math.
 *
 * Addresses C-03 / V-08. Masterplan §416 requires, before production:
 *   1. choose a verified V1 tick/range policy;
 *   2. simulate exact V3 amount0/amount1 requirements at the final marginal price;
 *   3. prove remaining TOKEN + curveCollateral can be consumed within a documented
 *      dust tolerance;
 *   4. prove initial spot price continuity;
 *   5. define deterministic handling of unavoidable mint dust.
 *
 * This script does 2, 3 and 4 analytically for candidate policies, and reports what
 * 1 and 5 should be. It is NOT the fork proof against the deployed
 * NonfungiblePositionManager — that remains open (V-06, V-09).
 *
 * Run: pnpm sim:v3
 */

import { WAD } from "../src/wad.ts";
import { makeCurve, p0FromReferenceMarketCap, graduationSnapshot } from "../src/curve.ts";
import {
  Q96,
  fullRange,
  simulateMint,
  sqrtPriceX96FromWadPrice,
  sqrtPriceX96AtTick,
  tickAtSqrtPriceX96,
  floorTickToSpacing,
  ceilTickToSpacing,
} from "../src/v3.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const fmtWad = (v: bigint, dp = 6): string => {
  const whole = v / WAD;
  const frac = (v % WAD).toString().padStart(18, "0").slice(0, dp);
  return `${whole.toLocaleString("en-US")}.${frac}`;
};

/** Express a dust amount as parts-per-billion of the available amount. */
const ppb = (dust: bigint, total: bigint): bigint => (total === 0n ? 0n : (dust * 1_000_000_000n) / total);

// ---------------------------------------------------------------------------

const REFERENCE_LAUNCH_MC_USD = 2_000n * WAD;
const XSTOCK_USD = 137_420_000_000_000_000_000n; // $137.42

const curve = makeCurve(p0FromReferenceMarketCap(REFERENCE_LAUNCH_MC_USD, XSTOCK_USD));
const snap = graduationSnapshot(curve);

console.log("\nSENT — Graduation V3 Geometry Proof (§416 / C-03 / V-08)");
console.log("=".repeat(74));
console.log(`  remaining TOKEN     ${fmtWad(snap.remaining, 0)}`);
console.log(`  curve collateral    ${fmtWad(snap.collateral, 6)} quote`);
console.log(`  final price PG      ${curve.pg} wad quote/TOKEN`);

// ---------------------------------------------------------------------------
// 1. Why the endpoint should fit full-range V3 exactly
// ---------------------------------------------------------------------------

console.log("\n--- 1. The structural claim ----------------------------------------");
console.log("  For a full-range V3 position, amount1/amount0 -> P.");
console.log("  §8 chose qG so that collateral == remaining * PG.");
console.log("  So the graduation assets should already sit at the full-range ratio.");

const ratioCheck = (snap.remaining * curve.pg) / WAD;
check(
  "collateral == remaining * PG (the §8 endpoint condition)",
  (ratioCheck > snap.collateral ? ratioCheck - snap.collateral : snap.collateral - ratioCheck) <=
    snap.collateral / 1_000_000_000n + 1n,
  `collateral ${snap.collateral} vs remaining*PG ${ratioCheck}`,
);

// ---------------------------------------------------------------------------
// 2. Token ordering — this is NOT a free choice
// ---------------------------------------------------------------------------

console.log("\n--- 2. Token ordering ----------------------------------------------");
console.log("  A V3 pool orders token0/token1 by address. The CREATE2 vanity suffix");
console.log("  (§4) influences the TOKEN address, so ordering is NOT knowable until");
console.log("  the salt is ground. Both orderings must therefore work.");

// V3 price is always token1 per token0.
//   ordering A: TOKEN is token0, xStock is token1  -> price = PG
//   ordering B: xStock is token0, TOKEN is token1  -> price = 1/PG
const priceA = curve.pg;
const priceB = (WAD * WAD) / curve.pg;

const orderings = [
  { name: "TOKEN=token0, xStock=token1", priceWad: priceA, amount0: snap.remaining, amount1: snap.collateral },
  { name: "xStock=token0, TOKEN=token1", priceWad: priceB, amount0: snap.collateral, amount1: snap.remaining },
] as const;

// ---------------------------------------------------------------------------
// 3. Candidate policies across every enabled HyperSwap V3 fee tier (V-07)
// ---------------------------------------------------------------------------

console.log("\n--- 3. Full-range mint per enabled fee tier ------------------------");
console.log("  Fee tiers and spacings are the VERIFIED on-chain set (V-07).\n");

// tier -> tickSpacing, from the verified factory reads.
const TIERS: ReadonlyArray<readonly [number, number]> = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10000, 200],
];

/** Dust tolerance we are willing to document: 1 part per million of each side. */
const DUST_TOLERANCE_PPB = 1_000n;

let worstDustPpb = 0n;

for (const ordering of orderings) {
  console.log(`  ${ordering.name}`);
  const sqrtP = sqrtPriceX96FromWadPrice(ordering.priceWad);
  const impliedTick = tickAtSqrtPriceX96(sqrtP);

  for (const [fee, spacing] of TIERS) {
    const { tickLower, tickUpper } = fullRange(spacing);
    const mint = simulateMint(sqrtP, tickLower, tickUpper, ordering.amount0, ordering.amount1);

    const d0 = ppb(mint.dust0, ordering.amount0);
    const d1 = ppb(mint.dust1, ordering.amount1);
    if (d0 > worstDustPpb) worstDustPpb = d0;
    if (d1 > worstDustPpb) worstDustPpb = d1;

    console.log(
      `    fee ${String(fee).padStart(5)}  spacing ${String(spacing).padStart(3)}  ` +
        `ticks [${tickLower}, ${tickUpper}]  bound by ${mint.limitedBy}  ` +
        `dust0 ${d0} ppb  dust1 ${d1} ppb`,
    );
  }

  console.log(`    implied tick at PG: ${impliedTick}\n`);
}

check(
  `full-range mint consumes both sides within ${DUST_TOLERANCE_PPB} ppb, every tier, both orderings`,
  worstDustPpb <= DUST_TOLERANCE_PPB,
  `worst observed ${worstDustPpb} ppb`,
);

// ---------------------------------------------------------------------------
// 4. Spot price continuity (§15, §416 item 4)
// ---------------------------------------------------------------------------

console.log("--- 4. Spot price continuity ---------------------------------------");

// The pool must be initialised at the curve's final marginal price. Because a
// pool can only be initialised at a tick boundary's sqrt price or an arbitrary
// sqrtPriceX96, we initialise at the exact sqrtPriceX96 derived from PG and let
// the tick fall where it may — the standard V3 initialize() takes a sqrt price,
// not a tick, so continuity is exact up to X96 truncation.
const sqrtPg = sqrtPriceX96FromWadPrice(curve.pg);
const tickPg = tickAtSqrtPriceX96(sqrtPg);
const sqrtAtTick = sqrtPriceX96AtTick(tickPg);
const sqrtAtNextTick = sqrtPriceX96AtTick(tickPg + 1);

console.log(`  PG                  ${curve.pg} wad`);
console.log(`  sqrtPriceX96(PG)    ${sqrtPg}`);
console.log(`  implied tick        ${tickPg}`);

check(
  "sqrtPriceX96(PG) lies within its implied tick's interval",
  sqrtAtTick <= sqrtPg && sqrtPg < sqrtAtNextTick,
);

// Round-tripping the sqrt price back to a wad price must land on PG.
const recoveredPrice = (sqrtPg * sqrtPg * WAD) / (Q96 * Q96);
const priceError = recoveredPrice > curve.pg ? recoveredPrice - curve.pg : curve.pg - recoveredPrice;

console.log(`  recovered price     ${recoveredPrice} wad  (error ${priceError} wei)`);

check(
  "initialising at sqrtPriceX96(PG) reproduces PG within 1 ppb",
  priceError * 1_000_000_000n <= curve.pg,
  `error ${priceError} on ${curve.pg}`,
);

// ---------------------------------------------------------------------------
// 5. What a NARROW range would cost — why full range is the V1 answer
// ---------------------------------------------------------------------------

console.log("\n--- 5. Narrow range comparison -------------------------------------");
console.log("  A concentrated range gives deeper book depth but strands one side");
console.log("  as dust, because the graduation assets arrive at exactly the");
console.log("  full-range ratio and nothing tops them up (§8: no creator or");
console.log("  treasury liquidity).\n");

const spacing = 200; // 1% tier
const sqrtP = sqrtPriceX96FromWadPrice(priceA);
const centreTick = tickAtSqrtPriceX96(sqrtP);

for (const halfWidth of [2000, 10000, 50000, 200000]) {
  const tickLower = floorTickToSpacing(centreTick - halfWidth, spacing);
  const tickUpper = ceilTickToSpacing(centreTick + halfWidth, spacing);
  const mint = simulateMint(sqrtP, tickLower, tickUpper, snap.remaining, snap.collateral);

  console.log(
    `    +/-${String(halfWidth).padStart(6)} ticks  bound by ${mint.limitedBy}  ` +
      `dust0 ${ppb(mint.dust0, snap.remaining)} ppb  dust1 ${ppb(mint.dust1, snap.collateral)} ppb`,
  );
}

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(74));

if (failures.length === 0) {
  console.log(`GEOMETRY PROOF (ANALYTIC): PASS — ${passed} checks green.`);
  console.log("");
  console.log("FINDING — the §8 endpoint is not merely compatible with V3 full-range");
  console.log("minting, it is exactly the full-range deposit ratio. collateral ==");
  console.log("remaining * PG IS the condition amount1/amount0 == P that a full-range");
  console.log("position requires. C-03's feared mismatch does not arise for full range.");
  console.log("");
  console.log("STILL OPEN (may not be closed by this script):");
  console.log("  V-06  deployed NonfungiblePositionManager address unconfirmed");
  console.log("  V-09  permanent principal lock + creator fee-right custody");
  console.log("  fork proof against the real HyperSwap deployment (§416 requires it)");
} else {
  console.log(`GEOMETRY PROOF: FAIL — ${failures.length} of ${passed + failures.length} checks failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log("\nPer §416 a material mismatch is a PRODUCT escalation, not a code fix.");
  process.exitCode = 1;
}
console.log("");
