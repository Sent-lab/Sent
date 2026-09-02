/**
 * SENT — Stockback finalizer.
 *
 * Turns indexed chain events into an attestable commitment, on the §404 path:
 *
 *   canonical chain events
 *     → deterministic TWAB over closed epochs
 *     → cumulative Merkle commitment + dataset hash
 *     → threshold attestor signatures
 *     → permissionless on-chain submission
 *
 * WHAT THIS SERVICE DOES NOT DO
 * -----------------------------
 * It does not sign, and it does not write to the commitment tables. §594 says
 * attestors never custody funds and §597 separates submission from attestation,
 * so signing keys live with the attestors — each running their own indexer
 * instance (§406). This service only *computes* what they will independently
 * arrive at, and stores it as a proposal.
 *
 * That separation is the entire security model. A finalizer that could both
 * compute and sign would be one party deciding who gets paid, and the quorum
 * would be decoration.
 *
 * IT RUNS OVER THE WHOLE HISTORY, EVERY TIME
 * ------------------------------------------
 * Entitlements are CUMULATIVE (§365): the vault pays `cumulative − claimed`, and
 * each root must be a superset of the last. Computing only the epochs since the
 * previous commitment would restart every holder's cumulative at zero, produce a
 * root that moves BACKWARDS, and either be rejected by the vault's monotonicity
 * check or — worse, if it were not — underpay everyone who had already claimed.
 *
 * So the input is always epoch zero through the settlement boundary. That is
 * more work than an increment, and it is not negotiable.
 *
 * IT ONLY READS SETTLED STATE (§335)
 * ----------------------------------
 * The cut-off is the timestamp of the highest FINALIZED block — not the head,
 * not the wall clock. A reorg beneath a signed distribution cannot be undone:
 * signatures cannot be recalled, and a proof that was valid becomes a proof
 * against a root the chain never had.
 */

import {
  Database,
  listBalanceEvents,
  listFundingByEpoch,
  getTotalFundedThrough,
  getExclusions,
  getLatestDataset,
  listFundedMarkets,
  finalizedHead,
  recordDataset,
  type Db,
} from "@sent/database";
import { EPOCH_DURATION_SECONDS, type BalanceEvent } from "@sent/stockback";
import { getProof } from "@sent/stockback/merkle";
import {
  computeDistribution,
  bucketByEpoch,
  type PipelineResult,
} from "@sent/stockback-service";

export interface FinalizerConfig {
  /**
   * Extra margin beyond block finality, in seconds.
   *
   * Belt and braces on top of the finalized-block cut-off: a run starting the
   * instant an epoch closes races the indexer's own last write into that epoch.
   */
  readonly settlementMarginSeconds: number;
  readonly runIntervalMs: number;
}

export const DEFAULT_FINALIZER_CONFIG: FinalizerConfig = {
  settlementMarginSeconds: 900,
  runIntervalMs: 60_000,
};

export interface MarketToFinalize {
  readonly market: `0x${string}`;
  readonly token: `0x${string}`;
  /** Stockback pays in the market's quote asset — the xStock itself (§318). */
  readonly rewardAsset: `0x${string}`;
}

export interface FinalizationOutput {
  readonly market: `0x${string}`;
  readonly result: PipelineResult;
  readonly totalFunded: bigint;
  /** Highest settled block the inputs were read through. */
  readonly throughBlock: bigint;
  readonly throughTimestamp: number;
}

/** Why a market produced nothing this run. Never an error — usually just quiet. */
export type SkipReason =
  | "NO_CLOSED_EPOCH"
  | "NO_BALANCE_EVENTS"
  | "NO_NEW_EPOCHS"
  | "NOT_DISTRIBUTABLE";

export interface FinalizationInput {
  readonly target: MarketToFinalize;
  /** Last epoch fully covered by settled chain state. */
  readonly through: bigint;
  /** Every balance change from the market's first block, in any order. */
  readonly events: readonly BalanceEvent[];
  readonly funding: ReadonlyMap<bigint, bigint>;
  readonly totalFunded: bigint;
  readonly excludedAccounts: readonly string[];
  /** Highest epoch already committed, or null if this is the first. */
  readonly lastCommittedEpoch: bigint | null;
}

/**
 * Decide and compute — no I/O, no clock, no chain.
 *
 * Every rule that governs what gets committed lives here, so the rules can be
 * exercised directly. `sim/finalizer.ts` uses that to prove the property this
 * service exists to protect: successive commitments must be non-decreasing per
 * holder, which is only true because the input starts at epoch zero.
 */
export function computeFinalization(
  input: FinalizationInput,
): { result: PipelineResult; totalFunded: bigint } | SkipReason {
  if (input.through < 0n) return "NO_CLOSED_EPOCH";
  if (input.lastCommittedEpoch !== null && input.lastCommittedEpoch >= input.through) {
    return "NO_NEW_EPOCHS";
  }
  if (input.events.length === 0) return "NO_BALANCE_EVENTS";

  // Bucketed by the shared helper (§1064). Re-implementing the boundary rule
  // here is exactly how two honest nodes reach different roots and the quorum
  // silently never forms.
  const epochs = bucketByEpoch(input.events, input.funding).filter(
    (e) => e.epochId <= input.through,
  );
  if (epochs.length === 0) return "NO_CLOSED_EPOCH";

  let result: PipelineResult;
  try {
    result = computeDistribution({
      market: input.target.market,
      token: input.target.token,
      rewardAsset: input.target.rewardAsset,
      distributionVersion: 1n,
      excludedAccounts: input.excludedAccounts,
      epochs,
      totalFunded: input.totalFunded,
    });
  } catch (error) {
    // The pipeline refuses degenerate input: nothing funded yet, every holder
    // excluded, an over-commitment. For a quiet market those are states rather
    // than failures, and the run must carry on to the next market.
    console.info(
      `[finalizer] ${input.target.market}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "NOT_DISTRIBUTABLE";
  }

  // The sequence comes from the epochs actually present, which can be lower than
  // `through` if the market went quiet. Re-checking here catches that case; the
  // check above could not, because it did not yet know the epoch set.
  if (
    input.lastCommittedEpoch !== null &&
    result.commitment.epochSequence <= input.lastCommittedEpoch
  ) {
    return "NO_NEW_EPOCHS";
  }

  return { result, totalFunded: input.totalFunded };
}

export class Finalizer {
  private readonly db: Database;
  private readonly config: FinalizerConfig;
  private running = false;

  constructor(db: Database, config: FinalizerConfig = DEFAULT_FINALIZER_CONFIG) {
    this.db = db;
    this.config = config;
  }

  /**
   * The last epoch fully covered by settled chain state.
   *
   * `-1n` when nothing has settled far enough. The subtraction is what makes it
   * *fully* covered: an epoch containing the cut-off is still open as far as this
   * node knows, and half an epoch of balances is not a distribution.
   */
  finalizableThrough(settledTimestamp: number): bigint {
    const cutoff = settledTimestamp - this.config.settlementMarginSeconds;
    if (cutoff <= 0) return -1n;
    return BigInt(Math.floor(cutoff / Number(EPOCH_DURATION_SECONDS))) - 1n;
  }

  /**
   * Compute a market's commitment over every settled epoch.
   *
   * Loads, then delegates to `computeFinalization`. The split is the same one the
   * API and the realtime gateway use: every decision lives in a pure function, so
   * the rules can be tested without a database standing in the way.
   */
  async finalizeMarket(
    target: MarketToFinalize,
    settled: { number: bigint; timestamp: number },
  ): Promise<FinalizationOutput | SkipReason> {
    const through = this.finalizableThrough(settled.timestamp);
    if (through < 0n) return "NO_CLOSED_EPOCH";

    // Exclusive upper bound: the first instant of the epoch AFTER the last one
    // included. An event exactly on the boundary belongs to the epoch it starts,
    // which is the same rule `bucketByEpoch` applies.
    const toTs = Number((through + 1n) * EPOCH_DURATION_SECONDS);

    const latest = await getLatestDataset(this.db, target.market);
    if (latest !== null && latest.epochSequence >= through) return "NO_NEW_EPOCHS";

    // From zero. See the header: cumulative entitlements cannot be incremented.
    const rows = await listBalanceEvents(this.db, target.market, 0, toTs);

    const events: BalanceEvent[] = rows.map((r) => ({
      account: r.account,
      delta: r.delta,
      timestamp: r.timestamp,
    }));

    const outcome = computeFinalization({
      target,
      through,
      events,
      funding: await listFundingByEpoch(this.db, target.market, toTs, EPOCH_DURATION_SECONDS),
      totalFunded: await getTotalFundedThrough(this.db, target.market, toTs),
      excludedAccounts: await getExclusions(this.db, target.market),
      lastCommittedEpoch: latest?.epochSequence ?? null,
    });

    if (typeof outcome === "string") return outcome;

    return {
      market: target.market,
      result: outcome.result,
      totalFunded: outcome.totalFunded,
      throughBlock: settled.number,
      throughTimestamp: settled.timestamp,
    };
  }

  /**
   * Persist a computed dataset with every holder's proof.
   *
   * Written before anything is signed. §367's transparency requirement only
   * means something if the data an attestor is asked to endorse is public while
   * they are still deciding.
   */
  async persist(db: Db, output: FinalizationOutput): Promise<void> {
    const { result } = output;

    await recordDataset(db, {
      market: output.market,
      epochSequence: result.commitment.epochSequence,
      merkleRoot: result.commitment.merkleRoot,
      datasetHash: result.commitment.datasetHash,
      totalCumulative: result.commitment.totalCumulative,
      carryForward: result.carryForward,
      totalFunded: output.totalFunded,
      computedThroughBlock: output.throughBlock,
      computedAt: output.throughTimestamp,
      entitlements: result.tree.entries.map((entry) => ({
        account: entry.account,
        cumulative: entry.cumulative,
        // Built once, here, against the root being stored alongside it. A proof
        // recomputed later against a newer tree would not verify against this
        // root, and this root is the one an attestor signed.
        proof: getProof(result.tree, entry.account),
      })),
      allocations: result.epochAllocations.map((a) => ({
        epochId: a.epochId,
        pool: a.pool,
        allocated: a.allocated,
        carryForward: a.carryForward,
        eligibleHolders: a.eligibleHolders,
        totalWeight: a.totalWeight,
      })),
    });
  }

  /** One pass over every funded market. Returns how many datasets were written. */
  async runOnce(): Promise<number> {
    const settled = await finalizedHead(this.db);
    if (settled === null) return 0;

    let written = 0;

    for (const target of await listFundedMarkets(this.db)) {
      const outcome = await this.finalizeMarket(
        { market: target.market, token: target.token, rewardAsset: target.quoteAsset },
        settled,
      );

      if (typeof outcome === "string") continue;

      await this.db.transaction((tx) => this.persist(tx, outcome));
      written += 1;

      console.info(
        `[finalizer] ${target.market} epoch ${outcome.result.commitment.epochSequence}: ` +
          `${outcome.result.tree.entries.length} holders, ` +
          `${outcome.result.commitment.totalCumulative} of ${outcome.totalFunded} funded, ` +
          `root ${outcome.result.commitment.merkleRoot}`,
      );
    }

    return written;
  }

  async start(): Promise<void> {
    this.running = true;

    while (this.running) {
      try {
        await this.runOnce();
      } catch (error) {
        // One bad market must not take the loop down. The next pass rebuilds
        // from chain state, which is the only state that matters.
        console.error("[finalizer] run failed:", error instanceof Error ? error.message : error);
      }

      await new Promise((resolve) => setTimeout(resolve, this.config.runIntervalMs));
    }
  }

  stop(): void {
    this.running = false;
  }
}
