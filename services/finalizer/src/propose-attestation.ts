/**
 * Build a Stockback attestation proposal from this operator's own indexed data.
 *
 * This tool never sees a private key and never sends a transaction. Each
 * attestor should run it against an independently operated indexer/database,
 * compare the resulting digest with the other attestors, then sign the exported
 * EIP-712 payload using their separately controlled wallet or HSM.
 */

import {
  createPublicClient,
  encodeFunctionData,
  hashTypedData,
  http,
  recoverAddress,
  type Address,
  type Hex,
} from "viem";
import {
  Database,
  finalizedHead,
  getExclusions,
  getLatestDataset,
  getMarketByToken,
  getTotalFundedThrough,
  listBalanceEvents,
  listFundingByEpoch,
} from "@sent/database";
import { HOLDER_REWARD_VAULT, HYPEREVM_PUBLIC_RPC } from "@sent/config";
import { databaseEnv } from "@sent/config/env";
import { holderRewardVaultAbi } from "@sent/contracts";
import { EPOCH_DURATION_SECONDS } from "@sent/stockback";
import { computeFinalization, Finalizer } from "./finalizer.ts";

const CHAIN_ID = 999;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
const TYPES = {
  StockbackCommitment: [
    { name: "chainId", type: "uint256" },
    { name: "vault", type: "address" },
    { name: "market", type: "address" },
    { name: "token", type: "address" },
    { name: "rewardAsset", type: "address" },
    { name: "distributionVersion", type: "uint256" },
    { name: "epochSequence", type: "uint256" },
    { name: "totalCumulative", type: "uint256" },
    { name: "merkleRoot", type: "bytes32" },
    { name: "datasetHash", type: "bytes32" },
  ],
} as const;

function fail(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  const tokenInput = process.argv[2];
  if (tokenInput === undefined || !/^0x[0-9a-fA-F]{40}$/.test(tokenInput)) {
    fail("Usage: pnpm --filter @sent/finalizer proposal -- <token-address>");
  }
  const args = process.argv.slice(3);
  let signatures: Hex[] | null = null;
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== "--signatures") {
      fail('Optional signing input: --signatures \'["0x<65-byte-signature>", ...]\'');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(args[1]!);
    } catch {
      fail("--signatures must be a JSON array of hex signatures");
    }
    if (
      !Array.isArray(parsed) ||
      parsed.some((signature) => typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    ) {
      fail("Each signature must be a 65-byte hex ECDSA signature");
    }
    signatures = parsed as Hex[];
  }

  const token = tokenInput.toLowerCase() as Address;
  // Treat the blank placeholder in `.env.example` the same as an unset value.
  const vaultInput = process.env.REWARD_VAULT_ADDRESS?.trim() || HOLDER_REWARD_VAULT;
  if (!/^0x[0-9a-fA-F]{40}$/.test(vaultInput)) {
    fail("REWARD_VAULT_ADDRESS must be a 20-byte address");
  }
  const vault = vaultInput.toLowerCase() as Address;
  const rpcUrl = process.env.RPC_URL?.trim() || HYPEREVM_PUBLIC_RPC;
  new URL(rpcUrl);

  const db = new Database(databaseEnv());
  try {
    const marketRecord = await getMarketByToken(db, token);
    if (marketRecord === null) fail(`Token ${token} is not present in this operator's indexer database`);

    const latest = await getLatestDataset(db, marketRecord.market);
    if (latest === null) fail("This indexer has no computed Stockback dataset for the market");

    const settled = await finalizedHead(db);
    if (settled === null) fail("This indexer has no finalized block yet");

    const finalizer = new Finalizer(db);
    const settledThrough = finalizer.finalizableThrough(settled.timestamp);
    if (latest.epochSequence > settledThrough) {
      fail("The latest dataset extends beyond this indexer's settled epoch boundary");
    }

    // Rebuild from this node's confirmed chain projection, not from the API's
    // leaf list. The existing dataset is used only as a value to compare with.
    const toTimestamp = Number((latest.epochSequence + 1n) * EPOCH_DURATION_SECONDS);
    const outcome = computeFinalization({
      target: {
        market: marketRecord.market,
        token: marketRecord.token,
        rewardAsset: marketRecord.quoteAsset,
      },
      through: latest.epochSequence,
      events: await listBalanceEvents(db, marketRecord.market, 0, toTimestamp),
      funding: await listFundingByEpoch(
        db,
        marketRecord.market,
        toTimestamp,
        EPOCH_DURATION_SECONDS,
      ),
      totalFunded: await getTotalFundedThrough(db, marketRecord.market, toTimestamp),
      excludedAccounts: await getExclusions(db, marketRecord.market),
      lastCommittedEpoch: null,
    });
    if (typeof outcome === "string") fail(`Local dataset cannot be rebuilt: ${outcome}`);

    const computed = outcome.result.commitment;
    if (
      computed.epochSequence !== latest.epochSequence ||
      computed.merkleRoot.toLowerCase() !== latest.merkleRoot.toLowerCase() ||
      computed.datasetHash.toLowerCase() !== latest.datasetHash.toLowerCase() ||
      computed.totalCumulative !== latest.totalCumulative
    ) {
      fail("Independent recomputation does not match the persisted dataset; do not sign it");
    }

    const client = createPublicClient({ transport: http(rpcUrl) });
    const chainId = await client.getChainId();
    if (chainId !== CHAIN_ID) fail(`RPC is on chain ${chainId}; expected HyperEVM ${CHAIN_ID}`);
    const vaultCode = await client.getCode({ address: vault });
    if (vaultCode === undefined || vaultCode === "0x") fail(`No contract code at reward vault ${vault}`);

    const [registered, rewardAsset, funded, quorum, attestorCount, governance, guardian, claimsPaused, active, pending] =
      await Promise.all([
        client.readContract({
          abi: holderRewardVaultAbi,
          address: vault,
          functionName: "isMarket",
          args: [marketRecord.market],
        }),
        client.readContract({
          abi: holderRewardVaultAbi,
          address: vault,
          functionName: "rewardAsset",
          args: [marketRecord.market],
        }),
        client.readContract({
          abi: holderRewardVaultAbi,
          address: vault,
          functionName: "funded",
          args: [marketRecord.market],
        }),
        client.readContract({ abi: holderRewardVaultAbi, address: vault, functionName: "quorum" }),
        client.readContract({
          abi: holderRewardVaultAbi,
          address: vault,
          functionName: "attestorCount",
        }),
        client.readContract({
          abi: holderRewardVaultAbi,
          address: vault,
          functionName: "governance",
        }),
        client.readContract({ abi: holderRewardVaultAbi, address: vault, functionName: "guardian" }),
        client.readContract({
          abi: holderRewardVaultAbi,
          address: vault,
          functionName: "claimsPaused",
        }),
        client.readContract({
          abi: holderRewardVaultAbi,
          address: vault,
          functionName: "active",
          args: [marketRecord.market],
        }),
        client.readContract({
          abi: holderRewardVaultAbi,
          address: vault,
          functionName: "pending",
          args: [marketRecord.market],
        }),
      ]);

    if (!registered) fail("The reward vault has not registered this market");
    if (rewardAsset.toLowerCase() !== marketRecord.quoteAsset.toLowerCase()) {
      fail("The vault reward asset differs from this market's indexed quote asset");
    }
    if (guardian.toLowerCase() === `0x${"0".repeat(40)}` || guardian.toLowerCase() === governance.toLowerCase()) {
      fail("The reward vault does not have a distinct, nonzero guardian address");
    }
    const [governanceCode, guardianCode] = await Promise.all([
      client.getCode({ address: governance }),
      client.getCode({ address: guardian }),
    ]);
    if (governanceCode === undefined || governanceCode === "0x") {
      fail("The reward vault governance address is not a deployed Safe contract");
    }
    if (guardianCode === undefined || guardianCode === "0x") {
      fail("The reward vault guardian address is not a deployed Safe contract");
    }
    if (quorum === 0n || attestorCount < quorum) fail("The vault does not have enough configured attestors for its quorum");
    if (computed.totalCumulative > funded) fail("The proposed cumulative entitlement exceeds live on-chain funding");

    const [activeRoot, , activeTotal, activeSequence] = active;
    const [pendingRoot, , pendingTotal, pendingSequence] = pending;
    const haveActive = activeRoot.toLowerCase() !== ZERO_HASH;
    const havePending = pendingRoot.toLowerCase() !== ZERO_HASH;
    const highestSequence =
      havePending && (!haveActive || pendingSequence > activeSequence)
        ? pendingSequence
        : activeSequence;
    const highestTotal = havePending && pendingTotal > activeTotal ? pendingTotal : activeTotal;
    if ((haveActive || havePending) && computed.epochSequence <= highestSequence) {
      fail("The proposal is not newer than the active or pending on-chain commitment");
    }
    if (computed.totalCumulative < highestTotal) {
      fail("The proposal would reduce the active or pending cumulative entitlement");
    }

    const message = {
      chainId: BigInt(CHAIN_ID),
      vault,
      market: marketRecord.market,
      token: marketRecord.token,
      rewardAsset: marketRecord.quoteAsset,
      distributionVersion: 1n,
      epochSequence: computed.epochSequence,
      totalCumulative: computed.totalCumulative,
      merkleRoot: computed.merkleRoot,
      datasetHash: computed.datasetHash,
    } as const;
    const domain = {
      name: "SENT Stockback",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: vault,
    } as const;
    const digest = hashTypedData({
      domain,
      types: TYPES,
      primaryType: "StockbackCommitment",
      message,
    });
    const onchainDigest = await client.readContract({
      abi: holderRewardVaultAbi,
      address: vault,
      functionName: "hashCommitment",
      args: [message],
    });
    if (digest.toLowerCase() !== onchainDigest.toLowerCase()) {
      fail("The exported EIP-712 digest does not match the vault's on-chain hashCommitment");
    }

    let submission: {
      readonly destination: Address;
      readonly calldata: Hex;
      readonly signatureCount: number;
      readonly recoveredSigners: readonly Address[];
      readonly simulation: "PASSED";
    } | null = null;
    if (signatures !== null) {
      if (BigInt(signatures.length) < quorum || BigInt(signatures.length) > attestorCount) {
        fail("Signature count must meet quorum and cannot exceed the live attestor count");
      }
      const recovered = await Promise.all(
        signatures.map((signature) => recoverAddress({ hash: digest, signature })),
      );
      for (let i = 0; i < recovered.length; i += 1) {
        const signer = recovered[i]!;
        if (i > 0 && signer.toLowerCase() <= recovered[i - 1]!.toLowerCase()) {
          fail("Recovered signers must be unique and sorted by ascending address");
        }
        const isAttestor = await client.readContract({
          abi: holderRewardVaultAbi,
          address: vault,
          functionName: "isAttestor",
          args: [signer],
        });
        if (!isAttestor) fail(`Recovered signer ${signer} is not a current on-chain attestor`);
      }

      const calldata = encodeFunctionData({
        abi: holderRewardVaultAbi,
        functionName: "submitCommitment",
        args: [message, signatures],
      });
      await client.simulateContract({
        abi: holderRewardVaultAbi,
        address: vault,
        functionName: "submitCommitment",
        args: [message, signatures],
      });
      submission = {
        destination: vault,
        calldata,
        signatureCount: signatures.length,
        recoveredSigners: recovered,
        simulation: "PASSED",
      };
    }

    console.log(JSON.stringify({
      status: submission === null ? "READY_FOR_INDEPENDENT_ATTESTOR_REVIEW" : "CALLDATA_READY_FOR_WALLET_REVIEW",
      warning: "This command never uses a private key or broadcasts. Independently review source events and exclusions before signing, then review the calldata in your wallet; it can become stale before submission.",
      source: {
        token: marketRecord.token,
        market: marketRecord.market,
        rewardAsset: marketRecord.quoteAsset,
        finalizedBlock: settled.number.toString(),
        recomputedAgainstLocalIndexer: true,
        matchesPersistedDataset: true,
      },
      onchain: {
        chainId,
        vault,
        marketRegistered: registered,
        rewardAsset,
        funded: funded.toString(),
        quorum: quorum.toString(),
        attestorCount: attestorCount.toString(),
        governance,
        guardian,
        claimsPaused,
        hashCommitmentMatches: true,
      },
      commitment: Object.fromEntries(
        Object.entries(message).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
      ),
      typedData: { domain, primaryType: "StockbackCommitment", types: TYPES, message },
      digest,
      submission,
    }, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(`[stockback-proposal] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
