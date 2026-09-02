/**
 * SENT — TransactionIntent integrity fixtures.
 *
 * §694 states the hard invariant:
 *
 *     UI REVIEW = TRANSACTION INTENT = SDK BUILDER = ACTUAL CALLDATA
 *
 * An invariant nothing checks is a comment. So the SDK builds real intents here,
 * and `contracts/test/IntentIntegrity.t.sol` submits their calldata BYTE FOR BYTE
 * to a real market, then asserts the on-chain outcome equals the numbers the
 * review showed.
 *
 * If the SDK ever computes a fee differently from the contract, or encodes an
 * argument in the wrong order, or the review is generated from anything other
 * than the same call, this fails.
 *
 * Run: pnpm fixtures:intent
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { WAD } from "@sent/economics";
import {
  makeCurve,
  p0FromReferenceMarketCap,
  tokensOutForNetIn,
  grossOutForTokensIn,
} from "../../economics/src/curve.ts";
import { computeFees } from "../../economics/src/fees.ts";
import {
  buildBuyIntent,
  buildSellIntent,
  toNormalized,
  toRawForPayout,
  intentFingerprint,
} from "../src/intent.ts";

const OUT = "contracts/test/fixtures/intents.json";

const CHAIN_ID = 999; // HyperEVM, VERIFIED (V-01)
const MARKET = "0x00000000000000000000000000000000000ma7ke" as `0x${string}`;
const DEADLINE = 9_999_999_999n;

const XSTOCK_USD = 137_420_000_000_000_000_000n;
const p0 = p0FromReferenceMarketCap(2_000n * WAD, XSTOCK_USD);
const curve = makeCurve(p0);

interface BuyCase {
  kind: "BUY";
  quoteDecimals: number;
  grossQuoteIn: string;
  minTokensOut: string;
  deadline: string;
  data: `0x${string}`;
  expectTokensOut: string;
  expectCoreFeeRaw: string;
  expectCreatorFeeRaw: string;
  expectPlatformFeeRaw: string;
  expectStockbackRaw: string;
  expectNetToCurveNormalized: string;
  fingerprint: string;
  summary: string;
}

interface SellCase {
  kind: "SELL";
  quoteDecimals: number;
  /** Warm-up buy the Solidity test replays first, so states match. */
  warmupGrossIn: string;
  tokensIn: string;
  minQuoteOut: string;
  deadline: string;
  data: `0x${string}`;
  expectNetOutRaw: string;
  expectCoreFeeRaw: string;
  expectStockbackRaw: string;
  fingerprint: string;
  summary: string;
}

const buys: BuyCase[] = [];
const sells: SellCase[] = [];

/**
 * Decimal scales that matter. 18 is where raw and normalized coincide and hide
 * unit bugs; 6 and 8 are where they do not.
 */
const DECIMALS = [18, 8, 6];

for (const quoteDecimals of DECIMALS) {
  const unit = 10n ** BigInt(quoteDecimals);

  // Awkward, non-round sizes. Round numbers hide rounding.
  const sizes = [
    unit / 10n,
    unit,
    (unit * 7n) / 3n,
    unit * 13n,
    (unit * 977n) / 10n,
  ];

  for (const grossQuoteIn of sizes) {
    if (grossQuoteIn <= 0n) continue;

    const grossNormalized = toNormalized(grossQuoteIn, quoteDecimals);
    const fees = computeFees("BUY", grossNormalized);
    const expectTokensOut = tokensOutForNetIn(curve, 0n, fees.net);
    if (expectTokensOut === 0n) continue;

    // A real client sets a bound; 1% below the quote is a normal setting.
    const minTokensOut = (expectTokensOut * 99n) / 100n;

    const intent = buildBuyIntent({
      chainId: CHAIN_ID,
      market: MARKET,
      grossQuoteIn,
      minTokensOut,
      deadline: DEADLINE,
      quoteDecimals,
      quoteSymbol: "NVDAx",
      tokenSymbol: "TEST",
      expectedTokensOut: expectTokensOut,
    });

    // The contract settles fees in RAW units, so the fixture records raw.
    const coreRaw = toRawForPayout(fees.coreFee, quoteDecimals);
    const creatorRaw = (coreRaw * 6_500n + 9_999n) / 10_000n;
    const creatorCapped = creatorRaw > coreRaw ? coreRaw : creatorRaw;

    buys.push({
      kind: "BUY",
      quoteDecimals,
      grossQuoteIn: grossQuoteIn.toString(),
      minTokensOut: minTokensOut.toString(),
      deadline: DEADLINE.toString(),
      data: intent.data,
      expectTokensOut: expectTokensOut.toString(),
      expectCoreFeeRaw: coreRaw.toString(),
      expectCreatorFeeRaw: creatorCapped.toString(),
      expectPlatformFeeRaw: (coreRaw - creatorCapped).toString(),
      expectStockbackRaw: toRawForPayout(fees.stockback, quoteDecimals).toString(),
      expectNetToCurveNormalized: fees.net.toString(),
      fingerprint: intentFingerprint(intent),
      summary: intent.review.summary,
    });
  }

  // One sell per decimal scale, taken after a known warm-up buy so the Solidity
  // test can reproduce the exact curve state.
  {
    const warmupGrossIn = unit * 20n;
    const warmupFees = computeFees("BUY", toNormalized(warmupGrossIn, quoteDecimals));
    const held = tokensOutForNetIn(curve, 0n, warmupFees.net);
    if (held > 0n) {
      const tokensIn = held / 2n;
      const grossOut = grossOutForTokensIn(curve, held, tokensIn);
      const fees = computeFees("SELL", grossOut);
      const expectNetOutRaw = toRawForPayout(fees.net, quoteDecimals);

      const intent = buildSellIntent({
        chainId: CHAIN_ID,
        market: MARKET,
        tokensIn,
        minQuoteOut: (expectNetOutRaw * 99n) / 100n,
        deadline: DEADLINE,
        quoteDecimals,
        quoteSymbol: "NVDAx",
        tokenSymbol: "TEST",
        expectedGrossOut: toRawForPayout(grossOut, quoteDecimals),
      });

      sells.push({
        kind: "SELL",
        quoteDecimals,
        warmupGrossIn: warmupGrossIn.toString(),
        tokensIn: tokensIn.toString(),
        minQuoteOut: ((expectNetOutRaw * 99n) / 100n).toString(),
        deadline: DEADLINE.toString(),
        data: intent.data,
        expectNetOutRaw: expectNetOutRaw.toString(),
        expectCoreFeeRaw: toRawForPayout(fees.coreFee, quoteDecimals).toString(),
        expectStockbackRaw: toRawForPayout(fees.stockback, quoteDecimals).toString(),
        fingerprint: intentFingerprint(intent),
        summary: intent.review.summary,
      });
    }
  }
}

// A mutated intent must never share a fingerprint with the original.
{
  const a = buildBuyIntent({
    chainId: CHAIN_ID,
    market: MARKET,
    grossQuoteIn: 10n ** 18n,
    minTokensOut: 1n,
    deadline: DEADLINE,
    quoteDecimals: 18,
    quoteSymbol: "NVDAx",
    tokenSymbol: "TEST",
    expectedTokensOut: 1n,
  });
  const b = buildBuyIntent({
    chainId: CHAIN_ID,
    market: MARKET,
    grossQuoteIn: 10n ** 18n,
    minTokensOut: 2n, // the only change
    deadline: DEADLINE,
    quoteDecimals: 18,
    quoteSymbol: "NVDAx",
    tokenSymbol: "TEST",
    expectedTokensOut: 1n,
  });
  if (intentFingerprint(a) === intentFingerprint(b)) {
    throw new Error("fingerprint does not distinguish a changed slippage bound");
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ p0: p0.toString(), buys, sells }, null, 2));

console.log(`\nIntent fixtures written to ${OUT}`);
console.log(`  buy intents   ${buys.length}`);
console.log(`  sell intents  ${sells.length}`);
console.log(`  decimals      ${DECIMALS.join(", ")}`);
console.log("  fingerprint distinguishes a changed slippage bound: verified");
console.log("");
