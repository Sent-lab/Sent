/**
 * SENT — TransactionIntent.
 *
 * THE LAW (§694, §695, §698, §1064):
 *
 *     UI REVIEW = TRANSACTION INTENT = SDK BUILDER = ACTUAL CALLDATA
 *
 * Every financial transaction in SENT is described by exactly one object, built
 * in exactly one place. The UI renders that object. The wallet signs the calldata
 * that object produced. Nothing between review and signature may alter either.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT A HELPER
 * ----------------------------------------------
 * The failure this prevents is not a bug in one place — it is the same arithmetic
 * being written twice. A frontend that formats a fee, a backend that quotes one,
 * and a contract that charges one will drift, and the user sees a number that is
 * not what they signed. §698 calls that a hidden transaction mutation and forbids
 * it outright.
 *
 * So: the SDK owns the builder, and the frontend, the API and any bot consume it.
 * None of them recompute fees, curve output, or calldata. A reviewer can check
 * that rule by grepping for `encodeFunctionData` — it should appear here and
 * nowhere else in the product.
 *
 * THE DISPLAY FIELDS ARE PART OF THE INTENT, NOT DECORATION
 * ---------------------------------------------------------
 * `review` carries the exact numbers the user must be shown, computed by the same
 * canonical functions the contract uses. If the UI renders anything else, it is
 * rendering a different transaction from the one it is about to submit.
 */

import { encodeFunctionData, type Hex } from "viem";

import { launchMarketAbi } from "@sent/contracts";
import { computeFees, type FeeBreakdown } from "@sent/economics";

/** Every kind of financial action a user can take. */
export type IntentKind =
  | "BUY"
  | "SELL"
  | "APPROVE_QUOTE"
  | "APPROVE_TOKEN"
  | "CLAIM_CREATOR_FEES"
  | "CLAIM_STOCKBACK"
  | "LAUNCH";

/**
 * What the user is shown before signing.
 *
 * Amounts are RAW asset units — what actually moves — with the normalized
 * figures alongside, because the contract's own accounting is normalized and a
 * reviewer needs both to check the two agree.
 */
export interface IntentReview {
  readonly kind: IntentKind;
  readonly summary: string;
  /** Ordered rows for the review sheet. The UI renders these, not its own. */
  readonly rows: readonly IntentRow[];
  /** The fee breakdown §316 requires to be shown in full, never aggregated. */
  readonly fees?: FeeBreakdown;
  /** Minimum the user accepts. Enforced on-chain, not merely displayed. */
  readonly minimumReceived?: bigint;
  /** True when this order finishes the curve and spills into HyperSwap (§411). */
  readonly crossesGraduation?: boolean;
  /**
   * True when the expected output covers only PART of the route.
   *
   * A crossing order executes on the curve and then on HyperSwap, and the
   * post-grad leg cannot be quoted without live venue state. Presenting the
   * curve leg alone as "you receive" would understate the total and read as a
   * complete figure — §411 requires a blended breakdown, so a UI must render
   * this differently rather than showing a number that looks whole.
   */
  readonly estimateIsPartial?: boolean;
  /**
   * True when `minimumReceived` bounds only part of the route.
   *
   * §14 requires ONE user-wide minimum covering blended execution. Until the
   * graduation router can quote the HyperSwap leg (V-06, V-09), the bound is
   * derived from the curve leg alone, which means the post-grad portion is
   * effectively unprotected: it could return almost nothing and the trade would
   * still clear. That is a real weakness, and it is surfaced rather than hidden.
   */
  readonly boundCoversPartialRoute?: boolean;
}

export interface IntentRow {
  readonly label: string;
  readonly value: string;
  /** Emphasised in the review sheet: the number the decision turns on. */
  readonly primary?: boolean;
  /** Rendered as a warning, e.g. high price impact (§232). */
  readonly warning?: boolean;
}

/**
 * A complete, signable transaction.
 *
 * `to` + `data` + `value` is exactly what the wallet receives. There is no
 * separate "build" step afterwards where a field could change.
 */
export interface TransactionIntent {
  readonly kind: IntentKind;
  readonly chainId: number;
  readonly to: `0x${string}`;
  readonly data: Hex;
  readonly value: bigint;
  readonly review: IntentReview;
  /** Unix seconds. Absent for actions with no deadline (approvals, claims). */
  readonly deadline?: bigint;
}

export interface BuildBuyParams {
  readonly chainId: number;
  readonly market: `0x${string}`;
  /** Gross quote input in RAW asset units. Fees come off this first (§9). */
  readonly grossQuoteIn: bigint;
  readonly minTokensOut: bigint;
  readonly deadline: bigint;
  /** Quote decimals, from the REGISTRY (never from the token itself). */
  readonly quoteDecimals: number;
  readonly quoteSymbol: string;
  readonly tokenSymbol: string;
  /** Expected output, quoted by the market through the same curve code. */
  readonly expectedTokensOut: bigint;
  readonly crossesGraduation?: boolean;
  /** Price impact in basis points, for the §232 warning. */
  readonly priceImpactBps?: bigint;
}

export interface BuildSellParams {
  readonly chainId: number;
  readonly market: `0x${string}`;
  readonly tokensIn: bigint;
  readonly minQuoteOut: bigint;
  readonly deadline: bigint;
  readonly quoteDecimals: number;
  readonly quoteSymbol: string;
  readonly tokenSymbol: string;
  /** Gross curve output, BEFORE fees — the SELL fee basis (§10). */
  readonly expectedGrossOut: bigint;
  readonly priceImpactBps?: bigint;
}

const WAD = 10n ** 18n;

/**
 * Format a raw amount for display at its own decimals.
 *
 * A NON-ZERO AMOUNT NEVER RENDERS AS ZERO
 * ---------------------------------------
 * Truncating to a fixed six places shows any amount below 0.000001 as
 * "0.000000". In a review sheet that is a transaction the user reads as doing
 * nothing — which is the one impression a review must never give. When the
 * fixed precision would erase the value entirely, it is extended until four
 * significant digits appear.
 *
 * Values large enough to survive six places are formatted exactly as before, so
 * this changes nothing for a realistic trade.
 */
export function formatUnits(amount: bigint, decimals: number, precision = 6): string {
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const sign = negative ? "-" : "";

  const scale = 10n ** BigInt(decimals);
  const whole = magnitude / scale;

  if (decimals === 0 || precision <= 0) {
    return `${sign}${whole.toLocaleString("en-US")}`;
  }

  const fraction = (magnitude % scale).toString().padStart(decimals, "0");

  let shown = precision;

  if (whole === 0n && magnitude > 0n) {
    let leadingZeros = 0;
    while (leadingZeros < fraction.length && fraction[leadingZeros] === "0") leadingZeros += 1;
    shown = Math.min(Math.max(precision, leadingZeros + 4), decimals);
  }

  return `${sign}${whole.toLocaleString("en-US")}.${fraction.slice(0, shown)}`;
}

/** Raw asset units -> normalized 18-decimal, mirroring XStockAssetAdapter. */
export function toNormalized(raw: bigint, decimals: number): bigint {
  if (decimals === 18) return raw;
  return decimals < 18 ? raw * 10n ** BigInt(18 - decimals) : raw / 10n ** BigInt(decimals - 18);
}

/** Normalized -> raw, rounding DOWN, mirroring the adapter's payout direction. */
export function toRawForPayout(normalized: bigint, decimals: number): bigint {
  if (decimals === 18) return normalized;
  return decimals < 18
    ? normalized / 10n ** BigInt(18 - decimals)
    : normalized * 10n ** BigInt(decimals - 18);
}

/**
 * Build a BUY.
 *
 * Fees are computed on the NORMALIZED gross, because that is the basis the
 * contract uses, then rendered back in raw units so the user sees amounts in the
 * asset they actually hold.
 */
export interface BuildApproveParams {
  readonly chainId: number;
  /** The ERC-20 being approved. */
  readonly token: `0x${string}`;
  /** Who may spend it — always a market, never an EOA. */
  readonly spender: `0x${string}`;
  /** Exact amount, in the asset's own raw units. */
  readonly amount: bigint;
  readonly decimals: number;
  readonly symbol: string;
  /** Distinguishes approving the quote asset from approving the token (§694). */
  readonly kind: "APPROVE_QUOTE" | "APPROVE_TOKEN";
}

/**
 * Build an ERC-20 approval.
 *
 * The `APPROVE_QUOTE` and `APPROVE_TOKEN` kinds existed in this enum with no
 * builder behind them, which meant a buy could be quoted and never executed:
 * the market cannot pull the quote asset without an allowance.
 *
 * EXACT AMOUNT, NEVER UNLIMITED
 * -----------------------------
 * The convention is to approve `type(uint256).max` so the user approves once.
 * It is also the reason a single bug in an approved contract drains every wallet
 * that ever traded with it, forever, including people who stopped using it years
 * earlier. These contracts are unaudited (see the README), so an unlimited
 * approval here would ask users to take a risk this project has not earned.
 *
 * The cost is one extra transaction per trade. That is a real cost and it is the
 * right side to be wrong on.
 *
 * The review says the amount in plain units, so "unlimited" can never appear in
 * a review as a number nobody reads.
 */
export function buildApproveIntent(params: BuildApproveParams): TransactionIntent {
  const { chainId, token, spender, amount, decimals, symbol, kind } = params;

  if (amount <= 0n) throw new Error("buildApproveIntent: amount must be positive");

  const data = encodeFunctionData({
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [spender, amount],
  });

  return {
    kind,
    chainId,
    to: token,
    data,
    value: 0n,
    review: {
      kind,
      summary: `Allow this market to spend ${formatUnits(amount, decimals)} ${symbol}`,
      rows: [
        {
          label: "Amount",
          value: `${formatUnits(amount, decimals)} ${symbol}`,
          primary: true,
        },
        { label: "Spender", value: spender },
        {
          label: "Approval type",
          // Stated, because the alternative is the one users have been trained
          // to expect and would otherwise assume.
          value: "Exact amount, not unlimited",
        },
      ],
    },
  };
}

/**
 * The one ERC-20 function this SDK encodes.
 *
 * Declared here rather than imported from a token ABI: an approval must encode
 * `approve(address,uint256)` and nothing else, and a full ERC-20 ABI in scope
 * would make it possible to encode a transfer by typo.
 */
const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function buildBuyIntent(params: BuildBuyParams): TransactionIntent {
  const {
    chainId,
    market,
    grossQuoteIn,
    minTokensOut,
    deadline,
    quoteDecimals,
    quoteSymbol,
    tokenSymbol,
    expectedTokensOut,
    crossesGraduation,
    priceImpactBps,
  } = params;

  if (grossQuoteIn <= 0n) throw new Error("buildBuyIntent: amount must be positive");

  const fees = computeFees("BUY", toNormalized(grossQuoteIn, quoteDecimals));

  const data = encodeFunctionData({
    abi: launchMarketAbi,
    functionName: "buy",
    args: [grossQuoteIn, minTokensOut, deadline],
  });

  const fee = (n: bigint) => `${formatUnits(toRawForPayout(n, quoteDecimals), quoteDecimals)} ${quoteSymbol}`;

  const rows: IntentRow[] = [
    {
      label: "You pay",
      value: `${formatUnits(grossQuoteIn, quoteDecimals)} ${quoteSymbol}`,
      primary: true,
    },
    crossesGraduation
      ? {
          // Never present a partial figure as a total. This order finishes the
          // curve and then executes on HyperSwap, and only the first leg is
          // quotable here.
          label: "You receive (curve leg only)",
          value: `at least ${formatUnits(expectedTokensOut, 18)} ${tokenSymbol}, plus a HyperSwap leg`,
          primary: true,
          warning: true,
        }
      : {
          label: "You receive",
          value: `${formatUnits(expectedTokensOut, 18)} ${tokenSymbol}`,
          primary: true,
        },
    // §316: the breakdown is shown in full. An aggregated "fee: 2%" hides which
    // part funds the creator and which part comes back to holders.
    { label: "Trading fee (1%)", value: fee(fees.coreFee) },
    { label: "  → creator", value: fee(fees.creatorFee) },
    { label: "  → platform", value: fee(fees.platformFee) },
    { label: "Stockback (1%)", value: fee(fees.stockback) },
    { label: "Into the curve", value: fee(fees.net) },
    {
      label: "Minimum received",
      value: `${formatUnits(minTokensOut, 18)} ${tokenSymbol}`,
    },
  ];

  if (priceImpactBps !== undefined) {
    rows.push({
      label: "Price impact",
      value: `${formatUnits(priceImpactBps * WAD, 4, 2)}%`,
      warning: priceImpactBps >= 500n, // §232 high-impact threshold
    });
  }

  if (crossesGraduation) {
    rows.push({
      label: "Route",
      value: "Finishes the curve, graduates, then HyperSwap",
      warning: true,
    });
    rows.push({
      label: "Slippage protection",
      value: "Covers the curve leg only — the HyperSwap leg is not yet quotable",
      warning: true,
    });
  }

  return {
    kind: "BUY",
    chainId,
    to: market,
    data,
    value: 0n,
    deadline,
    review: {
      kind: "BUY",
      summary: `Buy ${tokenSymbol} with ${formatUnits(grossQuoteIn, quoteDecimals)} ${quoteSymbol}`,
      rows,
      fees,
      minimumReceived: minTokensOut,
      ...(crossesGraduation !== undefined ? { crossesGraduation } : {}),
      ...(crossesGraduation
        ? { estimateIsPartial: true, boundCoversPartialRoute: true }
        : {}),
    },
  };
}

/**
 * Build a SELL.
 *
 * The fee basis is the curve's GROSS output, not the input — §10 runs the curve
 * first and takes fees from what comes out. Quoting a sell against the input
 * would show the user the wrong fee.
 */
export function buildSellIntent(params: BuildSellParams): TransactionIntent {
  const {
    chainId,
    market,
    tokensIn,
    minQuoteOut,
    deadline,
    quoteDecimals,
    quoteSymbol,
    tokenSymbol,
    expectedGrossOut,
    priceImpactBps,
  } = params;

  if (tokensIn <= 0n) throw new Error("buildSellIntent: amount must be positive");

  const fees = computeFees("SELL", toNormalized(expectedGrossOut, quoteDecimals));

  const data = encodeFunctionData({
    abi: launchMarketAbi,
    functionName: "sell",
    args: [tokensIn, minQuoteOut, deadline],
  });

  const fee = (n: bigint) => `${formatUnits(toRawForPayout(n, quoteDecimals), quoteDecimals)} ${quoteSymbol}`;

  const rows: IntentRow[] = [
    { label: "You sell", value: `${formatUnits(tokensIn, 18)} ${tokenSymbol}`, primary: true },
    { label: "You receive", value: fee(fees.net), primary: true },
    { label: "Gross from curve", value: fee(fees.notional) },
    { label: "Trading fee (1%)", value: fee(fees.coreFee) },
    { label: "  → creator", value: fee(fees.creatorFee) },
    { label: "  → platform", value: fee(fees.platformFee) },
    // Sells contribute twice as much as buys. Showing it plainly is the honest
    // way to explain why selling costs 3% and buying costs 2%.
    { label: "Stockback (2%)", value: fee(fees.stockback) },
    {
      label: "Minimum received",
      value: `${formatUnits(minQuoteOut, quoteDecimals)} ${quoteSymbol}`,
    },
  ];

  if (priceImpactBps !== undefined) {
    rows.push({
      label: "Price impact",
      value: `${formatUnits(priceImpactBps * WAD, 4, 2)}%`,
      warning: priceImpactBps >= 500n,
    });
  }

  return {
    kind: "SELL",
    chainId,
    to: market,
    data,
    value: 0n,
    deadline,
    review: {
      kind: "SELL",
      summary: `Sell ${formatUnits(tokensIn, 18)} ${tokenSymbol}`,
      rows,
      fees,
      minimumReceived: minQuoteOut,
    },
  };
}

/**
 * A stable fingerprint of everything that will be executed.
 *
 * §697 requires calldata to be verified before signing. The UI hashes the intent
 * it rendered, and the signing step re-hashes what it is about to send: any
 * divergence between review and submission is a mismatch, not a warning.
 */
export function intentFingerprint(intent: TransactionIntent): string {
  return [
    intent.kind,
    intent.chainId,
    intent.to.toLowerCase(),
    intent.data.toLowerCase(),
    intent.value.toString(),
    intent.deadline?.toString() ?? "-",
    intent.review.minimumReceived?.toString() ?? "-",
  ].join("|");
}

/**
 * Assert that what is about to be signed is what was reviewed.
 *
 * Called immediately before handing the transaction to the wallet. The check is
 * cheap; the failure it prevents is a user signing a transaction they never saw.
 */
export function assertIntentUnchanged(
  reviewed: TransactionIntent,
  submitting: TransactionIntent,
): void {
  const a = intentFingerprint(reviewed);
  const b = intentFingerprint(submitting);
  if (a !== b) {
    throw new Error(
      `TransactionIntent mutated between review and submission.\n  reviewed:   ${a}\n  submitting: ${b}`,
    );
  }
}
