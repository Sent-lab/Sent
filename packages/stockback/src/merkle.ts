/**
 * SENT — Stockback cumulative Merkle distribution.
 *
 * `HolderRewardVault` verifies claims against a Merkle root but nothing built the
 * trees. This is that half, and its encoding must match the contract EXACTLY —
 * a single byte of disagreement makes every claim in the system fail, and the
 * failure appears at integration time rather than at compile time.
 *
 * ENCODING — must mirror `HolderRewardVault.claim` and OpenZeppelin's
 * `MerkleProof.verify`:
 *
 *   leaf   = keccak256(keccak256(abi.encode(address account, uint256 cumulative)))
 *   node   = keccak256(sorted(left, right))
 *
 * The leaf is DOUBLE-hashed. That is the standard defence against a
 * second-preimage attack: an internal node is 64 bytes of preimage, a leaf is 32,
 * so without the second hash an attacker could present an internal node as if it
 * were a leaf and claim an amount nobody ever committed to.
 *
 * Pairs are sorted before hashing, so a proof carries no left/right flags and the
 * verifier stays cheap.
 *
 * Correctness is not asserted here — it is proven in `contracts/test/Merkle.t.sol`,
 * which builds trees with this code and verifies the proofs on-chain against the
 * real contract.
 */

import { encodeAbiParameters, keccak256, type Hex } from "viem";

export interface Entitlement {
  /** Holder address. Lower-cased on the way in; the encoding is case-blind. */
  readonly account: `0x${string}`;
  /** CUMULATIVE entitlement to date, in reward-asset wei (§407). */
  readonly cumulative: bigint;
}

export interface DistributionTree {
  readonly root: Hex;
  readonly leaves: readonly Hex[];
  readonly entries: readonly Entitlement[];
  /** Sum of every cumulative entitlement. Must never exceed vault funding (§364). */
  readonly totalCumulative: bigint;
  /** Deterministic hash of the input dataset, bound into the attestation (§405). */
  readonly datasetHash: Hex;
}

/** Encode one leaf exactly as `HolderRewardVault.claim` does. */
export function encodeLeaf(account: `0x${string}`, cumulative: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [account, cumulative],
    ),
  );
  return keccak256(inner);
}

/** Hash a pair the way OpenZeppelin's MerkleProof does: sorted, then keccak. */
function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(`0x${lo.slice(2)}${hi.slice(2)}` as Hex);
}

/**
 * Build a cumulative distribution tree.
 *
 * Entries are sorted by account so the tree is a deterministic function of its
 * contents. That determinism is what lets independent attestors compute the same
 * root from the same chain events without coordinating (§404, §406) — a tree that
 * depended on input ordering would produce a different root per indexer and the
 * quorum could never form.
 *
 * Duplicate accounts are rejected rather than merged: a duplicate means the
 * upstream TWAB computation is wrong, and silently summing them would hide it.
 */
export function buildDistributionTree(entries: readonly Entitlement[]): DistributionTree {
  if (entries.length === 0) {
    throw new Error("buildDistributionTree: refusing to build an empty tree");
  }

  const sorted = [...entries].sort((a, b) =>
    a.account.toLowerCase() < b.account.toLowerCase() ? -1
    : a.account.toLowerCase() > b.account.toLowerCase() ? 1
    : 0,
  );

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.account.toLowerCase() === sorted[i - 1]!.account.toLowerCase()) {
      throw new Error(`buildDistributionTree: duplicate account ${sorted[i]!.account}`);
    }
  }

  for (const entry of sorted) {
    if (entry.cumulative < 0n) {
      throw new Error(`buildDistributionTree: negative entitlement for ${entry.account}`);
    }
  }

  const leaves = sorted.map((e) => encodeLeaf(e.account, e.cumulative));

  let totalCumulative = 0n;
  for (const entry of sorted) totalCumulative += entry.cumulative;

  const datasetHash = keccak256(
    encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint256[]" }],
      [sorted.map((e) => e.account), sorted.map((e) => e.cumulative)],
    ),
  );

  return {
    root: computeRoot(leaves),
    leaves,
    entries: sorted,
    totalCumulative,
    datasetHash,
  };
}

/** Fold a level of leaves up to a single root. */
function computeRoot(leaves: readonly Hex[]): Hex {
  if (leaves.length === 0) throw new Error("computeRoot: no leaves");

  let level = [...leaves];

  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      // An odd node is promoted unchanged rather than paired with itself.
      // Duplicating it would make two distinct trees share a root.
      next.push(right === undefined ? left : hashPair(left, right));
    }
    level = next;
  }

  return level[0]!;
}

/**
 * Produce the proof for one account.
 *
 * Returns the sibling hashes from leaf to root, which is exactly what
 * `MerkleProof.verify` consumes.
 */
/**
 * Every proof in the tree, in one pass.
 *
 * `getProof` rebuilds the whole tree from the leaves on each call, and also
 * finds its index by scanning. Calling it once per holder — which is exactly
 * what persisting a distribution does — is therefore quadratic: a market with
 * 2,500 holders took 70 seconds, inside the transaction that writes the
 * dataset.
 *
 * This builds the levels once and walks each leaf's position up through them,
 * which is O(n log n) for the whole set. The proofs are byte-identical to
 * `getProof`'s, and `sim/merkle-fixtures.ts` asserts that rather than assuming
 * it — two implementations of a proof is precisely the shape that must not
 * diverge, since one of them is what the vault verifies against.
 *
 * Keyed by lower-cased account, matching `getProof`'s own comparison.
 */
export function getAllProofs(tree: DistributionTree): Map<string, Hex[]> {
  const levels: Hex[][] = [[...tree.leaves]];

  while ((levels[levels.length - 1] as Hex[]).length > 1) {
    const level = levels[levels.length - 1] as Hex[];
    const next: Hex[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as Hex;
      const right = level[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }

    levels.push(next);
  }

  const proofs = new Map<string, Hex[]>();

  tree.entries.forEach((entry, index) => {
    const proof: Hex[] = [];
    let position = index;

    // The last level is the root, which is never part of a proof.
    for (let depth = 0; depth < levels.length - 1; depth++) {
      const level = levels[depth] as Hex[];
      const siblingIndex = position % 2 === 1 ? position - 1 : position + 1;
      const sibling = level[siblingIndex];

      // A promoted odd node has no sibling and contributes nothing, exactly as
      // in `getProof`.
      if (sibling !== undefined) proof.push(sibling);

      position = Math.floor(position / 2);
    }

    proofs.set(entry.account.toLowerCase(), proof);
  });

  return proofs;
}

export function getProof(tree: DistributionTree, account: `0x${string}`): Hex[] {
  const index = tree.entries.findIndex(
    (e) => e.account.toLowerCase() === account.toLowerCase(),
  );
  if (index === -1) throw new Error(`getProof: ${account} is not in this distribution`);

  const proof: Hex[] = [];
  let level = [...tree.leaves];
  let position = index;

  while (level.length > 1) {
    const isRight = position % 2 === 1;
    const siblingIndex = isRight ? position - 1 : position + 1;
    const sibling = level[siblingIndex];

    // A promoted odd node has no sibling and contributes nothing to the proof.
    if (sibling !== undefined) proof.push(sibling);

    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }

    level = next;
    position = Math.floor(position / 2);
  }

  return proof;
}

/** Verify a proof locally, mirroring `MerkleProof.verify`. */
export function verifyProof(root: Hex, leaf: Hex, proof: readonly Hex[]): boolean {
  let computed = leaf;
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed.toLowerCase() === root.toLowerCase();
}
