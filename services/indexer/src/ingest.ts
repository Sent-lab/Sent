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
import { launchpadFactoryAbi, launchMarketAbi, launchTokenAbi, holderRewardVaultAbi } from "@sent/contracts";

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

    const logs = await this.client.getLogs({
      address: [this.config.factory, this.config.rewardVault, ...this.marketAddresses()],
      fromBlock: from,
      toBlock: to,
    });

    // Everything in this range lands together with the cursor. §138's rebuildable
    // projection is only true if a crash cannot leave them disagreeing.
    await this.db.transaction(async (tx) => {
      await recordBlock(tx, {
        number: first.number,
        hash: first.hash,
        parentHash: first.parentHash,
        timestamp: first.timestamp,
      });

      const ordered = [...logs].sort((a, b) => {
        const blockDelta = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n);
        if (blockDelta !== 0n) return blockDelta < 0n ? -1 : 1;
        return (a.logIndex ?? 0) - (b.logIndex ?? 0);
      });

      // Markets whose state changed in this range, collected as the logs are
      // handled so the follow-up work can be scheduled without a second pass.
      const touched = new Set<string>();

      for (const log of ordered) {
        await this.handleLog(tx, log, Number(first.timestamp), touched);
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
      // `undefined` while the chain is shallower than the confirmation depth —
      // early on a fresh chain, or right after a full reindex. Nothing is settled
      // yet, and marking anything would be a claim the tracker has not made.
      const settled = this.tracker.finalizedBelow(this.config.confirmations);
      if (settled !== undefined) await markFinalized(tx, settled);
    });

    this.tracker.commit(ref);
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
    if (this.knownMarkets.has(address)) {
      touched.add(address);
      return this.handleMarketLog(tx, log, blockTimestamp);
    }
    if (this.tokenToMarket.has(address)) {
      // A token transfer changes balances, so the market it belongs to needs
      // reconciling even though the market contract emitted nothing.
      const market = this.tokenToMarket.get(address);
      if (market !== undefined) touched.add(market);
      return this.handleTokenLog(tx, log, blockTimestamp);
    }
  }

  private async handleFactoryLog(tx: Transaction, log: Log, timestamp: number): Promise<void> {
    const decoded = tryDecode(launchpadFactoryAbi, log);
    if (decoded?.eventName !== "TokenLaunched") return;

    const a = decoded.args as Record<string, unknown>;

    const token = String(a.token).toLowerCase() as `0x${string}`;
    const market = String(a.market).toLowerCase() as `0x${string}`;
    const p0 = a.p0 as bigint;

    // qG is a pure fraction of supply and identical for every pair, so it is
    // derived rather than read — one less value that can disagree with the chain.
    const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

    await insertMarket(tx, {
      token,
      market,
      creator: String(a.creator).toLowerCase() as `0x${string}`,
      quoteAsset: String(a.quoteAsset).toLowerCase() as `0x${string}`,
      quoteDecimals: 18,
      name: String(a.name),
      symbol: String(a.symbol),
      p0,
      pg: p0 * 25n,
      qG: (TOTAL_SUPPLY * 50n) / 76n,
      launchedAt: timestamp,
      launchedAtBlock: log.blockNumber ?? 0n,
    });

    this.knownMarkets.set(market, { token, quoteDecimals: 18 });
    this.tokenToMarket.set(token, market);
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
    const market = this.tokenToMarket.get(log.address.toLowerCase());
    if (market === undefined) return;

    const from = String(a.from).toLowerCase();
    const to = String(a.to).toLowerCase();
    const value = a.value as bigint;
    const blockNumber = log.blockNumber ?? 0n;
    const logIndex = log.logIndex ?? 0;

    // Both sides are recorded. A transfer moves exposure rather than creating it,
    // and the integral needs both boundaries or the seam leaks weight.
    if (from !== ZERO) {
      await insertBalanceEvent(tx, {
        blockNumber,
        logIndex,
        market,
        account: from,
        delta: -value,
        timestamp,
      });
    }
    if (to !== ZERO) {
      await insertBalanceEvent(tx, {
        blockNumber,
        logIndex: logIndex + 1_000_000, // keep the pair distinct under the PK
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
