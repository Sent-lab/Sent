/**
 * SENT — Day 1 executable economic simulation.
 *
 * Day-1 Definition of Done #7 (docs/M0-COMPREHENSION.md §14): the simulation
 * must reproduce the Masterplan §8 reference outcomes, and the §315 worked fee
 * examples, from the canonical implementation — not from restated constants.
 *
 * Run:  pnpm sim
 *
 * §9/§10 state that economic simulation is a mandatory validation GATE. It does
 * not authorise anyone to change a locked rate. A failure here is a BLOCKED
 * escalation, not a tuning exercise.
 */

import { WAD } from "../src/wad.ts";
import {
  TOTAL_SUPPLY,
  makeCurve,
  p0FromReferenceMarketCap,
  collateralAt,
  marginalPrice,
  tokensOutForNetIn,
  netInForTokensOut,
  grossOutForTokensIn,
  graduationSnapshot,
} from "../src/curve.ts";
import { computeFees, splitPostGradFee } from "../src/fees.ts";

// ---------------------------------------------------------------------------
// tiny assertion harness
// ---------------------------------------------------------------------------

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

function eq(name: string, actual: bigint, expected: bigint): void {
  check(name, actual === expected, `expected ${expected}, got ${actual}`);
}

/** Assert |actual - expected| <= tolerance. */
function near(name: string, actual: bigint, expected: bigint, tolerance: bigint): void {
  const diff = actual > expected ? actual - expected : expected - actual;
  check(name, diff <= tolerance, `expected ~${expected} (+/-${tolerance}), got ${actual}`);
}

const fmtWad = (v: bigint, dp = 6): string => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / WAD;
  const frac = (a % WAD).toString().padStart(18, "0").slice(0, dp);
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}.${frac}`;
};

// ---------------------------------------------------------------------------
// Scenario: LOCKED product anchors
// ---------------------------------------------------------------------------

const REFERENCE_LAUNCH_MC_USD = 2_000n * WAD; //  $2,000  LOCKED §0
const REFERENCE_GRAD_MC_USD = 50_000n * WAD; // $50,000  LOCKED §0

// Launch-time xStock/USD reference snapshot. Any positive value must produce the
// same supply split, because P0 cancels out of the qG formula. We use a
// deliberately awkward price to prove the endpoint is pair-independent.
const XSTOCK_USD = 137_420_000_000_000_000_000n; // $137.42

console.log("\nSENT — Economic Simulation (Masterplan v19 §8 / §315 / §407)");
console.log("=".repeat(72));
console.log(`  reference launch MC   $${fmtWad(REFERENCE_LAUNCH_MC_USD, 2)}`);
console.log(`  reference grad MC     $${fmtWad(REFERENCE_GRAD_MC_USD, 2)}`);
console.log(`  xStock/USD snapshot   $${fmtWad(XSTOCK_USD, 2)}`);

const p0 = p0FromReferenceMarketCap(REFERENCE_LAUNCH_MC_USD, XSTOCK_USD);
const curve = makeCurve(p0);
const snap = graduationSnapshot(curve);

/** Convert a normalized quote amount back to USD (wad) at the snapshot price. */
const quoteToUsd = (q: bigint): bigint => (q * XSTOCK_USD) / WAD;

console.log("\n--- 1. Curve parameters -------------------------------------------");
console.log(`  P0                    ${curve.p0} wad quote/token`);
console.log(`  PG                    ${curve.pg} wad quote/token`);
console.log(`  qG                    ${fmtWad(curve.qG, 0)} TOKEN`);

check("PG is exactly 25x P0 (LOCKED §0)", curve.pg === curve.p0 * 25n);
check("dP is exactly 24x P0", curve.dP === curve.p0 * 24n);
eq("supply is exactly 1B TOKEN (LOCKED §2)", curve.supply, 1_000_000_000n * WAD);

// ---------------------------------------------------------------------------
// 2. §8 reference outcome table
// ---------------------------------------------------------------------------

console.log("\n--- 2. §8 reference outcomes at graduation -------------------------");
console.log(`  supply distributed    ${fmtWad(snap.distributed, 0)} TOKEN`);
console.log(`  supply remaining      ${fmtWad(snap.remaining, 0)} TOKEN`);
console.log(`  curve collateral      $${fmtWad(quoteToUsd(snap.collateral), 2)} equivalent`);
console.log(`  remaining @ PG        $${fmtWad(quoteToUsd(snap.remainingValue), 2)} equivalent`);
console.log(`  initial LP TVL        $${fmtWad(quoteToUsd(snap.lpTvl), 2)} equivalent`);

// qG/S = 50/76 = 65.7894736842...%  Expressed in wad percent for the assertion.
const qgRatioWadPct = (curve.qG * 100n * WAD) / curve.supply;
console.log(`  qG / S                ${fmtWad(qgRatioWadPct, 7)} %`);

near(
  "qG/S == 65.7894737% of supply (§8)",
  qgRatioWadPct,
  65_789_473_700_000_000_000n, // 65.78947370
  100_000_000_000n, // tolerance on the trailing digits
);

near(
  "supply distributed ~= 657.895M TOKEN (§8)",
  snap.distributed / WAD,
  657_894_737n,
  1n,
);

near(
  "supply remaining ~= 342.105M TOKEN (§8)",
  snap.remaining / WAD,
  342_105_263n,
  1n,
);

near(
  "curve collateral ~= $17,105 equivalent (§8)",
  quoteToUsd(snap.collateral) / WAD,
  17_105n,
  1n,
);

near(
  "initial LP TVL ~= $34,211 equivalent (§8)",
  quoteToUsd(snap.lpTvl) / WAD,
  34_210n,
  2n,
);

// ---------------------------------------------------------------------------
// 3. The defining endpoint property
// ---------------------------------------------------------------------------

console.log("\n--- 3. Endpoint balance property ----------------------------------");

// This is WHY qG has its value: collateral == value of remaining supply at PG.
// It is what removes the need for creator or treasury liquidity top-up (§8, §17).
near(
  "collateral(qG) == remaining supply valued at PG (no top-up needed, §8)",
  snap.collateral,
  snap.remainingValue,
  snap.collateral / 1_000_000_000n + 1n, // <= 1 part per billion of rounding dust
);

eq(
  "final marginal price == PG (graduation trigger, §13)",
  snap.finalMarginalPrice,
  curve.pg,
);

// Reference graduation MC actually lands on $50K.
const gradMcUsd = quoteToUsd((curve.pg * curve.supply) / WAD);
near(
  "reference market cap at PG == $50,000 (LOCKED §0)",
  gradMcUsd / WAD,
  50_000n,
  1n,
);

const launchMcUsd = quoteToUsd((curve.p0 * curve.supply) / WAD);
near(
  "reference market cap at P0 == $2,000 (LOCKED §0)",
  launchMcUsd / WAD,
  2_000n,
  1n,
);

// ---------------------------------------------------------------------------
// 4. §315 worked fee examples — exact
// ---------------------------------------------------------------------------

console.log("\n--- 4. §315 worked fee examples ------------------------------------");

const hundred = 100n * WAD;

const buyFees = computeFees("BUY", hundred);
console.log(
  `  BUY  100 quote  ->  core ${fmtWad(buyFees.coreFee, 2)} ` +
    `(creator ${fmtWad(buyFees.creatorFee, 2)} / platform ${fmtWad(buyFees.platformFee, 2)}) ` +
    `+ stockback ${fmtWad(buyFees.stockback, 2)}  -> net ${fmtWad(buyFees.net, 2)}`,
);

eq("BUY core fee == 1.00 (§315)", buyFees.coreFee, 1n * WAD);
eq("BUY creator == 0.65 (§315)", buyFees.creatorFee, 650_000_000_000_000_000n);
eq("BUY platform == 0.35 (§315)", buyFees.platformFee, 350_000_000_000_000_000n);
eq("BUY stockback == 1.00 (§315)", buyFees.stockback, 1n * WAD);
eq("BUY effective cost == 2.00 (2%, LOCKED §314.2)", buyFees.totalFee, 2n * WAD);

const sellFees = computeFees("SELL", hundred);
console.log(
  `  SELL 100 gross  ->  core ${fmtWad(sellFees.coreFee, 2)} ` +
    `(creator ${fmtWad(sellFees.creatorFee, 2)} / platform ${fmtWad(sellFees.platformFee, 2)}) ` +
    `+ stockback ${fmtWad(sellFees.stockback, 2)}  -> net ${fmtWad(sellFees.net, 2)}`,
);

eq("SELL core fee == 1.00 (§315)", sellFees.coreFee, 1n * WAD);
eq("SELL creator == 0.65 (§315)", sellFees.creatorFee, 650_000_000_000_000_000n);
eq("SELL platform == 0.35 (§315)", sellFees.platformFee, 350_000_000_000_000_000n);
eq("SELL stockback == 2.00 (§315)", sellFees.stockback, 2n * WAD);
eq("SELL effective cost == 3.00 (3%, LOCKED §314.2)", sellFees.totalFee, 3n * WAD);

// Creator's 65% share of the core fee is not reduced by Stockback (§2, §314.2).
check(
  "creator share unaffected by Stockback side (LOCKED §314.2)",
  buyFees.creatorFee === sellFees.creatorFee,
);

// ---------------------------------------------------------------------------
// 5. §407 post-graduation split
// ---------------------------------------------------------------------------

console.log("\n--- 5. §407 post-graduation fee split ------------------------------");

const lpRevenue = 1_000n * WAD;
const xs = splitPostGradFee(lpRevenue, true);
const tk = splitPostGradFee(lpRevenue, false);

console.log(
  `  paired xStock 1000  ->  creator ${fmtWad(xs.creator, 2)} / ` +
    `stockback ${fmtWad(xs.stockback, 2)} / platform ${fmtWad(xs.platform, 2)}`,
);
console.log(
  `  TOKEN-side    1000  ->  creator ${fmtWad(tk.creator, 2)} / ` +
    `stockback ${fmtWad(tk.stockback, 2)} / platform ${fmtWad(tk.platform, 2)}`,
);

eq("post-grad creator == 65.00% (LOCKED §407)", xs.creator, 650n * WAD);
eq("post-grad stockback == 17.50% (LOCKED §396-B)", xs.stockback, 175n * WAD);
eq("post-grad platform == 17.50% (LOCKED §396-B)", xs.platform, 175n * WAD);
eq("TOKEN-side stockback == 0, no auto-conversion (LOCKED §397)", tk.stockback, 0n);
eq("TOKEN-side platform == 35.00% (LOCKED §397)", tk.platform, 350n * WAD);
check(
  "creator undiluted regardless of fee asset (LOCKED §407)",
  xs.creator === tk.creator,
);

// ---------------------------------------------------------------------------
// 6. Quote/execute consistency and round-trip sanity
// ---------------------------------------------------------------------------

console.log("\n--- 6. Curve consistency -------------------------------------------");

// quote(x) and the inverse must agree: buying the quoted TOKEN out must cost no
// more than the input that quoted it (rounding may only favour the protocol).
let consistent = true;
let monotonic = true;
let prevPrice = -1n;

for (let i = 1; i <= 200; i++) {
  const q = (curve.qG * BigInt(i)) / 201n;
  const netIn = (10n ** 16n) * BigInt(i * 7 + 1); // varied, non-round sizes
  const out = tokensOutForNetIn(curve, q, netIn);
  if (out > 0n && q + out < curve.qG) {
    const cost = netInForTokensOut(curve, q, out);
    if (cost > netIn) consistent = false;
  }
  const price = marginalPrice(curve, q);
  if (price < prevPrice) monotonic = false;
  prevPrice = price;
}

check("netInForTokensOut(tokensOutForNetIn(x)) <= x for all sampled sizes", consistent);
check("marginal price is monotonically non-decreasing in q", monotonic);

// Sell immediately after buy must never return more than was paid in (no free
// money from rounding) — this is the core anti-extraction property.
let noRoundTripProfit = true;
for (let i = 1; i <= 200; i++) {
  const q = (curve.qG * BigInt(i)) / 201n;
  const netIn = (10n ** 15n) * BigInt(i * 13 + 3);
  const out = tokensOutForNetIn(curve, q, netIn);
  if (out === 0n) continue;
  const back = grossOutForTokensIn(curve, q + out, out);
  if (back > netIn) noRoundTripProfit = false;
}
check("buy-then-sell round trip never returns more than paid (pre-fee)", noRoundTripProfit);

// Collateral accumulated by walking the curve equals the closed form.
const walkSteps = 500n;
let q = 0n;
let walkedCollateral = 0n;
for (let i = 0n; i < walkSteps; i++) {
  const target = (curve.qG * (i + 1n)) / walkSteps;
  walkedCollateral += netInForTokensOut(curve, q, target - q);
  q = target;
}
eq("curve walk reaches exactly qG", q, curve.qG);
near(
  "sum of stepwise collateral == closed-form collateral(qG)",
  walkedCollateral,
  snap.collateral,
  walkSteps, // at most 1 wei of ceil-rounding per step, in the protocol's favour
);
check(
  "stepwise collateral rounds in the protocol's favour (>= closed form)",
  walkedCollateral >= snap.collateral,
);

// ---------------------------------------------------------------------------
// 7. Fees never touch curve collateral
// ---------------------------------------------------------------------------

console.log("\n--- 7. Fee / collateral separation (§8, §12) -----------------------");

const grossBuy = 500n * WAD;
const f = computeFees("BUY", grossBuy);
const tokensOut = tokensOutForNetIn(curve, 0n, f.net);
const collateralAfter = collateralAt(curve, tokensOut);

check(
  "collateral after buy <= net input (fees excluded from collateral)",
  collateralAfter <= f.net,
);
check(
  "collateral after buy < gross input by at least the full fee",
  grossBuy - collateralAfter >= f.totalFee,
);
eq(
  "fee split is exhaustive: creator + platform == core fee",
  f.creatorFee + f.platformFee,
  f.coreFee,
);
eq(
  "waterfall is exhaustive: net + core + stockback == gross",
  f.net + f.coreFee + f.stockback,
  grossBuy,
);

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(72));
if (failures.length === 0) {
  console.log(`SIMULATION GATE: PASS — ${passed} checks green.`);
  console.log("§8 reference outcomes and §315/§407 fee behaviour reproduced from");
  console.log("the canonical implementation. No locked rate was altered.");
} else {
  console.log(`SIMULATION GATE: FAIL — ${failures.length} of ${passed + failures.length} checks failed.`);
  for (const fail of failures) console.log(`  - ${fail}`);
  console.log("\nPer §9/§10 a failure here is a BLOCKED escalation, not a tuning exercise.");
  process.exitCode = 1;
}
console.log("");
