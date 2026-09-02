/**
 * SENT — Stockback time-weighted holder accounting (TWAB).
 *
 * LOCKED (§287, §288, §289, §290, §322-§328):
 *
 *   - reward weight = amount held x time held, NOT a snapshot balance;
 *   - 24h epochs on a shared 00:00 UTC boundary (§329);
 *   - no staking, no lockup — holding is the only requirement (§290);
 *   - every positive balance is eligible except explicitly excluded system
 *     addresses (§322, §323);
 *   - DEX pool weight is exactly zero (§324);
 *   - the creator is neither privileged nor excluded — TOKEN they buy on the
 *     open market earns exactly like anyone else's (§325);
 *   - rounding dust rolls into the next epoch of the same market (§327);
 *   - a zero-eligible-weight epoch carries its pool forward, never to
 *     creator/platform, and never divides by zero (§328).
 *
 * This is the canonical off-chain reward math (§1064). The on-chain vault
 * verifies an attested commitment over the dataset this produces (§404); it does
 * not recompute the integral.
 *
 * CANONICAL AUTHORITY BOUNDARY (§138): what this module computes is a DERIVED
 * projection of chain events. It becomes an entitlement only once a threshold
 * quorum attests to it and HolderRewardVault accepts the commitment. Nothing
 * here is money until then.
 */

export const EPOCH_DURATION_SECONDS = 86_400n;

/** Epoch identity: floor(timestamp / 1 day), global 00:00 UTC boundary (§329). */
export function epochIdAt(timestampSeconds: bigint): bigint {
  if (timestampSeconds < 0n) throw new RangeError("epochIdAt: negative timestamp");
  return timestampSeconds / EPOCH_DURATION_SECONDS;
}

export function epochStart(epochId: bigint): bigint {
  return epochId * EPOCH_DURATION_SECONDS;
}

export function epochEnd(epochId: bigint): bigint {
  return (epochId + 1n) * EPOCH_DURATION_SECONDS;
}

/** A balance change observed from canonical chain events. */
export interface BalanceEvent {
  readonly account: string;
  /** Signed delta in token wei. */
  readonly delta: bigint;
  readonly timestamp: bigint;
}

/**
 * Addresses that must never earn Stockback (§323, §324).
 *
 * Pool liquidity and protocol custody must not compete with real holders.
 * The factory registers or deterministically exposes these; the engine treats
 * the set as authoritative input, never as something to infer.
 */
export interface ExclusionSet {
  has(account: string): boolean;
}

export function makeExclusionSet(accounts: Iterable<string>): ExclusionSet {
  const set = new Set<string>();
  for (const a of accounts) set.add(a.toLowerCase());
  // Always excluded regardless of registration (§323).
  set.add("0x0000000000000000000000000000000000000000");
  set.add("0x000000000000000000000000000000000000dead");
  return { has: (a: string) => set.has(a.toLowerCase()) };
}

export interface EpochWeights {
  readonly epochId: bigint;
  /** account -> Σ(balance × seconds held) within the epoch, token-wei-seconds. */
  readonly weights: ReadonlyMap<string, bigint>;
  readonly totalWeight: bigint;
  /** Closing balances, carried into the next epoch as opening state. */
  readonly closingBalances: ReadonlyMap<string, bigint>;
}

/**
 * Integrate balances over one epoch.
 *
 * The integral is exact: each account's balance is piecewise-constant between
 * its own events, so Σ(balance × duration) is computed from segment boundaries
 * with no approximation and no sampling. This is what makes snapshot farming
 * (§289) structurally impossible rather than merely discouraged — a balance held
 * for one second earns one second of weight.
 *
 * `openingBalances` must be the previous epoch's closing balances.
 * `events` may arrive unordered; they are sorted here.
 */
export function computeEpochWeights(
  epochId: bigint,
  openingBalances: ReadonlyMap<string, bigint>,
  events: readonly BalanceEvent[],
  exclusions: ExclusionSet,
): EpochWeights {
  const start = epochStart(epochId);
  const end = epochEnd(epochId);

  const balances = new Map<string, bigint>();
  for (const [account, balance] of openingBalances) {
    if (balance > 0n) balances.set(account.toLowerCase(), balance);
  }

  const weights = new Map<string, bigint>();
  /** Last time each account's weight was accrued up to. */
  const lastAccrual = new Map<string, bigint>();

  const accrue = (account: string, until: bigint): void => {
    const balance = balances.get(account) ?? 0n;
    const from = lastAccrual.get(account) ?? start;
    if (until > from && balance > 0n && !exclusions.has(account)) {
      weights.set(account, (weights.get(account) ?? 0n) + balance * (until - from));
    }
    lastAccrual.set(account, until);
  };

  const inEpoch = events
    .filter((e) => e.timestamp >= start && e.timestamp < end)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  for (const event of inEpoch) {
    const account = event.account.toLowerCase();
    accrue(account, event.timestamp);

    const next = (balances.get(account) ?? 0n) + event.delta;
    if (next < 0n) {
      throw new Error(`computeEpochWeights: negative balance for ${account} — event stream is corrupt`);
    }
    if (next === 0n) balances.delete(account);
    else balances.set(account, next);
  }

  // Close out every account that still holds a balance at the epoch boundary.
  for (const account of balances.keys()) accrue(account, end);

  let totalWeight = 0n;
  for (const w of weights.values()) totalWeight += w;

  return { epochId, weights, totalWeight, closingBalances: balances };
}

export interface EpochDistribution {
  readonly epochId: bigint;
  /** Funds available: this epoch's contributions plus any carried dust/pool. */
  readonly pool: bigint;
  /** account -> reward for this epoch, in reward-asset (paired xStock) wei. */
  readonly rewards: ReadonlyMap<string, bigint>;
  /** Total actually allocated. Always <= pool (conservation). */
  readonly allocated: bigint;
  /** pool - allocated. Rolls into the next epoch of the same market (§327). */
  readonly carryForward: bigint;
  /** True when totalWeight was zero and the whole pool carried (§328). */
  readonly carriedWholePool: boolean;
}

/**
 * Allocate an epoch's Stockback pool by time-weighted share.
 *
 *   userReward = floor(pool * userWeight / totalWeight)
 *
 * Flooring every share guarantees Σ rewards <= pool — the conservation property
 * the vault's solvency invariant depends on (§359, §363, §364). The unallocated
 * remainder is dust and rolls forward; it is never assigned to creator, platform
 * or admin (§327).
 */
export function distributeEpoch(
  epochId: bigint,
  pool: bigint,
  weights: EpochWeights,
): EpochDistribution {
  if (pool < 0n) throw new RangeError("distributeEpoch: negative pool");

  // §328 — zero eligible weight: carry the whole pool, never divide by zero,
  // never divert to creator or platform.
  if (weights.totalWeight === 0n) {
    return {
      epochId,
      pool,
      rewards: new Map(),
      allocated: 0n,
      carryForward: pool,
      carriedWholePool: true,
    };
  }

  const rewards = new Map<string, bigint>();
  let allocated = 0n;

  for (const [account, weight] of weights.weights) {
    if (weight === 0n) continue;
    const reward = (pool * weight) / weights.totalWeight; // floor
    if (reward > 0n) {
      rewards.set(account, reward);
      allocated += reward;
    }
  }

  return {
    epochId,
    pool,
    rewards,
    allocated,
    carryForward: pool - allocated,
    carriedWholePool: false,
  };
}

/**
 * Cumulative entitlement across epochs — the shape the on-chain vault verifies.
 *
 * §407 requires a CUMULATIVE Merkle distribution rather than per-epoch roots, so
 * a holder's claim is one proof against the latest root regardless of how many
 * epochs they have accrued across, and a claim records what has already been
 * paid rather than replaying each epoch.
 */
export class CumulativeLedger {
  private readonly totals = new Map<string, bigint>();
  private funded = 0n;
  private claimed = 0n;

  /** Record Stockback contributions arriving from trades (§318, §320). */
  fund(amount: bigint): void {
    if (amount < 0n) throw new RangeError("fund: negative amount");
    this.funded += amount;
  }

  /** Fold one epoch's allocation into cumulative entitlements. */
  applyEpoch(distribution: EpochDistribution): void {
    for (const [account, reward] of distribution.rewards) {
      this.totals.set(account, (this.totals.get(account) ?? 0n) + reward);
    }
  }

  cumulativeFor(account: string): bigint {
    return this.totals.get(account.toLowerCase()) ?? this.totals.get(account) ?? 0n;
  }

  /** Total entitlement committed across all holders. */
  get totalEntitlement(): bigint {
    let sum = 0n;
    for (const v of this.totals.values()) sum += v;
    return sum;
  }

  get totalFunded(): bigint {
    return this.funded;
  }

  get totalClaimed(): bigint {
    return this.claimed;
  }

  /**
   * Claim against a cumulative entitlement: the payout is the difference between
   * the cumulative total and what has already been claimed, so a replayed or
   * stale proof pays zero rather than paying twice (§336, §337).
   */
  claim(account: string, alreadyClaimed: bigint): bigint {
    const cumulative = this.cumulativeFor(account);
    if (alreadyClaimed > cumulative) {
      throw new Error("claim: claimed exceeds cumulative entitlement — accounting is corrupt");
    }
    const payout = cumulative - alreadyClaimed;
    this.claimed += payout;
    return payout;
  }

  /**
   * THE conservation invariant (§359, §364): committed entitlement may never
   * exceed the funds actually contributed. Finalization cannot mint entitlement
   * beyond funding.
   */
  assertSolvent(): void {
    const entitlement = this.totalEntitlement;
    if (entitlement > this.funded) {
      throw new Error(
        `Stockback conservation violated: entitlement ${entitlement} exceeds funding ${this.funded}`,
      );
    }
    if (this.claimed > entitlement) {
      throw new Error(
        `Stockback claim violation: claimed ${this.claimed} exceeds entitlement ${entitlement}`,
      );
    }
  }
}
