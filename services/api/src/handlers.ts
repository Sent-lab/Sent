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
import { computeFees, referenceMarketCapUsd, TOTAL_SUPPLY } from "@sent/economics";

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
  /** Launch price in quote wei. Carries the §18 USD anchor implicitly. */
  readonly p0: bigint;
  /** Graduation price, 25 × p0. */
  readonly pg: bigint;
  readonly price: bigint;
  /** The HyperSwap pool, once graduation created it (§21 `graduatedPool`). */
  readonly pool: string | null;
  readonly holderCount: number;
  readonly tradeCount: number;
  /** Notional traded in the last 24h, normalized. */
  readonly volume24h: bigint;
  readonly trades24h: number;
  readonly launchedAt: number;
  readonly lastBlock: bigint;
  /** Chain timestamp of the graduating block, or null before graduation. */
  readonly graduatedAt: number | null;
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
  listCandles(market: string, intervalSeconds: number, limit: number): readonly CandleBar[];
  getCreator(address: string): CreatorRow | null;
  getStockback(market: string, account: string): StockbackRow | null;
  getAccount(address: string): AccountRow | null;
  getPlatformStats(): PlatformStatsRow | null;
  getPulse(): PulseRow | null;
  getEpochs(market: string): EpochsRow | null;
  /** How many markets the last `listMarkets` filter matched, before its limit. */
  countMarkets(options: ExploreOptions): number;

  /** Quote from the canonical curve, as the market itself would compute it. */
  quoteBuy(market: string, grossQuoteIn: bigint): QuoteResult | null;
  quoteSell(market: string, tokensIn: bigint): QuoteResult | null;
}

export interface CreatorRow {
  readonly launches: readonly MarketRow[];
  /**
   * The vault the claimable figures were read from.
   *
   * Returned so the claim a creator signs targets the same contract the balance
   * came from. A client holding its own vault address could show one contract's
   * balance over a button that calls another.
   */
  readonly feeVault: string | null;
  /**
   * Payable right now, read from the vault (§423).
   *
   * Not the sum of indexed accruals: a fee already claimed is still an accrual,
   * so the projection's total would tell a creator they can withdraw money that
   * is already in their wallet.
   */
  readonly claimable: readonly { asset: string; symbol: string; amount: bigint }[];
  /** Everything ever earned, from indexed events. A lifetime figure. */
  readonly accrued: readonly { asset: string; symbol: string; amount: bigint }[];
}

export interface CandleBar {
  readonly bucket: number;
  readonly open: bigint;
  readonly high: bigint;
  readonly low: bigint;
  readonly close: bigint;
  readonly volume: bigint;
  readonly tradeCount: number;
}

export interface QuoteResult {
  readonly tokensOut?: bigint;
  readonly grossOut?: bigint;
  readonly crossesGraduation: boolean;
  readonly priceImpactBps: bigint;
}

/**
 * §50's sorts, exactly.
 *
 * A closed union rather than a string: it reaches a SQL ORDER BY through a
 * lookup table, and an unrecognised value must be refused by name at the edge
 * rather than falling through to a default the caller did not ask for.
 */
/**
 * The one address shape this API accepts.
 *
 * Written once. Two copies of an address regex is how one endpoint ends up
 * accepting a checksum-less 39-character paste that another rejects.
 */
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const EXPLORE_SORTS = [
  "NEWEST",
  "PROGRESS",
  "VOLUME",
  "HOLDERS",
  "TRENDING",
  "GAINERS",
  "RECENTLY_GRADUATED",
] as const;

export type ExploreSortName = (typeof EXPLORE_SORTS)[number];

export interface ExploreOptions {
  readonly sort: ExploreSortName;
  readonly status?: "PRE_GRAD" | "GRADUATED";
  readonly quoteAsset?: string;
  readonly limit: number;
  /** Name, ticker, or an exact address (§95.21). */
  readonly query?: string;
  readonly offset?: number;
}

export interface AccountRow {
  readonly holdings: readonly {
    token: string;
    market: string;
    name: string;
    symbol: string;
    quoteSymbol: string;
    quoteDecimals: number;
    status: string;
    balance: bigint;
    price: bigint;
    value: bigint;
    lastBlock: bigint;
  }[];
  readonly stockback: readonly {
    token: string;
    symbol: string;
    rewardSymbol: string;
    quoteDecimals: number;
    claimable: bigint;
    lifetimeClaimed: bigint;
    merkleRoot: string | null;
  }[];
  readonly claims: readonly {
    token: string;
    symbol: string;
    amount: bigint;
    timestamp: number;
    blockNumber: bigint;
  }[];
  /** Markets this address launched. Counted, not listed — /creators lists them. */
  readonly launchCount: number;
}

export interface EpochRow {
  readonly epochSequence: bigint;
  readonly epochId: bigint;
  readonly startTime: number;
  readonly endTime: number;
  readonly pool: bigint;
  readonly allocated: bigint;
  readonly carryForward: bigint;
  readonly eligibleHolders: number;
  readonly totalWeight: bigint;
  readonly merkleRoot: string;
  readonly datasetHash: string;
  readonly totalCumulative: bigint;
  readonly cumulativeRewardFunded: bigint;
  readonly holderCount: number;
  readonly computedAt: number;
  readonly attested: boolean;
}

export interface EpochsRow {
  readonly epochs: readonly EpochRow[];
  readonly status: {
    readonly currentEpochId: bigint;
    readonly lastFinalizedSequence: bigint | null;
    readonly lastFinalizedAt: number | null;
    readonly finalizing: boolean;
    readonly attestedSequence: bigint | null;
    readonly totalFunded: bigint;
    readonly totalClaimed: bigint;
    readonly outstanding: bigint;
  };
}

export interface HeatRow {
  readonly quoteAsset: string;
  /** From the verified allowlist, never from the token itself (§699). */
  readonly quoteSymbol: string;
  readonly volume: bigint;
  readonly trades: number;
  readonly activeMarkets: number;
  readonly totalMarkets: number;
  readonly launches: number;
  readonly graduations: number;
  readonly nearGraduation: number;
  readonly buyPressureBps: number;
  readonly topMover: string | null;
  readonly topMoverGainBps: number;
}

export interface PulseRow {
  readonly heat: readonly HeatRow[];
  readonly presence: {
    readonly activeTraders: number;
    readonly liveMarkets: number;
    readonly nearGraduation: number;
    readonly graduatedInWindow: number;
    readonly tradesInWindow: number;
    readonly windowSeconds: number;
  };
}

export interface PlatformStatsRow {
  readonly totalLaunches: number;
  readonly activePreGrad: number;
  readonly graduated: number;
  readonly totalVolume: bigint;
  readonly windowVolume: bigint;
  readonly creatorFeesEarned: bigint;
  readonly stockbackDistributed: bigint;
  readonly activeQuoteAssets: number;
  readonly launchableQuoteAssets: number;
  readonly uniqueTraders: number;
  readonly windowLaunches: number;
  readonly windowGraduations: number;
  readonly windowTrades: number;
  readonly asOfBlock: bigint;
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

/**
 * A page of explore results.
 *
 * The listing used to return a bare array, which cannot say how many results
 * exist — so a client could only guess whether to offer another page, and §50's
 * "pagination/infinite load" had nothing to page against.
 */
export interface ExplorePage {
  readonly items: readonly ExploreItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface ExploreItem {
  readonly token: string;
  readonly market: string;
  readonly name: string;
  readonly symbol: string;
  readonly quoteSymbol: string;
  /**
   * Quote decimals, from the REGISTRY (§699), never read from the token.
   *
   * Without this a client cannot format `price` at all: the value is in raw
   * quote units, and assuming eighteen renders a six-decimal xStock's price a
   * trillion times too small — a wrong number that looks like a plausible one.
   */
  readonly quoteDecimals: number;
  readonly status: string;
  readonly price: Sourced;
  readonly graduationProgressBps: Sourced;
  readonly holderCount: Sourced;
  readonly creator: string;
  readonly launchedAt: number;
}

export function handleExplore(
  port: DataPort,
  options: Partial<ExploreOptions>,
): ApiResult<ExplorePage> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_LIMIT);

  if (options.sort !== undefined && !EXPLORE_SORTS.includes(options.sort)) {
    return fail(port, "UNSUPPORTED_SORT", `${String(options.sort)} is not a sort this API offers`);
  }

  // An address query that is nearly an address is refused rather than passed
  // through as text. A 39-character paste matches nothing exactly and would
  // fall back to a trigram scan over names, quietly returning the wrong market.
  const query = options.query?.trim();
  if (query !== undefined && query.startsWith("0x") && !ADDRESS.test(query)) {
    return fail(port, "MALFORMED_ADDRESS", `${query} looks like an address but is not one`);
  }

  const resolved: ExploreOptions = {
    sort: options.sort ?? "NEWEST",
    limit,
    offset: Math.max(options.offset ?? 0, 0),
    ...(options.status !== undefined ? { status: options.status } : {}),
    ...(options.quoteAsset !== undefined ? { quoteAsset: options.quoteAsset } : {}),
    ...(query !== undefined && query !== "" ? { query } : {}),
  };

  const rows = port.listMarkets(resolved);
  const total = port.countMarkets(resolved);
  const offset = resolved.offset ?? 0;

  return ok(port, {
    total,
    offset,
    limit,
    // Stated rather than inferred from `items.length === limit`, which is wrong
    // exactly once — on the page that ends flush with the limit, where it
    // promises another page that does not exist.
    hasMore: offset + rows.length < total,
    items: rows.map((row) => ({
      token: row.token,
      market: row.market,
      name: row.name,
      symbol: row.symbol,
      quoteSymbol: row.quoteSymbol,
      quoteDecimals: row.quoteDecimals,
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
  });
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
   * Chain timestamp of the block a market graduated in, or null.
   *
   * Served so a chart can place its graduation marker at the moment it actually
   * happened. Without it the only options are to omit the marker or to guess a
   * position, and a precise-looking mark in an arbitrary place is worse than no
   * mark at all (§57).
   */
  readonly graduatedAt: number | null;
  /**
   * Authenticity comes from the factory registry, never from the address shape
   * (§4). Exposed so a UI can render a verified badge without inventing its own
   * rule from the suffix.
   */
  readonly authentic: true;

  /**
   * The curve, in full (§21).
   *
   * A bot needs to price locally between blocks, and §21's `marketState()` is
   * meant to expose enough for exactly that. Without p0 and qG a caller can
   * only ask this API for every quote, which makes the API a dependency of
   * something that should be able to run without it.
   */
  readonly curve: {
    readonly p0: string;
    readonly pg: string;
    readonly qG: string;
    readonly totalSupply: string;
  };

  /** The HyperSwap pool, or null before graduation (§21 `graduatedPool`). */
  readonly pool: string | null;

  /**
   * The §403 pair.
   *
   * `referenceMarketCapUsd` is derived from p0 and the current price, with no
   * oracle involved: the launch-time xStock/USD snapshot is already baked into
   * p0, so price/p0 IS the movement along the reference path. It runs from
   * $2,000 to exactly $50,000 at graduation, which is what graduation follows.
   *
   * `liveMarketCapUsd` is ABSENT, not zero. It needs a live xStock/USD display
   * feed, which is unverified (V-11) and deliberately not implemented — §279
   * forbids a placeholder standing in for it, and §403 forbids implying that
   * the live number triggers anything. An absent field is a UI that shows
   * nothing; a zero is a UI that shows a market worth nothing.
   */
  readonly referenceMarketCapUsd: Sourced;
  readonly liveMarketCapUsd?: Sourced;

  readonly volume24h: Sourced;
  readonly trades24h: Sourced;
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
    graduatedAt: row.graduatedAt,
    authentic: true,

    curve: {
      p0: row.p0.toString(),
      pg: row.pg.toString(),
      qG: row.qG.toString(),
      totalSupply: TOTAL_SUPPLY.toString(),
    },

    pool: row.pool,

    // CALCULATED: derived from p0 and the price, not read from a contract. The
    // launch-time USD snapshot is already inside p0, so no oracle is consulted
    // and none can go stale underneath this number (§402).
    referenceMarketCapUsd: sourced(
      referenceMarketCapUsd(row.p0, row.price).toString(),
      "CALCULATED",
      row.lastBlock,
      port.serverTime(),
    ),

    // `liveMarketCapUsd` is deliberately not set. It needs the live xStock/USD
    // display feed, which is unverified (V-11); §279 forbids a placeholder in
    // its place, and a zero would render as a market worth nothing.

    volume24h: sourced(row.volume24h.toString(), "CALCULATED", row.lastBlock, port.serverTime()),
    trades24h: sourced(String(row.trades24h), "CALCULATED", row.lastBlock, port.serverTime()),
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
// Creator
// ---------------------------------------------------------------------------

export interface CreatorLaunch {
  readonly token: string;
  readonly market: string;
  readonly name: string;
  readonly symbol: string;
  readonly quoteSymbol: string;
  readonly quoteDecimals: number;
  readonly status: string;
  readonly graduationProgressBps: Sourced;
  readonly holderCount: Sourced;
  readonly launchedAt: number;
}

export interface CreatorResponse {
  readonly creator: string;
  /** Where a claim is sent. Null when the chain could not be reached. */
  readonly feeVault: string | null;
  readonly launches: readonly CreatorLaunch[];
  /** Payable now, from the vault. */
  readonly claimable: readonly { asset: string; symbol: string; amount: string }[];
  /** Earned over all time, from indexed events. */
  readonly accrued: readonly { asset: string; symbol: string; amount: string }[];
}

/**
 * A creator's cockpit data (§221).
 *
 * Two fee figures, deliberately, and they are not the same number. `claimable`
 * comes from the vault and is what a claim would actually pay; `accrued` comes
 * from the projection and is what has ever been earned. Showing one figure would
 * mean either telling a creator they can withdraw money they already withdrew,
 * or hiding what they have earned in total.
 *
 * No admin surface of any kind. §221 is explicit that no token admin powers are
 * exposed because none exist.
 */
export function handleCreator(port: DataPort, address: string): ApiResult<CreatorResponse> {
  if (!ADDRESS.test(address)) {
    return fail(port, "INVALID_ADDRESS", `${address} is not a 20-byte address`);
  }

  const row = port.getCreator(address.toLowerCase());

  // A creator with no launches is not an error. Everyone starts there, and a
  // 404 would make an empty cockpit look broken.
  if (row === null) {
    return ok(port, {
      creator: address.toLowerCase(),
      feeVault: null,
      launches: [],
      claimable: [],
      accrued: [],
    });
  }

  return ok(port, {
    creator: address.toLowerCase(),
    feeVault: row.feeVault,
    launches: row.launches.map((m) => ({
      token: m.token,
      market: m.market,
      name: m.name,
      symbol: m.symbol,
      quoteSymbol: m.quoteSymbol,
      quoteDecimals: m.quoteDecimals,
      status: m.status,
      graduationProgressBps: sourced(
        ((m.distributed * 10_000n) / m.qG).toString(),
        "CALCULATED",
        m.lastBlock,
        port.serverTime(),
      ),
      holderCount: sourced(String(m.holderCount), "INDEXED", m.lastBlock, port.serverTime()),
      launchedAt: m.launchedAt,
    })),
    claimable: row.claimable.map((c) => ({
      asset: c.asset,
      symbol: c.symbol,
      amount: c.amount.toString(),
    })),
    accrued: row.accrued.map((a) => ({
      asset: a.asset,
      symbol: a.symbol,
      amount: a.amount.toString(),
    })),
  });
}

// ---------------------------------------------------------------------------
// Account (§64, §347)
// ---------------------------------------------------------------------------

export interface AccountHolding {
  readonly token: string;
  readonly market: string;
  readonly name: string;
  readonly symbol: string;
  readonly quoteSymbol: string;
  readonly quoteDecimals: number;
  readonly status: string;
  readonly balance: string;
  readonly price: Sourced;
  /** balance × price. A mark, not what a sale would return — see below. */
  readonly value: Sourced;
}

export interface AccountResponse {
  readonly account: string;
  readonly holdings: readonly AccountHolding[];
  /** Summed across holdings, in normalized quote units. */
  readonly portfolioValue: Sourced;
  readonly stockback: readonly {
    token: string;
    symbol: string;
    rewardSymbol: string;
    quoteDecimals: number;
    claimable: string;
    lifetimeClaimed: string;
    merkleRoot: string | null;
  }[];
  readonly totalClaimable: string;
  readonly claims: readonly {
    token: string;
    symbol: string;
    amount: string;
    timestamp: number;
    blockNumber: string;
  }[];
  readonly launchCount: number;
}

/**
 * One wallet's positions, rewards and claim history (§64, §347).
 *
 * PORTFOLIO VALUE IS A MARK, AND SAYS SO
 * --------------------------------------
 * Every holding is valued at the curve's current price. Selling the whole
 * position walks DOWN the curve and returns less — sometimes much less on a
 * thin market. The figure is marked CALCULATED rather than INDEXED for exactly
 * that reason: it is derived, and the only thing that can answer "what would I
 * get" is a sell quote against the chain.
 *
 * CLAIMABLE IS ONLY EVER ATTESTED
 * -------------------------------
 * §293 keeps estimated accrual and claimable entitlement apart, and this
 * endpoint answers the second question only. A cross-market "claim everything"
 * total that included unattested arithmetic would be a number the vault will
 * not pay, offered as a button.
 */
export function handleAccount(port: DataPort, address: string): ApiResult<AccountResponse> {
  if (!ADDRESS.test(address)) {
    return fail(port, "INVALID_ADDRESS", `${address} is not a 20-byte address`);
  }

  const row = port.getAccount(address.toLowerCase());
  const now = port.serverTime();

  // An empty account is not an error. Everybody starts here, and a 404 makes a
  // first visit look like the page is broken rather than empty (§209).
  if (row === null) {
    return ok(port, {
      account: address.toLowerCase(),
      holdings: [],
      portfolioValue: sourced("0", "CALCULATED", port.indexedBlock(), now),
      stockback: [],
      totalClaimable: "0",
      claims: [],
      launchCount: 0,
    });
  }

  const portfolio = row.holdings.reduce((sum, h) => sum + h.value, 0n);
  const claimable = row.stockback.reduce((sum, r) => sum + r.claimable, 0n);

  return ok(port, {
    account: address.toLowerCase(),
    holdings: row.holdings.map((h) => ({
      token: h.token,
      market: h.market,
      name: h.name,
      symbol: h.symbol,
      quoteSymbol: h.quoteSymbol,
      quoteDecimals: h.quoteDecimals,
      status: h.status,
      balance: h.balance.toString(),
      price: sourced(h.price.toString(), "CALCULATED", h.lastBlock, now),
      value: sourced(h.value.toString(), "CALCULATED", h.lastBlock, now),
    })),
    portfolioValue: sourced(portfolio.toString(), "CALCULATED", port.indexedBlock(), now),
    stockback: row.stockback.map((r) => ({
      token: r.token,
      symbol: r.symbol,
      rewardSymbol: r.rewardSymbol,
      quoteDecimals: r.quoteDecimals,
      claimable: r.claimable.toString(),
      lifetimeClaimed: r.lifetimeClaimed.toString(),
      merkleRoot: r.merkleRoot,
    })),
    totalClaimable: claimable.toString(),
    claims: row.claims.map((c) => ({
      token: c.token,
      symbol: c.symbol,
      amount: c.amount.toString(),
      timestamp: c.timestamp,
      blockNumber: c.blockNumber.toString(),
    })),
    launchCount: row.launchCount,
  });
}

// ---------------------------------------------------------------------------
// Market heat and live presence (§52, §53)
// ---------------------------------------------------------------------------

export interface HeatItem {
  readonly quoteAsset: string;
  readonly quoteSymbol: string;
  readonly volume: string;
  readonly trades: number;
  readonly activeMarkets: number;
  readonly totalMarkets: number;
  readonly launches: number;
  readonly graduations: number;
  readonly nearGraduation: number;
  /** 10000 = every unit of volume was a buy. 5000 in a window with no volume. */
  readonly buyPressureBps: number;
  readonly topMover: string | null;
  readonly topMoverGainBps: number;
}

export interface PulseResponse {
  readonly ecosystems: readonly HeatItem[];
  readonly presence: {
    /**
     * Distinct traders in the presence window — NOT open connections.
     *
     * §53 requires the implementation to be honest about the metric it uses.
     * Counting sockets would be a different number wearing the same label:
     * higher, flattering, and moved by any bot with a reconnect loop.
     */
    readonly activeTraders: number;
    readonly liveMarkets: number;
    readonly nearGraduation: number;
    readonly graduatedRecently: number;
    readonly trades: number;
    /** Returned so a client cannot render any of the above as "right now". */
    readonly windowSeconds: number;
  };
  /** The window the ecosystem figures cover, which is longer than presence's. */
  readonly heatWindowSeconds: number;
}

/**
 * §52's market heat and §53's pulse, in one response.
 *
 * Together because they are one screen and two round trips would let the
 * halves disagree — "3 markets near graduation" beside an ecosystem row saying
 * two, read a second apart.
 *
 * NOTHING IS NORMALISED HERE
 * --------------------------
 * No 0-1 "heat" value is computed. Ecosystems differ by orders of magnitude, so
 * any normalisation is a presentation choice — linear against the busiest,
 * logarithmic, ranked — and §52's warning about becoming a noisy colour heatmap
 * is a warning about that mapping, not about these numbers. Raw comparable
 * figures go out; the view decides what hot looks like, visibly.
 */
export function handlePulse(port: DataPort): ApiResult<PulseResponse> {
  const row = port.getPulse();

  if (row === null) {
    return fail(port, "PULSE_UNAVAILABLE", "Market activity could not be read.");
  }

  return ok(port, {
    ecosystems: row.heat.map((h) => ({
      quoteAsset: h.quoteAsset,
      quoteSymbol: h.quoteSymbol,
      volume: h.volume.toString(),
      trades: h.trades,
      activeMarkets: h.activeMarkets,
      totalMarkets: h.totalMarkets,
      launches: h.launches,
      graduations: h.graduations,
      nearGraduation: h.nearGraduation,
      buyPressureBps: h.buyPressureBps,
      topMover: h.topMover,
      topMoverGainBps: h.topMoverGainBps,
    })),
    presence: {
      activeTraders: row.presence.activeTraders,
      liveMarkets: row.presence.liveMarkets,
      nearGraduation: row.presence.nearGraduation,
      graduatedRecently: row.presence.graduatedInWindow,
      trades: row.presence.tradesInWindow,
      windowSeconds: row.presence.windowSeconds,
    },
    heatWindowSeconds: 86_400,
  });
}

// ---------------------------------------------------------------------------
// Distribution transparency (§333, §367)
// ---------------------------------------------------------------------------

export interface EpochItem {
  readonly epochSequence: string;
  readonly epochId: string;
  readonly startTime: number;
  readonly endTime: number;
  /** What the epoch had to give out, before rounding. */
  readonly pool: string;
  readonly allocated: string;
  /** Rounding dust rolled into the next epoch (§327). */
  readonly carryForward: string;
  readonly eligibleHolders: number;
  readonly totalWeight: string;
  readonly merkleRoot: string;
  readonly datasetHash: string;
  readonly totalCumulative: string;
  readonly cumulativeRewardFunded: string;
  readonly holderCount: number;
  readonly computedAt: number;
  /**
   * Whether an attestor quorum activated this root on-chain.
   *
   * The line between "this node computed it" and "the chain honours it" (§293).
   * An unattested epoch's numbers are real arithmetic and pay nothing.
   */
  readonly attested: boolean;
}

export interface EpochsResponse {
  readonly market: string;
  readonly epochs: readonly EpochItem[];
  /** §367's public distribution status. */
  readonly status: {
    readonly currentEpochId: string;
    readonly state: "OPEN" | "FINALIZING" | "FINALIZED";
    readonly lastFinalizedSequence: string | null;
    readonly lastFinalizedAt: number | null;
    readonly attestedSequence: string | null;
    readonly totalFunded: string;
    readonly totalClaimed: string;
    readonly outstanding: string;
  };
}

/**
 * A market's distribution history and status (§333, §367).
 *
 * §333's dataset exists so that someone who does not trust this service can
 * re-derive the root themselves, which is why the inputs travel with the
 * outputs: the pool, the eligible holder count and the total weight are what
 * make the total reproducible, and a response carrying only a root would be
 * asking to be believed.
 *
 * §367's three states are collapsed from two independent facts — whether a root
 * is pending, and whether one is active — because they are what a reader
 * actually needs:
 *
 *   OPEN        nothing submitted; the current epoch is still accumulating
 *   FINALIZING  a root is on-chain, waiting out §334's activation delay
 *   FINALIZED   a root is active and entitlements against it are payable
 */
export function handleEpochs(port: DataPort, token: string): ApiResult<EpochsResponse> {
  const market = port.getMarket(token.toLowerCase());
  if (market === null) {
    return fail(port, "MARKET_NOT_FOUND", `No market for token ${token}`);
  }

  const row = port.getEpochs(market.market);

  // A market that has never had an epoch finalized is not an error — it is
  // every market on its first day (§209).
  if (row === null) {
    return ok(port, {
      market: market.market,
      epochs: [],
      status: {
        currentEpochId: "0",
        state: "OPEN" as const,
        lastFinalizedSequence: null,
        lastFinalizedAt: null,
        attestedSequence: null,
        totalFunded: "0",
        totalClaimed: "0",
        outstanding: "0",
      },
    });
  }

  const state = row.status.finalizing
    ? ("FINALIZING" as const)
    : row.status.attestedSequence !== null
      ? ("FINALIZED" as const)
      : ("OPEN" as const);

  return ok(port, {
    market: market.market,
    epochs: row.epochs.map((e) => ({
      epochSequence: e.epochSequence.toString(),
      epochId: e.epochId.toString(),
      startTime: e.startTime,
      endTime: e.endTime,
      pool: e.pool.toString(),
      allocated: e.allocated.toString(),
      carryForward: e.carryForward.toString(),
      eligibleHolders: e.eligibleHolders,
      totalWeight: e.totalWeight.toString(),
      merkleRoot: e.merkleRoot,
      datasetHash: e.datasetHash,
      totalCumulative: e.totalCumulative.toString(),
      cumulativeRewardFunded: e.cumulativeRewardFunded.toString(),
      holderCount: e.holderCount,
      computedAt: e.computedAt,
      attested: e.attested,
    })),
    status: {
      currentEpochId: row.status.currentEpochId.toString(),
      state,
      lastFinalizedSequence: row.status.lastFinalizedSequence?.toString() ?? null,
      lastFinalizedAt: row.status.lastFinalizedAt,
      attestedSequence: row.status.attestedSequence?.toString() ?? null,
      totalFunded: row.status.totalFunded.toString(),
      totalClaimed: row.status.totalClaimed.toString(),
      outstanding: row.status.outstanding.toString(),
    },
  });
}

// ---------------------------------------------------------------------------
// Platform statistics (§166, §168)
// ---------------------------------------------------------------------------

export interface PlatformStatsResponse {
  readonly totalLaunches: Sourced;
  readonly activePreGrad: Sourced;
  readonly graduated: Sourced;
  readonly totalVolume: Sourced;
  readonly volume24h: Sourced;
  readonly creatorFeesEarned: Sourced;
  readonly stockbackDistributed: Sourced;
  readonly activeXStockPairs: Sourced;
  readonly launchableXStockPairs: Sourced;
  readonly uniqueTraders: Sourced;
  readonly launches24h: Sourced;
  readonly graduations24h: Sourced;
  readonly trades24h: Sourced;
  /** Named so a client never has to infer what "24h" meant. */
  readonly windowSeconds: number;
}

/**
 * §166's metrics with §168's sources attached.
 *
 * Every figure carries its own provenance, because they do not share one: a
 * count of launches is INDEXED — the projection holds one row per
 * `TokenLaunched` — while volume is CALCULATED, being a sum over those rows.
 * §168 forbids vanity metrics, and the first way a metric becomes vanity is by
 * being presented without saying what produced it.
 *
 * `stockbackDistributed` is what holders have been PAID, not what has been
 * funded. Money sitting in the vault has not been distributed to anyone, and
 * counting it would be exactly the flattering-but-false figure §168 rules out.
 */
export function handlePlatformStats(port: DataPort): ApiResult<PlatformStatsResponse> {
  const stats = port.getPlatformStats();

  if (stats === null) {
    return fail(port, "STATS_UNAVAILABLE", "Platform statistics could not be read.");
  }

  const now = port.serverTime();
  const at = stats.asOfBlock;

  const counted = (value: number | bigint): Sourced =>
    sourced(String(value), "INDEXED", at, now);
  const summed = (value: bigint): Sourced => sourced(value.toString(), "CALCULATED", at, now);

  return ok(port, {
    totalLaunches: counted(stats.totalLaunches),
    activePreGrad: counted(stats.activePreGrad),
    graduated: counted(stats.graduated),
    totalVolume: summed(stats.totalVolume),
    volume24h: summed(stats.windowVolume),
    creatorFeesEarned: summed(stats.creatorFeesEarned),
    stockbackDistributed: summed(stats.stockbackDistributed),
    activeXStockPairs: counted(stats.activeQuoteAssets),
    launchableXStockPairs: counted(stats.launchableQuoteAssets),
    uniqueTraders: counted(stats.uniqueTraders),
    launches24h: counted(stats.windowLaunches),
    graduations24h: counted(stats.windowGraduations),
    trades24h: counted(stats.windowTrades),
    windowSeconds: 86_400,
  });
}

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

/**
 * Intervals the API serves.
 *
 * §57 lists 1s and 5s among the possible timeframes and allows the exact set to
 * follow data capacity. Sub-minute candles are not served: HyperEVM blocks do
 * not arrive fast enough for a one-second bar to carry information, and a chart
 * of mostly-empty buckets is a worse answer than a coarser one that is full.
 */
export const CANDLE_INTERVALS = [60, 300, 900, 3_600, 14_400, 86_400] as const;

const MAX_CANDLES = 500;

export interface CandleItem {
  /** Bucket start, unix seconds. */
  readonly t: number;
  readonly o: string;
  readonly h: string;
  readonly l: string;
  readonly c: string;
  readonly v: string;
  readonly n: number;
}

export interface CandleResponse {
  readonly intervalSeconds: number;
  /** Quote decimals, so a client can render the axis without a second call. */
  readonly quoteDecimals: number;
  readonly candles: readonly CandleItem[];
}

/**
 * Serve candles for one market and interval.
 *
 * Keys are short because a five-hundred-bar response repeats them five hundred
 * times, and this is the one endpoint where that difference is measurable. The
 * VALUES are still decimal strings — §424 does not bend for payload size.
 */
export function handleCandles(
  port: DataPort,
  token: string,
  intervalSeconds: number,
  limit = 200,
): ApiResult<CandleResponse> {
  const row = port.getMarket(token.toLowerCase());
  if (row === null) return fail(port, "MARKET_NOT_FOUND", `no launched market for token ${token}`);

  // Validated against the served set rather than clamped into it. A request for
  // a 37-second candle is a client bug, and silently answering with a minute bar
  // would let that bug ship.
  if (!CANDLE_INTERVALS.includes(intervalSeconds as (typeof CANDLE_INTERVALS)[number])) {
    return fail(
      port,
      "UNSUPPORTED_INTERVAL",
      `interval must be one of ${CANDLE_INTERVALS.join(", ")} seconds`,
    );
  }

  const capped = Math.min(Math.max(limit, 1), MAX_CANDLES);

  return ok(port, {
    intervalSeconds,
    quoteDecimals: row.quoteDecimals,
    candles: port.listCandles(row.market, intervalSeconds, capped).map((bar) => ({
      t: bar.bucket,
      o: bar.open.toString(),
      h: bar.high.toString(),
      l: bar.low.toString(),
      c: bar.close.toString(),
      v: bar.volume.toString(),
      n: bar.tradeCount,
    })),
  });
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
