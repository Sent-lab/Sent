/**
 * SENT — approval intent audit.
 *
 * An ERC-20 approval is four bytes of selector and two words of arguments, which
 * is exactly why it is worth testing: there is nothing to notice if it is wrong.
 * A transposed argument order approves the amount as a spender address, and
 * `approve(address,uint256)` has the same shape as several functions that do
 * very different things.
 *
 * So the selector and both arguments are asserted against the values computed
 * independently here, not against whatever the builder happened to produce.
 */

import { encodeFunctionData, keccak256, toHex } from "viem";

import { buildApproveIntent } from "../src/intent.ts";

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

const CHAIN_ID = 999;
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;

// ---------------------------------------------------------------------------

section("The calldata is an ERC-20 approval and nothing else");

{
  const amount = 1_234_567n;

  const intent = buildApproveIntent({
    chainId: CHAIN_ID,
    token: TOKEN,
    spender: MARKET,
    amount,
    decimals: 6,
    symbol: "NVDAx",
    kind: "APPROVE_QUOTE",
  });

  // Derived from the signature rather than copied from a table, so a table typo
  // cannot make this agree with itself.
  const selector = keccak256(toHex("approve(address,uint256)")).slice(0, 10);

  check("the selector is approve(address,uint256)", intent.data.slice(0, 10) === selector);
  check("the calldata is 4 + 32 + 32 bytes", intent.data.length === 2 + 8 + 64 + 64);

  // The two words, read positionally. A transposed builder would put the amount
  // where the spender belongs, and both would still be 32 bytes.
  const word1 = intent.data.slice(10, 74);
  const word2 = intent.data.slice(74, 138);

  check("the first argument is the spender", word1 === MARKET.slice(2).padStart(64, "0"));
  check("the second argument is the amount", BigInt(`0x${word2}`) === amount);

  check("the transaction targets the token, not the market", intent.to === TOKEN);
  check("it carries no native value", intent.value === 0n);
  check("and no deadline, because an approval has none", intent.deadline === undefined);
}

section("The approval is for the exact amount, never unlimited");

{
  const amount = 500n;
  const intent = buildApproveIntent({
    chainId: CHAIN_ID,
    token: TOKEN,
    spender: MARKET,
    amount,
    decimals: 18,
    symbol: "TEST",
    kind: "APPROVE_TOKEN",
  });

  const encoded = BigInt(`0x${intent.data.slice(74, 138)}`);
  const MAX_UINT256 = 2n ** 256n - 1n;

  check("the encoded amount is what was asked for", encoded === amount);

  // The property that matters. An unlimited approval means a single bug in this
  // market drains every wallet that ever traded with it, forever.
  check("it is not type(uint256).max", encoded !== MAX_UINT256);

  // A review that says "unlimited" is a review nobody reads carefully. The
  // amount appears as a number, and the approval type is stated outright.
  check(
    "the review states the amount",
    intent.review.rows.some((row) => row.value.includes("500")),
  );
  check(
    "and says it is not unlimited",
    intent.review.rows.some((row) => row.value.toLowerCase().includes("not unlimited")),
  );
  check(
    "the review names the spender",
    intent.review.rows.some((row) => row.value === MARKET),
  );
}

section("Decimals are display only and never touch the encoding");

{
  // The same raw amount at two different decimal settings must produce
  // byte-identical calldata: `decimals` scales what a human reads, never what
  // the chain receives.
  const raw = 1_000_000n;

  const six = buildApproveIntent({
    chainId: CHAIN_ID, token: TOKEN, spender: MARKET, amount: raw,
    decimals: 6, symbol: "A", kind: "APPROVE_QUOTE",
  });
  const eighteen = buildApproveIntent({
    chainId: CHAIN_ID, token: TOKEN, spender: MARKET, amount: raw,
    decimals: 18, symbol: "A", kind: "APPROVE_QUOTE",
  });

  check("the calldata is identical", six.data === eighteen.data);
  check("but the review differs", six.review.summary !== eighteen.review.summary);
  check("six decimals reads as 1.000000", six.review.summary.includes("1."));
}

section("The kind distinguishes which asset is being approved (§694)");

{
  const quote = buildApproveIntent({
    chainId: CHAIN_ID, token: TOKEN, spender: MARKET, amount: 1n,
    decimals: 18, symbol: "A", kind: "APPROVE_QUOTE",
  });
  const token = buildApproveIntent({
    chainId: CHAIN_ID, token: TOKEN, spender: MARKET, amount: 1n,
    decimals: 18, symbol: "A", kind: "APPROVE_TOKEN",
  });

  check("a quote approval is labelled as one", quote.kind === "APPROVE_QUOTE");
  check("a token approval is labelled as one", token.kind === "APPROVE_TOKEN");
  check("the review carries the same kind", quote.review.kind === quote.kind);
}

section("Malformed input is refused");

{
  const base = {
    chainId: CHAIN_ID, token: TOKEN, spender: MARKET,
    decimals: 18, symbol: "A", kind: "APPROVE_QUOTE" as const,
  };

  // A zero approval is a real ERC-20 operation — it revokes — but it is not what
  // this builder is for, and silently building one from an empty input field
  // would produce a transaction the user did not intend.
  let refusedZero = false;
  try {
    buildApproveIntent({ ...base, amount: 0n });
  } catch {
    refusedZero = true;
  }
  check("a zero amount is refused", refusedZero);

  let refusedNegative = false;
  try {
    buildApproveIntent({ ...base, amount: -1n });
  } catch {
    refusedNegative = true;
  }
  check("a negative amount is refused", refusedNegative);
}

section("The encoding matches viem's own, independently");

{
  // A second opinion from the library, using an ABI written here rather than the
  // one the builder holds. If both are wrong in the same way, they were wrong in
  // two separately written places.
  const amount = 42n;
  const expected = encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
      },
    ] as const,
    functionName: "approve",
    args: [MARKET, amount],
  });

  const intent = buildApproveIntent({
    chainId: CHAIN_ID, token: TOKEN, spender: MARKET, amount,
    decimals: 18, symbol: "A", kind: "APPROVE_QUOTE",
  });

  check("byte for byte", intent.data === expected);
}

console.log(failures === 0 ? "\napprove: all checks passed" : `\napprove: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
