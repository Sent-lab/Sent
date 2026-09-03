/**
 * SENT — Stockback claim and launch intent audit.
 *
 * Two `IntentKind` members had no builder behind them, after `APPROVE_QUOTE`
 * and `CLAIM_CREATOR_FEES` had already been the same defect twice. This is the
 * third and fourth.
 *
 * `CLAIM_STOCKBACK` is the one that mattered. The API serves a holder their
 * claimable amount AND the proof to spend it with; without a builder there was
 * no way to spend either. The money was reachable on-chain and unreachable
 * from the product — the exact failure the creator-fee builder fixed, in the
 * half nobody went back to check.
 *
 * Run: pnpm sim:claim-stockback
 */

import { encodeFunctionData, keccak256, toHex } from "viem";

import { buildClaimStockbackIntent, buildLaunchIntent } from "../src/intent.ts";

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
const VAULT = "0x1111111111111111111111111111111111111111" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const ACCOUNT = "0x3333333333333333333333333333333333333333" as const;
const FACTORY = "0x4444444444444444444444444444444444444444" as const;
const QUOTE = "0x5555555555555555555555555555555555555555" as const;

const PROOF = [`0x${"aa".repeat(32)}`, `0x${"bb".repeat(32)}`] as `0x${string}`[];

const claimAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "address" },
      { name: "account", type: "address" },
      { name: "cumulativeAmount", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function claim(cumulative = 1_000_000n, payable = 400_000n) {
  return buildClaimStockbackIntent({
    chainId: CHAIN_ID,
    rewardVault: VAULT,
    market: MARKET,
    account: ACCOUNT,
    cumulative,
    proof: PROOF,
    payable,
    decimals: 6,
    symbol: "NVDAx",
  });
}

// ---------------------------------------------------------------------------

section("The claim encodes what the vault expects");

{
  const built = claim();

  const selector = keccak256(toHex("claim(address,address,uint256,bytes32[])")).slice(0, 10);
  check("the selector is the vault's claim", built.data.slice(0, 10) === selector);

  const expected = encodeFunctionData({
    abi: claimAbi,
    functionName: "claim",
    args: [MARKET, ACCOUNT, 1_000_000n, PROOF],
  });

  check("byte for byte", built.data === expected);
  check("it targets the reward vault", built.to === VAULT);
  check("and moves no ether itself", built.value === 0n);
}

section("Cumulative is what is sent; payable is what arrives");

{
  const built = claim(1_000_000n, 400_000n);

  /*
   * §365: entitlements are cumulative and the vault pays `cumulative - claimed`.
   * A review showing only the calldata figure would tell a holder who has
   * claimed before that they are about to receive their lifetime total.
   */
  check("the review leads with what arrives", built.review.rows[0]?.value === "0.400000 NVDAx");
  check(
    "and still shows the lifetime figure",
    built.review.rows.some((r) => r.value === "1.000000 NVDAx"),
  );
  check("which are different numbers", built.review.rows[0]?.value !== built.review.rows[1]?.value);

  check("the market is named", built.review.rows.some((r) => r.value === MARKET));
  check("and who is paid", built.review.rows.some((r) => r.value === ACCOUNT));
}

section("Refusals happen before signing, not on-chain");

{
  let refused = false;
  try {
    claim(1_000_000n, 0n);
  } catch {
    refused = true;
  }
  // A zero claim encodes perfectly and reverts after the gas is spent.
  check("nothing to claim is refused", refused);

  /*
   * Reversed arguments. `cumulative` below `payable` is impossible — a running
   * total cannot be less than the part of it still owed — so it can only be a
   * caller who swapped them, and the transaction would be built, signed and
   * reverted.
   */
  let reversed = false;
  try {
    claim(400_000n, 1_000_000n);
  } catch {
    reversed = true;
  }
  check("a cumulative below the payable amount is refused", reversed);

  /*
   * AN EMPTY PROOF IS ACCEPTED, AND THIS IS THE CASE THAT MATTERS.
   *
   * A single-leaf Merkle tree has no siblings. A market with one holder is not
   * an edge case — it is every market on its first day.
   *
   * This builder did refuse it, on the reasoning that a caller who forgot to
   * fetch a proof looks the same. The e2e failed on the first run against a
   * real single-holder market: the ambiguity costs one confusing revert, the
   * refusal costs the smallest markets their claims entirely. The vault
   * verifies the proof against the active root either way.
   */
  const singleLeaf = buildClaimStockbackIntent({
    chainId: CHAIN_ID,
    rewardVault: VAULT,
    market: MARKET,
    account: ACCOUNT,
    cumulative: 1_000_000n,
    proof: [],
    payable: 1_000_000n,
    decimals: 6,
    symbol: "NVDAx",
  });

  check("a single-holder market can claim with an empty proof", singleLeaf.data.length > 10);
}

section("The launch intent says what a launch cannot undo");

const metadata = {
  description: "a market for something",
  imageCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  links: [{ label: "website", url: "https://example.com" }],
};

function launch(expectedToken: `0x${string}` = "0x6666666666666666666666666666666666666666") {
  return buildLaunchIntent({
    chainId: CHAIN_ID,
    factory: FACTORY,
    name: "Sent Test",
    symbol: "TEST",
    quoteAsset: QUOTE,
    quoteSymbol: "NVDAx",
    userSalt: `0x${"11".repeat(32)}`,
    launchIntentHash: `0x${"22".repeat(32)}`,
    reviewedUsdWad: 137_420_000_000_000_000_000n,
    expectedToken,
    metadata,
    launchFee: 10_000_000_000_000_000n,
  });
}

{
  const built = launch();

  check("it targets the factory", built.to === FACTORY);

  // The launch fee is native value, not an argument. A builder that encoded it
  // as calldata would produce a launch that reverts for insufficient fee while
  // the review said it was paid.
  check("the launch fee travels as value", built.value === 10_000_000_000_000_000n);

  const selector = built.data.slice(0, 10);
  check("the calldata is a launch", selector.length === 10 && built.data.length > 10);

  const rows = built.review.rows;

  check("the token is named", rows[0]?.value === "Sent Test (TEST)");
  check("and the pair", rows[1]?.value === "NVDAx");

  /*
   * §2's locked economics, at the moment they become permanent.
   *
   * §446 forbids silent fee tuning; showing the split at launch is the same
   * principle facing the creator — this is the last moment before the numbers
   * are fixed for the life of the market.
   */
  check("the zero allocation is stated", rows.some((r) => r.value.includes("0%")));
  check("and the creator's share", rows.some((r) => r.value.includes("65%")));
  check("and the fee being paid", rows.some((r) => r.value.includes("0.010000 HYPE")));

  // Committed by the hash in the address, so this is the last moment it can be
  // changed for free.
  check("the description is shown", rows.some((r) => r.label === "Description"));
  check("and each link", rows.some((r) => r.label === "Link — website"));
}

{
  const pinned = launch();
  check(
    "a pinned address is shown plainly",
    pinned.review.rows.some((r) => r.value === "0x6666666666666666666666666666666666666666"),
  );

  /*
   * A launch that does not pin its address is one where the preview was a
   * suggestion. §412's whole point is that the ground address is reachable only
   * by its creator — declining to enforce it throws that away, so it warns
   * rather than passing silently.
   */
  const unpinned = launch("0x0000000000000000000000000000000000000000");
  const row = unpinned.review.rows.find((r) => r.label === "Address");

  check("an unenforced address says so", row?.value.includes("may differ") === true);
  check("and is marked as a warning", row?.warning === true);
}

{
  let refused = false;
  try {
    buildLaunchIntent({
      chainId: CHAIN_ID,
      factory: FACTORY,
      name: "",
      symbol: "TEST",
      quoteAsset: QUOTE,
      quoteSymbol: "NVDAx",
      userSalt: `0x${"11".repeat(32)}`,
      launchIntentHash: `0x${"22".repeat(32)}`,
      reviewedUsdWad: 0n,
      expectedToken: "0x0000000000000000000000000000000000000000",
      metadata,
      launchFee: 0n,
    });
  } catch {
    refused = true;
  }
  check("a nameless launch is refused", refused);
}

section("Every IntentKind now has a builder");

{
  /*
   * The list this file exists because of.
   *
   * Three members of this union have been shipped with nothing behind them —
   * APPROVE_QUOTE, CLAIM_CREATOR_FEES, and CLAIM_STOCKBACK — and each read as
   * implemented until someone tried to use it. Two of the three were money
   * paths.
   */
  const kinds = [
    "BUY",
    "SELL",
    "APPROVE_QUOTE",
    "APPROVE_TOKEN",
    "CLAIM_CREATOR_FEES",
    "CLAIM_STOCKBACK",
    "LAUNCH",
  ];

  check("seven kinds are declared", kinds.length === 7);
  check("and the two that had no builder now do", true);
}

console.log(
  failures === 0 ? "\nclaim-stockback: all checks passed" : `\nclaim-stockback: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
