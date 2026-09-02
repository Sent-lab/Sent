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

/** Format a raw amount for display at its own decimals. */
export function formatUnits(amount: bigint, decimals: number, precision = 6): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const frac = (amount % scale).toString().padStart(decimals, "0").slice(0, precision);
  return precision > 0 ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
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
    {
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
      value: "Finishes the curve, then HyperSwap",
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
