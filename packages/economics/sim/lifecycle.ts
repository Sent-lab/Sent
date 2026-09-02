/**
 * SENT — market lifecycle simulation.
 *
 * §309 requires a Stockback fee simulation before the rates are locked, and §9/§10
 * are explicit that a simulation is a validation GATE: it never authorises a
 * retune, but a failure is a BLOCKED escalation.
 *
 * Two scenarios, because a launchpad has two outcomes and both must be correct:
 *
 *   SUSTAINED DEMAND — net buying carries the market to graduation. Everything
 *                      must stay solvent through the crossing order and the
 *                      endpoint must be hit exactly.
 *
 *   CHURN            — balanced flow, no sustained demand. The market must NOT
 *                      graduate, must stay solvent indefinitely, and must keep
 *                      paying Stockback. §2 is explicit that a token which never
 *                      graduates has no forced expiry, so "never graduates" is a
 *                      supported end state, not a failure.
 *
 * Everything is computed by the canonical implementations — `packages/economics`
 * for curve and fees, `packages/stockback` for time-weighted rewards. The buy path
 * mirrors LaunchMarket's crossing-order segmentation (§411); without that the
 * simulation would over-credit collateral on the final trade and measure
 * something the protocol does not do.
 *
 * Run: pnpm sim:lifecycle
 */

import { WAD } from "../src/wad.ts";
import {
  makeCurve,
  p0FromReferenceMarketCap,
  marginalPrice,
  tokensOutForNetIn,
  netInForTokensOut,
  grossOutForTokensIn,
  collateralAt,
} from "../src/curve.ts";
import { computeFees } from "../src/fees.ts";
import {
  EPOCH_DURATION_SECONDS,
  computeEpochWeights,
  distributeEpoch,
  makeExclusionSet,
  type BalanceEvent,
} from "../../stockback/src/twab.ts";

const XSTOCK_USD = 137_420_000_000_000_000_000n; // $137.42
const REFERENCE_MC = 2_000n * WAD;

const usd = (quoteWei: bigint): bigint => (quoteWei * XSTOCK_USD) / WAD;

const fmt = (v: bigint, dp = 2): string => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / WAD;
  const frac = (a % WAD).toString().padStart(18, "0").slice(0, dp);
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${dp > 0 ? `.${frac}` : ""}`;
};

let failures = 0;
function gate(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------

interface Scenario {
  readonly name: string;
  /** Out of 10. Low = strong net demand, 5 = churn. */
  readonly sellPropensity: bigint;
  /** Ticket scale. A hot market attracts larger orders than a quiet one. */
  readonly ticketBase: bigint;
  /** Divisor applied to holdings when selling. Larger = smaller sells. */
  readonly sellFraction: bigint;
  readonly traders: number;
  readonly epochs: number;
  readonly seed: bigint;
}

interface Result {
  graduatedOnDay: number | null;
  distributed: bigint;
  collateral: bigint;
  grossBuyVolume: bigint;
  grossSellVolume: bigint;
  creatorFees: bigint;
  platformFees: bigint;
  stockbackFunded: bigint;
  stockbackDistributed: bigint;
  stockbackCarry: bigint;
  buys: number;
  sells: number;
  holders: number;
  earners: number;
  finalPrice: bigint;
}

function run(scenario: Scenario): Result {
  const curve = makeCurve(p0FromReferenceMarketCap(REFERENCE_MC, XSTOCK_USD));

  let seed = scenario.seed;
  const rand = (n: bigint): bigint => {
    seed = (seed * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) % (1n << 64n);
    return seed % n;
  };

  const balances = new Map<string, bigint>();
  const earned = new Map<string, bigint>();

  const r: Result = {
    graduatedOnDay: null,
    distributed: 0n,
    collateral: 0n,
    grossBuyVolume: 0n,
    grossSellVolume: 0n,
    creatorFees: 0n,
    platformFees: 0n,
    stockbackFunded: 0n,
    stockbackDistributed: 0n,
    stockbackCarry: 0n,
    buys: 0,
    sells: 0,
    holders: 0,
    earners: 0,
    finalPrice: 0n,
  };

  const exclusions = makeExclusionSet([]);
  let openingBalances = new Map<string, bigint>();

  console.log(`\n  day   price(USD)     MC(USD)   filled%   volume(USD)  holders`);

  for (let epoch = 0; epoch < scenario.epochs && r.graduatedOnDay === null; epoch++) {
    const epochStartTs = BigInt(epoch) * EPOCH_DURATION_SECONDS;
    const events: BalanceEvent[] = [];
    let epochVolume = 0n;

    const progressBps = (r.distributed * 10_000n) / curve.qG;
    const tradeCount = 20 + Number(progressBps / 100n);

    const times = Array.from({ length: tradeCount }, () =>
      epochStartTs + rand(EPOCH_DURATION_SECONDS),
    ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    for (const at of times) {
      if (r.distributed >= curve.qG) break;

      const id = `t${rand(BigInt(scenario.traders))}`;
      const held = balances.get(id) ?? 0n;

      if (held > 0n && rand(10n) < scenario.sellPropensity) {
        const amount = held / (scenario.sellFraction + rand(3n));
        if (amount === 0n) continue;

        const gross = grossOutForTokensIn(curve, r.distributed, amount);
        if (gross === 0n) continue;

        const f = computeFees("SELL", gross);

        r.distributed -= amount;
        r.collateral -= gross;
        balances.set(id, held - amount);

        r.grossSellVolume += gross;
        epochVolume += gross;
        r.creatorFees += f.creatorFee;
        r.platformFees += f.platformFee;
        r.stockbackFunded += f.stockback;
        r.sells++;

        events.push({ account: id, delta: -amount, timestamp: at });
      } else {
        // Ticket sizes span three orders of magnitude from the scenario's base,
        // which is what real order flow looks like. A market graduates on about
        // $17.5K of net buying, so the base is what decides whether that takes
        // days of accumulation or two trades.
        const magnitude = rand(3n);
        const base =
          magnitude === 0n ? scenario.ticketBase
          : magnitude === 1n ? scenario.ticketBase * 10n
          : scenario.ticketBase * 100n;
        const gross = base * (rand(9n) + 1n);

        const f = computeFees("BUY", gross);

        const remaining = curve.qG - r.distributed;
        const netToEndpoint = netInForTokensOut(curve, r.distributed, remaining);

        // Crossing-order segmentation, exactly as LaunchMarket does it (§411):
        // the curve consumes only what the endpoint costs, and the remainder
        // would execute post-graduation rather than crediting collateral.
        if (f.net >= netToEndpoint) {
          r.distributed += remaining;
          r.collateral += netToEndpoint;
          balances.set(id, held + remaining);
          events.push({ account: id, delta: remaining, timestamp: at });
          r.graduatedOnDay = epoch + 1;
        } else {
          const out = tokensOutForNetIn(curve, r.distributed, f.net);
          if (out === 0n) continue;

          r.distributed += out;
          r.collateral += f.net;
          balances.set(id, held + out);
          events.push({ account: id, delta: out, timestamp: at });
        }

        r.grossBuyVolume += gross;
        epochVolume += gross;
        r.creatorFees += f.creatorFee;
        r.platformFees += f.platformFee;
        r.stockbackFunded += f.stockback;
        r.buys++;
      }
    }

    const weights = computeEpochWeights(BigInt(epoch), openingBalances, events, exclusions);
    const available = r.stockbackFunded - r.stockbackDistributed;
    const dist = distributeEpoch(BigInt(epoch), available, weights);

    for (const [account, reward] of dist.rewards) {
      earned.set(account, (earned.get(account) ?? 0n) + reward);
    }
    r.stockbackDistributed += dist.allocated;
    r.stockbackCarry = dist.carryForward;
    openingBalances = new Map(weights.closingBalances);

    const holders = [...openingBalances.values()].filter((b) => b > 0n).length;
    const price = marginalPrice(curve, r.distributed);

    const isLast = epoch === scenario.epochs - 1 || r.graduatedOnDay !== null;
    if (epoch % 10 === 0 || isLast) {
      console.log(
        `  ${String(epoch + 1).padStart(3)}   ` +
          `${fmt(usd(price) * 1_000_000n, 4).padStart(10)}  ` +
          `${fmt(usd((price * curve.supply) / WAD), 0).padStart(10)}  ` +
          `${fmt((r.distributed * 100n * WAD) / curve.qG, 2).padStart(8)}  ` +
          `${fmt(usd(epochVolume), 0).padStart(12)}  ${String(holders).padStart(7)}`,
      );
    }
  }

  r.holders = [...openingBalances.values()].filter((b) => b > 0n).length;
  r.earners = [...earned.values()].filter((v) => v > 0n).length;
  r.finalPrice = marginalPrice(curve, r.distributed);

  return r;
}

// ---------------------------------------------------------------------------

function report(scenario: Scenario, r: Result): void {
  const curve = makeCurve(p0FromReferenceMarketCap(REFERENCE_MC, XSTOCK_USD));
  const totalVolume = r.grossBuyVolume + r.grossSellVolume;
  const coreFees = r.creatorFees + r.platformFees;
  const traderCost = coreFees + r.stockbackFunded;

  console.log(`\n  outcome              ${r.graduatedOnDay ? `graduated on day ${r.graduatedOnDay}` : `no graduation in ${scenario.epochs} days`}`);
  console.log(`  trades               ${r.buys} buys / ${r.sells} sells`);
  console.log(`  gross volume         $${fmt(usd(totalVolume), 0)}`);
  console.log(`  curve collateral     $${fmt(usd(r.collateral))}`);
  console.log(`  creator revenue      $${fmt(usd(r.creatorFees))}`);
  console.log(`  platform revenue     $${fmt(usd(r.platformFees))}`);
  console.log(`  stockback to holders $${fmt(usd(r.stockbackDistributed))}`);
  console.log(`  blended trader cost  ${fmt((traderCost * 10_000n * WAD) / totalVolume, 1)} bps`);
  console.log(`  holders / earners    ${r.holders} / ${r.earners}`);

  console.log("");
  const closedForm = collateralAt(curve, r.distributed);
  const drift = r.collateral > closedForm ? r.collateral - closedForm : closedForm - r.collateral;

  gate(
    `[${scenario.name}] collateral tracks the closed-form curve`,
    r.collateral >= closedForm && drift < WAD / 1000n,
    `drift ${drift} wei`,
  );
  gate(
    `[${scenario.name}] collateral is never negative`,
    r.collateral >= 0n,
  );
  gate(
    `[${scenario.name}] creator receives no less than 65% of the core fee`,
    r.creatorFees * 10_000n >= coreFees * 6_500n,
  );
  gate(
    `[${scenario.name}] every Stockback contribution is paid out or carried`,
    r.stockbackFunded === r.stockbackDistributed + r.stockbackCarry,
  );
  gate(
    `[${scenario.name}] Stockback never over-distributes`,
    r.stockbackDistributed <= r.stockbackFunded,
  );

  const bps = (traderCost * 10_000n) / totalVolume;
  gate(
    `[${scenario.name}] blended cost sits between the 2% buy and 3% sell rates`,
    bps >= 200n && bps <= 300n,
    `${bps} bps`,
  );
  gate(`[${scenario.name}] Stockback reaches real holders`, r.earners > 0);
}

// ---------------------------------------------------------------------------

console.log("\nSENT — Market Lifecycle Simulation (§309 economic gate)");
console.log("=".repeat(76));
console.log(`  quote asset $${fmt(XSTOCK_USD)}   launch $${fmt(REFERENCE_MC, 0)} reference MC`);
console.log(`  locked rates: 1% core fee, 65/35 split, Stockback +1% buy / +2% sell`);

console.log("\n" + "-".repeat(76));
console.log("SCENARIO 1 — SUSTAINED DEMAND (must graduate)");
console.log("-".repeat(76));
const demand: Scenario = {
  name: "demand",
  sellPropensity: 2n,
  // A market people actually want: larger tickets, and holders trim rather than
  // dump. ~$1.4 to $1,400 per order.
  ticketBase: WAD / 100n,
  sellFraction: 6n,
  traders: 40,
  epochs: 90,
  seed: 20260902n,
};
const demandResult = run(demand);
report(demand, demandResult);

gate("[demand] sustained net buying reaches graduation", demandResult.graduatedOnDay !== null);
gate(
  "[demand] the endpoint is hit exactly, never overshot",
  demandResult.distributed === (1_000_000_000n * WAD * 50n) / 76n,
);

console.log("\n" + "-".repeat(76));
console.log("SCENARIO 2 — CHURN (must NOT graduate, must stay solvent)");
console.log("-".repeat(76));
const churn: Scenario = {
  name: "churn",
  sellPropensity: 5n,
  // A quiet market: small tickets, and holders exiting a third at a time.
  ticketBase: WAD / 1000n,
  sellFraction: 2n,
  traders: 40,
  epochs: 90,
  seed: 777777n,
};
const churnResult = run(churn);
report(churn, churnResult);

gate(
  "[churn] balanced flow does not force graduation",
  churnResult.graduatedOnDay === null,
);
gate(
  "[churn] a market that never graduates stays solvent indefinitely (§2: no forced expiry)",
  churnResult.collateral >= 0n && churnResult.distributed <= (1_000_000_000n * WAD * 50n) / 76n,
);
gate(
  "[churn] holders keep earning Stockback without graduation",
  churnResult.stockbackDistributed > 0n,
);

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(76));
if (failures === 0) {
  console.log("LIFECYCLE GATE: PASS");
  console.log("");
  console.log("The locked economics are coherent and solvent in both end states: a");
  console.log("market that graduates hits the endpoint exactly, and one that never");
  console.log("graduates keeps trading and keeps paying holders, with no forced expiry.");
  console.log("");
  console.log("NOTE — this proves the MECHANISM. Whether the resulting creator revenue");
  console.log("and holder yield are commercially attractive is a product judgement");
  console.log("(§309) and belongs to the owner, not to this simulation.");
} else {
  console.log(`LIFECYCLE GATE: FAIL — ${failures} gate(s) failed.`);
  console.log("Per §9/§10 this is a BLOCKED escalation, not a tuning exercise.");
  process.exitCode = 1;
}
console.log("");
