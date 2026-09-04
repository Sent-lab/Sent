/**
 * SENT — reading the chain directly (§87, D-017).
 *
 * WHY ANY OF THIS EXISTS WHEN THERE IS AN API
 * -------------------------------------------
 * The API serves the projection, and the projection is the right source for
 * everything it holds: it is reorg-safe, it carries a freshness envelope, and it
 * can say how far behind it is. What it cannot do is answer a question about a
 * contract it does not index.
 *
 * A wrapper's exchange rate is one of those. `assetsPerShare` is the underlying
 * xStock's own multiplier, which moves on dividends and splits with no event
 * this indexer follows. A user unwrapping is signing against that number. There
 * is no honest way to serve it from a cache: either it is read from the chain at
 * the moment it is shown, or the figure is a guess wearing a decimal point.
 *
 * The same goes for balances and allowances. "How much can I wrap" is a question
 * about the user's wallet right now, not about what the indexer last saw.
 *
 * DECODING IS DELIBERATELY NARROW
 * -------------------------------
 * Every reader here returns a single uint256 or a string, and each decodes with
 * viem against the ABI fragment it encoded with. There is no generic "call any
 * function" helper, because the value of this module is that a caller cannot
 * accidentally read one function and decode it as another.
 *
 * A REVERT IS AN ANSWER, NOT A CRASH
 * ----------------------------------
 * `eth_call` on a contract that is not there, or a multiplier of zero, throws.
 * Callers get the throw — they must not paper over it with a zero, because zero
 * is a legitimate balance and "the read failed" is not a balance at all.
 */

import { decodeFunctionResult, encodeFunctionData } from "viem";

import type { ChainRead } from "./wallet.ts";

/** Performs one `eth_call`. Supplied by the wallet so reads and sends agree. */
export type Reader = (request: ChainRead) => Promise<`0x${string}`>;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const WRAPPER_ABI = [
  {
    type: "function",
    name: "previewWrap",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "assetsPerShare",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function readUint(
  read: Reader,
  abi: typeof ERC20_ABI | typeof WRAPPER_ABI,
  to: `0x${string}`,
  functionName: string,
  args: readonly unknown[],
): Promise<bigint> {
  const data = encodeFunctionData({
    abi,
    functionName,
    args,
  } as Parameters<typeof encodeFunctionData>[0]);

  const result = await read({ to, data });

  return decodeFunctionResult({
    abi,
    functionName,
    data: result,
  } as Parameters<typeof decodeFunctionResult>[0]) as bigint;
}

export function balanceOf(
  read: Reader,
  token: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint> {
  return readUint(read, ERC20_ABI, token, "balanceOf", [account]);
}

export function allowance(
  read: Reader,
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return readUint(read, ERC20_ABI, token, "allowance", [owner, spender]);
}

/**
 * The wrapper tokens a deposit is expected to mint.
 *
 * An ESTIMATE, and the contract says so itself: `wrap` credits what actually
 * arrives rather than what was predicted, because the underlying rounds between
 * balances and shares. A caller must present this as approximate — the SDK's
 * wrap review already does.
 */
export function previewWrap(
  read: Reader,
  wrapper: `0x${string}`,
  assets: bigint,
): Promise<bigint> {
  return readUint(read, WRAPPER_ABI, wrapper, "previewWrap", [assets]);
}

/**
 * The underlying that burning `shares` returns, at the current multiplier.
 *
 * Exact, unlike `previewWrap`: `unwrap` pays from the same `convertToAssets` a
 * caller reads, so quote and fill cannot disagree (§315). It can still move
 * between the read and the signature — a dividend landing in that window raises
 * it — which is why the review says "at the current rate".
 */
export function convertToAssets(
  read: Reader,
  wrapper: `0x${string}`,
  shares: bigint,
): Promise<bigint> {
  return readUint(read, WRAPPER_ABI, wrapper, "convertToAssets", [shares]);
}

/** The underlying's own symbol, for a label. The ADDRESS is the identity. */
export async function symbolOf(read: Reader, token: `0x${string}`): Promise<string> {
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "symbol" });
  const result = await read({ to: token, data });

  return decodeFunctionResult({
    abi: ERC20_ABI,
    functionName: "symbol",
    data: result,
  }) as string;
}
