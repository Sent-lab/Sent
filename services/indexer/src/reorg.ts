/**
 * SENT — reorg-safe chain tracking.
 *
 * §138 makes this database a projection of the chain, and §178.7 makes reorg
 * handling a release gate. A reorg bug does not announce itself: the projection
 * keeps serving numbers, they are simply wrong, and the divergence compounds
 * until someone reconciles against the chain by hand.
 *
 * So the decision logic lives here as a pure state machine over block headers,
 * with no RPC and no database. It can be driven through reorg shapes that are
 * hard to produce against a live chain and impossible to produce on demand.
 *
 * THE RULE THAT MATTERS
 * --------------------
 * Continuity is decided by PARENT HASH, never by block number. A chain can
 * replace a block at the same height, and a height comparison sees nothing at
 * all. `parentHash === head.hash` is the only question worth asking.
 */

export interface BlockRef {
  readonly number: bigint;
  readonly hash: string;
  readonly parentHash: string;
}

export type IngestDecision =
  /** Extends the chain we have. Process its logs. */
  | { readonly action: "append"; readonly block: BlockRef }
  /**
   * The chain moved. Every derived row above `rollbackTo` must be deleted before
   * anything new is written — §138's "rebuildable projection" is only true if
   * rollback actually happens.
   */
  | { readonly action: "reorg"; readonly rollbackTo: bigint; readonly block: BlockRef }
  /** Already processed, byte for byte. Idempotent replay, safe to skip. */
  | { readonly action: "duplicate"; readonly block: BlockRef }
  /** Blocks are missing between the head and this one. Fetch them first. */
  | { readonly action: "gap"; readonly from: bigint; readonly to: bigint }
  /**
   * A reorg deeper than the retained window. The tracker cannot locate a common
   * ancestor from memory, so it refuses to guess.
   *
   * §279 forbids a placeholder in production, and a silently-assumed ancestor is
   * exactly that: it would produce a projection that looks healthy and is wrong.
   * A full reindex is correct and cheap; a wrong projection is neither.
   */
  | { readonly action: "reindex_required"; readonly reason: string };

/**
 * Tracks recent headers so a fork can be located without re-querying the chain.
 *
 * `depth` must exceed the deepest reorg the chain can produce. It is deliberately
 * a constructor argument and not a constant: HyperEVM's finality behaviour is
 * still an open VERIFY item (V-01, V-15), and hardcoding a number would be
 * asserting something nobody has measured.
 */
export class ChainTracker {
  private readonly window: BlockRef[] = [];
  private readonly depth: number;

  // Written out rather than declared as a parameter property: Node's
  // type-stripping loader cannot handle those, since they require emitting code
  // rather than removing types.
  constructor(depth: number = 128) {
    if (depth < 1) throw new RangeError("ChainTracker: depth must be at least 1");
    this.depth = depth;
  }

  get head(): BlockRef | undefined {
    return this.window[this.window.length - 1];
  }

  get size(): number {
    return this.window.length;
  }

  /** Lowest block still retained. Below this a reorg cannot be resolved locally. */
  get earliestRetained(): bigint | undefined {
    return this.window[0]?.number;
  }

  /**
   * Decide what a newly observed header means. Pure: it mutates nothing.
   * `commit` applies the decision once the caller has acted on it.
   */
  inspect(block: BlockRef): IngestDecision {
    const head = this.head;

    // Cold start. Nothing to compare against, so accept and anchor here.
    if (head === undefined) return { action: "append", block };

    // The ordinary case: this block's parent is our head.
    if (block.parentHash === head.hash && block.number === head.number + 1n) {
      return { action: "append", block };
    }

    // Ahead of the head with blocks missing in between.
    if (block.number > head.number + 1n) {
      return { action: "gap", from: head.number + 1n, to: block.number - 1n };
    }

    // At or below the head. Either a replay or a reorg.
    const known = this.window.find((b) => b.number === block.number);

    if (known !== undefined && known.hash === block.hash) {
      // Identical block already processed. Replay must be a no-op, which is what
      // makes crash recovery safe: the indexer can always re-run its last batch.
      return { action: "duplicate", block };
    }

    // Same height, different hash — or a parent that does not match. Either way
    // the chain has changed shape and we must find where it diverged.
    return this.locateFork(block);
  }

  /**
   * Walk back to the last block both chains agree on.
   *
   * The fork point is the highest retained block whose hash still appears in the
   * new chain's ancestry. We can only check the immediate parent from a single
   * header, so this resolves what it can and otherwise reports how far to roll
   * back conservatively.
   */
  private locateFork(block: BlockRef): IngestDecision {
    const earliest = this.earliestRetained;

    if (earliest === undefined || block.number <= earliest) {
      return {
        action: "reindex_required",
        reason:
          `reorg at block ${block.number} is at or below the retained window ` +
          `(earliest ${earliest ?? "none"}); a common ancestor cannot be located locally`,
      };
    }

    // Does our copy of the parent height match this block's parent hash?
    const parentHeight = block.number - 1n;
    const ourParent = this.window.find((b) => b.number === parentHeight);

    if (ourParent !== undefined && ourParent.hash === block.parentHash) {
      // The fork is exactly here: everything from `block.number` up is stale.
      return { action: "reorg", rollbackTo: parentHeight, block };
    }

    // The divergence is deeper than one block. Roll back to the earliest header
    // we can still vouch for and replay forward from there.
    //
    // Rolling back further than strictly necessary costs a re-scan. Rolling back
    // too little leaves stale rows behind forever. The asymmetry decides it.
    if (ourParent === undefined) {
      return {
        action: "reindex_required",
        reason: `no retained header at ${parentHeight}; cannot bound the fork`,
      };
    }

    return { action: "reorg", rollbackTo: earliest, block };
  }

  /** Apply an accepted block to the tracked window. */
  commit(block: BlockRef): void {
    const existingIndex = this.window.findIndex((b) => b.number >= block.number);

    if (existingIndex !== -1) {
      // A reorg replaces this height and everything above it.
      this.window.splice(existingIndex);
    }

    this.window.push(block);

    while (this.window.length > this.depth) this.window.shift();
  }

  /** Drop every retained header above `blockNumber`, mirroring a DB rollback. */
  rollbackTo(blockNumber: bigint): void {
    const index = this.window.findIndex((b) => b.number > blockNumber);
    if (index !== -1) this.window.splice(index);
  }

  /** Discard everything. Used before a full reindex. */
  reset(): void {
    this.window.length = 0;
  }

  /**
   * Blocks deep enough to be treated as settled.
   *
   * Stockback finalization acts on chain state (§335 reorg safety), so it must
   * only ever read below this line. Reading unfinalized state would let a reorg
   * invalidate a distribution that has already been attested.
   */
  finalizedBelow(confirmations: number): bigint | undefined {
    const head = this.head;
    if (head === undefined) return undefined;
    const boundary = head.number - BigInt(confirmations);
    return boundary > 0n ? boundary : undefined;
  }
}
