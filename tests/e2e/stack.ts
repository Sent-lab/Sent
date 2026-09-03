/**
 * SENT — full stack, end to end.
 *
 * Deploys the real contracts to a real chain, launches a real market, executes
 * real trades, runs the real indexer against them, and asserts the projection
 * and the API agree with what the chain actually did.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every seam in this system has now broken at least once, and every one of them
 * broke in the same way: both sides were correct in isolation and the join
 * between them was never exercised. The balances upsert typechecked and would
 * have stopped indexing at the first sell. The realtime server wiped its own
 * subscriptions on a timer. The API sent no CORS headers and worked perfectly
 * from curl.
 *
 * The last untested seam is the largest one: contracts to indexer. Everything
 * before this point either tested the contracts through Foundry or tested the
 * indexer through synthetic logs. Nothing has ever produced a log with a real
 * contract and fed it to the real reducer.
 *
 * IT SKIPS WITHOUT A CHAIN
 * ------------------------
 * Needs an EVM node and a database:
 *
 *   anvil
 *   docker run --rm -e POSTGRES_PASSWORD=sent -e POSTGRES_USER=sent \
 *     -e POSTGRES_DB=sent -p 5432:5432 postgres:16-alpine
 *
 *   RPC_URL=http://127.0.0.1:8545 \
 *   DATABASE_URL=postgres://sent:sent@localhost:5432/sent \
 *     node --experimental-strip-types tests/e2e/stack.ts
 *
 * Contracts are deployed from the artifacts Foundry already built, so this runs
 * exactly the bytecode the test suite ran against — not a re-compilation.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { Database, migrate, loadMigrations, getMarketByToken, listTrades } from "@sent/database";
import { Indexer, DEFAULT_CONFIG } from "@sent/indexer";

const RPC_URL = process.env.RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;

if (RPC_URL === undefined || DATABASE_URL === undefined) {
  console.log("e2e: RPC_URL or DATABASE_URL not set, skipping (see the header)");
  process.exit(0);
}

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

/** Anvil's first account. A well-known development key, never used elsewhere. */
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const ROOT = join(import.meta.dirname, "..", "..");

interface Artifact {
  abi: Abi;
  bytecode: { object: Hex };
}

/** Load a compiled contract from Foundry's output. */
function artifact(name: string, file = `${name}.sol`): Artifact {
  const path = join(ROOT, "contracts", "out", file, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

const account = privateKeyToAccount(DEPLOYER_KEY);
const transport = http(RPC_URL);

// `cacheTime: 0` because viem caches `eth_blockNumber` for its polling interval
// by default — four seconds of a frozen head, which in a test that mines and
// reverts within milliseconds looks exactly like a chain that stopped moving.
const publicClient = createPublicClient({ transport, cacheTime: 0 });
const wallet = createWalletClient({ account, transport });

async function deploy(
  name: string,
  args: readonly unknown[],
  file?: string,
): Promise<Address> {
  const { abi, bytecode } = artifact(name, file);

  const hash = await wallet.deployContract({
    abi,
    bytecode: bytecode.object,
    args: args as never,
    chain: null,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.contractAddress === null || receipt.contractAddress === undefined) {
    throw new Error(`${name} did not deploy`);
  }
  return receipt.contractAddress;
}

async function send(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
  value = 0n,
): Promise<void> {
  const hash = await wallet.writeContract({
    address,
    abi,
    functionName,
    args: args as never,
    value,
    chain: null,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
}

/**
 * Poll until a condition holds, or give up.
 *
 * Polling rather than sleeping a fixed interval: a fixed sleep is either flaky
 * or slow, and usually manages both.
 */
async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 30_000): Promise<T | null> {
  const deadlineAt = Date.now() + timeoutMs;

  while (Date.now() < deadlineAt) {
    const result = await probe();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return null;
}

const db = new Database({ connectionString: DATABASE_URL });

try {
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db, loadMigrations());

  const chainId = await publicClient.getChainId();
  section(`Deploying to chain ${chainId}`);

  // --- Contracts ---------------------------------------------------------

  const governance = account.address;
  // Governance and treasury must differ; the deploy script refuses otherwise,
  // and there is no reason for a test to be the exception.
  const treasury = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

  const registry = await deploy("XStockRegistry", [governance]);
  const factory = await deploy("LaunchpadFactory", [governance, treasury, registry, 0n]);

  check("the registry deployed", registry.length === 42);
  check("the factory deployed", factory.length === 42);

  const factoryAbi = artifact("LaunchpadFactory").abi;
  const registryAbi = artifact("XStockRegistry").abi;

  const feeVault = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "FEE_VAULT",
  })) as Address;

  const rewardVault = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "REWARD_VAULT",
  })) as Address;

  check("the factory built its own fee vault", feeVault.length === 42);
  check("and its own reward vault", rewardVault !== feeVault);

  // --- A quote asset -----------------------------------------------------

  // Six decimals, because that is where normalisation bugs live and an
  // eighteen-decimal test would never have caught the fee-settlement fault.
  const quote = await deploy("ProjQuote", [6], "ProjectionFixture.t.sol");
  const quoteAbi = artifact("ProjQuote", "ProjectionFixture.t.sol").abi;

  await send(registry, registryAbi, "registerAsset", [quote, 6, 0, 0]);
  await send(registry, registryAbi, "setGates", [
    quote,
    {
      canonicalRepresentation: true,
      transferBehaviour: true,
      multiplierBehaviour: true,
      priceSource: true,
      haltSource: true,
      hyperSwapCompatible: true,
      normalizedAccountingTested: true,
      legalReviewed: true,
    },
  ]);
  await send(registry, registryAbi, "enableAsset", [quote]);

  const launchable = (await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "isLaunchable",
    args: [quote],
  })) as boolean;

  check("the asset is launchable only after every gate passes", launchable);

  // --- The router --------------------------------------------------------

  // A market cannot launch without one, which is the factory refusing to create
  // something that could never graduate. On mainnet this is blocked on V-06 and
  // V-09; here a stub stands in so the pre-graduation path can be exercised.
  const router = await deploy("ProjRouter", [], "ProjectionFixture.t.sol");
  await send(factory, factoryAbi, "setRouter", [router]);

  // --- Launch ------------------------------------------------------------

  section("Launching a market");

  const params = {
    name: "End To End",
    symbol: "E2E",
    quoteAsset: quote,
    userSalt: `0x${"11".repeat(32)}` as Hex,
    launchIntentHash: `0x${"22".repeat(32)}` as Hex,
    xStockUsdWad: parseEther("100"),
    // Zero means "do not enforce a previewed address". The creator-bound salt is
    // covered by the factory's own tests; this is about the indexer.
    expectedToken: "0x0000000000000000000000000000000000000000" as Address,
  };

  await send(factory, factoryAbi, "launch", [params]);

  const launches = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "launchesByCreator",
    args: [account.address],
  })) as readonly Address[];

  check("the launch is recorded on-chain", launches.length === 1);

  const token = launches[0]!;
  const marketAbi = artifact("LaunchMarket").abi;

  const launch = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "getLaunch",
    args: [token],
  })) as { market: Address; creator: Address; quoteAsset: Address };

  const market = launch.market;

  // The factory's own record of authenticity (§4). A UI's verified badge comes
  // from this and never from the address shape.
  const authentic = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "isAuthentic",
    args: [token],
  })) as boolean;

  check("the factory vouches for the token", authentic);
  check("and not for an address it never launched", !(await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "isAuthentic",
    args: [quote],
  })));

  check("the market exists", market.length === 42 && market !== token);

  // --- Trades ------------------------------------------------------------

  section("Trading");

  const ONE_QUOTE = 1_000_000n; // 1.0 at six decimals

  await send(quote, quoteAbi, "mint", [account.address, ONE_QUOTE * 10_000n]);
  await send(quote, quoteAbi, "approve", [market, ONE_QUOTE * 10_000n]);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3_600);

  await send(market, marketAbi, "buy", [ONE_QUOTE * 100n, 0n, deadline]);
  await send(market, marketAbi, "buy", [ONE_QUOTE * 50n, 0n, deadline]);

  const balance = (await publicClient.readContract({
    address: token,
    abi: artifact("LaunchToken").abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  check("the buyer holds tokens", balance > 0n);

  // Sell a tenth back. This is the path that would have thrown inside the
  // indexer's transaction before the balances upsert was fixed — the bug that
  // would have stopped indexing at the first sell on the first market.
  await send(token, artifact("LaunchToken").abi, "approve", [market, balance]);
  await send(market, marketAbi, "sell", [balance / 10n, 0n, deadline]);


  // --- Index it ----------------------------------------------------------

  section("Indexing what actually happened");

  const indexer = new Indexer(db, {
    ...DEFAULT_CONFIG,
    rpcUrl: RPC_URL,
    chainId,
    factory,
    rewardVault,
    startBlock: 0n,
    confirmations: 0,
    pollIntervalMs: 100,
  });

  await indexer.start();

  const indexed = await waitFor(async () => {
    const view = await getMarketByToken(db, token);
    return view !== null && view.tradeCount >= 3 ? view : null;
  });

  indexer.stop();

  check("the market reached the projection", indexed !== null);

  if (indexed !== null) {
    check("with the launched symbol", indexed.symbol === "E2E");
    check("and the creator who launched it", indexed.creator === account.address.toLowerCase());
    check("the quote asset is the registered one", indexed.quoteAsset === quote.toLowerCase());

    // The decimals come from the REGISTRY, not from the token. A projection that
    // read decimals() would have no way to notice a token lying about them.
    check("quote decimals came from the registry", indexed.quoteDecimals === 6);

    check("all three trades were indexed", indexed.tradeCount === 3);
    check("it has not graduated", indexed.status === 0);

    // The projection's own numbers against the chain's. This is the assertion
    // the whole file exists for: §138 says the database is a rebuildable copy of
    // chain state, and here the two are compared directly.
    const onChainDistributed = (await publicClient.readContract({
      address: market,
      abi: marketAbi,
      functionName: "distributed",
    })) as bigint;

    const onChainCollateral = (await publicClient.readContract({
      address: market,
      abi: marketAbi,
      functionName: "curveCollateral",
    })) as bigint;

    check("distributed matches the chain exactly", indexed.distributed === onChainDistributed);
    check("curve collateral matches the chain exactly", indexed.curveCollateral === onChainCollateral);

    const trades = await listTrades(db, market, 10);
    check("the tape has every trade", trades.length === 3);

    const sells = trades.filter((t) => t.side === 1);
    check("including the sell", sells.length === 1);

    // §316: the split is stored in full, and the parts must sum to the whole.
    check(
      "every trade's fee split sums to its core fee",
      trades.every((t) => t.creatorFee + t.platformFee === t.coreFee),
    );

    check("every trade recorded a non-zero core fee", trades.every((t) => t.coreFee > 0n));
    check("every buy paid stockback", trades.filter((t) => t.side === 0).every((t) => t.stockback > 0n));

    // Against a head read NOW, not the one captured before indexing began. The
    // earlier form compared a live value to a stale snapshot and failed in CI
    // when a block arrived in between — an assertion about the test's own timing
    // rather than about the projection.
    const headNow = await publicClient.getBlockNumber();

    check(
      "the last indexed block is a real block at or below the head",
      indexed.lastBlock > 0n && indexed.lastBlock <= headNow,
    );
    check("and is at or after the launch", indexed.lastBlock >= indexed.launchedAtBlock);

    // --- A real reorg ------------------------------------------------------

    section("Surviving a reorg the chain actually performed");

    /*
     * Reorg handling has been tested against synthetic logs and never against a
     * node that genuinely reorganised. It is also the most safety-critical path
     * in the indexer: §138's rebuildable projection is a claim about exactly
     * this, and a rollback that leaves one stale row makes the database disagree
     * with the chain permanently and silently.
     *
     * anvil's snapshot and revert produce a real one — the same block heights
     * come back with different hashes and different contents, which is precisely
     * what a reorg is.
     */
    const snapshot = (await publicClient.request({
      method: "evm_snapshot" as never,
      params: [] as never,
    })) as string;

    /*
     * A trade that is about to be un-happened.
     *
     * Deliberately small. A larger buy runs into the curve endpoint, where the
     * market accepts only the portion that reaches qG and emits THAT as the
     * gross — so two different requested amounts produce the same recorded
     * trade, and this test would be unable to tell the orphan from its
     * replacement.
     */
    await send(market, marketAbi, "buy", [ONE_QUOTE, 0n, deadline]);

    await indexer.start();
    const orphaned = await waitFor(async () => {
      const view = await getMarketByToken(db, token);
      return view !== null && view.tradeCount === 4 ? view : null;
    });
    indexer.stop();

    check("the doomed trade was indexed first", orphaned !== null);

    const orphanedHead = await publicClient.getBlockNumber();

    // Rewind. The chain now has no memory of that trade.
    await publicClient.request({
      method: "evm_revert" as never,
      params: [snapshot] as never,
    });

    // A different history from the same height: a different size instead.
    await send(market, marketAbi, "buy", [ONE_QUOTE * 2n, 0n, deadline]);

    const rewoundHead = await publicClient.getBlockNumber();
    console.log(`       orphaned head ${orphanedHead}, rewound head ${rewoundHead}`);
    check("the chain really did rewind", rewoundHead <= orphanedHead);

    await indexer.start();

    const reconciled = await waitFor(async () => {
      const view = await getMarketByToken(db, token);
      if (view === null) return null;

      // Settled when the projection agrees with the chain again, whatever the
      // chain now says — not when it reaches a number this test predicted.
      const onChain = (await publicClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: "distributed",
      })) as bigint;

      return view.distributed === onChain ? view : null;
    });

    indexer.stop();

    check("the projection reconverged on the chain", reconciled !== null);
    check("a reorg was actually detected", indexer.status().reorgsHandled > 0);

    if (reconciled !== null) {
      const finalCollateral = (await publicClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: "curveCollateral",
      })) as bigint;

      check("collateral matches the surviving chain", reconciled.curveCollateral === finalCollateral);

      // The orphaned trade must be GONE, not merely outnumbered. A rollback that
      // leaves it behind produces a tape showing a trade that never happened.
      const tape = await listTrades(db, market, 20);
      check("the tape holds four trades, not five", tape.length === 4);

      /*
       * Notionals are stored NORMALIZED to eighteen decimals, because that is
       * the basis the contract's own accounting uses. This quote asset has six,
       * so a raw amount scales by 10^12 on its way into the projection.
       */
      const normalized = (raw: bigint): bigint => raw * 10n ** 12n;

      check(
        "the orphaned trade is gone from the tape",
        !tape.some((t) => t.notional === normalized(ONE_QUOTE)),
      );
      check(
        "and the replacement is present",
        tape.some((t) => t.notional === normalized(ONE_QUOTE * 2n)),
      );

      // Every derived table cascades from `blocks`, so an orphaned block left
      // behind would take its rows with it. Asserted here, before anything mines
      // further — the graduation phase below moves the head again.
      const staleBlocks = await db.query<{ c: string }>(
        "SELECT COUNT(*)::TEXT AS c FROM blocks WHERE number > $1",
        [rewoundHead.toString()],
      );
      check("no block above the new head survived", staleBlocks[0]?.c === "0");

      // --- Graduation ----------------------------------------------------

      section("Graduating, and the projection following it");

      /*
       * The last untested seam. `markGraduated` has never seen a real Graduated
       * event — every graduation test so far has been inside Foundry, where the
       * indexer does not exist.
       *
       * It also exercises §411's crossing order: a buy large enough to finish
       * the curve executes on the curve and then continues into the pool, and
       * the market accepts only the portion that reaches qG on the curve leg.
       */
      const beforeStatus = (await getMarketByToken(db, token))?.status;
      check("the market has not graduated yet", beforeStatus === 0);

      // Far more than the curve can absorb, so the endpoint is certainly crossed.
      await send(quote, quoteAbi, "mint", [account.address, ONE_QUOTE * 1_000_000n]);
      await send(quote, quoteAbi, "approve", [market, ONE_QUOTE * 1_000_000n]);
      await send(market, marketAbi, "buy", [ONE_QUOTE * 500_000n, 0n, deadline]);

      const onChainStatus = (await publicClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: "status",
      })) as number;

      check("the market graduated on-chain", onChainStatus === 2);

      await indexer.start();

      const graduated = await waitFor(async () => {
        const view = await getMarketByToken(db, token);
        return view !== null && view.status === 2 ? view : null;
      });

      indexer.stop();

      check("the projection saw the graduation", graduated !== null);

      if (graduated !== null) {
        // GRADUATING exists only inside a single transaction (§19). A persisted
        // 1 would mean the indexer captured a partial state.
        check("the status is GRADUATED, never GRADUATING", graduated.status === 2);

        const onChainPool = (await publicClient.readContract({
          address: market,
          abi: marketAbi,
          functionName: "pool",
        })) as Address;

        check("the pool address was recorded", graduated.pool === onChainPool.toLowerCase());
        check("and it is not the market itself", graduated.pool !== market.toLowerCase());

        // The graduating block's timestamp is what the §57 chart marker is
        // placed from, so it has to be a real chain timestamp.
        check("a graduation block was recorded", graduated.graduatedAtBlock !== null);
        check("with the block's own timestamp", (graduated.graduatedAt ?? 0) > 0);

        const gradBlock = await publicClient.getBlock({
          blockNumber: graduated.graduatedAtBlock ?? 0n,
        });
        check(
          "matching the chain exactly",
          BigInt(graduated.graduatedAt ?? 0) === gradBlock.timestamp,
        );

        // A graduated market must refuse further curve trades. If the projection
        // says GRADUATED while the market still fills on the curve, one of them
        // is lying.
        let refused = false;
        try {
          await send(market, marketAbi, "buy", [ONE_QUOTE, 0n, deadline]);
        } catch {
          refused = true;
        }
        check("the curve refuses a trade after graduation", refused);
      }

    }
  }
} finally {
  await db.close();
}

console.log(failures === 0 ? "\ne2e: all checks passed" : `\ne2e: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
