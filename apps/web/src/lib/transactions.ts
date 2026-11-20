"use client";

/**
 * SENT — transaction context that outlives the panel that started it (§61).
 *
 * Every panel tracked its own `sent` hash in local state, so the moment a user
 * navigated — to the market they just bought, say, which is the obvious next
 * click — the fact that they had a transaction in flight was gone. §61 asks for
 * one centralized context that survives the page.
 *
 * WHY A MODULE STORE AND NOT A CONTEXT PROVIDER
 * ---------------------------------------------
 * A provider would have to wrap the app and every sender would have to be
 * inside it, which is true today and is exactly the kind of thing that stops
 * being true when someone adds a panel. A module-level store with
 * `useSyncExternalStore` is reachable from anywhere, survives client-side
 * navigation for free, and cannot be forgotten by a new component.
 *
 * It is also what makes the poller possible: one loop for all transactions,
 * rather than one per component that happens to be mounted.
 *
 * FOUR STATES, AND THE MIDDLE ONE IS REAL (§61)
 * ---------------------------------------------
 * Pending is submitted with no receipt. Confirming is a receipt that the chain
 * has not yet built on. Confirmed is a receipt with blocks on top of it. Failed
 * is a receipt whose status is zero — a transaction that WAS mined and reverted,
 * which is a different thing from one that never landed and must not read the
 * same.
 *
 * On a one-second chain the confirming window is brief, which is not a reason to
 * skip it: it is the difference between "the chain has seen this" and "the chain
 * has kept it", and a reorg lands in exactly that gap.
 *
 * IT PERSISTS, BUT ONLY AS A RECORD
 * ---------------------------------
 * The list is written to localStorage so a refresh does not lose track of
 * something in flight. It holds hashes and labels — never calldata, never
 * amounts to re-sign, nothing that could be replayed. §86 is explicit that
 * transactional drafts must not be synced around, and this is deliberately not
 * a draft: it is a receipt book.
 */

import { useSyncExternalStore } from "react";

import { CHAIN_ID } from "./wallet.ts";

export type TxStatus = "PENDING" | "CONFIRMING" | "CONFIRMED" | "FAILED";

export interface TrackedTx {
  readonly hash: string;
  /** What the user did, in their words. Comes from the intent's own review. */
  readonly summary: string;
  /** The market this belongs to, so the entry can link back to it (§61). */
  readonly token?: string;
  readonly submittedAt: number;
  readonly status: TxStatus;
  readonly blockNumber?: number;
}

/**
 * Blocks on top of a receipt before the app labels it confirmed.
 * Mirrors the 20-block settlement depth used by the indexer/finalizer. This is
 * SENT's confirmation threshold, not a claim that the chain can never reorg it.
 */
const CONFIRMATIONS = 20;

/** How often the poller asks, while anything is still open. */
const POLL_MS = 3_000;

/** Kept small: this is recent context, not a history page. */
const MAX_TRACKED = 20;

const STORAGE_KEY = "sent.transactions";
const EMPTY_SNAPSHOT: readonly TrackedTx[] = Object.freeze([]);

let state: readonly TrackedTx[] = [];
const listeners = new Set<() => void>();
let loaded = false;
let timer: ReturnType<typeof setInterval> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage refused. The list still works for this page's lifetime. */
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    // Shape-checked rather than trusted: this string is editable by anyone with
    // devtools, and a malformed entry would render as a broken row forever.
    state = parsed.filter(
      (t): t is TrackedTx =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as TrackedTx).hash === "string" &&
        typeof (t as TrackedTx).summary === "string" &&
        typeof (t as TrackedTx).submittedAt === "number",
    );
  } catch {
    /* Unreadable or unparseable. Start empty. */
  }
}

function subscribe(listener: () => void): () => void {
  load();
  listeners.add(listener);
  ensurePolling();

  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): readonly TrackedTx[] {
  return state;
}

/** The server has no transactions, and rendering some would not hydrate. */
function serverSnapshot(): readonly TrackedTx[] {
  return EMPTY_SNAPSHOT;
}

/** Everything the product is still waiting on. */
export function isOpen(tx: TrackedTx): boolean {
  return tx.status === "PENDING" || tx.status === "CONFIRMING";
}

/**
 * Record a submitted transaction.
 *
 * Called with the intent's own summary, so the entry says what the user read
 * before signing rather than a label invented here (§694).
 */
export function track(entry: { hash: string; summary: string; token?: string }): void {
  load();

  // A resubmitted hash replaces rather than duplicates.
  const rest = state.filter((t) => t.hash !== entry.hash);

  state = [
    {
      hash: entry.hash,
      summary: entry.summary,
      ...(entry.token !== undefined ? { token: entry.token } : {}),
      submittedAt: Math.floor(Date.now() / 1000),
      status: "PENDING" as const,
    },
    ...rest,
  ].slice(0, MAX_TRACKED);

  persist();
  emit();
  ensurePolling();
}

export function clearSettled(): void {
  load();
  state = state.filter(isOpen);
  persist();
  emit();
}

function update(hash: string, patch: Partial<TrackedTx>): void {
  let changed = false;

  state = state.map((t) => {
    if (t.hash !== hash) return t;
    // Only emit on an actual change: the poller runs every few seconds and a
    // new array each time would re-render the header for nothing.
    const next = { ...t, ...patch };
    if (next.status === t.status && next.blockNumber === t.blockNumber) return t;
    changed = true;
    return next;
  });

  if (changed) {
    persist();
    emit();
  }
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function provider(): Eip1193 | null {
  const injected = (globalThis as { ethereum?: Eip1193 }).ethereum;
  return injected ?? null;
}

async function poll(): Promise<void> {
  const open = state.filter(isOpen);
  if (open.length === 0) {
    stopPolling();
    return;
  }

  // Nothing to ask, and nothing lost: the entries stay pending until a wallet
  // is available again.
  const eth = provider();
  if (eth === null) return;

  /*
   * The chain is checked before anything is believed, for the same reason
   * `wallet.read` checks it: a wallet pointed elsewhere answers from THAT chain
   * without complaint. A receipt lookup would return null there — harmless — but
   * `eth_blockNumber` would return a real head from a different chain, and
   * subtracting our block from it produces a confirmation count that is pure
   * fiction. Better to leave the entry pending than to confirm it against the
   * wrong ledger.
   */
  const chain = await eth
    .request({ method: "eth_chainId" })
    .then((v) => Number(v))
    .catch(() => null);
  if (chain !== CHAIN_ID) return;

  const head = await eth
    .request({ method: "eth_blockNumber" })
    .then((v) => Number(v))
    .catch(() => null);

  for (const tx of open) {
    const receipt = (await eth
      .request({ method: "eth_getTransactionReceipt", params: [tx.hash] })
      .catch(() => null)) as { status?: string; blockNumber?: string } | null;

    // No receipt yet is the normal case for a transaction seconds old, not an
    // error and not a reason to stop watching.
    if (receipt === null || receipt.blockNumber == null) continue;

    const block = Number(receipt.blockNumber);

    if (receipt.status === "0x0") {
      // Mined and reverted. Distinct from never landing, and the user needs to
      // know their gas was spent.
      update(tx.hash, { status: "FAILED", blockNumber: block });
      continue;
    }

    const settled = head !== null && head - block >= CONFIRMATIONS;
    update(tx.hash, { status: settled ? "CONFIRMED" : "CONFIRMING", blockNumber: block });
  }
}

function ensurePolling(): void {
  if (timer !== null) return;
  if (typeof window === "undefined") return;
  if (!state.some(isOpen)) return;

  timer = setInterval(() => {
    // A background tab polling a wallet is a request per interval for an answer
    // nobody is reading. The next foreground tick catches up.
    if (document.hidden) return;
    void poll();
  }, POLL_MS);

  void poll();
}

function stopPolling(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

export function useTransactions(): readonly TrackedTx[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Where a hash can be looked up, when the deployment names an explorer. */
export function explorerUrl(hash: string): string | null {
  const base = process.env.NEXT_PUBLIC_EXPLORER_URL;
  return base === undefined || base === "" ? null : `${base.replace(/\/$/, "")}/tx/${hash}`;
}
