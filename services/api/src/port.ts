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
  getLatestDataset,
  getEntitlementForRoot,
  headBlockIndexed,
  listCandles as dbListCandles,
  listMarketsByCreator,
  creatorAccruals,
  type ExploreSort,
} from "@sent/database";
import { launchMarketAbi, launchpadFactoryAbi, feeVaultAbi } from "@sent/contracts";

import type {
  DataPort,
  ExploreOptions,
  MarketRow,
  TradeRow,
  StockbackRow,
  QuoteResult,
  CandleBar,
  CreatorRow,
} from "./handlers.ts";

const STATUS_NAMES = ["PRE_GRAD", "GRADUATING", "GRADUATED"] as const;

export interface PortConfig {
  readonly rpcUrl: string;
  /**
   * The factory, which is where the fee vault's address comes from.
   *
   * Deliberately not its own environment variable. The factory already holds
   * `FEE_VAULT` and the two must agree; a second variable is a second thing that
   * can be set to the wrong address, and the failure would be an API showing a
   * creator someone else's balance.
   */
  readonly factory: `0x${string}`;
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

  listCandles(market: string, intervalSeconds: number, limit: number): readonly CandleBar[] {
    const rows = this.cachedCandles.get(`${market.toLowerCase()}:${intervalSeconds}`) ?? [];
    return rows.slice(-limit);
  }

  getCreator(address: string): CreatorRow | null {
    return this.cachedCreators.get(address.toLowerCase()) ?? null;
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
  private readonly cachedCandles = new Map<string, CandleBar[]>();
  private readonly cachedCreators = new Map<string, CreatorRow>();

  /** Resolved once from the factory, then remembered. */
  private feeVault: `0x${string}` | null = null;

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

  /**
   * Load candles from the projection.
   *
   * From the projection rather than the chain, unlike a quote. History is not a
   * decision a user signs, and re-deriving five hundred bars from logs on every
   * chart load would cost far more than the freshness is worth — the envelope
   * says how far behind it is (§211).
   */
  async loadCandles(market: string, intervalSeconds: number, limit: number): Promise<void> {
    const rows = await dbListCandles(this.db, market, intervalSeconds, limit);

    this.cachedCandles.set(
      `${market.toLowerCase()}:${intervalSeconds}`,
      rows.map((r) => ({
        bucket: r.bucket,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        tradeCount: r.tradeCount,
      })),
    );
  }

  /**
   * Load a holder's Stockback position.
   *
   * §293 requires estimated accrual and claimable entitlement to be
   * DISTINGUISHABLE, and they come from genuinely different places:
   *
   *   `claimable` is money. It exists only under a commitment the attestors
   *   activated on-chain, and it is paid as `cumulative - claimed` against THAT
   *   root. The proof is served alongside it, because a claim without one is a
   *   number the user cannot act on.
   *
   *   `estimatedAccrued` is a projection. It comes from the newest dataset this
   *   node computed, which nobody has signed and the vault would not honour.
   *
   * Both were hardcoded to zero while the finalizer did not exist. It does now,
   * so a holder with a real entitlement was being shown nothing — the failure is
   * quiet, and on the side that looks like the user simply earned nothing.
   */
  async loadStockback(market: string, account: string, quoteDecimals: number): Promise<void> {
    void quoteDecimals;

    const [commitment, claimed, latest] = await Promise.all([
      getActiveCommitment(this.db, market),
      getClaimedTotal(this.db, market, account),
      getLatestDataset(this.db, market),
    ]);

    // Against the ACTIVE root, not the newest one. A proof is only valid for the
    // tree it was built from, and serving a newer proof against an older active
    // root hands the user calldata that reverts.
    const active =
      commitment === null
        ? null
        : await getEntitlementForRoot(this.db, market, account, commitment.merkleRoot);

    const claimable = active === null ? 0n : subtractClaimed(active.cumulative, claimed);

    // The newest computed entitlement, whether or not it is attested yet.
    const computed =
      latest === null
        ? null
        : await getEntitlementForRoot(this.db, market, account, latest.merkleRoot);

    // What the pipeline has worked out MINUS what is already payable, so the two
    // figures do not double-count the same reward.
    const accrued =
      computed === null ? 0n : subtractClaimed(computed.cumulative, claimed) - claimable;

    this.cachedStockback.set(`${market.toLowerCase()}:${account.toLowerCase()}`, {
      estimatedAccrued: accrued > 0n ? accrued : 0n,
      claimable,
      lifetimeClaimed: claimed,
      epochSequence: commitment?.epochSequence ?? latest?.epochSequence ?? 0n,
      epochEndsAt: nextEpochBoundary(),
      ...(active !== null ? { proof: active.proof, cumulative: active.cumulative } : {}),
    });
  }

  /**
   * Load a creator's cockpit (§221).
   *
   * Two fee figures from two different authorities, on purpose:
   *
   *   `accrued` is the projection's lifetime total — every fee the chain has ever
   *   credited this creator, including ones already withdrawn.
   *
   *   `claimable` is read from the VAULT (§423), because it is the number a
   *   button spends. Summing indexed accruals would tell a creator they can
   *   withdraw money that is already in their wallet, and the claim would revert
   *   with `NothingToClaim` after they paid gas to find out.
   *
   * The asset list comes from the projection because the vault has no enumerable
   * one — `creatorBalance` is a mapping. An asset the creator never earned in has
   * a zero balance, so nothing is missed by asking only about the ones indexed.
   */
  async loadCreator(address: string): Promise<void> {
    const [views, accruals] = await Promise.all([
      listMarketsByCreator(this.db, address),
      creatorAccruals(this.db, address),
    ]);

    const vault = await this.resolveFeeVault();

    const claimable: { asset: `0x${string}`; symbol: string; amount: bigint }[] = [];

    if (vault !== null) {
      for (const accrual of accruals) {
        try {
          const balance = (await this.client.readContract({
            address: vault,
            abi: feeVaultAbi,
            functionName: "creatorBalance",
            args: [address as `0x${string}`, accrual.asset],
          })) as bigint;

          if (balance > 0n) {
            claimable.push({ asset: accrual.asset, symbol: this.symbolOf(accrual.asset), amount: balance });
          }
        } catch {
          // An RPC failure must not turn into a zero. A zero here reads as
          // "nothing to claim", which is a lie the creator cannot tell apart
          // from the truth — so the asset is simply omitted, and the page shows
          // the accrued figure with the freshness envelope saying why.
        }
      }
    }

    this.cachedCreators.set(address.toLowerCase(), {
      launches: views.map((v) => this.toRow(v)),
      claimable,
      accrued: accruals.map((a) => ({
        asset: a.asset,
        symbol: this.symbolOf(a.asset),
        amount: a.accrued,
      })),
    });
  }

  /**
   * The fee vault, from the factory.
   *
   * Cached after the first success and never cached as a failure: an RPC blip at
   * startup would otherwise disable every creator's claim figure until restart.
   */
  private async resolveFeeVault(): Promise<`0x${string}` | null> {
    if (this.feeVault !== null) return this.feeVault;

    try {
      const vault = (await this.client.readContract({
        address: this.config.factory,
        abi: launchpadFactoryAbi,
        functionName: "FEE_VAULT",
      })) as `0x${string}`;

      this.feeVault = vault;
      return vault;
    } catch {
      return null;
    }
  }

  private symbolOf(asset: `0x${string}`): string {
    return this.config.quoteSymbols.get(asset.toLowerCase()) ?? "xSTOCK";
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
    graduatedAt: number | null;
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
      graduatedAt: v.graduatedAt,
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

/**
 * Cumulative minus what has already been claimed, floored at zero.
 *
 * Never negative. A holder who claimed under a later root than the one being
 * read would otherwise show a negative balance, which is not a state the vault
 * can be in — it pays `cumulative - claimed` and reverts if that underflows.
 */
function subtractClaimed(cumulative: bigint, claimed: bigint): bigint {
  return cumulative > claimed ? cumulative - claimed : 0n;
}

/** Epochs are 24h on a shared 00:00 UTC boundary (§329). */
function nextEpochBoundary(): number {
  const now = Math.floor(Date.now() / 1000);
  return (Math.floor(now / 86_400) + 1) * 86_400;
}
