/**
 * SENT — creator fee claim intent audit.
 *
 * `claimCreatorFees(address,address)` takes two addresses and no amount. That is
 * the whole hazard: transposing the arguments produces valid calldata that sends
 * the fees to the asset's own contract, where they are gone. Nothing about the
 * transaction would look wrong to a user, and nothing about the encoding would
 * fail.
 *
 * So the selector and both arguments are computed independently here and
 * compared byte for byte, rather than asserted against whatever the builder
 * produced.
 *
 * Run: pnpm sim:claim
 */

import { encodeFunctionData, keccak256, toHex } from "viem";

import { buildClaimCreatorFeesIntent } from "../src/intent.ts";

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
const ASSET = "0x2222222222222222222222222222222222222222" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;

const claimAbi = [
  {
    type: "function",
    name: "claimCreatorFees",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const;

function intent(amount = 1_500_000_000_000_000_000n) {
  return buildClaimCreatorFeesIntent({
    chainId: CHAIN_ID,
    feeVault: VAULT,
    asset: ASSET,
    to: CREATOR,
    amount,
    decimals: 18,
    symbol: "NVDAx",
  });
}

// ---------------------------------------------------------------------------

section("The calldata is a claim and nothing else");

{
  const built = intent();

  const selector = keccak256(toHex("claimCreatorFees(address,address)")).slice(0, 10);
  check("the selector is claimCreatorFees(address,address)", built.data.slice(0, 10) === selector);

  check("the calldata is a selector and two words", built.data.length === 10 + 128);

  // The asset comes FIRST. Transposed, the vault would be asked to pay the
  // creator's balance of the creator's own address — an asset that owes nothing,
  // so the claim reverts rather than misdirecting funds. The revert is the
  // benign outcome and it is still a bug the user pays gas for.
  const expected = encodeFunctionData({
    abi: claimAbi,
    functionName: "claimCreatorFees",
    args: [ASSET, CREATOR],
  });

  check("byte for byte", built.data === expected);

  check("the asset is the first argument", built.data.slice(10, 74).endsWith(ASSET.slice(2)));
  check("the recipient is the second", built.data.slice(74).endsWith(CREATOR.slice(2)));
}

section("It targets the vault, and moves no value itself");

{
  const built = intent();

  // The vault, not the asset. Sending this calldata to the ERC-20 would hit an
  // unknown selector and revert, but only after the user signed it.
  check("the transaction goes to the fee vault", built.to === VAULT);
  check("it carries no ether", built.value === 0n);
  check("and no deadline, because there is nothing to expire", built.deadline === undefined);
}

section("The review states what the transaction actually does");

{
  const built = intent();

  check("it is a CLAIM_CREATOR_FEES intent", built.kind === "CLAIM_CREATOR_FEES");
  check("and its review agrees", built.review.kind === built.kind);

  const rows = built.review.rows;

  // Fixed precision, not a trimmed decimal. The SDK's formatter pads to six
  // places so a column of amounts lines up, and matching it here is the point:
  // this asserts what a user actually reads, not what looks tidy in a test.
  check("the amount is shown in plain units", rows[0]?.value === "1.500000 NVDAx");
  check("as the primary row", rows[0]?.primary === true);

  // The call has no amount argument, so the figure shown is what the vault owed
  // when the page read it. Saying so is the difference between a stale number
  // and a misleading one.
  check(
    "the review says the full balance is claimed",
    rows.some((r) => r.value.includes("full balance")),
  );

  check("the recipient is stated", rows.some((r) => r.value === CREATOR));
  check("and the asset", rows.some((r) => r.value.includes(ASSET)));
}

section("Nothing to claim is refused rather than encoded");

{
  // A zero-amount claim would encode perfectly and revert with NothingToClaim,
  // after the user paid gas. Refusing it here is cheaper than refusing it on
  // chain.
  let refused = false;
  try {
    intent(0n);
  } catch {
    refused = true;
  }
  check("a zero claim is refused", refused);

  let negativeRefused = false;
  try {
    intent(-1n);
  } catch {
    negativeRefused = true;
  }
  check("so is a negative one", negativeRefused);
}

section("A six-decimal asset renders in its own units");

{
  // xStocks are not eighteen-decimal assets. Rendering 1500000 raw units of a
  // six-decimal token as 0.0000000000015 is the same scale error that has
  // already appeared twice in this codebase.
  const built = buildClaimCreatorFeesIntent({
    chainId: CHAIN_ID,
    feeVault: VAULT,
    asset: ASSET,
    to: CREATOR,
    amount: 1_500_000n,
    decimals: 6,
    symbol: "NVDAx",
  });

  check(
    "1500000 raw units of a six-decimal asset reads as 1.5",
    built.review.rows[0]?.value === "1.500000 NVDAx",
  );
  check(
    "and the summary agrees",
    built.review.summary === "Claim 1.500000 NVDAx in creator fees",
  );
}

console.log(failures === 0 ? "\nclaim: all checks passed" : `\nclaim: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
