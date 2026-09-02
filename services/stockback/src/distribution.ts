/**
 * SENT — Stockback distribution pipeline.
 *
 * The link between the TWAB engine and the vault:
 *
 *   canonical chain events
 *     -> time-weighted balances per epoch
 *     -> cumulative entitlements
 *     -> Merkle tree + dataset hash
 *     -> commitment for attestors to sign
 *
 * DETERMINISM IS THE WHOLE REQUIREMENT (§404, §406)
 * --------------------------------------------------
 * §406 requires independently deployed indexer instances. Those instances receive
 * logs in whatever order their provider returns, run on different machines, and
 * never coordinate. If any of that could change the root by one bit, the quorum
 * would never form and Stockback would silently stop paying.
 *
 * So every step here is a pure function of the event set: inputs are sorted,
 * exclusions are applied from a registered list rather than inferred, and nothing
 * reads a clock or a random source. `sim/determinism.ts` proves it by running the
 * same events through shuffled, split and re-ordered pipelines and requiring
 * byte-identical output.
 *
 * CONSERVATION IS ENFORCED HERE, NOT DISCOVERED LATER (§364)
 * ----------------------------------------------------------
 * The vault rejects a commitment whose total exceeds funding. This pipeline must
 * never produce one in the first place: a rejected commitment is an outage, and
 * an outage in reward distribution looks exactly like theft to a holder.
 */

import {
  EPOCH_DURATION_SECONDS,
  computeEpochWeights,
  distributeEpoch,
  makeExclusionSet,
  type BalanceEvent,
  type ExclusionSet,
} from "@sent/stockback";
import {
  buildDistributionTree,
  getProof,
  type DistributionTree,
  type Entitlement,
} from "@sent/stockback/merkle";

export interface EpochInput {
  readonly epochId: bigint;
  /** Every balance change in this epoch, in any order. */
  readonly events: readonly BalanceEvent[];
  /** Stockback contributions received during this epoch, in reward-asset wei. */
  readonly contributions: bigint;
}

export interface PipelineInput {
  readonly market: `0x${string}`;
  readonly token: `0x${string}`;
  readonly rewardAsset: `0x${string}`;
  readonly distributionVersion: bigint;
  /** Addresses that must never earn (§323, §324). Registered, never inferred. */
  readonly excludedAccounts: readonly string[];
  readonly epochs: readonly EpochInput[];
  /** Total the vault has actually been funded. The conservation ceiling (§364). */
  readonly totalFunded: bigint;
}

export interface Commitment {
  readonly market: `0x${string}`;
  readonly token: `0x${string}`;
  readonly rewardAsset: `0x${string}`;
  readonly distributionVersion: bigint;
  readonly epochSequence: bigint;
  readonly totalCumulative: bigint;
  readonly merkleRoot: `0x${string}`;
  readonly datasetHash: `0x${string}`;
}

export interface PipelineResult {
  readonly commitment: Commitment;
  readonly tree: DistributionTree;
  /** Per-epoch allocation, for the transparency dataset §367 requires. */
  readonly epochAllocations: readonly EpochAllocation[];
  /** Dust rolled forward, never assigned to creator or platform (§327). */
  readonly carryForward: bigint;
}

export interface EpochAllocation {
  readonly epochId: bigint;
  readonly pool: bigint;
  readonly allocated: bigint;
  readonly carryForward: bigint;
  readonly eligibleHolders: number;
  readonly totalWeight: bigint;
}

/**
 * Run the full pipeline.
 *
 * Epochs are processed in ascending order regardless of input order, and each
 * epoch's opening balances come from the previous epoch's close — so a holder who
 * never trades still accrues, which is the whole point of rewarding time held.
 */
export function computeDistribution(input: PipelineInput): PipelineResult {
  const exclusions: ExclusionSet = makeExclusionSet(input.excludedAccounts);

  const epochs = [...input.epochs].sort((a, b) =>
    a.epochId < b.epochId ? -1 : a.epochId > b.epochId ? 1 : 0,
  );

  if (epochs.length === 0) {
    throw new Error("computeDistribution: refusing to build a commitment from no epochs");
  }

  for (let i = 1; i < epochs.length; i++) {
    if (epochs[i]!.epochId === epochs[i - 1]!.epochId) {
      throw new Error(`computeDistribution: duplicate epoch ${epochs[i]!.epochId}`);
    }
  }

  const cumulative = new Map<string, bigint>();
  const allocations: EpochAllocation[] = [];

  let openingBalances = new Map<string, bigint>();
  let carry = 0n;
  let totalAllocated = 0n;

  for (const epoch of epochs) {
    const weights = computeEpochWeights(epoch.epochId, openingBalances, epoch.events, exclusions);

    // Dust from previous epochs joins this pool (§327). It is holder money and
    // stays holder money.
    const pool = epoch.contributions + carry;
    const dist = distributeEpoch(epoch.epochId, pool, weights);

    for (const [account, reward] of dist.rewards) {
      cumulative.set(account, (cumulative.get(account) ?? 0n) + reward);
    }

    totalAllocated += dist.allocated;
    carry = dist.carryForward;
    openingBalances = new Map(weights.closingBalances);

    let eligible = 0;
    for (const w of weights.weights.values()) if (w > 0n) eligible += 1;

    allocations.push({
      epochId: epoch.epochId,
      pool,
      allocated: dist.allocated,
      carryForward: dist.carryForward,
      eligibleHolders: eligible,
      totalWeight: weights.totalWeight,
    });
  }

  // §364. The vault would reject this, but a rejected commitment is an outage,
  // and an outage in reward distribution looks like theft from the outside. Catch
  // it here, where it is a bug report rather than an incident.
  if (totalAllocated > input.totalFunded) {
    throw new Error(
      `computeDistribution: entitlement ${totalAllocated} exceeds funding ${input.totalFunded}`,
    );
  }

  const entries: Entitlement[] = [...cumulative.entries()]
    .filter(([, amount]) => amount > 0n)
    .map(([account, amount]) => ({
      account: account as `0x${string}`,
      cumulative: amount,
    }));

  if (entries.length === 0) {
    throw new Error(
      "computeDistribution: no holder earned anything; there is nothing to commit " +
        "and the pool must carry forward instead (§328)",
    );
  }

  const tree = buildDistributionTree(entries);

  return {
    commitment: {
      market: input.market,
      token: input.token,
      rewardAsset: input.rewardAsset,
      distributionVersion: input.distributionVersion,
      // The sequence is the highest epoch included, so a later commitment always
      // carries a strictly greater value and the vault's monotonicity check has
      // something meaningful to compare (§365).
      epochSequence: epochs[epochs.length - 1]!.epochId,
      totalCumulative: tree.totalCumulative,
      merkleRoot: tree.root,
      datasetHash: tree.datasetHash,
    },
    tree,
    epochAllocations: allocations,
    carryForward: carry,
  };
}

/** Proof for one holder, for the claim API (§368). */
export function proofFor(result: PipelineResult, account: `0x${string}`) {
  const entry = result.tree.entries.find(
    (e) => e.account.toLowerCase() === account.toLowerCase(),
  );
  if (entry === undefined) return null;

  return {
    account: entry.account,
    cumulative: entry.cumulative,
    proof: getProof(result.tree, account),
    merkleRoot: result.tree.root,
  };
}

/**
 * Bucket raw events into epochs.
 *
 * Convenience for the indexer, but with a real rule: an event at exactly an epoch
 * boundary belongs to the epoch it STARTS, never to both. Counting it twice would
 * pay the same exposure in two epochs.
 */
export function bucketByEpoch(
  events: readonly BalanceEvent[],
  contributionsByEpoch: ReadonlyMap<bigint, bigint>,
): EpochInput[] {
  const buckets = new Map<bigint, BalanceEvent[]>();

  for (const event of events) {
    const epochId = event.timestamp / EPOCH_DURATION_SECONDS;
    const bucket = buckets.get(epochId);
    if (bucket === undefined) buckets.set(epochId, [event]);
    else bucket.push(event);
  }

  for (const epochId of contributionsByEpoch.keys()) {
    if (!buckets.has(epochId)) buckets.set(epochId, []);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([epochId, epochEvents]) => ({
      epochId,
      events: epochEvents,
      contributions: contributionsByEpoch.get(epochId) ?? 0n,
    }));
}
