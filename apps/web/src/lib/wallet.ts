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

import { useCallback, useEffect, useRef, useState } from "react";

import type { WireIntent } from "./api.ts";
import { toTransactionRequest } from "./tx.ts";
import { discoverInjectedWallets, type DiscoveredWallet, type Eip1193Provider } from "./injectedWallets.ts";

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
  readonly localTestWallet: boolean;
  readonly wallets: readonly Pick<DiscoveredWallet, "id" | "name">[];
  readonly selectedWalletId: string | null;
  readonly walletName: string | null;
}

/** One `eth_call`: a read of chain state, signing nothing and costing nothing. */
export interface ChainRead {
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
}

export interface Wallet extends WalletState {
  selectWallet(id: string): void;
  connect(): Promise<void>;
  send(intent: WireIntent): Promise<`0x${string}`>;
  switchChain(): Promise<void>;
  /**
   * Read chain state through the SAME provider that will send the transaction.
   *
   * §87 asks where a number came from, and for a wrapper's exchange rate the
   * only acceptable answer is the chain. It is not in the projection and must
   * not be: a stale `convertToAssets` is a number a user signs against.
   *
   * Through the wallet's own node rather than a separate RPC, so the value that
   * was quoted and the state the transaction executes against come from one
   * place. A second endpoint could be a block behind and nothing would say so.
   *
   * Needs a provider, not a connection — a read works before the user has
   * granted an account, so a rate can be shown to someone still deciding.
   */
  read(request: ChainRead): Promise<`0x${string}`>;
  /** Native HyperEVM balance, read from the same injected wallet provider. */
  nativeBalance(account: `0x${string}`): Promise<bigint>;
}

export function useWallet(): Wallet {
  const providerRef = useRef<Eip1193Provider | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredWallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
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
    localTestWallet: false,
    wallets: [],
    selectedWalletId: null,
    walletName: null,
  });

  useEffect(() => {
    const legacy = window.ethereum ?? installLocalAnvilProvider();
    void discoverInjectedWallets(legacy).then((wallets) => {
      setDiscovered(wallets);
      setState((current) => ({ ...current, wallets: wallets.map(({ id, name }) => ({ id, name })) }));
      const preferred = wallets.find((wallet) => wallet.name.toLowerCase().includes("metamask")) ?? wallets[0];
      if (preferred !== undefined) setSelectedWalletId((current) => current ?? preferred.id);
    });
  }, []);

  const selected = discovered.find((wallet) => wallet.id === selectedWalletId) ?? null;

  useEffect(() => {
    const provider = selected?.provider ?? null;
    providerRef.current = provider;
    setState((current) => ({
      ...current,
      available: provider !== null,
      address: null,
      chainId: null,
      wrongChain: false,
      localTestWallet: provider?.isSentLocalAnvil === true,
      selectedWalletId: selected?.id ?? null,
      walletName: selected?.name ?? null,
    }));
    if (provider === null) return;

    setState((current) => ({
      ...current,
      available: true,
      localTestWallet: provider.isSentLocalAnvil === true,
    }));

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
  }, [selected]);

  const selectWallet = useCallback((id: string) => {
    setSelectedWalletId(id);
  }, []);

  const connect = useCallback(async () => {
    const provider = providerRef.current;
    if (provider === null) {
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
    const provider = providerRef.current;
    if (provider === null) return;

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
      const provider = providerRef.current;
      if (provider === null) {
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

      // The selected account can change after React renders the button. Do not
      // send with the stale `from` address captured by this callback: make the
      // user review again against the account the wallet currently exposes.
      const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
      const activeAddress = accounts[0]?.toLowerCase() ?? null;
      if (activeAddress !== state.address.toLowerCase()) {
        setState((current) => ({
          ...current,
          address: activeAddress as `0x${string}` | null,
        }));
        throw new WalletError(
          "ACCOUNT_CHANGED",
          "The active wallet account changed. Review the transaction again before sending.",
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

  const read = useCallback(async (request: ChainRead): Promise<`0x${string}`> => {
    const provider = providerRef.current;
    if (provider === null) {
      throw new WalletError("NO_WALLET", "No wallet was found in this browser.");
    }

    /*
     * The chain is checked here too, and for a sharper reason than on `send`.
     *
     * A wallet pointed at another network answers `eth_call` from THAT chain,
     * cheerfully and with no error. The address exists there or it does not; if
     * it does, the number that comes back is real and belongs to a different
     * contract. Reading a rate off the wrong chain and showing it as this
     * market's rate is worse than showing nothing.
     */
    const chain = Number((await provider.request({ method: "eth_chainId" })) as string);
    if (chain !== CHAIN_ID) {
      throw new WalletError(
        "WRONG_CHAIN",
        `Your wallet is on chain ${chain}. Switch to ${CHAIN_ID} to read this market.`,
      );
    }

    return (await provider.request({
      method: "eth_call",
      params: [{ to: request.to, data: request.data }, "latest"],
    })) as `0x${string}`;
  }, []);

  const nativeBalance = useCallback(async (account: `0x${string}`): Promise<bigint> => {
    const provider = providerRef.current;
    if (provider === null) throw new WalletError("NO_WALLET", "No wallet was found in this browser.");
    const chain = Number((await provider.request({ method: "eth_chainId" })) as string);
    if (chain !== CHAIN_ID) throw new WalletError("WRONG_CHAIN", `Switch to chain ${CHAIN_ID} to read this balance.`);
    const raw = (await provider.request({ method: "eth_getBalance", params: [account, "latest"] })) as string;
    if (!/^0x[0-9a-f]+$/i.test(raw)) throw new WalletError("BAD_BALANCE", "The wallet returned an invalid HYPE balance.");
    return BigInt(raw);
  }, []);

  return { ...state, selectWallet, connect, send, switchChain, read, nativeBalance };
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

/**
 * A disposable, unlocked Anvil account for local UI testing only.
 *
 * The helper is opt-in at dev-server startup, localhost-only, and hard-pinned
 * to chain 31337. It proxies every read and transaction to Anvil; it contains
 * no key and is never installed when a real browser wallet is present.
 */
function installLocalAnvilProvider(): Eip1193Provider | undefined {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_CHAIN_ID !== "31337" ||
    process.env.NEXT_PUBLIC_ENABLE_ANVIL_WALLET !== "true" ||
    (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1")
  ) {
    return undefined;
  }

  const rpcUrl = "http://127.0.0.1:8545";
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  let connectedAccount: string | null = null;

  const rpc = async (method: string, params: unknown[] = []): Promise<unknown> => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`Local Anvil RPC returned HTTP ${response.status}`);

    const body = (await response.json()) as {
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    if (body.error !== undefined) {
      const error = new Error(body.error.message ?? `Local Anvil RPC failed: ${method}`) as Error & {
        code?: number;
      };
      if (body.error.code !== undefined) error.code = body.error.code;
      throw error;
    }
    return body.result;
  };

  const provider: Eip1193Provider = {
    isSentLocalAnvil: true,
    async request({ method, params = [] }) {
      if (method === "eth_accounts") {
        return connectedAccount === null ? [] : [connectedAccount];
      }
      if (method === "eth_requestAccounts") {
        const chainId = await rpc("eth_chainId");
        if (chainId !== "0x7a69") {
          throw new Error("The local wallet only connects to Anvil chain 31337.");
        }
        const accounts = (await rpc("eth_accounts")) as string[];
        connectedAccount = accounts[0] ?? null;
        const handlers = listeners.get("accountsChanged");
        for (const handler of handlers ?? []) {
          handler((connectedAccount === null ? [] : [connectedAccount]) as never);
        }
        return connectedAccount === null ? [] : [connectedAccount];
      }
      if (method === "eth_sendTransaction") {
        const transaction = params[0] as { from?: string } | undefined;
        if (connectedAccount === null || transaction?.from?.toLowerCase() !== connectedAccount) {
          const error = new Error("Connect the local test wallet before sending.") as Error & {
            code?: number;
          };
          error.code = 4100;
          throw error;
        }
        return rpc(method, params);
      }
      if (method === "wallet_switchEthereumChain") {
        const requested = (params[0] as { chainId?: string } | undefined)?.chainId;
        if (requested !== "0x7a69") {
          const error = new Error("The local wallet only supports Anvil chain 31337.") as Error & {
            code?: number;
          };
          error.code = 4902;
          throw error;
        }
        return null;
      }
      return rpc(method, params);
    },
    on(event, handler) {
      const handlers = listeners.get(event) ?? new Set<(...args: never[]) => void>();
      handlers.add(handler);
      listeners.set(event, handlers);
    },
    removeListener(event, handler) {
      listeners.get(event)?.delete(handler);
    },
  };

  window.ethereum = provider;
  return provider;
}

/** EIP-1193 code 4001. A rejected prompt is a choice, not an error. */
function isUserRejection(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 4001;
}

/** EIP-3085 code 4902: the wallet has never heard of this chain. */
function isUnknownChain(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 4902;
}
