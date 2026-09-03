/**
 * SENT — Merkle cross-boundary fixtures.
 *
 * The off-chain half builds the tree; the on-chain half verifies the proof. If
 * their encodings disagree by one byte, every Stockback claim in the system
 * fails — and it fails at integration time, long after both halves have passed
 * their own tests.
 *
 * So the trees are built here, by the real production code, and
 * `contracts/test/Merkle.t.sol` performs actual claims against the real
 * `HolderRewardVault` using these proofs. Nothing is re-implemented on either
 * side for the purpose of testing.
 *
 * Run: pnpm fixtures:merkle
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildDistributionTree,
  getProof,
  getAllProofs,
  verifyProof,
  encodeLeaf,
  type Entitlement,
} from "../src/merkle.ts";

const OUT = "contracts/test/fixtures/merkle.json";

/** Deterministic pseudo-random addresses, so fixtures are reproducible. */
function addressAt(index: number): `0x${string}` {
  const hex = (index + 1).toString(16).padStart(40, "7");
  return `0x${hex.slice(-40)}` as `0x${string}`;
}

interface Scenario {
  readonly name: string;
  readonly entries: Entitlement[];
}

const scenarios: Scenario[] = [
  {
    // The degenerate case. A single holder means the root IS the leaf, with no
    // pairing at all — an off-by-one in the folding loop shows up here first.
    name: "single holder",
    entries: [{ account: addressAt(0), cumulative: 1_000n * 10n ** 18n }],
  },
  {
    name: "two holders",
    entries: [
      { account: addressAt(0), cumulative: 600n * 10n ** 18n },
      { account: addressAt(1), cumulative: 400n * 10n ** 18n },
    ],
  },
  {
    // An odd count forces a node to be promoted unpaired at some level, which is
    // where naive implementations duplicate the node and corrupt the root.
    name: "three holders (odd, forces promotion)",
    entries: [
      { account: addressAt(0), cumulative: 1n },
      { account: addressAt(1), cumulative: 2n },
      { account: addressAt(2), cumulative: 3n },
    ],
  },
  {
    name: "five holders (odd at two levels)",
    entries: Array.from({ length: 5 }, (_, i) => ({
      account: addressAt(i),
      cumulative: BigInt(i + 1) * 10n ** 17n,
    })),
  },
  {
    name: "sixteen holders (perfectly balanced)",
    entries: Array.from({ length: 16 }, (_, i) => ({
      account: addressAt(i),
      cumulative: BigInt(i + 1) * 3_141_592_653_589n,
    })),
  },
  {
    // Unsorted input must produce the same root as sorted input: attestors
    // computing independently cannot be required to agree on ordering (§404).
    name: "unsorted input, must normalise",
    entries: [
      { account: addressAt(9), cumulative: 900n },
      { account: addressAt(2), cumulative: 200n },
      { account: addressAt(7), cumulative: 700n },
      { account: addressAt(0), cumulative: 100n },
    ],
  },
  {
    // A zero entitlement is legitimate: a holder who accrued nothing this epoch
    // still appears in a CUMULATIVE tree carrying their prior total.
    name: "includes a zero entitlement",
    entries: [
      { account: addressAt(0), cumulative: 0n },
      { account: addressAt(1), cumulative: 5_000n },
      { account: addressAt(2), cumulative: 1n },
    ],
  },
];

const out = scenarios.map((scenario) => {
  const tree = buildDistributionTree(scenario.entries);

  const proofs = tree.entries.map((entry) => {
    const proof = getProof(tree, entry.account);

    // Self-check before the fixture ever reaches Solidity. If the TypeScript
    // side cannot verify its own proof, the on-chain failure would be far
    // harder to attribute.
    const leaf = tree.leaves[tree.entries.indexOf(entry)]!;
    if (!verifyProof(tree.root, leaf, proof)) {
      throw new Error(`self-verification failed for ${entry.account} in "${scenario.name}"`);
    }

    return {
      account: entry.account,
      cumulative: entry.cumulative.toString(),
      proof,
    };
  });

  return {
    name: scenario.name,
    root: tree.root,
    datasetHash: tree.datasetHash,
    totalCumulative: tree.totalCumulative.toString(),
    // Flat parallel arrays alongside the structured proofs: Foundry's JSON
    // parser has no wildcard, so a Solidity test cannot gather a field across
    // an array of objects.
    accounts: tree.entries.map((e) => e.account),
    cumulatives: tree.entries.map((e) => e.cumulative.toString()),
    proofs,
  };
});

// Determinism check: rebuilding from shuffled input must give the same root.
const shuffled = [...scenarios[5]!.entries].reverse();
const a = buildDistributionTree(scenarios[5]!.entries).root;
const b = buildDistributionTree(shuffled).root;
if (a !== b) throw new Error("tree is not order-independent — attestors could never agree");

/*
 * The batch proof builder must agree with the single one, byte for byte.
 *
 * `getAllProofs` exists because `getProof` rebuilds the tree on every call, and
 * calling it once per holder is quadratic. That makes it a SECOND implementation
 * of a proof, and one of them is what the vault verifies against — so they are
 * compared here at sizes where the tree shape actually varies, including odd
 * counts where a node is promoted without a sibling.
 */
{
  let compared = 0;

  for (const size of [1, 2, 3, 5, 8, 9, 16, 17, 33, 100, 257]) {
    const entries = Array.from({ length: size }, (_, i) => ({
      account: `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
      cumulative: BigInt(1_000 + i * 37),
    }));

    const tree = buildDistributionTree(entries);
    const batch = getAllProofs(tree);

    for (const entry of tree.entries) {
      const single = getProof(tree, entry.account);
      const many = batch.get(entry.account.toLowerCase()) ?? [];

      if (single.length !== many.length || single.some((h, i) => h !== many[i])) {
        throw new Error(
          `getAllProofs disagrees with getProof at size ${size} for ${entry.account}`,
        );
      }

      // Both must actually verify, or agreeing on a wrong answer would pass.
      if (!verifyProof(tree.root, encodeLeaf(entry.account, entry.cumulative), many)) {
        throw new Error(`batch proof does not verify at size ${size}`);
      }

      compared += 1;
    }
  }

  console.log(`  batch proofs match the single builder: ${compared} compared`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ scenarios: out }, null, 2));

console.log(`\nMerkle fixtures written to ${OUT}`);
for (const s of out) {
  console.log(`  ${s.proofs.length.toString().padStart(3)} holders  ${s.name}`);
}
console.log("  order-independence: verified");
console.log("");
