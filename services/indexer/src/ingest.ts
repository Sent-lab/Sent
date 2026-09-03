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
  insertFeeAccrual,
  insertFeeClaim,
  insertMetadata,
  registerExclusions,
  recordCommitmentSubmitted,
  markCommitmentActivated,
  markCommitmentCancelled,
  recordClaim,
  upsertXStockAsset,
  setAssetGates,
  setAssetLaunchable,
  refreshHolderCount,
  recordStockbackFunding,
  type Transaction,
} from "@sent/database";
import { scheduleForRange } from "@sent/worker";
import { makeCurve, marginalPrice } from "@sent/economics";
import {
  launchpadFactoryAbi,
  launchMarketAbi,
  launchTokenAbi,
  holderRewardVaultAbi,
  xStockRegistryAbi,
  feeVaultAbi,
} from "@sent/contracts";

import { toNormalized } from "@sent/sdk";
import { createLogger, type Logger } from "@sent/observability/logger";
import type { Registry } from "@sent/observability/metrics";

import {
  createIndexerRegistry,
  TICKS_TOTAL,
  TICK_SECONDS,
  RANGE_SECONDS,
  LOGS_TOTAL,
  EVENTS_TOTAL,
  REORGS_TOTAL,
  REINDEXES_TOTAL,
  RPC_FAILURES,
} from "./observability.ts";

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
  private readonly knownMarkets = new Map<
    string,
    { token: string; quoteDecimals: number; p0: bigint }
  >();
  private readonly tokenToMarket = new Map<string, string>();

  /**
   * The fee vault, read from the factory rather than configured.
   *
   * Not its own environment variable: the factory already holds `FEE_VAULT`, the
   * two must agree, and a second setting is a second thing that can be wrong.
   * Getting it wrong would mean indexing another deployment's fees into this
   * projection, which is worse than indexing none.
   */
  private feeVault: `0x${string}` | null = null;

  /**
   * The graduation router, also from the factory.
   *
   * Excluded from Stockback because it holds tokens in transit during
   * graduation (§323). Null until the factory has one set — a market can launch
   * before the router is configured, and an exclusion that cannot be derived is
   * better absent than guessed.
   */
  private router: `0x${string}` | null = null;

  /** The xStock registry, also from the factory. Its own events are indexed. */
  private registry: `0x${string}` | null = null;

  private running = false;
  private connected = false;
  private headBlock = 0n;
  private indexedBlock = 0n;
  private reorgsHandled = 0;
  private reindexesRequired = 0;

  /**
   * The chain timestamp of the newest block written.
   *
   * Kept in memory because it answers §146's "event delay", which is a
   * different question from lag: on a chain that has stopped producing blocks
   * lag is zero and stays zero — the indexer is caught up with a chain that is
   * not moving — and only this number grows.
   */
  private newestBlockTimestamp: number | null = null;

  private readonly log: Logger;
  readonly metrics: Registry;

  constructor(db: Database, config: IndexerConfig) {
    this.db = db;
    this.config = config;
    this.tracker = new ChainTracker(config.reorgDepth);

    this.log = createLogger({ service: "indexer" }).child({ chainId: config.chainId });

    this.metrics = createIndexerRegistry({
      headBlock: () => this.headBlock,
      indexedBlock: () => this.indexedBlock,
      connected: () => this.connected,
      newestBlockTimestamp: () => this.newestBlockTimestamp,
    });

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
      const started = process.hrtime.bigint();

      try {
        await this.tick();
        this.connected = true;

        this.metrics.increment(TICKS_TOTAL, { outcome: "ok" });
        this.metrics.observe(TICK_SECONDS, seconds(started), { outcome: "ok" });
      } catch (error) {
        // Anything staged during the failed transaction is discarded with it.
        this.pendingMarkets = [];

        // A failed tick is not fatal: the cursor has not moved, so the next tick
        // retries the same range. Marking the connection down is what makes the
        // API report DELAYED rather than serving stale data as live (§211).
        this.connected = false;

        this.metrics.increment(TICKS_TOTAL, { outcome: "error" });
        this.metrics.increment(RPC_FAILURES);
        // Timed even when it fails: a tick that errors immediately and one that
        // hangs for a minute are different incidents, and dropping the second
        // from the histogram hides it entirely.
        this.metrics.observe(TICK_SECONDS, seconds(started), { outcome: "error" });

        this.log.error("tick failed", {
          blockNumber: this.indexedBlock,
          error: error instanceof Error ? error.message : String(error),
        });
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
        this.metrics.increment(REINDEXES_TOTAL);
        this.log.error("full reindex required", {
          blockNumber: this.indexedBlock,
          reason: decision.reason,
        });
        await this.fullReindex();
        return;
      }

      // A head below the cursor with a matching hash still means rows above it
      // describe blocks that are gone.
      if (this.headBlock < this.indexedBlock) {
        this.log.warn("chain head is below the cursor; rolling back", {
          blockNumber: this.indexedBlock,
          headBlock: this.headBlock,
        });
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
      this.metrics.increment(REINDEXES_TOTAL);
      this.log.error("full reindex required", {
        blockNumber: this.indexedBlock,
        reason: decision.reason,
      });
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
    const feeVault = await this.resolveFeeVault();
    const registry = await this.resolveRegistry();
    await this.resolveRouter();

    const rangeStarted = process.hrtime.bigint();

    let logs = await this.client.getLogs({
      address: [
        this.config.factory,
        this.config.rewardVault,
        ...(feeVault === null ? [] : [feeVault]),
        ...(registry === null ? [] : [registry]),
        ...this.marketAddresses(),
      ],
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

    /*
     * Pending logs are refused before anything is sorted or written.
     *
     * `getLogs` over a fixed range should never return one, so this is a
     * consistency check on the node rather than an expected case. Sorting them
     * as zero would have placed a pending log ahead of every real one in the
     * range, and the insert sites would then have written it as a trade in
     * block zero.
     */
    for (const log of logs) {
      if (log.blockNumber === null || log.logIndex === null) {
        throw new Error(
          `[indexer] node returned a pending log for range ${from}..${to} from ${log.address}`,
        );
      }
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
        p0: entry.p0,
      });
      this.tokenToMarket.set(entry.token, entry.market);
    }
    this.pendingMarkets = [];

    this.indexedBlock = to;

    /*
     * §146's event delay, recorded from the block's OWN timestamp.
     *
     * Not from the wall clock at write time, which would measure how recently
     * this process ran rather than how old the data is. On a chain that has
     * stopped producing blocks the two diverge completely: lag stays at zero
     * because the indexer is caught up with a chain that is not moving, and
     * only this number grows.
     */
    let newest = first.timestamp;
    for (const header of headers.values()) {
      if (header.timestamp > newest) newest = header.timestamp;
    }

    // Across every header this range recorded, including the range-start block.
    // `headers` holds only blocks that carried logs, so a quiet range would
    // otherwise leave this value stale — and a stale event-delay reading is
    // indistinguishable from a chain that stopped.
    this.newestBlockTimestamp = Number(newest);

    this.metrics.observe(RANGE_SECONDS, seconds(rangeStarted));
    this.metrics.increment(LOGS_TOTAL, {}, logs.length);

    return true;
  }

  private async handleReorg(rollbackPoint: bigint): Promise<void> {
    this.reorgsHandled += 1;

    // §146's missed-block recovery, as a rate. A "recovering" boolean would be
    // true for milliseconds and missed by every scrape; the rate is what
    // distinguishes normal reorg depth from a chain in trouble.
    this.metrics.increment(REORGS_TOTAL, {
      depth: bucketDepth(this.indexedBlock - rollbackPoint),
    });

    this.log.warn("reorg detected, rolling back", {
      blockNumber: this.indexedBlock,
      rollbackTo: rollbackPoint,
    });

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
    this.log.warn("full reindex starting", { blockNumber: this.config.startBlock });

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

    // Counted here, at the one point every log passes through, rather than in
    // each handler. A per-handler increment is one that gets forgotten when a
    // handler is added, and the metric would under-report without failing.
    this.metrics.increment(EVENTS_TOTAL, { source: this.sourceOf(address) });

    if (address === this.config.factory.toLowerCase()) {
      return this.handleFactoryLog(tx, log, blockTimestamp);
    }
    if (address === this.config.rewardVault.toLowerCase()) {
      return this.handleRewardVaultLog(tx, log, blockTimestamp);
    }
    if (this.feeVault !== null && address === this.feeVault.toLowerCase()) {
      return this.handleFeeVaultLog(tx, log, blockTimestamp);
    }
    if (this.registry !== null && address === this.registry.toLowerCase()) {
      return this.handleRegistryLog(tx, log, blockTimestamp);
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
    if (decoded === null) return;

    /*
     * Metadata arrives on its own event (§95.20).
     *
     * Handled before the launch branch because it is not a launch: a revision
     * comes long afterwards, from a different transaction, and falling through
     * the `TokenLaunched` guard would drop every one of them.
     */
    if (decoded.eventName === "LaunchMetadata") {
      return this.handleMetadataLog(tx, decoded.args as Record<string, unknown>, log, timestamp);
    }

    if (decoded.eventName !== "TokenLaunched") return;

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
      launchedAtBlock: this.positionOf(log).blockNumber,
      // The commitment the address was derived from (§412). Stored so revision
      // 0's published content can be checked against it without re-deriving an
      // address — which makes §231's trust signal a fact rather than a claim.
      launchIntentHash: String(a.launchIntentHash) as `0x${string}`,
    });

    /*
     * §323/§324. Registered here, in the same transaction as the market.
     *
     * Deferring this to a later job would leave a window in which a finalization
     * could run against a market whose curve balance is still eligible — and the
     * curve holds every token nobody has bought yet, which at launch is the
     * whole supply. The distribution would be arithmetically correct and would
     * pay the market contract instead of the holders.
     *
     * The vault addresses come from the factory rather than configuration, for
     * the same reason the fee vault does: they must agree, and a second source
     * is a second thing that can name another deployment's contracts.
     */
    await registerExclusions(tx, market, {
      factory: this.config.factory,
      feeVault: (await this.resolveFeeVault()) ?? this.config.factory,
      rewardVault: this.config.rewardVault,
      ...(this.router !== null ? { router: this.router } : {}),
    });

    // Staged, NOT applied. This runs inside the advance transaction, and a
    // transaction that rolls back must not leave the in-memory map claiming a
    // market the database does not have — the next tick would then treat the
    // token's transfers as belonging to a known market, and every insert would
    // fail the foreign key, forever. Applied by `advance` once the commit lands.
    this.pendingMarkets.push({ market, token, quoteDecimals, p0 });
  }

  private async handleMarketLog(tx: Transaction, log: Log, timestamp: number): Promise<void> {
    const decoded = tryDecode(launchMarketAbi, log);
    if (decoded === null) return;

    const market = log.address.toLowerCase() as `0x${string}`;
    const a = decoded.args as Record<string, unknown>;
    const { blockNumber, logIndex } = this.positionOf(log);

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
          priceAfter: this.priceAfter(market, a.newDistributed as bigint),
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
        priceAfter: this.priceAfter(market, a.newDistributed as bigint),
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
    const { blockNumber, logIndex } = this.positionOf(log);

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

  /**
   * Fees the vault credited to a creator.
   *
   * `fee_accruals` existed in the schema from the first migration and nothing
   * ever wrote to it — the indexer watched the factory, the reward vault and
   * every market, but never the fee vault. A creator's earnings page therefore
   * had no source at all, and the table looked populated-by-design rather than
   * dead.
   *
   * Only `FeesAccrued` is recorded. A claim moves money that was already
   * credited, so treating `CreatorClaimed` as a second row would double-count
   * lifetime earnings; what remains payable is read from the vault (§423).
   */
  private async handleFeeVaultLog(tx: Transaction, log: Log, timestamp: number): Promise<void> {
    const decoded = tryDecode(feeVaultAbi, log);
    if (decoded === null) return;

    const a = decoded.args as Record<string, unknown>;
    const { blockNumber: claimBlock, logIndex: claimIndex } = this.positionOf(log);

    /*
     * §178.7 lists fee claim indexing on its own line, and §21's event family
     * is "FeesAccrued / FeesClaimed". Only the accrual side was handled.
     *
     * Claims carry no market — the vault settles per (creator, asset) across
     * every market they launched — so they are recorded before the
     * market-scoped guard below, which would skip them for having no market to
     * check.
     */
    if (decoded.eventName === "CreatorClaimed" || decoded.eventName === "PlatformClaimed") {
      const asset = String(a.asset).toLowerCase() as `0x${string}`;

      /*
       * NORMALIZED, like every other quantity in this projection (§424).
       *
       * The vault emits raw token amounts. Storing them as emitted would put
       * two scales in one creator's view: 4.2 earned beside 4200000 claimed for
       * a six-decimal xStock — the exact defect `fee_accruals` already had, in
       * the table next to it.
       *
       * The decimals come from the REGISTRY by asset, not from a market row: a
       * claim settles across every market the creator launched against this
       * asset, so there is no single market to read them from.
       */
      const decimals = await this.quoteDecimalsOf(asset);

      return insertFeeClaim(tx, {
        blockNumber: claimBlock,
        logIndex: claimIndex,
        // Null creator for a platform claim. They share the table because they
        // are the same event shape from the same contract; §12's separation is
        // about the buckets the money came from, which the vault has already
        // applied by the time either is emitted.
        creator:
          decoded.eventName === "CreatorClaimed" ? String(a.creator).toLowerCase() : null,
        asset,
        amount: toNormalized(a.amount as bigint, decimals),
        recipient: String(a.to).toLowerCase(),
        timestamp,
      });
    }

    if (decoded.eventName !== "FeesAccrued") return;

    const market = String(a.market).toLowerCase();

    // The row references `markets`, so a fee for a market this projection has
    // not indexed would violate the foreign key and stop ingestion. That can
    // only happen for a market from another factory sharing the vault, which is
    // not a state this deployment has — but it is cheap to refuse rather than
    // throw inside the advance transaction.
    if (!this.isKnownMarket(market)) return;

    const { blockNumber, logIndex } = this.positionOf(log);

    /*
     * NORMALIZED to eighteen decimals before it is stored (§424).
     *
     * The market emits normalized quantities because that is the unit it does
     * arithmetic in; the vault emits RAW token amounts because that is what it
     * transfers. Both are correct, and storing them side by side as written
     * would put two scales in one projection: a six-decimal xStock would show a
     * creator fee of 174,432 in the cockpit next to 174431738875981363 for the
     * same fee in the tape.
     *
     * Converted with the SDK's own helper rather than a local multiply, so the
     * boundary rule has one implementation (§1064).
     */
    const decimals = this.quoteDecimalsFor(market);

    await insertFeeAccrual(
      tx,
      {
        blockNumber,
        market: market as `0x${string}`,
        creator: String(a.creator).toLowerCase() as `0x${string}`,
        asset: String(a.asset).toLowerCase() as `0x${string}`,
        creatorAmount: toNormalized(a.creatorAmount as bigint, decimals),
        platformAmount: toNormalized(a.platformAmount as bigint, decimals),
        timestamp,
      },
      logIndex,
    );
  }

  /** A market's quote decimals, committed or staged in this transaction. */
  private quoteDecimalsFor(market: string): number {
    const known = this.knownMarkets.get(market);
    if (known !== undefined) return known.quoteDecimals;

    const staged = this.pendingMarkets.find((m) => m.market === market);
    if (staged !== undefined) return staged.quoteDecimals;

    // Unreachable: `handleFeeVaultLog` returns before this for an unknown
    // market. Throwing rather than defaulting to eighteen, because a default
    // here is the exact placeholder shape that scaled every price by 10^12 once
    // already.
    throw new Error(`[indexer] quote decimals requested for unknown market ${market}`);
  }

  /**
   * The fee vault's address, from the factory, resolved once.
   *
   * Never cached as a failure: an RPC blip on the first tick would otherwise
   * leave this indexer permanently blind to every fee until it restarts.
   */
  /** The graduation router, from the factory. Zero means not yet set. */
  private async resolveRouter(): Promise<`0x${string}` | null> {
    if (this.router !== null) return this.router;

    try {
      const router = (await this.client.readContract({
        address: this.config.factory,
        abi: launchpadFactoryAbi,
        functionName: "router",
      })) as `0x${string}`;

      if (/^0x0{40}$/i.test(router)) return null;

      this.router = router;
      return router;
    } catch {
      return null;
    }
  }

  /**
   * The xStock registry, from the factory.
   *
   * Cached after the first success, like the fee vault, and never cached as a
   * failure. `quoteDecimalsOf` used to re-read `REGISTRY` on every uncached
   * asset; it now shares this resolution, so a launch costs one RPC call rather
   * than two.
   */
  private async resolveRegistry(): Promise<`0x${string}` | null> {
    if (this.registry !== null) return this.registry;

    try {
      const registry = (await this.client.readContract({
        address: this.config.factory,
        abi: launchpadFactoryAbi,
        functionName: "REGISTRY",
      })) as `0x${string}`;

      this.registry = registry;
      return registry;
    } catch {
      return null;
    }
  }

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

  /**
   * The reward vault's whole event surface, not just funding.
   *
   * Only `Funded` was handled. `stockback_commitments` and `stockback_claims`
   * were read by the API and written by nobody, which had two consequences that
   * both look like a working system:
   *
   *   `getActiveCommitment` returned NULL forever, so every holder's claimable
   *   figure was zero no matter what the vault would actually pay. A holder with
   *   a live entitlement was shown nothing.
   *
   *   `getClaimedTotal` returned zero forever, so a holder who HAD claimed was
   *   shown the full amount again — and the claim they were invited to make
   *   reverts, because the vault pays `cumulative - claimed` and knows better.
   *
   * The two errors point in opposite directions, which is why neither shows up
   * as an obviously broken page.
   */
  private async handleRewardVaultLog(tx: Transaction, log: Log, timestamp: number): Promise<void> {
    const decoded = tryDecode(holderRewardVaultAbi, log);
    if (decoded === null) return;

    const a = decoded.args as Record<string, unknown>;
    const { blockNumber, logIndex } = this.positionOf(log);

    const market = a.market === undefined ? null : String(a.market).toLowerCase();

    // Every row here references `markets`. A vault shared with another
    // deployment would violate the foreign key inside the advance transaction
    // and stop ingestion, so an unknown market is skipped rather than thrown.
    if (market !== null && !this.isKnownMarket(market)) return;

    /*
     * Each case writes, then publishes INSIDE the same transaction.
     *
     * NOTIFY is delivered on commit, so a subscriber can never be told about a
     * row that rolled back, and a process that dies before committing has
     * announced nothing. §369 wants these live; §138 requires that live never
     * mean "ahead of the projection".
     */
    switch (decoded.eventName) {
      case "Funded": {
        await recordStockbackFunding(tx, {
          blockNumber,
          logIndex,
          market: market as string,
          amount: a.amount as bigint,
          totalFunded: a.totalFunded as bigint,
          timestamp,
        });

        return publish(tx, {
          type: "stockback_funded",
          market,
          amount: a.amount as bigint,
          totalFunded: a.totalFunded as bigint,
          blockNumber,
          timestamp,
        });
      }

      case "CommitmentSubmitted": {
        await recordCommitmentSubmitted(tx, {
          market: market as string,
          merkleRoot: String(a.merkleRoot),
          totalCumulative: a.totalCumulative as bigint,
          submitter: String(a.submitter).toLowerCase(),
          activeAt: Number(a.activeAt as bigint),
          blockNumber,
        });

        // FINALIZING, not finalized. Between this and activation the root is
        // on-chain and pays nothing — §334's delay is the window in which a bad
        // root can still be cancelled, and a client that treated submission as
        // finality would offer a claim six hours early.
        return publish(tx, {
          type: "stockback_finalizing",
          market,
          merkleRoot: String(a.merkleRoot),
          totalCumulative: a.totalCumulative as bigint,
          activeAt: Number(a.activeAt as bigint),
          submitter: String(a.submitter).toLowerCase(),
          blockNumber,
          timestamp,
        });
      }

      case "CommitmentActivated": {
        await markCommitmentActivated(tx, market as string, String(a.merkleRoot), blockNumber);

        return publish(tx, {
          type: "stockback_finalized",
          market,
          merkleRoot: String(a.merkleRoot),
          totalCumulative: a.totalCumulative as bigint,
          blockNumber,
          timestamp,
        });
      }

      case "PendingCommitmentCancelled":
        // Deliberately not published. A cancelled root never paid anything, so
        // there is no client state to correct — and announcing a withdrawal of
        // something never offered would only raise an alarm about money that
        // was never at risk.
        return markCommitmentCancelled(
          tx,
          market as string,
          String(a.merkleRoot),
          blockNumber,
        );

      case "Claimed": {
        await recordClaim(tx, {
          blockNumber,
          logIndex,
          market: market as string,
          account: String(a.account).toLowerCase(),
          amount: a.amount as bigint,
          cumulative: a.cumulative as bigint,
          timestamp,
        });

        // Carries `account`, which is what routes it to that wallet's own
        // channel as well as the market's (§512).
        return publish(tx, {
          type: "stockback_claimed",
          market,
          account: String(a.account).toLowerCase(),
          amount: a.amount as bigint,
          cumulative: a.cumulative as bigint,
          blockNumber,
          timestamp,
        });
      }

      default:
        // Attestor and governance changes are the vault's administration, not
        // its accounting. They are deliberately not projected: nothing in the
        // product reads them, and a table nobody reads is a table nobody
        // notices going wrong.
        return;
    }
  }

  /**
   * A token's metadata, at launch or revised (§95.20).
   *
   * ORDER IS THE CONTRACT'S, NOT THE LOG'S
   * --------------------------------------
   * `revision` comes from the factory's own counter rather than from log index.
   * Two revisions in one block are indistinguishable by position — and log
   * order is not something the chain promises to preserve across a reorg — so
   * the counter is the only ordering that survives one.
   *
   * The row is keyed on (token, revision), which makes a replay idempotent for
   * free: the same revision written twice is the same row.
   */
  private async handleMetadataLog(
    tx: Transaction,
    a: Record<string, unknown>,
    log: Log,
    timestamp: number,
  ): Promise<void> {
    const token = String(a.token).toLowerCase();

    /*
     * The row references `markets`, and at LAUNCH that row is staged rather
     * than committed — the factory emits `TokenLaunched` first and this second,
     * inside one transaction. `pendingMarkets` is what makes the staged one
     * visible; without checking it, every launch's own metadata would be
     * dropped and only revisions would survive.
     */
    if (
      !this.tokenToMarket.has(token) &&
      !this.pendingMarkets.some((m) => m.token === token)
    ) {
      return;
    }

    const { blockNumber, logIndex } = this.positionOf(log);

    const links = Array.isArray(a.links)
      ? (a.links as { label: string; url: string }[]).map((l) => ({
          label: String(l.label),
          url: String(l.url),
        }))
      : [];

    await insertMetadata(tx, {
      token,
      revision: a.revision as bigint,
      description: String(a.description),
      imageCid: String(a.imageCid),
      links,
      author: String(a.creator).toLowerCase(),
      blockNumber,
      logIndex,
      timestamp,
    });
  }

  /**
   * The xStock registry's own state (§420, §252).
   *
   * `xstock_assets` was the one dead table with no reader either, so nothing
   * looked wrong. §168 needs it — "Active xStock Pairs" is sourced from the
   * registry — and so does anything that wants to show WHICH of the eight
   * verification gates an asset has passed rather than a single yes or no.
   *
   * Registry rows are not tied to a market and carry no foreign key to one, so
   * unlike the vault handlers this one has nothing to skip: an asset can be
   * registered long before any market quotes against it.
   */
  private async handleRegistryLog(tx: Transaction, log: Log, timestamp: number): Promise<void> {
    const decoded = tryDecode(xStockRegistryAbi, log);
    if (decoded === null) return;

    const a = decoded.args as Record<string, unknown>;
    const { blockNumber } = this.positionOf(log);
    const asset = a.token === undefined ? null : String(a.token).toLowerCase();
    if (asset === null) return;

    switch (decoded.eventName) {
      case "AssetRegistered":
        return upsertXStockAsset(tx, {
          asset,
          decimals: Number(a.decimals),
          coreTokenIndex: BigInt(a.coreTokenIndex as number | bigint),
          // Not in this event. §399's adapter carries it, and `getAsset` is the
          // place it can be read from; zero is the registry's own default for
          // an asset registered without one.
          evmExtraWeiDecimals: 0,
          lastBlock: blockNumber,
        });

      case "GatesUpdated": {
        const g = a.gates as Record<string, boolean>;

        // Ordered to match the eight columns, and to match §420's own order.
        // A positional list is the one thing here that could silently mean
        // something else, so it is written out rather than mapped over.
        return setAssetGates(
          tx,
          asset,
          [
            g.canonicalRepresentation === true,
            g.transferBehaviour === true,
            g.multiplierBehaviour === true,
            g.priceSource === true,
            g.haltSource === true,
            g.hyperSwapCompatible === true,
            g.normalizedAccountingTested === true,
            g.legalReviewed === true,
          ],
          blockNumber,
        );
      }

      case "AssetEnabled":
        return setAssetLaunchable(tx, asset, true, Number(a.verifiedAt as bigint), blockNumber);

      case "AssetDisabled":
        // Existing markets are untouched. §420's rule governs what may be
        // CREATED; holders of a market that already launched are not stranded
        // because governance stopped accepting new pairs against the asset.
        return setAssetLaunchable(tx, asset, false, null, blockNumber);

      default:
        void timestamp;
        return;
    }
  }

  /**
   * Which contract a log came from, as a low-cardinality label.
   *
   * Five values, never an address: one time series per market is how a metrics
   * store falls over on the day the product succeeds.
   */
  private sourceOf(address: string): string {
    if (address === this.config.factory.toLowerCase()) return "factory";
    if (address === this.config.rewardVault.toLowerCase()) return "reward_vault";
    if (this.feeVault !== null && address === this.feeVault.toLowerCase()) return "fee_vault";
    if (this.registry !== null && address === this.registry.toLowerCase()) return "registry";
    if (this.isKnownMarket(address)) return "market";
    if (this.marketForToken(address) !== undefined) return "token";
    return "unknown";
  }

  /** Committed, or staged earlier in this same transaction. */
  private isKnownMarket(market: string): boolean {
    return (
      this.knownMarkets.has(market) || this.pendingMarkets.some((m) => m.market === market)
    );
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
  /**
   * Marginal price after a trade, from the canonical curve.
   *
   * Stored on every trade because it is what candles, the tape and the chart are
   * built from. It was a hardcoded zero, which meant every price in the
   * projection was zero: a flat tape, and a chart that would have drawn a
   * straight line along the axis for a market that had actually moved 25x.
   *
   * Derived through `marginalPrice` from `@sent/economics` — the same function
   * the API and the simulations use, and the one differentially tested against
   * the Solidity. Re-deriving `p0 + dP * q / qG` here would be a second
   * implementation of the price of everything (§1064).
   *
   * The curve is rebuilt from the market's own `p0`, which is recorded at launch
   * and never re-anchored (§402).
   */
  /**
   * A log's position on the chain, or a refusal.
   *
   * `blockNumber` and `logIndex` are nullable in viem's type because a log from
   * a pending block has neither. Coercing that to zero — which is what `?? 0n`
   * did at every insert site — writes a real trade attached to block zero, at a
   * log index that collides with the genuine first log of that block.
   *
   * `getLogs` over a fixed range never returns a pending log, so this should be
   * unreachable. That is exactly why it throws rather than defaulting: the tick
   * fails, the cursor holds, and the range is retried — instead of a plausible
   * row landing in the projection with nothing to indicate it is wrong.
   */
  private positionOf(log: Log): { blockNumber: bigint; logIndex: number } {
    if (log.blockNumber === null || log.logIndex === null) {
      throw new Error(
        `[indexer] refusing a pending log from ${log.address}: ` +
          `block ${String(log.blockNumber)}, index ${String(log.logIndex)}`,
      );
    }

    return { blockNumber: log.blockNumber, logIndex: log.logIndex };
  }

  private priceAfter(market: string, distributed: bigint): bigint {
    const known =
      this.knownMarkets.get(market) ?? this.pendingMarkets.find((m) => m.market === market);

    // A trade for a market this indexer has never seen cannot be priced. Zero is
    // wrong, but so is any other number, and the trade is already being recorded
    // against a market row that must exist for the insert to succeed.
    if (known === undefined) return 0n;

    return marginalPrice(makeCurve(known.p0), distributed);
  }

  private async quoteDecimalsOf(asset: `0x${string}`): Promise<number> {
    const cached = this.quoteDecimalsCache.get(asset);
    if (cached !== undefined) return cached;

    const registry = await this.resolveRegistry();
    if (registry === null) {
      // Refused rather than defaulted. Eighteen was the placeholder here once
      // already, and it scaled every price and notional for a six-decimal
      // xStock by 10^12 without anything failing.
      throw new Error(`[indexer] cannot read the registry to size ${asset}`);
    }

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
  private pendingMarkets: {
    market: string;
    token: string;
    quoteDecimals: number;
    p0: bigint;
  }[] = [];

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
    const rows = await this.db.query<{
      market: unknown;
      token: unknown;
      quote_decimals: number;
      p0: string;
    }>("SELECT market, token, quote_decimals, p0 FROM markets");

    for (const row of rows) {
      const market = `0x${Buffer.from(row.market as Uint8Array).toString("hex")}`;
      const token = `0x${Buffer.from(row.token as Uint8Array).toString("hex")}`;
      this.knownMarkets.set(market, {
        token,
        quoteDecimals: row.quote_decimals,
        // Needed to derive the price after each trade; without it every trade
        // in the projection would be priced at zero.
        p0: BigInt(row.p0),
      });
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

function seconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e9;
}

/**
 * Reorg depth as a bucket, not as a number.
 *
 * The label is what a dashboard groups by, and an exact depth would create a
 * new time series for every distinct rollback distance. Three buckets say the
 * thing an operator needs: routine, deep, or something is badly wrong.
 */
function bucketDepth(depth: bigint): string {
  if (depth <= 2n) return "1-2";
  if (depth <= 12n) return "3-12";
  return "13+";
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
