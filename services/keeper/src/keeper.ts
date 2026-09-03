/**
 * SENT — graduation keeper.
 *
 * WHY THIS SERVICE EXISTS
 * -----------------------
 * A full graduation costs 5,388,986 gas against the real HyperSwap deployment.
 * HyperEVM's default block lane caps at 3,000,000 and runs at 99.8% of that in
 * ordinary blocks. So the migration cannot ride along in the buy that crosses
 * the endpoint, and D-016 split it: the crossing buy closes the curve, and a
 * permissionless `finalizeGraduation()` mints the position afterwards.
 *
 * That split introduced an operational dependency the protocol did not have.
 * Between the two transactions a market has NO venue — the curve is shut and
 * the pool does not exist — so its holders cannot act at all. Someone has to
 * make the second call, and this is the someone by default.
 *
 * IT IS NOT THE ONLY SOMEONE, AND MUST NOT BE
 * -------------------------------------------
 * §16 requires the finalise to be permissionless, and the reason is exactly
 * this service: a permissioned finaliser is a party who can freeze a graduated
 * market by doing nothing. So the contract takes no argument and never reads
 * `msg.sender`, the SDK builds the intent, and the API serves the pending list
 * publicly. If this process is down, a holder can finalise their own market
 * from the UI and the protocol is no worse off.
 *
 * This keeper is therefore a convenience with an alert attached, not a
 * component the protocol's safety rests on. It is written to behave that way:
 * it never assumes it is the only caller, and losing a race is a normal
 * outcome rather than an error.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not choose anything. Every input to the migration is frozen when the
 * curve closes — `distributed`, `curveCollateral` and `graduationDust` are
 * fixed by curve math, and every function that could move them is `onlyPreGrad`.
 * So there is no ratio to pick, no price to submit and no parameter to pass.
 * A keeper that could influence the migration would be one worth attacking.
 *
 * It also does not decide WHETHER to finalise. Every pending market is
 * finalised; there is no policy, no allowlist, and no ordering preference
 * beyond oldest-first. Anything else would be this process exercising
 * discretion over whose market opens, which is the privilege §16 spends four
 * bullet points forbidding.
 */

import type { Address, Hash } from "viem";

/** One market whose curve has closed and whose position is not yet minted. */
export interface PendingMarket {
  readonly market: Address;
  readonly symbol: string;
  readonly waitingBlocks: bigint;
}

export type AttemptOutcome =
  /** Sent and mined. */
  | { readonly kind: "FINALISED"; readonly market: Address; readonly hash: Hash }
  /**
   * Someone else got there first, or the market was never pending.
   *
   * NOT an error, and the distinction matters. The call is permissionless by
   * design, so another keeper, a holder, or a UI user winning the race is the
   * system working. Counting it as a failure would make a healthy protocol look
   * broken, and would bury the alert that does matter.
   */
  | { readonly kind: "ALREADY_DONE"; readonly market: Address }
  /** Tried and could not. Retried next poll; the escrow is unchanged. */
  | { readonly kind: "FAILED"; readonly market: Address; readonly reason: string }
  /** Not attempted, because sending was impossible or unsafe. */
  | { readonly kind: "SKIPPED"; readonly market: Address; readonly reason: string };

export interface KeeperDeps {
  /** Markets awaiting finalisation, oldest first. */
  listPending(): Promise<readonly PendingMarket[]>;
  /**
   * Send `finalizeGraduation()` and wait for the receipt.
   *
   * Must REJECT on a reverted receipt as well as on a send failure. A receipt
   * with `status: "reverted"` is a transaction that was mined and did nothing,
   * and treating it as success would mark a still-stuck market as handled.
   */
  finalise(market: Address): Promise<Hash>;
  /** Whether this process can send at all right now. */
  canSend(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface SweepResult {
  readonly pending: number;
  readonly finalised: number;
  readonly alreadyDone: number;
  readonly failed: number;
  readonly skipped: number;
  /** Longest wait seen this sweep. What an alert threshold compares against. */
  readonly worstWaitBlocks: bigint;
  readonly outcomes: readonly AttemptOutcome[];
}

/**
 * One pass over the pending set.
 *
 * SEQUENTIAL, NOT CONCURRENT, AND THAT IS THE POINT
 * -------------------------------------------------
 * Every send comes from one account, so concurrent sends share a nonce. Two
 * in-flight transactions from the same account either collide or silently
 * replace one another depending on gas price, and the second market simply
 * never gets finalised while the logs record two attempts.
 *
 * The pending set is small by construction — a market passes through this
 * state once, briefly — so there is nothing to gain by racing anyway. If it is
 * ever large enough for sequencing to hurt, that is the alert firing.
 *
 * ONE FAILURE MUST NOT END THE SWEEP
 * ----------------------------------
 * A market that cannot be finalised — HyperSwap paused, a pool a stranger
 * priced, an RPC hiccup — must not stop the others. It stays pending with its
 * escrow untouched and is retried next pass, which is precisely §95.6's
 * idempotent retry. Letting it throw would let one stuck market hold every
 * other stuck market hostage.
 */
export async function sweep(deps: KeeperDeps): Promise<SweepResult> {
  const pending = await deps.listPending();

  const outcomes: AttemptOutcome[] = [];
  let worstWaitBlocks = 0n;

  for (const m of pending) {
    if (m.waitingBlocks > worstWaitBlocks) worstWaitBlocks = m.waitingBlocks;
  }

  const sendable = await deps.canSend();

  if (!sendable.ok) {
    /*
     * Watch-only, or unable to pay. Every market is reported SKIPPED rather
     * than the sweep returning early.
     *
     * The difference is what an operator sees. An early return produces
     * "pending: 0, nothing to do" — a quiet, healthy-looking sweep at the exact
     * moment markets are stuck and nobody is finalising them. Reporting each
     * one keeps the count visible whether or not this process can act on it,
     * which is the number the alert is on.
     */
    for (const m of pending) {
      outcomes.push({ kind: "SKIPPED", market: m.market, reason: sendable.reason });
    }
    return summarise(pending.length, worstWaitBlocks, outcomes);
  }

  for (const m of pending) {
    try {
      const hash = await deps.finalise(m.market);
      outcomes.push({ kind: "FINALISED", market: m.market, hash });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      outcomes.push(
        isAlreadyFinalised(reason)
          ? { kind: "ALREADY_DONE", market: m.market }
          : { kind: "FAILED", market: m.market, reason },
      );
    }
  }

  return summarise(pending.length, worstWaitBlocks, outcomes);
}

/**
 * Did this fail because the market is no longer pending?
 *
 * `NotGraduating()` is what the contract reverts with when the status is not
 * GRADUATING — which, after a successful finalise by anyone, is the normal
 * state. Matched on the error NAME rather than a selector so a node returning
 * a decoded message, a raw selector name, or viem's formatted string all land
 * in the same branch.
 *
 * Matching loosely here would hide real failures as races, so it matches that
 * one error and nothing else. An unrecognised revert is FAILED, retried, and
 * visible.
 */
export function isAlreadyFinalised(reason: string): boolean {
  return /NotGraduating/i.test(reason);
}

function summarise(
  pending: number,
  worstWaitBlocks: bigint,
  outcomes: readonly AttemptOutcome[],
): SweepResult {
  const count = (kind: AttemptOutcome["kind"]): number =>
    outcomes.filter((o) => o.kind === kind).length;

  return {
    pending,
    finalised: count("FINALISED"),
    alreadyDone: count("ALREADY_DONE"),
    failed: count("FAILED"),
    skipped: count("SKIPPED"),
    worstWaitBlocks,
    outcomes,
  };
}
