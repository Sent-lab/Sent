/**
 * SENT — HTTP API handlers.
 *
 * Pure functions over a data port. No framework, no database driver, no clock —
 * so the behaviour that matters can be tested directly rather than through a
 * server harness.
 *
 * THE RULE THIS FILE EXISTS TO KEEP (§1064, §694)
 * -----------------------------------------------
 * The API does not compute economics. A quote is produced by the SDK's intent
 * builder, which calls the same curve and fee code the contract runs. If this
 * layer formatted a fee or estimated an output, that would be a third
 * implementation of the same arithmetic — after the contract and the SDK — and
 * the one users would see first.
 *
 * There is no `encodeFunctionData` here and no fee arithmetic. That absence is
 * the design.
 *
 * EVERY RESPONSE CARRIES ITS FRESHNESS (§87, §211)
 * -------------------------------------------------
 * A client cannot render honestly what the server described vaguely. Responses
 * carry a freshness envelope and per-value provenance, so a component knows
 * whether it is holding a chain read, an indexed projection, or an estimate.
 */

import {
  classifyFreshness,
  type FreshnessEnvelope,
  type Provenance,
  type Sourced,
} from "@sent/realtime";
import {
  buildBuyIntent,
  buildSellIntent,
  toNormalized,
  toRawForPayout,
  type TransactionIntent,
} from "@sent/sdk";
import { computeFees } from "@sent/economics";

// ---------------------------------------------------------------------------
// Port — what the API needs from the projection
// ---------------------------------------------------------------------------

export interface MarketRow {
  readonly token: string;
  readonly market: string;
  readonly creator: string;
  readonly quoteAsset: string;
  readonly quoteDecimals: number;
  readonly quoteSymbol: string;
  readonly name: string;
  readonly symbol: string;
  readonly status: "PRE_GRAD" | "GRADUATING" | "GRADUATED";
  readonly distributed: bigint;
  readonly curveCollateral: bigint;
  readonly qG: bigint;
  readonly price: bigint;
  readonly holderCount: number;
  readonly tradeCount: number;
  readonly launchedAt: number;
  readonly lastBlock: bigint;
}

export interface TradeRow {
  readonly txHash: string;
  readonly blockNumber: bigint;
  readonly side: "BUY" | "SELL";
  readonly trader: string;
  readonly notional: bigint;
  readonly tokens: bigint;
  readonly coreFee: bigint;
  readonly creatorFee: bigint;
  readonly platformFee: bigint;
  readonly stockback: bigint;
  readonly priceAfter: bigint;
  readonly timestamp: number;
}

export interface StockbackRow {
  /** Accruing this epoch. A projection, not an entitlement (§293). */
  readonly estimatedAccrued: bigint;
  /** Committed, activated, and payable by the vault. */
  readonly claimable: bigint;
  readonly lifetimeClaimed: bigint;
  readonly epochSequence: bigint;
  readonly epochEndsAt: number;
  /** Present only when a commitment covering this holder is active. */
  readonly proof?: readonly string[];
  readonly cumulative?: bigint;
}

export interface DataPort {
  headBlock(): bigint;
  /** Unix seconds. Required, so a response can never claim an epoch timestamp. */
  serverTime(): number;
  indexedBlock(): bigint;
  finalizedBlock(): bigint | undefined;
  chainConnected(): boolean;

  listMarkets(options: ExploreOptions): readonly MarketRow[];
  getMarket(token: string): MarketRow | null;
  listTrades(market: string, limit: number): readonly TradeRow[];
  getStockback(market: string, account: string): StockbackRow | null;

  /** Quote from the canonical curve, as the market itself would compute it. */
  quoteBuy(market: string, grossQuoteIn: bigint): QuoteResult | null;
  quoteSell(market: string, tokensIn: bigint): QuoteResult | null;
}

export interface QuoteResult {
  readonly tokensOut?: bigint;
  readonly grossOut?: bigint;
  readonly crossesGraduation: boolean;
  readonly priceImpactBps: bigint;
}

export interface ExploreOptions {
  readonly sort: "NEWEST" | "PROGRESS" | "VOLUME" | "HOLDERS";
  readonly status?: "PRE_GRAD" | "GRADUATED";
  readonly quoteAsset?: string;
  readonly limit: number;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  readonly ok: true;
  readonly data: T;
  readonly freshness: FreshnessEnvelope;
}

export interface ApiError {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly freshness: FreshnessEnvelope;
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

const MAX_LIMIT = 100;

function envelope(port: DataPort): FreshnessEnvelope {
  // `serverTime` is read from the port rather than defaulted. A zero here would
  // claim 1970, and a UI rendering "updated Xs ago" would show 56 years — a
  // silent lie in the one field built to prevent lying about freshness (§279).
  const head = port.headBlock();
  const indexed = port.indexedBlock();
  const lag = head > indexed ? Number(head - indexed) : 0;
  const finalized = port.finalizedBlock();

  return {
    state: classifyFreshness(lag, port.chainConnected()),
    headBlock: head.toString(),
    lagBlocks: lag,
    ...(finalized !== undefined ? { finalizedBlock: finalized.toString() } : {}),
    serverTime: port.serverTime(),
  };
}

function ok<T>(port: DataPort, data: T): ApiResponse<T> {
  return { ok: true, data, freshness: envelope(port) };
}

function fail(port: DataPort, code: string, message: string, retryable = false): ApiError {
  return { ok: false, code, message, retryable, freshness: envelope(port) };
}

/**
 * Attach provenance to a value.
 *
 * `asOf` is a required argument for the same reason `serverTime` is: a zero
 * default would claim 1970, and a component rendering "as of" would show a date
 * from before the web existed rather than failing visibly (§279).
 */
function sourced(value: string, provenance: Provenance, block: bigint, asOf: number): Sourced {
  return { value, provenance, asOfBlock: block.toString(), asOf };
}

// ---------------------------------------------------------------------------
// Explore
// ---------------------------------------------------------------------------

export interface ExploreItem {
  readonly token: string;
  readonly market: string;
  readonly name: string;
  readonly symbol: string;
  readonly quoteSymbol: string;
  readonly status: string;
  readonly price: Sourced;
  readonly graduationProgressBps: Sourced;
  readonly holderCount: Sourced;
  readonly creator: string;
  readonly launchedAt: number;
}

export function handleExplore(port: DataPort, options: Partial<ExploreOptions>): ApiResult<ExploreItem[]> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_LIMIT);

  const resolved: ExploreOptions = {
    sort: options.sort ?? "NEWEST",
    limit,
    ...(options.status !== undefined ? { status: options.status } : {}),
    ...(options.quoteAsset !== undefined ? { quoteAsset: options.quoteAsset } : {}),
  };

  const rows = port.listMarkets(resolved);

  return ok(
    port,
    rows.map((row) => ({
      token: row.token,
      market: row.market,
      name: row.name,
      symbol: row.symbol,
      quoteSymbol: row.quoteSymbol,
      status: row.status,
      price: sourced(row.price.toString(), "INDEXED", row.lastBlock, port.serverTime()),
      // CALCULATED, not INDEXED: derived from indexed values rather than read
      // from a contract, and §87 requires that distinction to survive the wire.
      graduationProgressBps: sourced(
        ((row.distributed * 10_000n) / row.qG).toString(),
        "CALCULATED",
        row.lastBlock,
        port.serverTime(),
      ),
      holderCount: sourced(String(row.holderCount), "INDEXED", row.lastBlock, port.serverTime()),
      creator: row.creator,
      launchedAt: row.launchedAt,
    })),
  );
}

// ---------------------------------------------------------------------------
// Market detail
// ---------------------------------------------------------------------------

export interface MarketDetail {
  readonly token: string;
  readonly market: string;
  readonly creator: string;
  readonly name: string;
  readonly symbol: string;
  readonly quoteAsset: string;
  readonly quoteSymbol: string;
  readonly quoteDecimals: number;
  readonly status: string;
  readonly price: Sourced;
  readonly distributed: Sourced;
  readonly curveCollateral: Sourced;
  readonly graduationProgressBps: Sourced;
  readonly holderCount: Sourced;
  /**
   * Authenticity comes from the factory registry, never from the address shape
   * (§4). Exposed so a UI can render a verified badge without inventing its own
   * rule from the suffix.
   */
  readonly authentic: true;
}

export function handleMarket(port: DataPort, token: string): ApiResult<MarketDetail> {
  const row = port.getMarket(token.toLowerCase());
  if (row === null) {
    return fail(port, "MARKET_NOT_FOUND", `no launched market for token ${token}`);
  }

  return ok(port, {
    token: row.token,
    market: row.market,
    creator: row.creator,
    name: row.name,
    symbol: row.symbol,
    quoteAsset: row.quoteAsset,
    quoteSymbol: row.quoteSymbol,
    quoteDecimals: row.quoteDecimals,
    status: row.status,
    price: sourced(row.price.toString(), "INDEXED", row.lastBlock, port.serverTime()),
    distributed: sourced(row.distributed.toString(), "INDEXED", row.lastBlock, port.serverTime()),
    curveCollateral: sourced(row.curveCollateral.toString(), "INDEXED", row.lastBlock, port.serverTime()),
    graduationProgressBps: sourced(((row.distributed * 10_000n) / row.qG).toString(), "CALCULATED", row.lastBlock, port.serverTime()),
    holderCount: sourced(String(row.holderCount), "INDEXED", row.lastBlock, port.serverTime()),
    authentic: true,
  });
}

// ---------------------------------------------------------------------------
// Tape
// ---------------------------------------------------------------------------

export interface TapeItem {
  readonly txHash: string;
  readonly blockNumber: string;
  readonly side: string;
  readonly trader: string;
  readonly notional: string;
  readonly tokens: string;
  /** §316: the split is served in full. The API never aggregates it. */
  readonly coreFee: string;
  readonly creatorFee: string;
  readonly platformFee: string;
  readonly stockback: string;
  readonly priceAfter: string;
  readonly timestamp: number;
}

export function handleTape(port: DataPort, token: string, limit = 50): ApiResult<TapeItem[]> {
  const row = port.getMarket(token.toLowerCase());
  if (row === null) return fail(port, "MARKET_NOT_FOUND", `no launched market for token ${token}`);

  const capped = Math.min(Math.max(limit, 1), MAX_LIMIT);

  return ok(
    port,
    port.listTrades(row.market, capped).map((t) => ({
      txHash: t.txHash,
      blockNumber: t.blockNumber.toString(),
      side: t.side,
      trader: t.trader,
      notional: t.notional.toString(),
      tokens: t.tokens.toString(),
      coreFee: t.coreFee.toString(),
      creatorFee: t.creatorFee.toString(),
      platformFee: t.platformFee.toString(),
      stockback: t.stockback.toString(),
      priceAfter: t.priceAfter.toString(),
      timestamp: t.timestamp,
    })),
  );
}

// ---------------------------------------------------------------------------
// Quote — returns a signable intent, not a number
// ---------------------------------------------------------------------------

export interface QuoteRequest {
  readonly token: string;
  readonly side: "BUY" | "SELL";
  readonly amount: bigint;
  /** Slippage tolerance in basis points. */
  readonly slippageBps: bigint;
  readonly deadline: bigint;
  readonly chainId: number;
}

/**
 * Quote an order.
 *
 * Returns a complete `TransactionIntent`, not a price. A client that received a
 * bare number would have to build the transaction itself, which is exactly the
 * second implementation §694 forbids — and the review the user sees would be
 * assembled from different arithmetic than the calldata they sign.
 */
export function handleQuote(port: DataPort, request: QuoteRequest): ApiResult<TransactionIntent> {
  if (request.amount <= 0n) {
    return fail(port, "INVALID_AMOUNT", "amount must be positive");
  }
  if (request.slippageBps < 0n || request.slippageBps > 5_000n) {
    return fail(port, "INVALID_SLIPPAGE", "slippage must be between 0 and 5000 bps");
  }

  const row = port.getMarket(request.token.toLowerCase());
  if (row === null) return fail(port, "MARKET_NOT_FOUND", `no launched market for token ${request.token}`);

  if (row.status !== "PRE_GRAD") {
    // §19: after graduation the curve is permanently closed and HyperSwap is the
    // canonical venue. Quoting the curve here would offer a trade that cannot
    // execute.
    return fail(
      port,
      "MARKET_GRADUATED",
      "this market has graduated; trade on the HyperSwap pool instead",
    );
  }

  if (request.side === "BUY") {
    const quote = port.quoteBuy(row.market, request.amount);
    if (quote === null || quote.tokensOut === undefined) {
      return fail(port, "QUOTE_UNAVAILABLE", "the market could not quote this order", true);
    }

    const minTokensOut =
      (quote.tokensOut * (10_000n - request.slippageBps)) / 10_000n;

    return ok(
      port,
      buildBuyIntent({
        chainId: request.chainId,
        market: row.market as `0x${string}`,
        grossQuoteIn: request.amount,
        minTokensOut,
        deadline: request.deadline,
        quoteDecimals: row.quoteDecimals,
        quoteSymbol: row.quoteSymbol,
        tokenSymbol: row.symbol,
        expectedTokensOut: quote.tokensOut,
        crossesGraduation: quote.crossesGraduation,
        priceImpactBps: quote.priceImpactBps,
      }),
    );
  }

  const quote = port.quoteSell(row.market, request.amount);
  if (quote === null || quote.grossOut === undefined) {
    return fail(port, "QUOTE_UNAVAILABLE", "the market could not quote this order", true);
  }

  // The sell bound is on the NET payout, which is what the user receives — not on
  // the curve's gross output, which they never see.
  //
  // The net comes from the canonical fee implementation, NOT from a rate written
  // here. An earlier version computed `grossOut * 9700 / 10000`, which was a
  // third implementation of the sell fee after the contract and the SDK — and it
  // was computing `minQuoteOut`, the bound that protects the user on-chain. A
  // protection derived from a duplicated rate is not a protection.
  const netNormalized = computeFees(
    "SELL",
    toNormalized(quote.grossOut, row.quoteDecimals),
  ).net;
  const netEstimate = toRawForPayout(netNormalized, row.quoteDecimals);
  const minQuoteOut = (netEstimate * (10_000n - request.slippageBps)) / 10_000n;

  return ok(
    port,
    buildSellIntent({
      chainId: request.chainId,
      market: row.market as `0x${string}`,
      tokensIn: request.amount,
      minQuoteOut,
      deadline: request.deadline,
      quoteDecimals: row.quoteDecimals,
      quoteSymbol: row.quoteSymbol,
      tokenSymbol: row.symbol,
      expectedGrossOut: quote.grossOut,
      priceImpactBps: quote.priceImpactBps,
    }),
  );
}

// ---------------------------------------------------------------------------
// Stockback (§368)
// ---------------------------------------------------------------------------

export interface StockbackResponse {
  readonly market: string;
  readonly account: string;
  /**
   * Two separate fields, deliberately. §293 requires estimated accrual and
   * claimable entitlement to be distinguishable, and the provenance on each says
   * which is which — one is a projection, the other is money the vault will pay.
   * Merging them into a single "rewards" number is the misleading financial UI
   * state §451 blocks a release for.
   */
  readonly estimatedAccrued: Sourced;
  readonly claimable: Sourced;
  readonly lifetimeClaimed: Sourced;
  readonly epochSequence: string;
  readonly epochEndsAt: number;
  /** Present only when an activated commitment covers this holder. */
  readonly proof?: readonly string[];
  readonly cumulative?: string;
}

export function handleStockback(
  port: DataPort,
  token: string,
  account: string,
): ApiResult<StockbackResponse> {
  const row = port.getMarket(token.toLowerCase());
  if (row === null) return fail(port, "MARKET_NOT_FOUND", `no launched market for token ${token}`);

  const stockback = port.getStockback(row.market, account.toLowerCase());
  if (stockback === null) {
    return fail(port, "NO_STOCKBACK_RECORD", "this account has no Stockback record for that market");
  }

  const indexed = port.indexedBlock();

  return ok(port, {
    market: row.market,
    account: account.toLowerCase(),
    estimatedAccrued: sourced(stockback.estimatedAccrued.toString(), "ESTIMATED", indexed, port.serverTime()),
    claimable: sourced(stockback.claimable.toString(), "INDEXED", indexed, port.serverTime()),
    lifetimeClaimed: sourced(stockback.lifetimeClaimed.toString(), "INDEXED", indexed, port.serverTime()),
    epochSequence: stockback.epochSequence.toString(),
    epochEndsAt: stockback.epochEndsAt,
    ...(stockback.proof !== undefined ? { proof: stockback.proof } : {}),
    ...(stockback.cumulative !== undefined ? { cumulative: stockback.cumulative.toString() } : {}),
  });
}

// ---------------------------------------------------------------------------
// Health (§693)
// ---------------------------------------------------------------------------

export interface HealthResponse {
  readonly chainConnected: boolean;
  readonly headBlock: string;
  readonly indexedBlock: string;
  readonly lagBlocks: number;
  readonly finalizedBlock?: string;
  /** False when the projection is too far behind to serve trading decisions. */
  readonly serving: boolean;
}

export function handleHealth(port: DataPort): ApiResponse<HealthResponse> {
  const env = envelope(port);
  const finalized = port.finalizedBlock();

  return ok(port, {
    chainConnected: port.chainConnected(),
    headBlock: env.headBlock,
    indexedBlock: port.indexedBlock().toString(),
    lagBlocks: env.lagBlocks,
    ...(finalized !== undefined ? { finalizedBlock: finalized.toString() } : {}),
    // A STALE or disconnected service still answers, but says it should not be
    // trusted for a trading decision. Returning 200 with fresh-looking data
    // while minutes behind is the failure §211 is written against.
    serving: env.state === "LIVE" || env.state === "SYNCING",
  });
}
