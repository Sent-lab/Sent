/**
 * SENT — DataPort backed by PostgreSQL.
 *
 * The handlers are pure functions over this interface, so this is the only file
 * in the API that touches a database. That separation is what let every handler
 * behaviour be tested before a database existed.
 *
 * QUOTING GOES TO THE CHAIN, NOT TO THE PROJECTION (§423)
 * -------------------------------------------------------
 * A quote decides what a user signs, so it is computed from the market's OWN
 * `quoteBuy`/`quoteSell` over RPC — the same functions the trade will execute
 * against — rather than from indexed state.
 *
 * The projection is a rebuildable copy and may be blocks behind. Quoting from it
 * would price a trade against a market that has since moved, and the user would
 * sign a review built from stale numbers. §423 is explicit that the chain is the
 * authority; this is where that costs an RPC round trip and is worth it.
 *
 * Listings and history come from the projection, because being a few blocks
 * behind on an explore page is what the freshness envelope exists to say.
 */

import { createPublicClient, http, type PublicClient } from "viem";

import {
  Database,
  listMarkets as dbListMarkets,
  getMarketByToken,
  listTrades as dbListTrades,
  getActiveCommitment,
  getClaimedTotal,
  headBlockIndexed,
  type ExploreSort,
} from "@sent/database";
import { launchMarketAbi } from "@sent/contracts";

import type {
  DataPort,
  ExploreOptions,
  MarketRow,
  TradeRow,
  StockbackRow,
  QuoteResult,
} from "./handlers.ts";

const STATUS_NAMES = ["PRE_GRAD", "GRADUATING", "GRADUATED"] as const;

export interface PortConfig {
  readonly rpcUrl: string;
  /** Quote symbols by asset address, from the registry. Display only. */
  readonly quoteSymbols: ReadonlyMap<string, string>;
  readonly confirmations: number;
}

export class PostgresPort implements DataPort {
  private readonly db: Database;
  private readonly client: PublicClient;
  private readonly config: PortConfig;

  private head = 0n;
  private indexed = 0n;
  private connected = false;

  constructor(db: Database, config: PortConfig) {
    this.db = db;
    this.config = config;
    this.client = createPublicClient({ transport: http(config.rpcUrl) });
  }

  /**
   * Refresh the chain head and the indexed height.
   *
   * Called on a timer rather than per request: a request that made its own RPC
   * call to report freshness would pay a round trip to say how fresh it is.
   */
  async refresh(): Promise<void> {
    try {
      this.head = await this.client.getBlockNumber();
      this.connected = true;
    } catch {
      // Losing the chain does not mean losing the projection. The service keeps
      // answering and reports RECONNECTING, which is the honest state (§211).
      this.connected = false;
    }
    this.indexed = await headBlockIndexed(this.db);
  }

  headBlock(): bigint {
    return this.head;
  }

  serverTime(): number {
    return Math.floor(Date.now() / 1000);
  }

  indexedBlock(): bigint {
    return this.indexed;
  }

  finalizedBlock(): bigint | undefined {
    const boundary = this.indexed - BigInt(this.config.confirmations);
    return boundary > 0n ? boundary : undefined;
  }

  chainConnected(): boolean {
    return this.connected;
  }

  // -------------------------------------------------------------------------
  // Reads — projection
  // -------------------------------------------------------------------------

  listMarkets(options: ExploreOptions): readonly MarketRow[] {
    return this.cachedMarkets.get(cacheKey(options)) ?? [];
  }

  getMarket(token: string): MarketRow | null {
    return this.cachedByToken.get(token.toLowerCase()) ?? null;
  }

  listTrades(market: string, limit: number): readonly TradeRow[] {
    const rows = this.cachedTrades.get(market.toLowerCase()) ?? [];
    return rows.slice(0, limit);
  }

  getStockback(market: string, account: string): StockbackRow | null {
    return this.cachedStockback.get(`${market.toLowerCase()}:${account.toLowerCase()}`) ?? null;
  }

  quoteBuy(market: string, grossQuoteIn: bigint): QuoteResult | null {
    return this.cachedQuotes.get(`buy:${market.toLowerCase()}:${grossQuoteIn}`) ?? null;
  }

  quoteSell(market: string, tokensIn: bigint): QuoteResult | null {
    return this.cachedQuotes.get(`sell:${market.toLowerCase()}:${tokensIn}`) ?? null;
  }

  // -------------------------------------------------------------------------
  // Async loaders
  //
  // The handlers are synchronous by design — a pure function over data, which is
  // what made them testable without a database. So the server loads what a route
  // needs first, then calls the handler. The alternative, making every handler
  // async, would have pulled I/O into the layer that has none.
  // -------------------------------------------------------------------------

  private readonly cachedMarkets = new Map<string, MarketRow[]>();
  private readonly cachedByToken = new Map<string, MarketRow>();
  private readonly cachedTrades = new Map<string, TradeRow[]>();
  private readonly cachedStockback = new Map<string, StockbackRow>();
  private readonly cachedQuotes = new Map<string, QuoteResult>();

  async loadMarkets(options: ExploreOptions): Promise<void> {
    const views = await dbListMarkets(this.db, {
      sort: options.sort as ExploreSort,
      limit: options.limit,
      ...(options.status !== undefined
        ? { status: STATUS_NAMES.indexOf(options.status as (typeof STATUS_NAMES)[number]) }
        : {}),
      ...(options.quoteAsset !== undefined ? { quoteAsset: options.quoteAsset } : {}),
    });

    this.cachedMarkets.set(cacheKey(options), views.map((v) => this.toRow(v)));
  }

  async loadMarket(token: string): Promise<void> {
    const view = await getMarketByToken(this.db, token);
    if (view !== null) this.cachedByToken.set(token.toLowerCase(), this.toRow(view));
  }

  async loadTrades(market: string, limit: number): Promise<void> {
    const trades = await dbListTrades(this.db, market, limit);

    this.cachedTrades.set(
      market.toLowerCase(),
      trades.map((t) => ({
        txHash: t.txHash,
        blockNumber: t.blockNumber,
        side: t.side === 0 ? "BUY" : "SELL",
        trader: t.trader,
        notional: t.notional,
        tokens: t.tokens,
        coreFee: t.coreFee,
        creatorFee: t.creatorFee,
        platformFee: t.platformFee,
        stockback: t.stockback,
        priceAfter: t.priceAfter,
        timestamp: t.timestamp,
      })),
    );
  }

  /**
   * Load a quote from the CHAIN.
   *
   * §423: the chain is the authority. A quote decides what a user signs, and the
   * projection can be blocks behind — pricing from it would build a review out of
   * numbers the market has already moved past.
   */
  async loadQuote(
    market: string,
    side: "BUY" | "SELL",
    amount: bigint,
    qG: bigint,
    distributed: bigint,
  ): Promise<void> {
    const key = `${side.toLowerCase()}:${market.toLowerCase()}:${amount}`;

    try {
      if (side === "BUY") {
        const result = (await this.client.readContract({
          address: market as `0x${string}`,
          abi: launchMarketAbi,
          functionName: "quoteBuy",
          args: [amount],
        })) as readonly [bigint, bigint, bigint, bigint, boolean];

        this.cachedQuotes.set(key, {
          tokensOut: result[0],
          crossesGraduation: result[4],
          priceImpactBps: estimateImpactBps(result[0], qG, distributed),
        });
        return;
      }

      const result = (await this.client.readContract({
        address: market as `0x${string}`,
        abi: launchMarketAbi,
        functionName: "quoteSell",
        args: [amount],
      })) as readonly [bigint, bigint, bigint, bigint];

      this.cachedQuotes.set(key, {
        grossOut: result[1],
        crossesGraduation: false,
        priceImpactBps: estimateImpactBps(amount, qG, distributed),
      });
    } catch {
      // Leaving the cache empty makes the handler return QUOTE_UNAVAILABLE with
      // retryable set, rather than inventing a price the chain did not give.
    }
  }

  async loadStockback(market: string, account: string, quoteDecimals: number): Promise<void> {
    const commitment = await getActiveCommitment(this.db, market);
    const claimed = await getClaimedTotal(this.db, market, account);

    quoteDecimals;

    this.cachedStockback.set(`${market.toLowerCase()}:${account.toLowerCase()}`, {
      // Estimated accrual is computed by the Stockback service from TWAB, and is
      // a projection rather than an entitlement (§293). Absent that service it
      // reports zero rather than guessing — a wrong estimate here is a number a
      // user would read as money.
      estimatedAccrued: 0n,
      claimable: 0n,
      lifetimeClaimed: claimed,
      epochSequence: commitment?.epochSequence ?? 0n,
      epochEndsAt: nextEpochBoundary(),
    });
  }

  private toRow(v: {
    token: `0x${string}`;
    market: `0x${string}`;
    creator: `0x${string}`;
    quoteAsset: `0x${string}`;
    quoteDecimals: number;
    name: string;
    symbol: string;
    status: number;
    distributed: bigint;
    curveCollateral: bigint;
    qG: bigint;
    p0: bigint;
    pg: bigint;
    holderCount: number;
    tradeCount: number;
    launchedAt: number;
    lastBlock: bigint;
  }): MarketRow {
    return {
      token: v.token,
      market: v.market,
      creator: v.creator,
      quoteAsset: v.quoteAsset,
      quoteDecimals: v.quoteDecimals,
      quoteSymbol: this.config.quoteSymbols.get(v.quoteAsset.toLowerCase()) ?? "xSTOCK",
      name: v.name,
      symbol: v.symbol,
      status: STATUS_NAMES[v.status] ?? "PRE_GRAD",
      distributed: v.distributed,
      curveCollateral: v.curveCollateral,
      qG: v.qG,
      price: v.p0 + (v.qG > 0n ? ((v.pg - v.p0) * v.distributed) / v.qG : 0n),
      holderCount: v.holderCount,
      tradeCount: v.tradeCount,
      launchedAt: v.launchedAt,
      lastBlock: v.lastBlock,
    };
  }
}

function cacheKey(options: ExploreOptions): string {
  return `${options.sort}:${options.status ?? "-"}:${options.quoteAsset ?? "-"}:${options.limit}`;
}

/**
 * Price impact in basis points, from how far the order moves along the curve.
 *
 * A display figure for the §232 warning, not an input to anything the user
 * signs — the bound they sign is `minTokensOut`, quoted from the chain.
 */
function estimateImpactBps(delta: bigint, qG: bigint, distributed: bigint): bigint {
  if (qG === 0n || delta === 0n) return 0n;
  const remaining = qG > distributed ? qG - distributed : 1n;
  return (delta * 10_000n) / (remaining + delta);
}

/** Epochs are 24h on a shared 00:00 UTC boundary (§329). */
function nextEpochBoundary(): number {
  const now = Math.floor(Date.now() / 1000);
  return (Math.floor(now / 86_400) + 1) * 86_400;
}
