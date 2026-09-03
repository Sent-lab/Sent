/**
 * SENT — the last link in the §694 chain.
 *
 * UI REVIEW = TRANSACTION INTENT = SDK BUILDER = ACTUAL CALLDATA.
 *
 * Turning an intent into the object a wallet receives is the final step of that
 * chain, and it lives in its own module with no React and no DOM so it can be
 * exercised directly. "The bytes handed to the wallet are the intent's own" is a
 * property worth being able to fail a build over, and a property buried inside a
 * hook is a property nothing checks.
 */

import type { WireIntent } from "./api.ts";

/** Raised when an intent cannot be turned into a transaction. */
export class TransactionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TransactionError";
    this.code = code;
  }
}

export interface TransactionRequest {
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  /** Hex quantity, as JSON-RPC requires. */
  readonly value: `0x${string}`;
}

/**
 * Turn an intent into the object a wallet receives.
 *
 * This is the last link in §694's chain, and it is deliberately trivial: `to`
 * and `data` are copied, and `value` only changes representation — parsed from
 * the decimal string the API sent and re-encoded as a hex quantity, never
 * recomputed. Nothing here can encode calldata, so the review and the signature
 * cannot describe different transactions.
 *
 * Exported and tested rather than inlined, because "the bytes are unmodified" is
 * a property worth being able to fail a build over.
 */
export function toTransactionRequest(
  intent: WireIntent,
  from: `0x${string}`,
): TransactionRequest {
  if (!/^0x[0-9a-fA-F]*$/.test(intent.data)) {
    throw new TransactionError("MALFORMED_CALLDATA", "The transaction data is not hex.");
  }

  if (!/^\d+$/.test(intent.value)) {
    throw new TransactionError("MALFORMED_VALUE", "The transaction value is not a decimal integer.");
  }

  return {
    from,
    to: intent.to,
    data: intent.data,
    value: `0x${BigInt(intent.value).toString(16)}`,
  };
}
