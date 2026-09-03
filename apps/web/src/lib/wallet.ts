"use client";

/**
 * SENT — wallet connection and signing.
 *
 * §694: UI REVIEW = TRANSACTION INTENT = SDK BUILDER = ACTUAL CALLDATA.
 *
 * The last link in that chain is here, and it is the shortest one on purpose:
 * `send` takes an intent and passes `to`, `data` and `value` to the wallet
 * exactly as received. It does not encode anything, does not adjust anything,
 * and has no access to the ABI. If this file could construct calldata, §694
 * would be a convention rather than a property.
 *
 * NO CONNECTOR LIBRARY
 * --------------------
 * EIP-1193 is what every browser wallet actually exposes, and this app needs
 * four things from it: the accounts, the chain, a transaction, and events when
 * either changes. A connector library adds a dependency with a large surface
 * for the part of the stack where a surprise is most expensive.
 *
 * THE CHAIN IS CHECKED BEFORE EVERY SEND
 * --------------------------------------
 * A transaction sent on the wrong chain is not a failed trade — it is a real
 * transfer to an address that means something else there, or nothing. Wallets
 * switch networks behind an app's back, so the check happens at send time and
 * not only at connect.
 */

import { useCallback, useEffect, useState } from "react";

import type { WireIntent } from "./api.ts";
import { toTransactionRequest } from "./tx.ts";

/** The subset of EIP-1193 this app uses. */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, handler: (...args: never[]) => void): void;
  removeListener(event: string, handler: (...args: never[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "999");

export { toTransactionRequest, TransactionError } from "./tx.ts";

export class WalletError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

export interface WalletState {
  readonly available: boolean;
  readonly address: `0x${string}` | null;
  readonly chainId: number | null;
  /** True when connected to a chain other than the one this app targets. */
  readonly wrongChain: boolean;
  readonly connecting: boolean;
  readonly error: string | null;
}

export interface Wallet extends WalletState {
  connect(): Promise<void>;
  send(intent: WireIntent): Promise<`0x${string}`>;
  switchChain(): Promise<void>;
}

export function useWallet(): Wallet {
  const [state, setState] = useState<WalletState>({
    // Resolved in an effect, never during render: `window` does not exist on
    // the server, and reading it here would make the first client render
    // disagree with the server's and trip a hydration mismatch.
    available: false,
    address: null,
    chainId: null,
    wrongChain: false,
    connecting: false,
    error: null,
  });

  useEffect(() => {
    const provider = window.ethereum;
    if (provider === undefined) return;

    setState((current) => ({ ...current, available: true }));

    // Already-authorised accounts, without prompting. `eth_accounts` returns
    // what the user previously granted; `eth_requestAccounts` would open a
    // dialog on every page load, which is how an app teaches people to dismiss
    // wallet prompts without reading them.
    void (async () => {
      const [accounts, chain] = await Promise.all([
        provider.request({ method: "eth_accounts" }) as Promise<string[]>,
        provider.request({ method: "eth_chainId" }) as Promise<string>,
      ]).catch(() => [[], "0x0"] as [string[], string]);

      applyAccounts(setState, accounts, Number(chain));
    })();

    const onAccounts = (...args: never[]): void => {
      const accounts = args[0] as unknown as string[];
      setState((current) => ({
        ...current,
        address: (accounts[0]?.toLowerCase() as `0x${string}`) ?? null,
      }));
    };

    const onChain = (...args: never[]): void => {
      const chain = Number(args[0] as unknown as string);
      setState((current) => ({
        ...current,
        chainId: chain,
        wrongChain: chain !== CHAIN_ID,
      }));
    };

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);

    return () => {
      provider.removeListener("accountsChanged", onAccounts);
      provider.removeListener("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = window.ethereum;
    if (provider === undefined) {
      throw new WalletError("NO_WALLET", "No wallet was found in this browser.");
    }

    setState((current) => ({ ...current, connecting: true, error: null }));

    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const chain = Number((await provider.request({ method: "eth_chainId" })) as string);

      applyAccounts(setState, accounts, chain);
    } catch (error) {
      setState((current) => ({
        ...current,
        connecting: false,
        // A rejected prompt is a decision, not a failure, and must not be
        // reported as one (§42).
        error: isUserRejection(error)
          ? null
          : "The wallet could not be connected. Try again from the wallet itself.",
      }));
    }
  }, []);

  const switchChain = useCallback(async () => {
    const provider = window.ethereum;
    if (provider === undefined) return;

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
      });
    } catch (error) {
      // 4902: the wallet does not know this chain. Adding it is a separate
      // permission and is left to the user — an app that offers to add a
      // network is asking for trust it has not established.
      setState((current) => ({
        ...current,
        error: isUnknownChain(error)
          ? `Add HyperEVM (chain ${CHAIN_ID}) to your wallet, then reconnect.`
          : "The network could not be switched.",
      }));
    }
  }, []);

  /**
   * Send an intent.
   *
   * The three fields the wallet receives come straight from the intent. Nothing
   * here re-encodes, re-checks or re-derives them — that is the §694 guarantee
   * expressed as code rather than as a comment.
   */
  const send = useCallback(
    async (intent: WireIntent): Promise<`0x${string}`> => {
      const provider = window.ethereum;
      if (provider === undefined) {
        throw new WalletError("NO_WALLET", "No wallet was found in this browser.");
      }
      if (state.address === null) {
        throw new WalletError("NOT_CONNECTED", "Connect a wallet first.");
      }

      // Re-read rather than trusting state: a wallet can switch chains between
      // the render that drew this button and the click that pressed it.
      const chain = Number((await provider.request({ method: "eth_chainId" })) as string);
      if (chain !== CHAIN_ID) {
        throw new WalletError(
          "WRONG_CHAIN",
          `Your wallet is on chain ${chain}. Switch to ${CHAIN_ID} before trading.`,
        );
      }

      // The intent says which chain it was built for. If that ever disagrees
      // with the app's own target, something upstream is misconfigured and the
      // right move is to refuse rather than to pick one.
      if (intent.chainId !== CHAIN_ID) {
        throw new WalletError(
          "INTENT_CHAIN_MISMATCH",
          `This transaction was built for chain ${intent.chainId}, not ${CHAIN_ID}.`,
        );
      }

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [toTransactionRequest(intent, state.address)],
      })) as string;

      return hash as `0x${string}`;
    },
    [state.address],
  );

  return { ...state, connect, send, switchChain };
}

function applyAccounts(
  setState: React.Dispatch<React.SetStateAction<WalletState>>,
  accounts: string[],
  chainId: number,
): void {
  setState((current) => ({
    ...current,
    connecting: false,
    address: (accounts[0]?.toLowerCase() as `0x${string}`) ?? null,
    chainId,
    wrongChain: accounts.length > 0 && chainId !== CHAIN_ID,
  }));
}

/** EIP-1193 code 4001. A rejected prompt is a choice, not an error. */
function isUserRejection(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 4001;
}

/** EIP-3085 code 4902: the wallet has never heard of this chain. */
function isUnknownChain(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 4902;
}
