/**
 * SENT — §694's last link, under test.
 *
 *     UI REVIEW = TRANSACTION INTENT = SDK BUILDER = ACTUAL CALLDATA
 *
 * Everything upstream of the wallet is already proven: the SDK's calldata is
 * submitted byte for byte to a real market in `IntentIntegrity.t.sol`, and the
 * review rows come from the same object that carries the bytes. This is the one
 * remaining step — the handoff to the wallet — and the property it must have is
 * simple enough to state in a sentence:
 *
 *     `to` and `data` reach the wallet unchanged, and `value` changes only its
 *     representation.
 *
 * A frontend is the easiest place in the stack to break that, because rebuilding
 * a transaction "to be safe" looks like diligence.
 */

import { toTransactionRequest, TransactionError } from "../src/lib/tx.ts";
import type { WireIntent } from "../src/lib/api.ts";

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;

/** A realistic buy: selector plus three 32-byte words. */
const BUY_DATA =
  "0xd96a094a" +
  "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
  "00000000000000000000000000000000000000000000000000000000000186a0" +
  "00000000000000000000000000000000000000000000000000000000655f2d00";

function intent(overrides: Partial<WireIntent> = {}): WireIntent {
  return {
    kind: "BUY",
    chainId: 999,
    to: MARKET,
    data: BUY_DATA as `0x${string}`,
    value: "0",
    review: { kind: "BUY", summary: "Buy TEST", rows: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

section("The bytes reach the wallet unchanged");

{
  const request = toTransactionRequest(intent(), FROM);

  // Identity, not equivalence. Re-encoding to the same bytes would still be a
  // second implementation of the encoding.
  check("the calldata is the same string", request.data === BUY_DATA);
  check("not merely equal after normalisation", request.data === intent().data);
  check("the target is the intent's own", request.to === MARKET);
  check("the sender is the connected account", request.from === FROM);

  // Nothing is added. A wallet given a gas limit or a nonce by the app is a
  // wallet whose own estimation has been overridden.
  check(
    "exactly four fields are sent",
    Object.keys(request).sort().join(",") === "data,from,to,value",
  );
}

section("Value changes representation, never magnitude");

{
  check("zero encodes as 0x0", toTransactionRequest(intent(), FROM).value === "0x0");

  check(
    "one ether encodes exactly",
    toTransactionRequest(intent({ value: "1000000000000000000" }), FROM).value ===
      "0xde0b6b3a7640000",
  );

  // Past 2^53. A value routed through Number() would come back rounded, and the
  // transaction would move a different amount than the review displayed.
  const huge = "123456789012345678901234567890";
  const encoded = toTransactionRequest(intent({ value: huge }), FROM).value;

  check("a value beyond floating point survives", BigInt(encoded) === BigInt(huge));
  check("and round-trips back to the same decimal", BigInt(encoded).toString() === huge);

  const maxUint256 = (2n ** 256n - 1n).toString();
  check(
    "a full uint256 survives",
    BigInt(toTransactionRequest(intent({ value: maxUint256 }), FROM).value) === BigInt(maxUint256),
  );
}

section("Malformed intents are refused, not repaired");

{
  const refuses = (over: Partial<WireIntent>, code: string): boolean => {
    try {
      toTransactionRequest(intent(over), FROM);
      return false;
    } catch (error) {
      return error instanceof TransactionError && error.code === code;
    }
  };

  check("non-hex calldata is refused", refuses({ data: "not hex" as `0x${string}` }, "MALFORMED_CALLDATA"));
  check("calldata without 0x is refused", refuses({ data: "d96a094a" as `0x${string}` }, "MALFORMED_CALLDATA"));

  // A hex value where a decimal string belongs would be read by BigInt() and
  // send a completely different amount.
  check("a hex value is refused", refuses({ value: "0x10" }, "MALFORMED_VALUE"));
  check("an exponent value is refused", refuses({ value: "1e18" }, "MALFORMED_VALUE"));
  check("a decimal value is refused", refuses({ value: "1.5" }, "MALFORMED_VALUE"));
  check("a negative value is refused", refuses({ value: "-1" }, "MALFORMED_VALUE"));
  check("an empty value is refused", refuses({ value: "" }, "MALFORMED_VALUE"));

  // Empty calldata is legal: a plain transfer has none. It must not be confused
  // with malformed calldata.
  let acceptedEmpty = false;
  try {
    acceptedEmpty = toTransactionRequest(intent({ data: "0x" }), FROM).data === "0x";
  } catch {
    acceptedEmpty = false;
  }
  check("empty calldata is accepted", acceptedEmpty);
}

section("An approval and a trade produce different transactions");

{
  // The two steps of a buy. If these ever produced the same request, the app
  // would be sending one of them twice.
  const approval = toTransactionRequest(
    intent({
      kind: "APPROVE_QUOTE",
      to: "0x4444444444444444444444444444444444444444",
      data: "0x095ea7b3" as `0x${string}`,
    }),
    FROM,
  );
  const trade = toTransactionRequest(intent(), FROM);

  check("they target different contracts", approval.to !== trade.to);
  check("and carry different calldata", approval.data !== trade.data);
  check("the approval targets the asset, not the market", approval.to !== MARKET);
}

console.log(failures === 0 ? "\ntx: all checks passed" : `\ntx: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
