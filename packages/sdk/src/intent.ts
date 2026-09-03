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
  | "LAUNCH"
  | "FINALIZE_GRADUATION";

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
  /**
   * True when this order finishes the curve and closes it (§411, D-016).
   *
   * It no longer means "spills into HyperSwap". A crossing order fills on the
   * curve up to the endpoint and the remainder is REFUNDED, because at that
   * instant the pool does not exist yet — there is no venue to route into and
   * no price to route at.
   */
  readonly crossesGraduation?: boolean;
  /**
   * Quote returned unspent, raw units. Only set on a crossing order.
   *
   * Shown because a user who sends 100 and is charged 62 should see the 38
   * before they sign, not discover it in their balance afterwards.
   */
  readonly refundedQuote?: bigint;
}

/*
 * `estimateIsPartial` and `boundCoversPartialRoute` used to live here.
 *
 * They existed for V-19: a crossing order executed on the curve and then on
 * HyperSwap, `minimumReceived` bounded only the first leg, and the second rode
 * along unprotected. The flags surfaced that in the UI rather than hiding it,
 * which was mitigation rather than a fix, and the ledger said so.
 *
 * D-016 removed the second leg. The curve leg IS the trade now, so the estimate
 * is whole and the bound covers all of it — both flags are permanently false.
 *
 * They are deleted rather than kept and always-false. A flag that cannot be true
 * is worse than none: every UI keeps a branch for a state that cannot occur, and
 * the branch is never exercised, so nobody notices when it rots. V-19 is closed,
 * not accepted.
 */

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
  /**
   * Quote the curve had no supply left to sell, returned in the same
   * transaction (D-016). Raw units. Only meaningful on a crossing order.
   */
  readonly refundedQuote?: bigint;
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
    refundedQuote,
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
      // On a crossing order this is the whole input, and the part the curve
      // cannot sell comes straight back. The "Refunded" row below says how much,
      // so the two read together rather than this one overstating the cost.
      label: "You pay",
      value:
        crossesGraduation && refundedQuote !== undefined && refundedQuote > 0n
          ? `up to ${formatUnits(grossQuoteIn, quoteDecimals)} ${quoteSymbol}`
          : `${formatUnits(grossQuoteIn, quoteDecimals)} ${quoteSymbol}`,
      primary: true,
    },
    {
      // One figure, whole, on both paths. This row used to be split: a crossing
      // order showed "You receive (curve leg only) ... plus a HyperSwap leg",
      // because the second leg could not be quoted here.
      //
      // There is no second leg any more (D-016), so the number is complete and
      // is presented as one. Keeping the hedge would be worse than useless - it
      // would warn about a risk the trade no longer carries, and a warning that
      // is never real is one users learn to click past.
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
      value: "Finishes the curve and closes it",
      warning: true,
    });

    if (refundedQuote !== undefined && refundedQuote > 0n) {
      rows.push({
        label: "Refunded",
        value: `${formatUnits(refundedQuote, quoteDecimals)} ${quoteSymbol} — more than the curve had left to sell`,
      });
    }

    rows.push({
      label: "After this trade",
      value: "The curve is permanently closed. HyperSwap opens once the position is minted.",
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
      ...(refundedQuote !== undefined ? { refundedQuote } : {}),
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
export interface BuildClaimCreatorFeesParams {
  readonly chainId: number;
  /** The fee vault, read from the factory rather than configured separately. */
  readonly feeVault: `0x${string}`;
  /** The asset being withdrawn — a market's quote xStock. */
  readonly asset: `0x${string}`;
  /** Where the fees go. The creator's own address; the vault pays msg.sender's balance. */
  readonly to: `0x${string}`;
  /** What the vault says is payable, for the review. Never an indexed total. */
  readonly amount: bigint;
  readonly decimals: number;
  readonly symbol: string;
}

/**
 * Build a creator fee claim.
 *
 * `CLAIM_CREATOR_FEES` sat in `IntentKind` with no builder behind it, exactly as
 * `APPROVE_QUOTE` did — an enum member that reads as implemented. A creator
 * could see what they had earned and had no way to withdraw it.
 *
 * THE AMOUNT IS NOT AN ARGUMENT
 * -----------------------------
 * `claimCreatorFees(asset, to)` pays the caller's entire balance for that asset;
 * there is no amount to pass. So `amount` here is for the REVIEW only, and it
 * must come from the vault rather than from indexed accruals — a review showing
 * a lifetime total next to a call that pays the remaining balance would state a
 * figure the transaction does not produce.
 *
 * The vault credits `msg.sender`'s balance, so a wallet other than the creator's
 * cannot claim on their behalf and `to` only redirects where it lands.
 */
export function buildClaimCreatorFeesIntent(
  params: BuildClaimCreatorFeesParams,
): TransactionIntent {
  const { chainId, feeVault, asset, to, amount, decimals, symbol } = params;

  if (amount <= 0n) throw new Error("buildClaimCreatorFeesIntent: nothing to claim");

  const data = encodeFunctionData({
    abi: claimCreatorFeesAbi,
    functionName: "claimCreatorFees",
    args: [asset, to],
  });

  const plain = `${formatUnits(amount, decimals)} ${symbol}`;

  return {
    kind: "CLAIM_CREATOR_FEES",
    chainId,
    to: feeVault,
    data,
    value: 0n,
    review: {
      kind: "CLAIM_CREATOR_FEES",
      summary: `Claim ${plain} in creator fees`,
      rows: [
        { label: "You receive", value: plain, primary: true },
        { label: "Asset", value: `${symbol} (${asset})` },
        { label: "Sent to", value: to },
        {
          // Stated because the call has no amount argument: whatever the vault
          // owes at execution is what arrives, which may differ from this figure
          // if a trade lands in between.
          label: "Claims",
          value: "Your full balance of this asset at execution",
        },
      ],
    },
  };
}

/**
 * The one FeeVault function this SDK encodes.
 *
 * Declared here rather than importing the vault's full ABI, for the same reason
 * the approval builder declares its own: with `feeVaultAbi` in scope it becomes
 * possible to encode `setTreasury` by typo.
 */
const claimCreatorFeesAbi = [
  {
    type: "function",
    name: "claimCreatorFees",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const;

export interface BuildClaimStockbackParams {
  readonly chainId: number;
  readonly rewardVault: `0x${string}`;
  readonly market: `0x${string}`;
  /** Whose entitlement. The vault pays this account, not `msg.sender`. */
  readonly account: `0x${string}`;
  /**
   * The CUMULATIVE figure from the active root, not the amount to receive.
   *
   * §365: entitlements are cumulative and the vault pays `cumulative - claimed`.
   * Passing the payable amount here would claim far less than is owed — and
   * would succeed, because a smaller cumulative is a valid leaf's worth of a
   * claim as far as the arithmetic is concerned.
   */
  readonly cumulative: bigint;
  /** The Merkle proof for THIS root. A proof for another root simply fails. */
  readonly proof: readonly `0x${string}`[];
  /** What the user will actually receive: `cumulative - claimed`. Review only. */
  readonly payable: bigint;
  readonly decimals: number;
  readonly symbol: string;
}

/**
 * Build a Stockback claim.
 *
 * `CLAIM_STOCKBACK` was the third `IntentKind` with nothing behind it, after
 * `APPROVE_QUOTE` and `CLAIM_CREATOR_FEES` — and it is the one that mattered
 * most. The API serves a holder their `claimable` amount and the proof to spend
 * it with; without this there was no way to spend either. The money was
 * reachable on-chain and unreachable from the product.
 *
 * TWO DIFFERENT NUMBERS, AND THE REVIEW SHOWS BOTH
 * ------------------------------------------------
 * `cumulative` is what goes in the calldata; `payable` is what arrives. They
 * differ by everything previously claimed, and a review that showed only the
 * first would tell a holder they are about to receive their lifetime total.
 *
 * The proof and the cumulative must come from the SAME root. The API serves
 * them together for that reason, and mixing them produces a claim the vault
 * rejects — which is the safe failure, but only because the vault checks.
 */
export function buildClaimStockbackIntent(
  params: BuildClaimStockbackParams,
): TransactionIntent {
  const { chainId, rewardVault, market, account, cumulative, proof, payable, decimals, symbol } =
    params;

  if (payable <= 0n) throw new Error("buildClaimStockbackIntent: nothing to claim");
  if (cumulative < payable) {
    // Cumulative is a running total and can only be at least what is payable.
    // Reversed arguments produce exactly this, and the transaction would
    // otherwise be built, signed and reverted.
    throw new Error("buildClaimStockbackIntent: cumulative is below the payable amount");
  }
  /*
   * AN EMPTY PROOF IS NOT AN ERROR, AND REFUSING IT WAS ONE.
   *
   * A single-leaf Merkle tree has no siblings, so its proof is legitimately
   * empty — and a market with one holder is not an edge case, it is every
   * market on its first day.
   *
   * This did refuse it, on the reasoning that a caller who forgot to fetch a
   * proof looks identical. That reasoning was defensive in the wrong direction:
   * the ambiguity costs one confusing revert, while the refusal costs the
   * smallest markets their claims entirely. The e2e caught it on the first run
   * against a real single-holder market.
   *
   * The vault verifies the proof against the active root regardless, so a
   * genuinely missing one fails there — where the authority is.
   */

  const data = encodeFunctionData({
    abi: claimStockbackAbi,
    functionName: "claim",
    args: [market, account, cumulative, [...proof]],
  });

  const receiving = `${formatUnits(payable, decimals)} ${symbol}`;

  return {
    kind: "CLAIM_STOCKBACK",
    chainId,
    to: rewardVault,
    data,
    value: 0n,
    review: {
      kind: "CLAIM_STOCKBACK",
      summary: `Claim ${receiving} in Stockback`,
      rows: [
        { label: "You receive", value: receiving, primary: true },
        {
          // Shown because it is the number in the calldata, and a reviewer
          // comparing the two would otherwise find a figure they cannot explain.
          label: "Lifetime entitlement",
          value: `${formatUnits(cumulative, decimals)} ${symbol}`,
        },
        { label: "Market", value: market },
        { label: "Paid to", value: account },
      ],
    },
  };
}

/**
 * The one HolderRewardVault function this SDK encodes.
 *
 * Declared here rather than importing the vault's ABI, for the same reason the
 * approval and creator-claim builders declare their own: with the full ABI in
 * scope it becomes possible to encode `pauseClaims` by typo.
 */
const claimStockbackAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "address" },
      { name: "account", type: "address" },
      { name: "cumulativeAmount", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface LaunchMetadataInput {
  readonly description: string;
  readonly imageCid: string;
  readonly links: readonly { label: string; url: string }[];
}

export interface BuildLaunchParams {
  readonly chainId: number;
  readonly factory: `0x${string}`;
  readonly name: string;
  readonly symbol: string;
  readonly quoteAsset: `0x${string}`;
  readonly quoteSymbol: string;
  /** The salt the creator's grinder found. Never the deployment salt (§412). */
  readonly userSalt: `0x${string}`;
  /** keccak of the metadata. Bound into the address — see `launchIntentHash`. */
  readonly launchIntentHash: `0x${string}`;
  /**
   * The xStock/USD price the creator was shown.
   *
   * NOT the anchor. The factory reads that from the reference price adapter;
   * this bounds how far the feed may have moved since the preview, within
   * `ANCHOR_TOLERANCE_BPS`. Zero opts out of the check.
   */
  readonly reviewedUsdWad: bigint;
  /**
   * The address the creator was shown in the preview, enforced on-chain.
   *
   * Zero disables the check. Passing it is strongly preferred: it is the only
   * thing standing between "the address you ground for" and "an address".
   */
  readonly expectedToken: `0x${string}`;
  readonly metadata: LaunchMetadataInput;
  /** The launch fee, in the native gas token. Sent as `value`. */
  readonly launchFee: bigint;
}

/**
 * Build a launch.
 *
 * The last `IntentKind` with no builder, and the primary creator action. Without
 * it the create flow could not go through §694's path at all — the numbers a
 * creator reviews and the bytes they sign would have come from different places,
 * which is the one thing that path exists to prevent.
 *
 * WHAT THE REVIEW HAS TO SAY, AND WHY
 * -----------------------------------
 * A launch is irreversible in three ways at once and each has its own row:
 *
 *   The ADDRESS is permanent. §412 binds the creator into the salt, so the one
 *   in the preview is reachable only by them — and only for this exact intent.
 *
 *   The METADATA is committed. `launchIntentHash` is in the salt, so changing a
 *   character of the description after grinding lands the token somewhere else.
 *
 *   The ECONOMICS are locked. 0% creator allocation, a fixed supply, a fee split
 *   that cannot be tuned. §446 forbids silent fee tuning; showing the numbers at
 *   the moment of launch is the same principle facing the creator.
 */
export function buildLaunchIntent(params: BuildLaunchParams): TransactionIntent {
  const {
    chainId,
    factory,
    name,
    symbol,
    quoteAsset,
    quoteSymbol,
    userSalt,
    launchIntentHash,
    reviewedUsdWad,
    expectedToken,
    metadata,
    launchFee,
  } = params;

  if (name.length === 0 || symbol.length === 0) {
    throw new Error("buildLaunchIntent: name and symbol are required");
  }

  const data = encodeFunctionData({
    abi: launchAbi,
    functionName: "launch",
    args: [
      {
        name,
        symbol,
        quoteAsset,
        userSalt,
        launchIntentHash,
        xStockUsdWad: reviewedUsdWad,
        expectedToken,
        metadata: {
          description: metadata.description,
          imageCid: metadata.imageCid,
          links: metadata.links.map((l) => ({ label: l.label, url: l.url })),
        },
      },
    ],
  });

  const rows: IntentRow[] = [
    { label: "Token", value: `${name} (${symbol})`, primary: true },
    { label: "Paired with", value: quoteSymbol, primary: true },
    {
      label: "Address",
      value:
        expectedToken === "0x0000000000000000000000000000000000000000"
          ? "Not enforced — the deployed address may differ"
          : expectedToken,
      // A launch that does not pin its address is one where the preview was a
      // suggestion. Worth a warning rather than a silent difference.
      warning: expectedToken === "0x0000000000000000000000000000000000000000",
    },
    { label: "Your allocation", value: "0% — the curve holds the entire supply" },
    { label: "Your fee share", value: "65% of the 1% trading fee, forever" },
    { label: "Launch fee", value: `${formatUnits(launchFee, 18)} HYPE` },
  ];

  if (metadata.description !== "") {
    // Shown because it is permanent and committed: it is in the hash that is in
    // the address, so this is the last moment it can be changed for free.
    rows.push({ label: "Description", value: metadata.description });
  }

  for (const link of metadata.links) {
    rows.push({ label: `Link — ${link.label}`, value: link.url });
  }

  return {
    kind: "LAUNCH",
    chainId,
    to: factory,
    data,
    value: launchFee,
    review: {
      kind: "LAUNCH",
      summary: `Launch ${symbol} against ${quoteSymbol}`,
      rows,
    },
  };
}

/**
 * The one LaunchpadFactory function this SDK encodes.
 *
 * The tuple mirrors `LaunchParams` in declaration order. It has to: `abi.encode`
 * is positional, and a field in the wrong place produces calldata that decodes
 * into a different launch without failing.
 */
const launchAbi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "quoteAsset", type: "address" },
          { name: "userSalt", type: "bytes32" },
          { name: "launchIntentHash", type: "bytes32" },
          { name: "xStockUsdWad", type: "uint256" },
          { name: "expectedToken", type: "address" },
          {
            name: "metadata",
            type: "tuple",
            components: [
              { name: "description", type: "string" },
              { name: "imageCid", type: "string" },
              {
                name: "links",
                type: "tuple[]",
                components: [
                  { name: "label", type: "string" },
                  { name: "url", type: "string" },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "market", type: "address" },
    ],
  },
] as const;

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

// ---------------------------------------------------------------------------
// FINALIZE_GRADUATION (§16, §95.6, D-016)
// ---------------------------------------------------------------------------

const FINALIZE_GRADUATION_ABI = [
  {
    type: "function",
    name: "finalizeGraduation",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "pool", type: "address" },
      { name: "positionId", type: "uint256" },
    ],
  },
] as const;

export interface BuildFinalizeGraduationParams {
  readonly chainId: number;
  readonly market: `0x${string}`;
  readonly tokenSymbol: string;
  /** TOKEN bound for the pool, raw. From the `GraduationPending` event. */
  readonly tokenAmount: bigint;
  /** Quote bound for the pool, raw. From the same event. */
  readonly quoteAmount: bigint;
  readonly quoteDecimals: number;
  readonly quoteSymbol: string;
  /** Blocks the market has been waiting. Review only. */
  readonly waitingBlocks?: bigint;
}

/**
 * Build the graduation finalise.
 *
 * WHY THIS IS A USER-FACING INTENT AND NOT JUST A KEEPER SCRIPT
 * -------------------------------------------------------------
 * §16 requires this call to be permissionless, and a permissionless call that
 * only one party's tooling can construct is permissionless on paper. If the
 * keeper is down, a holder of a stalled market must be able to finalise it from
 * the UI — that is the whole reason the contract takes no arguments and reads no
 * `msg.sender`.
 *
 * §694 then applies unchanged: what the UI reviews is what the SDK builds is
 * what the wallet signs. So it goes through the same builder as every other
 * action rather than being special-cased somewhere.
 *
 * THE REVIEW HAS TO BE HONEST ABOUT WHAT THE CALLER GETS
 * ------------------------------------------------------
 * Nothing. §16 lists the exclusions - no collateral, no LP, no creator rights,
 * no economic privilege - and a review that showed a large TOKEN figure and a
 * large quote figure without saying so would read exactly like a claim.
 *
 * The amounts are shown because they are what the caller is moving and the sums
 * are large; they are labelled as destinations, not receipts.
 *
 * IT COSTS REAL GAS
 * -----------------
 * ~5.4M against the real HyperSwap deployment (V-20), which is why the split
 * exists at all. That does not fit in HyperEVM's default block lane, so a wallet
 * on the default lane cannot include this transaction. The review says so,
 * because the alternative is a user signing something their wallet will hold
 * forever without explaining why.
 */
export function buildFinalizeGraduationIntent(
  params: BuildFinalizeGraduationParams,
): TransactionIntent {
  const {
    chainId,
    market,
    tokenSymbol,
    tokenAmount,
    quoteAmount,
    quoteDecimals,
    quoteSymbol,
    waitingBlocks,
  } = params;

  const data = encodeFunctionData({
    abi: FINALIZE_GRADUATION_ABI,
    functionName: "finalizeGraduation",
    args: [],
  });

  const rows: IntentRow[] = [
    {
      label: "You receive",
      value: "Nothing — this call pays no one",
      primary: true,
    },
    {
      label: "Into permanent liquidity",
      value: `${formatUnits(tokenAmount, 18)} ${tokenSymbol} + ${formatUnits(quoteAmount, quoteDecimals)} ${quoteSymbol}`,
    },
    {
      label: "Who owns it after",
      value: "The lock. Nobody can withdraw it, including you and the creator.",
    },
    {
      label: "Block lane",
      value: "Needs the large lane — about 5.4M gas, over the default 3M limit",
      warning: true,
    },
  ];

  if (waitingBlocks !== undefined) {
    rows.push({ label: "Waiting since", value: `${waitingBlocks} blocks ago` });
  }

  return {
    kind: "FINALIZE_GRADUATION",
    chainId,
    to: market,
    data,
    value: 0n,
    // No deadline. The escrow is frozen and its inputs cannot drift, so there is
    // no stale-quote risk for a deadline to protect against — and a deadline on
    // a call anyone may retry would just be a way to make retries fail.
    deadline: 0n,
    review: {
      kind: "FINALIZE_GRADUATION",
      summary: `Finalise ${tokenSymbol}'s graduation`,
      rows,
    },
  };
}
