/**
 * SENT — the keeper's chain side.
 *
 * Everything that touches a key, an RPC or a receipt lives here, so `keeper.ts`
 * stays a pure function over a small interface and can be tested without either.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { launchMarketAbi } from "@sent/contracts";

import type { KeeperDeps, PendingMarket } from "./keeper.ts";

/**
 * Gas ceiling for one finalise.
 *
 * The measured cost against the real HyperSwap deployment is 5,388,986 (V-20).
 * This is that with room for a pool whose creation costs a little more, and it
 * is set EXPLICITLY rather than left to estimation for one reason: an estimate
 * that comes back low produces a transaction that runs out of gas mid-migration
 * — mined, paid for, and having done nothing.
 *
 * It is also over the 3,000,000 default-lane ceiling on purpose. A node on the
 * default lane cannot include a transaction with this limit, so a misconfigured
 * keeper fails at send time with a clear rejection rather than posting
 * transactions that sit unmined forever.
 */
export const FINALISE_GAS_LIMIT = 8_000_000n;

export interface ChainConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly privateKey: `0x${string}` | null;
  readonly minBalanceWei: bigint;
}

export interface ChainSide {
  readonly account: Address | null;
  finalise(market: Address): Promise<Hash>;
  canSend(): Promise<{ ok: true } | { ok: false; reason: string }>;
  balance(): Promise<bigint | null>;
}

export function createChainSide(config: ChainConfig): ChainSide {
  const chain = {
    id: config.chainId,
    name: "HyperEVM",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  } as const;

  const publicClient: PublicClient = createPublicClient({
    transport: http(config.rpcUrl),
  }) as PublicClient;

  const account = config.privateKey === null ? null : privateKeyToAccount(config.privateKey);

  const wallet: WalletClient | null =
    account === null
      ? null
      : createWalletClient({ account, chain, transport: http(config.rpcUrl) });

  return {
    account: account?.address ?? null,

    async balance(): Promise<bigint | null> {
      if (account === null) return null;
      try {
        return await publicClient.getBalance({ address: account.address });
      } catch {
        return null;
      }
    },

    async canSend(): Promise<{ ok: true } | { ok: false; reason: string }> {
      if (wallet === null || account === null) {
        return { ok: false, reason: "watch-only: KEEPER_PRIVATE_KEY is not set" };
      }

      let funds: bigint;
      try {
        funds = await publicClient.getBalance({ address: account.address });
      } catch (error) {
        /*
         * An unreadable balance is NOT treated as sufficient. Sending on the
         * assumption that the account can pay, when the chain could not be
         * asked, produces a burned attempt and a market that is still stuck —
         * and the log says the keeper tried, which is the wrong story.
         */
        return {
          ok: false,
          reason: `cannot read the keeper balance: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (funds < config.minBalanceWei) {
        return {
          ok: false,
          reason: `keeper balance ${funds} is below the ${config.minBalanceWei} floor`,
        };
      }

      return { ok: true };
    },

    async finalise(market: Address): Promise<Hash> {
      if (wallet === null || account === null) {
        throw new Error("finalise called while watch-only");
      }

      /*
       * Simulated first, and this is not belt-and-braces.
       *
       * A finalise costs ~5.4M gas. Sending one that was always going to revert
       * spends that for nothing, and at the rate a stalled market gets retried
       * that is a slow, self-inflicted drain. The simulation also surfaces
       * `NotGraduating()` as a clean revert reason, which is how a lost race is
       * told apart from a real failure without a wasted transaction.
       */
      const { request } = await publicClient.simulateContract({
        address: market,
        abi: launchMarketAbi,
        functionName: "finalizeGraduation",
        account,
        gas: FINALISE_GAS_LIMIT,
      });

      const hash = await wallet.writeContract(request);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== "success") {
        /*
         * A reverted receipt is a mined transaction that did nothing. Returning
         * the hash here would record the market as finalised on the strength of
         * a transaction that changed no state, and the next sweep would find it
         * still pending with the logs insisting it was handled.
         */
        throw new Error(`finalise reverted on-chain for ${market} in ${hash}`);
      }

      return hash;
    },
  };
}

/** Wire the chain side and a pending-market source into the sweep's interface. */
export function createDeps(
  chain: ChainSide,
  listPending: () => Promise<readonly PendingMarket[]>,
): KeeperDeps {
  return {
    listPending,
    finalise: (market) => chain.finalise(market),
    canSend: () => chain.canSend(),
  };
}
