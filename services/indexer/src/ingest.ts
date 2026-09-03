/**
 * SENT — chain ingestion.
 *
 * The stage §421 lays out:
 *
 *   RPC → raw block/log ingestion → canonical event normalization
 *       → reorg-safe persistence → domain processors → derived views
 *
 * Everything decidable already exists and is tested without a chain:
 * `ChainTracker` owns reorg policy, `projection.ts` owns state derivation. This
 * module is the I/O that feeds them, and it is deliberately thin — the more
 * logic that lives here, the more that can only be tested against a live node.
 *
 * TWO PROPERTIES THIS LOOP MUST HAVE
 * ----------------------------------
 * **Atomic advance.** A block's events and the cursor move in ONE transaction. A
 * crash between them would leave the cursor claiming work that was never
 * persisted, and the gap would never be revisited because the cursor says it is
 * done.
 *
 * **Idempotent replay.** Every insert is keyed on (block, logIndex), the chain's
 * own ordering, and conflicts do nothing. So re-running a batch after a crash is
 * a no-op rather than a duplicate — which is what makes crash recovery a restart
 * instead of a repair.
 */

import {
  createPublicClient,
  http,
  webSocket,
  decodeEventLog,
  type Log,
  type PublicClient,
} from "viem";

import {
  Database,
  getCursor,
  setCursor,
  recordBlock,
  markFinalized,
  publish,
  rollbackTo,
  insertMarket,
  insertTrade,
  updateMarketState,
  markGraduated,
  insertBalanceEvent,
  refreshHolderCount,
  recordStockbackFunding,
  type Transaction,
} from "@sent/database";
import { scheduleForRange } from "@sent/worker";
import {
  launchpadFactoryAbi,
  launchMarketAbi,
  launchTokenAbi,
  holderRewardVaultAbi,
  xStockRegistryAbi,
} from "@sent/contracts";

import { ChainTracker, type BlockRef } from "./reorg.ts";

export interface IndexerConfig {
  readonly rpcUrl: string;
  /** Optional WebSocket endpoint. Falls back to HTTP polling when absent. */
  readonly wsUrl?: string;
  readonly chainId: number;
  readonly factory: `0x${string}`;
  readonly rewardVault: `0x${string}`;
  /** Block to start from. Usually the factory deployment block. */
  readonly startBlock: bigint;
  /** Blocks per getLogs call. HyperEVM's range cap is unmeasured (V-15). */
  readonly batchSize: bigint;
  /** Blocks below the head treated as settled (§335). */
  readonly confirmations: number;
  readonly pollIntervalMs: number;
  /** Retained headers. Must exceed the deepest reorg the chain produces. */
  readonly reorgDepth: number;
}

export const DEFAULT_CONFIG: Omit<IndexerConfig, "rpcUrl" | "chainId" | "factory" | "rewardVault" | "startBlock"> = {
  batchSize: 500n,
  confirmations: 20,
  pollIntervalMs: 2_000,
  reorgDepth: 128,
};

export interface IndexerStatus {
  readonly headBlock: bigint;
  readonly indexedBlock: bigint;
  readonly finalizedBlock: bigint | undefined;
  readonly connected: boolean;
  readonly reorgsHandled: number;
  readonly reindexesRequired: number;
}

export class Indexer {
  private readonly config: IndexerConfig;
  private readonly db: Database;
  private readonly client: PublicClient;
  private readonly tracker: ChainTracker;

  /** market address -> quote decimals, so a trade can be normalized on arrival. */
  private readonly knownMarkets = new Map<string, { token: string; quoteDecimals: number }>();
  private readonly tokenToMarket = new Map<string, string>();

  private running = false;
  private connected = false;
  private headBlock = 0n;
  private indexedBlock = 0n;
  private reorgsHandled = 0;
  private reindexesRequired = 0;

  constructor(db: Database, config: IndexerConfig) {
    this.db = db;
    this.config = config;
    this.tracker = new ChainTracker(config.reorgDepth);

    this.client = createPublicClient({
      transport: config.wsUrl !== undefined ? webSocket(config.wsUrl) : http(config.rpcUrl),
      // viem caches `eth_blockNumber` for its polling interval, which defaults to
      // four seconds regardless of what this service was configured to do. An
      // indexer told to poll every 100ms would still see a head that only moves
      // every four — so the cache is tied to the configured cadence instead, and
      // the setting means what it says.
      cacheTime: config.pollIntervalMs,
    });
  }

  status(): IndexerStatus {
    return {
      headBlock: this.headBlock,
      indexedBlock: this.indexedBlock,
      finalizedBlock: this.tracker.finalizedBelow(this.config.confirmations),
      connected: this.connected,
      reorgsHandled: this.reorgsHandled,
      reindexesRequired: this.reindexesRequired,
    };
  }

  /** Resume from the persisted cursor, or start at the configured block. */
  async start(): Promise<void> {
    const cursor = await getCursor(this.db);
    this.indexedBlock = cursor?.lastBlock ?? this.config.startBlock - 1n;

    await this.loadKnownMarkets();

    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
        this.connected = true;
      } catch (error) {
        // Anything staged during the failed transaction is discarded with it.
        this.pendingMarkets = [];

        // A failed tick is not fatal: the cursor has not moved, so the next tick
        // retries the same range. Marking the connection down is what makes the
        // API report DELAYED rather than serving stale data as live (§211).
        this.connected = false;
        console.error("[indexer] tick failed:", error instanceof Error ? error.message : error);
      }

      await sleep(this.config.pollIntervalMs);
    }
  }

  /** One pass: catch up to the head, a batch at a time. */
  async tick(): Promise<void> {
    this.headBlock = await this.client.getBlockNumber();

    /*
     * Check the tip before assuming there is nothing to do.
     *
     * The loop below only moves FORWARDS, so once the cursor reaches the head it
     * stops looking — and the two most ordinary reorgs are invisible from there:
     *
     *   Same height, different hash. A one-block reorg replaces the tip and
     *   leaves the height unchanged. `indexedBlock === headBlock`, the loop does
     *   not run, and the orphaned block's trades stay in the projection forever
     *   while the chain has no memory of them.
     *
     *   A shorter chain. A deeper reorg, a rewound node or a replaced one leaves
     *   the head BELOW the cursor. The indexer then sits idle believing it is
     *   ahead of the chain, and nothing ever reports a problem.
     *
     * Neither is exotic. The first is the common case on any chain with
     * competing blocks, and it is exactly what the reorg tracker was written to
     * handle — it was simply never asked.
     */
    if (this.headBlock <= this.indexedBlock) {
      const tip = await this.client.getBlock({
        blockNumber: this.headBlock,
        includeTransactions: false,
      });

      const decision = this.tracker.inspect({
        number: tip.number,
        hash: tip.hash,
        parentHash: tip.parentHash,
      });

      if (decision.action === "reorg") {
        await this.handleReorg(decision.rollbackTo);
        return;
      }

      if (decision.action === "reindex_required") {
        this.reindexesRequired += 1;
        console.error(`[indexer] ${decision.reason}`);
        await this.fullReindex();
        return;
      }

      // A head below the cursor with a matching hash still means rows above it
      // describe blocks that are gone.
      if (this.headBlock < this.indexedBlock) {
        console.warn(
          `[indexer] chain head ${this.headBlock} is below the cursor ${this.indexedBlock}; rolling back`,
        );
        await this.handleReorg(this.headBlock);
      }

      return;
    }

    while (this.indexedBlock < this.headBlock && this.running) {
      const from = this.indexedBlock + 1n;
      const to = min(from + this.config.batchSize - 1n, this.headBlock);

      const advanced = await this.processRange(from, to);
      if (!advanced) return; // a reorg rewound us; the next tick re-reads
    }
  }

  /**
   * Process a block range.
   *
   * Returns false when a reorg forced a rewind, so the caller re-reads the head
   * rather than continuing from a cursor that just moved backwards.
   */
  private async processRange(from: bigint, to: bigint): Promise<boolean> {
    // The boundary header decides continuity. Checking every block in the range
    // would cost an RPC call each; checking the first is enough to detect that
    // the chain moved under us, and the tracker walks back from there.
    const first = await this.client.getBlock({ blockNumber: from, includeTransactions: false });

    const ref: BlockRef = {
      number: first.number,
      hash: first.hash,
      parentHash: first.parentHash,
    };

    const decision = this.tracker.inspect(ref);

    if (decision.action === "reorg") {
      await this.handleReorg(decision.rollbackTo);
      return false;
    }

    if (decision.action === "reindex_required") {
      this.reindexesRequired += 1;
      console.error(`[indexer] ${decision.reason}`);
      await this.fullReindex();
      return false;
    }

    if (decision.action === "gap") {
      // Cannot happen while the cursor advances one range at a time, but a
      // silent continue here would skip blocks — so it is reported instead.
      throw new Error(`[indexer] unexpected gap ${decision.from}..${decision.to}`);
    }

    /*
     * A market launched in this range has trades in this range.
     *
     * `getLogs` filters by address, and a market's address is only known once
     * its launch log has been read — so the first query for a range that
     * contains a launch cannot ask for that market's own events. Everything the
     * market emitted in the same range was silently absent.
     *
     * On a real chain with a 500-block batch that is the first several minutes
     * of every market's life, which is exactly when most of its activity
     * happens, and nothing would ever have reported it: the projection would
     * simply be missing trades that the chain has.
     *
     * So the range is re-queried for addresses that became known while reading
     * it, until nothing new appears. The loop is bounded because a market cannot
     * launch another market — one extra pass is the normal case.
     */
    let logs = await this.client.getLogs({
      address: [this.config.factory, this.config.rewardVault, ...this.marketAddresses()],
      fromBlock: from,
      toBlock: to,
    });

    const seen = new Set(this.marketAddresses().map((a) => a.toLowerCase()));

    for (let pass = 0; pass < 4; pass++) {
      const launched = this.launchedAddressesIn(logs).filter((a) => !seen.has(a.toLowerCase()));
      if (launched.length === 0) break;

      for (const address of launched) seen.add(address.toLowerCase());

      const extra = await this.client.getLogs({
        address: launched as `0x${string}`[],
        fromBlock: from,
        toBlock: to,
      });

      logs = [...logs, ...extra];
    }

    const ordered = [...logs].sort((a, b) => {
      const blockDelta = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n);
      if (blockDelta !== 0n) return blockDelta < 0n ? -1 : 1;
      return (a.logIndex ?? 0) - (b.logIndex ?? 0);
    });

    /*
     * Fetch a header for every block that produced a log.
     *
     * Two things depend on this and both were wrong when only the range's first
     * block was recorded.
     *
     * The schema: every derived row carries `block_number REFERENCES blocks`,
     * because that foreign key is what makes a reorg rollback a DELETE rather
     * than a hand-written cascade. With a 500-block range and one block
     * recorded, 499 blocks' worth of inserts violated it and the tick failed —
     * so the cursor never advanced and indexing stopped at the first range
     * containing an event outside its own first block.
     *
     * The data: an event's timestamp is its OWN block's. Stamping every log in a
     * range with the range-start timestamp puts trades in the wrong candle and,
     * far worse, in the wrong TWAB epoch — Stockback integrates holder balances
     * over time, so a shifted timestamp is a shifted entitlement.
     *
     * Fetched outside the transaction: a network round trip inside one holds it
     * open for the duration.
     */
    const blockNumbers = [
      ...new Set(ordered.map((log) => log.blockNumber).filter((n): n is bigint => n !== null)),
    ];

    const headers = new Map<bigint, { hash: string; parentHash: string; timestamp: bigint }>();

    for (const number of blockNumbers) {
      if (number === first.number) continue;
      const block = await this.client.getBlock({ blockNumber: number });
      headers.set(number, {
        hash: block.hash ?? "0x00",
        parentHash: block.parentHash,
        timestamp: block.timestamp,
      });
    }

    // Everything in this range lands together with the cursor. §138's rebuildable
    // projection is only true if a crash cannot leave them disagreeing.
    await this.db.transaction(async (tx) => {
      await recordBlock(tx, {
        number: first.number,
        hash: first.hash,
        parentHash: first.parentHash,
        timestamp: first.timestamp,
      });

      // Recorded before any row that references them.
      for (const [number, header] of headers) {
        await recordBlock(tx, { number, ...header });
      }

      // Markets whose state changed in this range, collected as the logs are
      // handled so the follow-up work can be scheduled without a second pass.
      const touched = new Set<string>();

      /*
       * Launches first, then everything else.
       *
       * A token's genesis transfers — mint to the factory, forward to the market
       * — are emitted BEFORE `TokenLaunched` in the same transaction, because the
       * token is constructed before the factory can announce it. Processing in
       * strict log order therefore reaches those transfers while the market does
       * not exist yet, and they were silently dropped: the market's opening
       * balance of the entire supply was never recorded, and the first buy drove
       * it negative against the schema's own check constraint.
       *
       * Splitting the pass fixes the dependency without reordering anything that
       * matters. Both halves keep chain order internally, and a launch cannot
       * depend on a trade — a market has to exist before it can emit.
       */
      const factory = this.config.factory.toLowerCase();
      const launches = ordered.filter((log) => log.address.toLowerCase() === factory);
      const rest = ordered.filter((log) => log.address.toLowerCase() !== factory);

      const timestampFor = (log: Log): number =>
        Number(
          log.blockNumber === first.number || log.blockNumber === null
            ? first.timestamp
            : (headers.get(log.blockNumber)?.timestamp ?? first.timestamp),
        );

      for (const log of launches) {
        await this.handleLog(tx, log, timestampFor(log), touched);
      }

      for (const log of rest) {
        await this.handleLog(tx, log, timestampFor(log), touched);
      }

      // Derived work — candles, holder reconciliation — is enqueued in the SAME
      // transaction as the events that imply it. Enqueuing after the commit would
      // lose the jobs if the process died in between, and the projection would
      // then hold trades that no candle ever covers.
      for (const market of touched) {
        await scheduleForRange(
          tx,
          market,
          Number(first.timestamp),
          Number(first.timestamp),
          to,
          Number(first.timestamp),
        );
      }

      await setCursor(tx, to, first.hash);

      // Settle everything the tracker now considers unreachable by a reorg.
      // Inside the same transaction as the cursor: a block marked settled while
      // the cursor stayed behind would let the finalizer act on a range this
      // indexer has not committed to.
      /*
       * Settlement follows the CURSOR, not the tracker's window.
       *
       * This range is being committed, so everything at or below
       * `to - confirmations` is now buried by at least that many blocks. Reading
       * the boundary from the tracker instead was wrong by exactly one range:
       * the tracker is only advanced after this transaction commits, so it still
       * described the previous range and the newest block was never marked
       * settled until another one arrived behind it.
       *
       * With a non-zero confirmation depth that lag is invisible. At zero it
       * means the tip is never settled at all, and anything waiting on settled
       * state — Stockback finalization above all — simply never runs.
       */
      const settled = to - BigInt(this.config.confirmations);
      if (settled > 0n) await markFinalized(tx, settled);
    });

    /*
     * Commit the range's headers to the tracker, ending with its LAST block.
     *
     * Only the range's FIRST block used to be committed, which left the tracker
     * claiming a head far below where the indexer had actually reached. The next
     * range then began at `to + 1`, the tracker compared it against a head one
     * block after the previous range's START, and anything wider than a single
     * block was reported as a gap — which `processRange` throws on.
     *
     * In steady state ranges are one block wide and this never fired. It fires
     * the moment the indexer falls behind and catches up in a batch, which is
     * exactly when it must not: the tick throws, the cursor stops, and indexing
     * wedges until someone restarts it.
     *
     * The headers already fetched for blocks carrying logs are committed too, so
     * the fork-location window is denser at no extra round trip.
     */
    const committed: BlockRef[] = [ref];

    for (const [number, header] of [...headers].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (number > ref.number) {
        committed.push({ number, hash: header.hash, parentHash: header.parentHash });
      }
    }

    if (to > ref.number && !committed.some((b) => b.number === to)) {
      const last = await this.client.getBlock({ blockNumber: to, includeTransactions: false });
      committed.push({ number: last.number, hash: last.hash, parentHash: last.parentHash });
    }

    for (const block of committed) this.tracker.commit(block);

    // The transaction committed, so the in-memory view may now match it.
    for (const entry of this.pendingMarkets) {
      this.knownMarkets.set(entry.market, {
        token: entry.token,
        quoteDecimals: entry.quoteDecimals,
      });
      this.tokenToMarket.set(entry.token, entry.market);
    }
    this.pendingMarkets = [];

    this.indexedBlock = to;
    return true;
  }

  private async handleReorg(rollbackPoint: bigint): Promise<void> {
    this.reorgsHandled += 1;
    console.warn(`[indexer] reorg detected, rolling back to ${rollbackPoint}`);

    await this.db.transaction(async (tx) => {
      await rollbackTo(tx, rollbackPoint);
      await setCursor(tx, rollbackPoint, "0x00");
    });

    this.tracker.rollbackTo(rollbackPoint);
    this.indexedBlock = rollbackPoint;
  }

  /**
   * Rebuild from genesis.
   *
   * §138 calls the projection rebuildable, and this is the operation that makes
   * that true. It is correct and cheap; a wrong projection is neither.
   */
  private async fullReindex(): Promise<void> {
    console.warn("[indexer] full reindex starting");

    await this.db.transaction(async (tx) => {
      await rollbackTo(tx, 0n);
      await setCursor(tx, this.config.startBlock - 1n, "0x00");
    });

    this.tracker.reset();
    this.indexedBlock = this.config.startBlock - 1n;
    this.knownMarkets.clear();
    this.tokenToMarket.clear();
  }

  // -------------------------------------------------------------------------
  // Event normalization (§421 stage 2)
  // -------------------------------------------------------------------------

  private async handleLog(
    tx: Transaction,
    log: Log,
    blockTimestamp: number,
    touched: Set<string>,
  ): Promise<void> {
    const address = log.address.toLowerCase();

    if (address === this.config.factory.toLowerCase()) {
      return this.handleFactoryLog(tx, log, blockTimestamp);
    }
    if (address === this.config.rewardVault.toLowerCase()) {
      return this.handleRewardVaultLog(tx, log, blockTimestamp);
    }
    // Both committed markets and ones staged earlier in THIS transaction. A
    // market launched and traded in the same range emits its first trades before
    // the commit that registers it, and routing on committed state alone would
    // fetch those logs and then drop them.
    if (this.knownMarkets.has(address) || this.pendingMarkets.some((m) => m.market === address)) {
      touched.add(address);
      return this.handleMarketLog(tx, log, blockTimestamp);
    }

    const market = this.marketForToken(address);
    if (market !== undefined) {
      // A token transfer changes balances, so the market it belongs to needs
      // reconciling even though the market contract emitted nothing.
      touched.add(market);
      return this.handleTokenLog(tx, log, blockTimestamp);
    }
  }

  /** The market a token belongs to, committed or staged in this transaction. */
  private marketForToken(token: string): string | undefined {
    return this.tokenToMarket.get(token) ?? this.pendingMarkets.find((m) => m.token === token)?.market;
  }

  private async handleFactoryLog(tx: Transaction, log: Log, timestamp: number): Promise<void> {
    const decoded = tryDecode(launchpadFactoryAbi, log);
    if (decoded?.eventName !== "TokenLaunched") return;

    const a = decoded.args as Record<string, unknown>;

    const token = String(a.token).toLowerCase() as `0x${string}`;
    const market = String(a.market).toLowerCase() as `0x${string}`;
    const quoteAsset = String(a.quoteAsset).toLowerCase() as `0x${string}`;
    const p0 = a.p0 as bigint;

    // From the REGISTRY, never assumed and never read from the token itself
    // (§699). This was hardcoded to eighteen, which silently scaled every price
    // and notional in the projection by 10^12 for a six-decimal xStock — and
    // xStocks are not eighteen-decimal assets.
    const quoteDecimals = await this.quoteDecimalsOf(quoteAsset);

    // qG is a pure fraction of supply and identical for every pair, so it is
    // derived rather than read — one less value that can disagree with the chain.
    const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

    await insertMarket(tx, {
      token,
      market,
      creator: String(a.creator).toLowerCase() as `0x${string}`,
      quoteAsset,
      quoteDecimals,
      name: String(a.name),
      symbol: String(a.symbol),
      p0,
      pg: p0 * 25n,
      qG: (TOTAL_SUPPLY * 50n) / 76n,
      launchedAt: timestamp,
      launchedAtBlock: log.blockNumber ?? 0n,
    });

    // Staged, NOT applied. This runs inside the advance transaction, and a
    // transaction that rolls back must not leave the in-memory map claiming a
    // market the database does not have — the next tick would then treat the
    // token's transfers as belonging to a known market, and every insert would
    // fail the foreign key, forever. Applied by `advance` once the commit lands.
    this.pendingMarkets.push({ market, token, quoteDecimals });
  }

  private async handleMarketLog(tx: Transaction, log: Log, timestamp: number): Promise<void> {
    const decoded = tryDecode(launchMarketAbi, log);
    if (decoded === null) return;

    const market = log.address.toLowerCase() as `0x${string}`;
    const a = decoded.args as Record<string, unknown>;
    const blockNumber = log.blockNumber ?? 0n;
    const logIndex = log.logIndex ?? 0;

    if (decoded.eventName === "Bought" || decoded.eventName === "Sold") {
      const isBuy = decoded.eventName === "Bought";

      await insertTrade(
        tx,
        {
          txHash: (log.transactionHash ?? "0x") as `0x${string}`,
          blockNumber,
          market,
          trader: String(isBuy ? a.buyer : a.seller).toLowerCase() as `0x${string}`,
          side: isBuy ? 0 : 1,
          notional: (isBuy ? a.grossQuoteIn : a.grossQuoteOut) as bigint,
          net: (isBuy ? a.netToCurve : a.netQuoteOut) as bigint,
          tokens: (isBuy ? a.tokensOut : a.tokensIn) as bigint,
          coreFee: a.coreFee as bigint,
          // The event carries the core fee; the split is re-derived from the
          // canonical rule rather than stored twice on-chain.
          creatorFee: ceilBps(a.coreFee as bigint, 6_500n),
          platformFee: (a.coreFee as bigint) - ceilBps(a.coreFee as bigint, 6_500n),
          stockback: a.stockback as bigint,
          distributedAfter: a.newDistributed as bigint,
          collateralAfter: a.newCollateral as bigint,
          priceAfter: 0n,
          timestamp,
        },
        logIndex,
      );

      await updateMarketState(tx, market, {
        distributed: a.newDistributed as bigint,
        curveCollateral: a.newCollateral as bigint,
        lastBlock: blockNumber,
      });

      // Published INSIDE the transaction. NOTIFY is delivered on commit, so a
      // subscriber can never see a trade whose rows were rolled back — and if
      // the process dies before committing, nothing was announced.
      //
      // §316: the fee split travels in full. The tape is where most users form
      // their impression of who earns what, and aggregating it here would be the
      // one place that impression is formed from a single number.
      await publish(tx, {
        type: "trade",
        market,
        side: isBuy ? "BUY" : "SELL",
        trader: String(isBuy ? a.buyer : a.seller).toLowerCase(),
        txHash: log.transactionHash ?? "0x",
        blockNumber,
        notional: (isBuy ? a.grossQuoteIn : a.grossQuoteOut) as bigint,
        tokens: (isBuy ? a.tokensOut : a.tokensIn) as bigint,
        coreFee: a.coreFee as bigint,
        creatorFee: ceilBps(a.coreFee as bigint, 6_500n),
        platformFee: (a.coreFee as bigint) - ceilBps(a.coreFee as bigint, 6_500n),
        stockback: a.stockback as bigint,
        priceAfter: 0n,
        distributedAfter: a.newDistributed as bigint,
        timestamp,
      });
      return;
    }

    if (decoded.eventName === "Graduated") {
      await markGraduated(
        tx,
        market,
        String(a.pool).toLowerCase(),
        a.positionId as bigint,
        blockNumber,
      );

      await publish(tx, {
        type: "graduation",
        market,
        pool: String(a.pool).toLowerCase(),
        positionId: a.positionId as bigint,
        blockNumber,
        timestamp,
      });
    }
  }

  /** ERC-20 Transfers on a launched token — the TWAB input (§288). */
  private async handleTokenLog(tx: Transaction, log: Log, timestamp: number): Promise<void> {
    const decoded = tryDecode(launchTokenAbi, log);
    if (decoded?.eventName !== "Transfer") return;

    const a = decoded.args as Record<string, unknown>;
    const market = this.marketForToken(log.address.toLowerCase());
    if (market === undefined) return;

    const from = String(a.from).toLowerCase();
    const to = String(a.to).toLowerCase();
    const value = a.value as bigint;
    const blockNumber = log.blockNumber ?? 0n;
    const logIndex = log.logIndex ?? 0;

    /*
     * Both sides are recorded. A transfer moves exposure rather than creating it,
     * and the integral needs both boundaries or the seam leaks weight.
     *
     * The stored index is `logIndex * 2` for the debit and `+ 1` for the credit,
     * which keeps the pair distinct AND keeps the whole block in chronological
     * order.
     *
     * The previous scheme offset the credit by a million to avoid a primary key
     * collision, and that silently reordered every block with more than one
     * transfer: log 0's credit sorted after log 3's debit. A token's genesis is
     * exactly that shape — mint to the factory, then forward to the market — so
     * the factory appeared to spend a billion tokens before receiving them, the
     * running balance went negative, and the TWAB engine refused the stream as
     * corrupt. Correctly: Stockback simply stopped for that market.
     */
    if (from !== ZERO) {
      await insertBalanceEvent(tx, {
        blockNumber,
        logIndex: logIndex * 2,
        market,
        account: from,
        delta: -value,
        timestamp,
      });
    }
    if (to !== ZERO) {
      await insertBalanceEvent(tx, {
        blockNumber,
        logIndex: logIndex * 2 + 1,
        market,
        account: to,
        delta: value,
        timestamp,
      });
    }

    await refreshHolderCount(tx, market);
  }

  private async handleRewardVaultLog(tx: Transaction, log: Log, timestamp: number): Promise<void> {
    const decoded = tryDecode(holderRewardVaultAbi, log);
    if (decoded?.eventName !== "Funded") return;

    const a = decoded.args as Record<string, unknown>;

    await recordStockbackFunding(tx, {
      blockNumber: log.blockNumber ?? 0n,
      logIndex: log.logIndex ?? 0,
      market: String(a.market).toLowerCase(),
      amount: a.amount as bigint,
      totalFunded: a.totalFunded as bigint,
      timestamp,
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Market and token addresses announced by launch logs in a batch.
   *
   * Decoded rather than pattern-matched: a `TokenLaunched` topic is the only
   * thing that makes an address a market, and reading it from the event is what
   * keeps §4's "authenticity comes from the factory" true inside the indexer as
   * well as inside the UI.
   */
  /**
   * Decimals for a quote asset, from the registry.
   *
   * Cached: the value is immutable once an asset is registered, and a launch is
   * rare enough that one call per new asset costs nothing.
   *
   * A registry that cannot answer is fatal rather than defaulted. Guessing
   * eighteen is what produced the bug this replaces, and a wrong scale is
   * indistinguishable from a real number once it is in the database.
   */
  private async quoteDecimalsOf(asset: `0x${string}`): Promise<number> {
    const cached = this.quoteDecimalsCache.get(asset);
    if (cached !== undefined) return cached;

    const registry = (await this.client.readContract({
      address: this.config.factory,
      abi: launchpadFactoryAbi,
      functionName: "REGISTRY",
    })) as `0x${string}`;

    const record = (await this.client.readContract({
      address: registry,
      abi: xStockRegistryAbi,
      functionName: "getAsset",
      args: [asset],
    })) as { decimals: number };

    this.quoteDecimalsCache.set(asset, record.decimals);
    return record.decimals;
  }

  private readonly quoteDecimalsCache = new Map<string, number>();

  /** Markets discovered in the current transaction, applied only on commit. */
  private pendingMarkets: { market: string; token: string; quoteDecimals: number }[] = [];

  private launchedAddressesIn(logs: readonly Log[]): string[] {
    const found: string[] = [];

    for (const log of logs) {
      if (log.address.toLowerCase() !== this.config.factory.toLowerCase()) continue;

      const decoded = tryDecode(launchpadFactoryAbi, log);
      if (decoded?.eventName !== "TokenLaunched") continue;

      const args = decoded.args as Record<string, unknown>;
      found.push(String(args.market).toLowerCase(), String(args.token).toLowerCase());
    }

    return found;
  }

  private marketAddresses(): `0x${string}`[] {
    return [...this.knownMarkets.keys(), ...this.tokenToMarket.keys()] as `0x${string}`[];
  }

  private async loadKnownMarkets(): Promise<void> {
    const rows = await this.db.query<{ market: unknown; token: unknown; quote_decimals: number }>(
      "SELECT market, token, quote_decimals FROM markets",
    );

    for (const row of rows) {
      const market = `0x${Buffer.from(row.market as Uint8Array).toString("hex")}`;
      const token = `0x${Buffer.from(row.token as Uint8Array).toString("hex")}`;
      this.knownMarkets.set(market, { token, quoteDecimals: row.quote_decimals });
      this.tokenToMarket.set(token, market);
    }
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";

/** Creator share rounds UP, matching `Fees.splitCore` (D-003a). */
function ceilBps(amount: bigint, bps: bigint): bigint {
  const result = (amount * bps + 9_999n) / 10_000n;
  return result > amount ? amount : result;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decode a log, returning null when it does not belong to this ABI.
 *
 * An unknown log is normal — a market emits events this indexer does not consume
 * — so it must not throw. Letting it propagate would stall the whole range on a
 * log nobody cares about.
 */
function tryDecode(
  abi: readonly unknown[],
  log: Log,
): { eventName: string; args: unknown } | null {
  try {
    const decoded = decodeEventLog({
      abi: abi as never,
      data: log.data,
      topics: log.topics as never,
    });
    // `eventName` is typed as possibly undefined for a generic ABI; an
    // undecodable log is treated as unknown rather than coerced.
    if (decoded.eventName === undefined) return null;
    return { eventName: String(decoded.eventName), args: decoded.args };
  } catch {
    return null;
  }
}
