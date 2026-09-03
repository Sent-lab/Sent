/**
 * SENT — keeper audit.
 *
 * The keeper's job is small, so what is worth testing is not that it finalises
 * a market. It is everything it must do WITHOUT getting wrong while doing so:
 *
 *   - a lost race is not a failure, because the call is permissionless (§16)
 *   - one stuck market must not stop the others (§95.6 idempotent retry)
 *   - a watch-only keeper must still report what it can see, loudly
 *   - it must never quietly report a healthy zero when it cannot act
 *
 * That last one is the failure this file exists for. A keeper that returns
 * "nothing to do" when it has no key produces exactly the same output as a
 * keeper watching a protocol with no pending graduations — and the second is
 * fine while the first means markets are stuck and nobody is coming.
 *
 * Run: pnpm --filter @sent/keeper test
 */

import { sweep, isAlreadyFinalised, type KeeperDeps, type PendingMarket } from "../src/keeper.ts";
import { FINALISE_GAS_LIMIT } from "../src/chain.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${detail}`}`);
  }
}

const A = "0x00000000000000000000000000000000000000a1" as const;
const B = "0x00000000000000000000000000000000000000b2" as const;
const C = "0x00000000000000000000000000000000000000c3" as const;
const HASH = "0xfeed000000000000000000000000000000000000000000000000000000000000" as const;

function market(address: `0x${string}`, waitingBlocks: bigint, symbol = "TEST"): PendingMarket {
  return { market: address, symbol, waitingBlocks };
}

function deps(overrides: Partial<KeeperDeps> = {}): KeeperDeps {
  return {
    listPending: async () => [],
    finalise: async () => HASH,
    canSend: async () => ({ ok: true }),
    ...overrides,
  };
}

console.log("\nSENT — Keeper Audit (§16, §95.6, D-016)");
console.log("=".repeat(74));

// ---------------------------------------------------------------------------
console.log("\n--- 1. The ordinary case ------------------------------------------------");

{
  const sent: string[] = [];
  const result = await sweep(
    deps({
      listPending: async () => [market(A, 3n), market(B, 9n)],
      finalise: async (m) => {
        sent.push(m);
        return HASH;
      },
    }),
  );

  check("every pending market is attempted", sent.length === 2);
  check("and counted", result.finalised === 2);
  check("nothing is reported as failed", result.failed === 0);
  check("the worst wait is the longest one, not the last one", result.worstWaitBlocks === 9n);
}

// ---------------------------------------------------------------------------
console.log("\n--- 2. Losing the race is the system working ----------------------------");

{
  /*
   * §16 makes the finalise permissionless precisely so that no single party can
   * withhold it. The consequence is that this keeper will regularly find a
   * market already handled by another keeper, a holder, or someone clicking a
   * button in the UI.
   *
   * Counting that as a failure would page an operator every time the protocol
   * worked as designed, and an alert that fires when nothing is wrong is one
   * that stops being read.
   */
  const result = await sweep(
    deps({
      listPending: async () => [market(A, 2n)],
      finalise: async () => {
        throw new Error("execution reverted: NotGraduating()");
      },
    }),
  );

  check("a market finalised by someone else is not a failure", result.failed === 0);
  check("it is recorded as already done", result.alreadyDone === 1);
  check("and the outcome says so", result.outcomes[0]?.kind === "ALREADY_DONE");
}

// ---------------------------------------------------------------------------
console.log("\n--- 3. But a real revert must not be mistaken for one -------------------");

{
  /*
   * The race check matches one error name. Matching loosely - anything with
   * "revert" in it, say - would file genuine failures as races and leave a
   * market stuck while the metrics said everything was fine.
   */
  check("a plain revert is not a race", !isAlreadyFinalised("execution reverted"));
  check("nor is a diverged pool", !isAlreadyFinalised("PoolPriceDiverged(1, 2)"));
  check("nor is a router that is not set", !isAlreadyFinalised("RouterNotSet()"));
  check("nor is an incomplete graduation", !isAlreadyFinalised("GraduationIncomplete()"));
  check("the one that IS a race still matches", isAlreadyFinalised("NotGraduating()"));
  check("however the node formats it", isAlreadyFinalised('reverted with "notgraduating"'));

  const result = await sweep(
    deps({
      listPending: async () => [market(A, 2n)],
      finalise: async () => {
        throw new Error("execution reverted: PoolPriceDiverged(1, 2)");
      },
    }),
  );

  check("so a diverged pool is reported as a failure", result.failed === 1);
  check("and not silently as a race", result.alreadyDone === 0);
}

// ---------------------------------------------------------------------------
console.log("\n--- 4. One stuck market must not hold the others hostage ----------------");

{
  const attempted: string[] = [];

  const result = await sweep(
    deps({
      listPending: async () => [market(A, 5n), market(B, 4n), market(C, 3n)],
      finalise: async (m) => {
        attempted.push(m);
        if (m === A) throw new Error("execution reverted: PoolPriceDiverged(1, 2)");
        return HASH;
      },
    }),
  );

  check("the sweep does not stop at the first failure", attempted.length === 3);
  check("the two healthy markets are finalised", result.finalised === 2);
  check("and the stuck one is reported", result.failed === 1);

  /*
   * §95.6's idempotent retry lives in the CONTRACT, not here: a failed finalise
   * reverts wholly and leaves the escrow untouched, so the market is still
   * pending on the next sweep with nothing to reconcile. The keeper's whole
   * contribution is to not give up on the rest of the list.
   */
  check("nothing was skipped", result.skipped === 0);
}

// ---------------------------------------------------------------------------
console.log("\n--- 5. A keeper that cannot act must still be loud ----------------------");

{
  /*
   * THE FAILURE THIS FILE EXISTS FOR.
   *
   * An early return here would produce `pending: 0` - a quiet, healthy-looking
   * sweep at the exact moment markets are stuck with no venue and nobody is
   * coming for them. It would read identically to a protocol with nothing to do.
   */
  let sends = 0;

  const result = await sweep(
    deps({
      listPending: async () => [market(A, 700n), market(B, 12n)],
      canSend: async () => ({ ok: false, reason: "watch-only: KEEPER_PRIVATE_KEY is not set" }),
      finalise: async () => {
        sends += 1;
        return HASH;
      },
    }),
  );

  check("a watch-only keeper sends nothing", sends === 0);
  check("but still reports the pending count", result.pending === 2);
  check("and still reports the worst wait", result.worstWaitBlocks === 700n);
  check("every market is accounted for as skipped", result.skipped === 2);
  check("with the reason attached", (() => {
    const first = result.outcomes[0];
    return first?.kind === "SKIPPED" && first.reason.includes("watch-only");
  })());
  check("and none of them counted as failures", result.failed === 0);
}

// ---------------------------------------------------------------------------
console.log("\n--- 6. An underfunded keeper behaves the same way -----------------------");

{
  /*
   * Sending with too little burns the attempt and leaves the market exactly as
   * stuck, while the log records that the keeper tried - which is the wrong
   * story to tell an operator who has to decide whether to intervene.
   */
  const result = await sweep(
    deps({
      listPending: async () => [market(A, 40n)],
      canSend: async () => ({ ok: false, reason: "keeper balance 1 is below the 100 floor" }),
    }),
  );

  check("nothing is attempted", result.finalised === 0);
  check("the market stays visible", result.pending === 1);
  check("and the reason names the balance", (() => {
    const first = result.outcomes[0];
    return first?.kind === "SKIPPED" && first.reason.includes("balance");
  })());
}

// ---------------------------------------------------------------------------
console.log("\n--- 7. Nothing pending is a real answer ---------------------------------");

{
  const result = await sweep(deps());

  check("an empty protocol sweeps clean", result.pending === 0);
  check("with no worst wait", result.worstWaitBlocks === 0n);
  check("and nothing skipped", result.skipped === 0);
}

// ---------------------------------------------------------------------------
console.log("\n--- 8. The gas limit is above the default lane, deliberately ------------");

{
  /*
   * A finalise measured 5,388,986 gas against the real HyperSwap deployment
   * (V-20) and HyperEVM's default block lane caps at 3,000,000.
   *
   * The limit sits above BOTH on purpose. Above the measurement so a slightly
   * costlier pool still fits; above the lane ceiling so that a keeper whose
   * account has not been opted into the large lane is rejected at send time,
   * rather than posting transactions that sit unmined forever while the metrics
   * report an attempt was made.
   */
  check("the limit covers the measured cost", FINALISE_GAS_LIMIT > 5_388_986n);
  check(
    "and cannot be included in a default-lane block",
    FINALISE_GAS_LIMIT > 3_000_000n,
  );
  check("while still fitting the large lane", FINALISE_GAS_LIMIT < 30_000_000n);
}

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(74));
if (failures.length === 0) {
  console.log(`KEEPER AUDIT: PASS — ${passed} checks green.`);
  console.log("");
  console.log("A lost race is not a failure, one stuck market does not stop the rest,");
  console.log("and a keeper that cannot act says so instead of reporting a quiet zero.");
} else {
  console.log(`KEEPER AUDIT: FAIL — ${failures.length} of ${passed + failures.length} failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
console.log("");
