/**
 * SENT — reorg handling audit.
 *
 * §178.7 makes reorg safety a release gate. A reorg bug is silent: the projection
 * keeps answering queries, the answers are simply wrong, and the divergence
 * compounds until somebody reconciles against the chain by hand.
 *
 * These scenarios are hard to produce against a live chain and impossible to
 * produce on demand, which is exactly why the decision logic is pure.
 *
 * Run: pnpm sim:reorg
 */

import { ChainTracker, type BlockRef, type IngestDecision } from "../src/reorg.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Build a header. `fork` distinguishes competing chains at the same height. */
function block(number: number, fork = "a", parentFork = fork): BlockRef {
  return {
    number: BigInt(number),
    hash: `0x${fork}${number}`,
    parentHash: number === 0 ? "0xgenesis" : `0x${parentFork}${number - 1}`,
  };
}

/** Feed a canonical run of blocks into a tracker. */
function seed(tracker: ChainTracker, from: number, to: number, fork = "a"): void {
  for (let i = from; i <= to; i++) {
    const b = block(i, fork);
    const decision = tracker.inspect(b);
    if (decision.action !== "append" && decision.action !== "duplicate") {
      throw new Error(`seeding failed at ${i}: ${decision.action}`);
    }
    tracker.commit(b);
  }
}

console.log("\nSENT — Reorg Handling Audit");
console.log("=".repeat(72));

// ---------------------------------------------------------------------------
console.log("\n--- 1. The ordinary path ---------------------------------------------");

{
  const t = new ChainTracker(64);
  const first = t.inspect(block(100));

  check("a cold start accepts any block as the anchor", first.action === "append");
  t.commit(block(100));

  const next = t.inspect(block(101));
  check("a block whose parent is the head appends", next.action === "append");
  t.commit(block(101));

  check("the head tracks the latest committed block", t.head?.number === 101n);
}

// ---------------------------------------------------------------------------
console.log("\n--- 2. Gaps ----------------------------------------------------------");

{
  const t = new ChainTracker(64);
  seed(t, 100, 105);

  const d = t.inspect(block(110));
  check("a jump ahead is reported as a gap, not appended", d.action === "gap");
  if (d.action === "gap") {
    check("the gap names exactly the missing range", d.from === 106n && d.to === 109n);
  }
}

// ---------------------------------------------------------------------------
console.log("\n--- 3. Replay must be idempotent -------------------------------------");

{
  const t = new ChainTracker(64);
  seed(t, 100, 105);

  const d = t.inspect(block(105));
  check("re-observing an identical block is a duplicate, not a reorg", d.action === "duplicate");

  // This is what makes crash recovery safe: an indexer that dies mid-batch can
  // always re-run its last batch without corrupting anything.
  const d2 = t.inspect(block(103));
  check("an older identical block is also a duplicate", d2.action === "duplicate");
}

// ---------------------------------------------------------------------------
console.log("\n--- 4. The reorg a height check cannot see ----------------------------");

{
  // THE case. Block 105 is replaced by a different block at the SAME height.
  // Comparing numbers sees nothing wrong at all.
  const t = new ChainTracker(64);
  seed(t, 100, 105);

  const replacement: BlockRef = {
    number: 105n,
    hash: "0xb105",
    parentHash: "0xa104", // same parent, different block
  };

  const d = t.inspect(replacement);

  check("a same-height replacement is detected as a reorg", d.action === "reorg");
  if (d.action === "reorg") {
    check("rollback targets the common ancestor", d.rollbackTo === 104n);
  }
}

{
  // A deeper fork: the new chain diverged several blocks back.
  const t = new ChainTracker(64);
  seed(t, 100, 110);

  // Arrives claiming a parent we have never seen.
  const forked: BlockRef = {
    number: 108n,
    hash: "0xb108",
    parentHash: "0xb107",
  };

  const d = t.inspect(forked);
  check("a deeper fork is still a reorg", d.action === "reorg");
  if (d.action === "reorg") {
    check(
      "an unbounded fork rolls back conservatively rather than guessing",
      d.rollbackTo <= 107n,
      `rollbackTo ${d.rollbackTo}`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\n--- 5. Reorgs deeper than memory --------------------------------------");

{
  // A short window, then a fork below it. The tracker cannot locate a common
  // ancestor, and must say so rather than pick one.
  const t = new ChainTracker(5);
  seed(t, 100, 110);

  const ancient: BlockRef = {
    number: 104n,
    hash: "0xb104",
    parentHash: "0xb103",
  };

  const d = t.inspect(ancient);
  check("a reorg below the retained window demands a reindex", d.action === "reindex_required");

  // §279 forbids placeholders in production, and a silently-assumed ancestor is
  // exactly that: it produces a projection that looks healthy and is wrong.
  check(
    "it does not silently guess an ancestor",
    d.action !== "reorg",
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 6. Rollback actually rolls back -----------------------------------");

{
  const t = new ChainTracker(64);
  seed(t, 100, 110);

  t.rollbackTo(105n);
  check("rollback drops every header above the fork", t.head?.number === 105n);

  // The replacement chain must now append cleanly.
  const replacement: BlockRef = {
    number: 106n,
    hash: "0xb106",
    parentHash: "0xa105",
  };
  const d = t.inspect(replacement);
  check("the replacement chain appends after rollback", d.action === "append");

  t.commit(replacement);
  check("the new chain becomes the head", t.head?.hash === "0xb106");
}

{
  // Committing a block at an existing height must REPLACE that height and
  // everything above it. Leaving stale headers behind would make the tracker
  // report a fork that no longer exists.
  const t = new ChainTracker(64);
  seed(t, 100, 110);

  t.commit({ number: 107n, hash: "0xb107", parentHash: "0xa106" });

  check("committing over a height truncates the window", t.head?.number === 107n);
  check("and the new hash wins", t.head?.hash === "0xb107");

  const next = t.inspect({ number: 108n, hash: "0xb108", parentHash: "0xb107" });
  check("the rebuilt chain continues cleanly", next.action === "append");
}

// ---------------------------------------------------------------------------
console.log("\n--- 7. The retained window is bounded ----------------------------------");

{
  const t = new ChainTracker(10);
  seed(t, 100, 200);

  check("the window never grows past its depth", t.size === 10);
  check("it retains the most recent blocks", t.head?.number === 200n);
  check("and forgets the oldest", (t.earliestRetained ?? 0n) === 191n);
}

// ---------------------------------------------------------------------------
console.log("\n--- 8. Finality boundary ----------------------------------------------");

{
  const t = new ChainTracker(64);
  seed(t, 100, 150);

  // Stockback finalization must only read settled state (§335): a reorg that
  // invalidated an already-attested distribution would be unrecoverable, because
  // the attestors have signed.
  check("finalized boundary sits `confirmations` below the head", t.finalizedBelow(20) === 130n);
  check("an unreachable boundary reports nothing rather than a negative", t.finalizedBelow(1000) === undefined);
}

// ---------------------------------------------------------------------------
console.log("\n--- 9. A long randomised chain with injected reorgs --------------------");

{
  const t = new ChainTracker(64);
  let seedValue = 424242n;
  const rand = (n: bigint): bigint => {
    seedValue = (seedValue * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) % (1n << 64n);
    return seedValue % n;
  };

  seed(t, 1000, 1010);

  let reorgs = 0;
  let appends = 0;
  let reindexes = 0;
  let forkId = 0;
  let currentFork = "a";
  let height = 1010;

  for (let step = 0; step < 500; step++) {
    // One step in twelve, fork the chain a few blocks back.
    if (rand(12n) === 0n && height > 1015) {
      const depth = Number(rand(5n)) + 1;
      const forkHeight = height - depth;
      forkId++;
      const newFork = `f${forkId}`;

      const b: BlockRef = {
        number: BigInt(forkHeight + 1),
        hash: `0x${newFork}${forkHeight + 1}`,
        parentHash: `0x${currentFork}${forkHeight}`,
      };

      const d = t.inspect(b);
      if (d.action === "reorg") {
        reorgs++;
        t.rollbackTo(d.rollbackTo);
        t.commit(b);
        currentFork = newFork;
        height = forkHeight + 1;
      } else if (d.action === "reindex_required") {
        reindexes++;
        t.reset();
        t.commit(b);
        currentFork = newFork;
        height = forkHeight + 1;
      } else if (d.action === "append" || d.action === "duplicate") {
        t.commit(b);
        currentFork = newFork;
        height = forkHeight + 1;
      }
      continue;
    }

    const next: BlockRef = {
      number: BigInt(height + 1),
      hash: `0x${currentFork}${height + 1}`,
      parentHash: `0x${currentFork}${height}`,
    };

    const d: IngestDecision = t.inspect(next);
    if (d.action === "append") {
      appends++;
      t.commit(next);
      height++;
    } else {
      failures.push(`unexpected ${d.action} on a clean extension at ${height + 1}`);
      break;
    }
  }

  console.log(`  ${appends} appends, ${reorgs} reorgs, ${reindexes} reindexes over 500 steps`);

  check("a long chain with injected reorgs never desynchronises", failures.length === 0);
  check("reorgs were actually exercised", reorgs > 0);
  check("the window stays bounded throughout", t.size <= 64);
  check("the head is always the last committed block", t.head?.number === BigInt(height));
}

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(72));
if (failures.length === 0) {
  console.log(`REORG AUDIT: PASS — ${passed} checks green.`);
  console.log("");
  console.log("Continuity is decided by parent hash, never by block number: a chain");
  console.log("can replace a block at the same height, and a height comparison sees");
  console.log("nothing at all.");
} else {
  console.log(`REORG AUDIT: FAIL — ${failures.length} of ${passed + failures.length} failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
console.log("");
