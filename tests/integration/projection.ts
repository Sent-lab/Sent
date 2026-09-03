/**
 * SENT — projection integration tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every simulation in this repository runs against pure functions. That was a
 * deliberate design choice and it paid for itself — but it left the SQL itself
 * completely unexecuted. A wrong column name, a constraint that fires on the
 * happy path, a `bytea[]` that does not round-trip: none of it is visible to
 * TypeScript, and all of it fails at run time in production instead.
 *
 * So this file connects to a real PostgreSQL, applies the real migrations, and
 * runs every query the services depend on.
 *
 * IT SKIPS RATHER THAN FAILS WITHOUT A DATABASE
 * ---------------------------------------------
 * `DATABASE_URL` unset means "no database available here", which is the normal
 * state on a laptop. Failing then would train people to ignore the result. CI
 * sets it, so CI runs it.
 *
 *   docker run --rm -e POSTGRES_PASSWORD=sent -e POSTGRES_USER=sent \
 *     -e POSTGRES_DB=sent -p 5432:5432 postgres:16-alpine
 *   DATABASE_URL=postgres://sent:sent@localhost:5432/sent \
 *     node --experimental-strip-types tests/integration/projection.ts
 */

import {
  Database,
  migrate,
  loadMigrations,
  big,
  addr,
  hexBytes,
  // cursor and blocks
  getCursor,
  setCursor,
  recordBlock,
  markFinalized,
  finalizedHead,
  headBlockIndexed,
  rollbackTo,
  // markets
  insertMarket,
  getMarketByToken,
  listMarkets,
  updateMarketState,
  markGraduated,
  // trades
  insertTrade,
  listTrades,
  listTradesInRange,
  priceBefore,
  // balances
  insertBalanceEvent,
  listBalanceEvents,
  listBalances,
  foldBalancesFromEvents,
  setBalance,
  refreshHolderCount,
  // stockback
  recordStockbackFunding,
  getTotalFundedThrough,
  listFundingByEpoch,
  listFundedMarkets,
  getExclusions,
  recordDataset,
  getLatestDataset,
  getEntitlementForRoot,
  // jobs
  enqueueJob,
  claimJob,
  completeJob,
  failJob,
  listDeadJobs,
  countJobsByStatus,
  upsertCandles,
  recordFinding,
  listFindings,
  findBlockGaps,
  listAllMarkets,
  listCandles,
} from "@sent/database";
import {
  candleHandler,
  holderReconciliationHandler,
  healthReconciliationHandler,
} from "@sent/worker/jobs";

const CONNECTION = process.env.DATABASE_URL;

if (CONNECTION === undefined || CONNECTION.trim() === "") {
  console.log("integration: DATABASE_URL not set, skipping (see the header for how to run this)");
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

async function refuses(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const QUOTE = "0x4444444444444444444444444444444444444444" as const;
const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

const WAD = 10n ** 18n;

function hash(n: number): `0x${string}` {
  return `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
}

async function block(db: Database, number: bigint, timestamp: bigint): Promise<void> {
  await recordBlock(db, {
    number,
    hash: hash(Number(number)),
    parentHash: hash(Number(number) - 1),
    timestamp,
  });
}

const db = new Database({ connectionString: CONNECTION });

try {
  // Start from nothing every run. An integration test that depends on leftover
  // state passes once and then reports whatever the last run happened to leave.
  await db.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
  `);

  // -------------------------------------------------------------------------

  section("Migrations");

  {
    const migrations = loadMigrations();
    check("migrations are discovered", migrations.length >= 3);

    const first = await migrate(db, migrations);
    check("every migration applies", first.length === migrations.length);

    // The whole point of the ledger. A second run that re-executed CREATE TABLE
    // would fail, and a deploy that restarts a service would break the schema.
    const second = await migrate(db, migrations);
    check("a second run applies nothing", second.length === 0);

    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = new Set(tables.map((t) => t.table_name));

    for (const table of [
      "blocks",
      "markets",
      "market_state",
      "trades",
      "balance_events",
      "balances",
      "candles",
      "stockback_commitments",
      "stockback_datasets",
      "stockback_entitlements",
      "jobs",
      "reconciliation_findings",
    ]) {
      check(`table ${table} exists`, names.has(table));
    }
  }

  section("Quantities never arrive as floats (§424)");

  {
    await block(db, 1n, 1_000n);

    // A uint256 far beyond 2^53. If the driver parsed NUMERIC as a JS number
    // this would come back rounded, and every balance in the system would be
    // approximately right.
    const huge = 123_456_789_012_345_678_901_234_567_890n;

    await db.query(
      "INSERT INTO markets (token, market, creator, quote_asset, name, symbol, p0, pg, qg, quote_decimals, launched_at_block, launched_at, effective_salt) " +
        "VALUES ($1,$2,$3,$4,'T','T',$5,$5,$5,18,1,1000,$6)",
      [
        Buffer.from(TOKEN.slice(2), "hex"),
        Buffer.from(MARKET.slice(2), "hex"),
        Buffer.from(CREATOR.slice(2), "hex"),
        Buffer.from(QUOTE.slice(2), "hex"),
        huge.toString(),
        Buffer.alloc(32),
      ],
    );

    const row = await db.queryOne<Record<string, unknown>>(
      "SELECT p0, launched_at_block FROM markets WHERE token = $1",
      [Buffer.from(TOKEN.slice(2), "hex")],
    );

    check("NUMERIC comes back as a string", typeof row?.p0 === "string");
    check("BIGINT comes back as a string", typeof row?.launched_at_block === "string");
    check("and survives the round trip exactly", big(row?.p0) === huge);

    // The guard that makes a missing type parser loud rather than silent.
    let threw = false;
    try {
      big(1.5 as unknown);
    } catch (error) {
      threw = error instanceof TypeError && String(error.message).includes("floating point");
    }
    check("a JS number is refused outright", threw);

    await db.query("DELETE FROM markets");
  }

  section("Addresses are length-checked at the boundary");

  {
    // A 32-byte value read through `addr` is the bug the length check exists for:
    // it would return a plausible 0x string that matches no market anywhere.
    let threw = false;
    try {
      addr(Buffer.alloc(32));
    } catch {
      threw = true;
    }
    check("a 32-byte value is not an address", threw);
    check("but hexBytes reads it", hexBytes(Buffer.alloc(32)).length === 66);
  }

  section("Blocks, cursor and settlement");

  {
    for (let n = 2n; n <= 40n; n++) await block(db, n, 1_000n + n);

    check("the head is the highest block", (await headBlockIndexed(db)) === 40n);

    await setCursor(db, 40n, hash(40));
    const cursor = await getCursor(db);
    check("the cursor round-trips", cursor?.lastBlock === 40n);
    check("and keeps its 32-byte hash", cursor?.lastHash === hash(40));

    check("nothing is settled before it is marked", (await finalizedHead(db)) === null);

    const marked = await markFinalized(db, 20n);
    check("marking settles the range", marked === 20);

    const settled = await finalizedHead(db);
    check("the settled head is the highest marked block", settled?.number === 20n);
    check("and carries its chain timestamp", settled?.timestamp === 1_020);

    // Idempotent: a second pass must not re-report blocks it already settled, or
    // the indexer would log a settlement storm on every tick.
    check("re-marking settles nothing new", (await markFinalized(db, 20n)) === 0);
    check("extending settles only the difference", (await markFinalized(db, 25n)) === 5);

    check("a zero height settles nothing", (await markFinalized(db, 0n)) === 0);
  }

  section("Gaps are visible");

  {
    check("a contiguous range has no gaps", (await findBlockGaps(db, 1n, 40n, 10)).length === 0);

    await db.query("DELETE FROM blocks WHERE number = 33");
    const gaps = await findBlockGaps(db, 1n, 40n, 10);

    check("a deleted block is found", gaps.length === 1 && gaps[0] === 33n);

    await block(db, 33n, 1_033n);
    check("and disappears once restored", (await findBlockGaps(db, 1n, 40n, 10)).length === 0);
  }

  section("Markets");

  {
    await insertMarket(db, {
      token: TOKEN,
      market: MARKET,
      creator: CREATOR,
      quoteAsset: QUOTE,
      quoteDecimals: 6,
      name: "Test Market",
      symbol: "TEST",
      p0: 1_000n,
      pg: 25_000n,
      qG: 657_894_736n * WAD,
      launchedAt: 1_010,
      launchedAtBlock: 10n,
    });

    const view = await getMarketByToken(db, TOKEN);
    check("a market reads back", view !== null);
    check("addresses are lower case", view?.market === MARKET);
    check("curve parameters survive", view?.qG === 657_894_736n * WAD);
    check("quote decimals come from the registry, not the token", view?.quoteDecimals === 6);
    check("state is created alongside", view?.status === 0);
    check("and starts empty", view?.distributed === 0n && view?.tradeCount === 0);

    // Re-inserting the same market must not duplicate it or reset its state; the
    // indexer replays ranges after a restart.
    await insertMarket(db, {
      token: TOKEN,
      market: MARKET,
      creator: CREATOR,
      quoteAsset: QUOTE,
      quoteDecimals: 6,
      name: "Test Market",
      symbol: "TEST",
      p0: 1_000n,
      pg: 25_000n,
      qG: 657_894_736n * WAD,
      launchedAt: 1_010,
      launchedAtBlock: 10n,
    });

    const all = await listAllMarkets(db);
    check("a replayed insert does not duplicate", all.length === 1);

    check("an unknown token reads as null", (await getMarketByToken(db, ALICE)) === null);
  }

  section("Trades and market state");

  {
    for (let i = 0; i < 4; i++) {
      await insertTrade(
        db,
        {
          txHash: hash(100 + i),
          blockNumber: 20n + BigInt(i),
          market: MARKET,
          trader: i % 2 === 0 ? ALICE : BOB,
          side: (i % 2) as 0 | 1,
          notional: 1_000n * BigInt(i + 1),
          net: 990n * BigInt(i + 1),
          tokens: 10n * WAD * BigInt(i + 1),
          coreFee: 10n,
          creatorFee: 7n,
          platformFee: 3n,
          stockback: 5n,
          distributedAfter: 10n * WAD * BigInt(i + 1),
          collateralAfter: 990n * BigInt(i + 1),
          priceAfter: 1_000n + 100n * BigInt(i),
          timestamp: 1_020 + i * 30,
        },
        i,
      );

      await updateMarketState(db, MARKET, {
        distributed: 10n * WAD * BigInt(i + 1),
        curveCollateral: 990n * BigInt(i + 1),
        lastBlock: 20n + BigInt(i),
      });
    }

    const trades = await listTrades(db, MARKET, 10);
    check("every trade is stored", trades.length === 4);
    check("newest first", trades[0]?.blockNumber === 23n);
    check("the tape keeps its fee split", trades[0]?.creatorFee === 7n);

    const state = await getMarketByToken(db, TOKEN);
    check("the trade count accumulates", state?.tradeCount === 4);
    check("distributed reflects the last trade", state?.distributed === 40n * WAD);

    // Replaying the same log must not double-count. This is the property that
    // makes a restart safe.
    await insertTrade(
      db,
      {
        txHash: hash(100),
        blockNumber: 20n,
        market: MARKET,
        trader: ALICE,
        side: 0,
        notional: 1_000n,
        net: 990n,
        tokens: 10n * WAD,
        coreFee: 10n,
        creatorFee: 7n,
        platformFee: 3n,
        stockback: 5n,
        distributedAfter: 10n * WAD,
        collateralAfter: 990n,
        priceAfter: 1_000n,
        timestamp: 1_020,
      },
      0,
    );
    check("a replayed trade is ignored", (await listTrades(db, MARKET, 10)).length === 4);

    const window = await listTradesInRange(db, MARKET, 1_020, 1_080);
    check("a time window selects the right trades", window.length === 2);
    check("and returns them in execution order", window[0]?.timestamp === 1_020);

    check("the price before a window is the prior close", (await priceBefore(db, MARKET, 1_080)) === 1_100n);
    check("with no prior trade it is null", (await priceBefore(db, MARKET, 0)) === null);

    const listed = await listMarkets(db, { sort: "NEWEST", limit: 10 });
    check("explore lists the market", listed.length === 1);
    check("VOLUME sort executes", (await listMarkets(db, { sort: "VOLUME", limit: 10 })).length === 1);
    check("PROGRESS sort executes", (await listMarkets(db, { sort: "PROGRESS", limit: 10 })).length === 1);
    check("HOLDERS sort executes", (await listMarkets(db, { sort: "HOLDERS", limit: 10 })).length === 1);
    check(
      "a status filter executes",
      (await listMarkets(db, { sort: "NEWEST", limit: 10, status: 2 })).length === 0,
    );
  }

  section("Balances and holder counts");

  {
    await insertBalanceEvent(db, {
      blockNumber: 20n,
      logIndex: 10,
      market: MARKET,
      account: ALICE,
      delta: 100n * WAD,
      timestamp: 1_020,
    });
    await insertBalanceEvent(db, {
      blockNumber: 21n,
      logIndex: 11,
      market: MARKET,
      account: BOB,
      delta: 40n * WAD,
      timestamp: 1_050,
    });
    await insertBalanceEvent(db, {
      blockNumber: 22n,
      logIndex: 12,
      market: MARKET,
      account: ALICE,
      delta: -30n * WAD,
      timestamp: 1_080,
    });

    const balances = await listBalances(db, MARKET);
    check("balances accumulate", balances.length === 2);
    check("a sale reduces the balance", balances.find((b) => b.account === ALICE)?.balance === 70n * WAD);

    const derived = await foldBalancesFromEvents(db, MARKET);
    check("folding the event log agrees with the running total", derived.length === balances.length);
    check(
      "and matches per account",
      derived.every((d) => balances.find((b) => b.account === d.account)?.balance === d.balance),
    );

    check("the holder count is derived", (await refreshHolderCount(db, MARKET)) === 2);

    const events = await listBalanceEvents(db, MARKET, 1_000, 1_100);
    check("balance events read back in order", events.length === 3);
    check("a negative delta survives NUMERIC", events[2]?.delta === -30n * WAD);

    // The check constraint. A projection that stored a negative balance would
    // hand the TWAB engine a corrupt stream.
    check(
      "a negative balance is refused by the schema",
      await refuses(() => setBalance(db, MARKET, ALICE, -1n, 30n)),
    );

    // Reconciliation's repair path: drift the stored value, then correct it.
    await setBalance(db, MARKET, ALICE, 999n * WAD, 30n);
    check("a balance can be overwritten", (await listBalances(db, MARKET)).find((b) => b.account === ALICE)?.balance === 999n * WAD);

    await setBalance(db, MARKET, ALICE, 70n * WAD, 30n);
    check("and put back", (await listBalances(db, MARKET)).find((b) => b.account === ALICE)?.balance === 70n * WAD);

    // Zero means gone, not a row holding zero — otherwise the holder count
    // includes accounts that hold nothing.
    await setBalance(db, MARKET, BOB, 0n, 30n);
    check("a zeroed balance is deleted", (await listBalances(db, MARKET)).length === 1);
    check("and the holder count follows", (await refreshHolderCount(db, MARKET)) === 1);

    await setBalance(db, MARKET, BOB, 40n * WAD, 30n);
  }

  section("Candles replace rather than accumulate");

  {
    await upsertCandles(db, MARKET, [
      { intervalSeconds: 60, bucket: 1_020, open: 100n, high: 200n, low: 90n, close: 150n, volume: 1_000n, tradeCount: 3 },
    ]);

    await upsertCandles(db, MARKET, [
      { intervalSeconds: 60, bucket: 1_020, open: 100n, high: 250n, low: 90n, close: 180n, volume: 1_500n, tradeCount: 4 },
    ]);

    const row = await db.queryOne<Record<string, unknown>>(
      "SELECT high, volume, trade_count FROM candles WHERE market = $1 AND interval_s = 60 AND bucket = 1020",
      [Buffer.from(MARKET.slice(2), "hex")],
    );

    check("a rewritten candle replaces the old one", big(row?.high) === 250n);
    // The failure a retry would cause if this accumulated: 2500 rather than 1500.
    check("volume is not doubled by the second write", big(row?.volume) === 1_500n);
    check("nor is the trade count", Number(row?.trade_count) === 4);
  }

  section("Worker handlers, against the real schema");

{
  // The handlers are where the queue meets the projection. Everything about them
  // that can be tested without a database is in services/worker/sim/worker.ts;
  // this is the half that cannot.
  const market = MARKET;

  // Candles from the trades inserted above. The 60s bucket containing 1_020.
  await candleHandler(db)({ market, intervalSeconds: 60, bucket: 1_020 });

  const bar = await db.queryOne<Record<string, unknown>>(
    "SELECT open, high, low, close, volume, trade_count FROM candles WHERE market = $1 AND interval_s = 60 AND bucket = 1020",
    [Buffer.from(market.slice(2), "hex")],
  );

  check("the candle handler wrote a bar", bar !== null);
  check("with the trades in that bucket", Number(bar?.trade_count) === 2);
  check("volume is the sum of their notionals", big(bar?.volume) === 3_000n);

  // Re-running must produce the same row, not a doubled one. This is the
  // property the whole at-least-once design rests on.
  await candleHandler(db)({ market, intervalSeconds: 60, bucket: 1_020 });

  const again = await db.queryOne<Record<string, unknown>>(
    "SELECT volume, trade_count FROM candles WHERE market = $1 AND interval_s = 60 AND bucket = 1020",
    [Buffer.from(market.slice(2), "hex")],
  );

  check("re-running does not double the volume", big(again?.volume) === 3_000n);
  check("nor the trade count", Number(again?.trade_count) === 2);

  // A bucket with no trades writes nothing rather than a flat bar.
  await candleHandler(db)({ market, intervalSeconds: 60, bucket: 999_000 });
  const empty = await db.queryOne<{ count: string }>(
    "SELECT COUNT(*)::TEXT AS count FROM candles WHERE market = $1 AND bucket = 999000",
    [Buffer.from(market.slice(2), "hex")],
  );
  check("an empty bucket writes no candle", empty?.count === "0");

  // A malformed payload must throw so the runner can retry or dead-letter it,
  // rather than reading undefined and writing nonsense.
  check(
    "a payload missing its market is refused",
    await refuses(() => candleHandler(db)({ intervalSeconds: 60, bucket: 1_020 })),
  );
  check(
    "a block height sent as a number rather than a string is refused",
    await refuses(() =>
      holderReconciliationHandler(db)({ market, throughBlock: 21 as unknown as string }),
    ),
  );

  // Reconciliation: drift the stored balance, then let the handler find it.
  await setBalance(db, market, ALICE, 4_242n * WAD, 21n);

  await holderReconciliationHandler(db)({ market, throughBlock: "21" });

  const repaired = (await listBalances(db, market)).find((b) => b.account === ALICE);
  check("reconciliation repairs drift from the event log", repaired?.balance === 70n * WAD);

  const findings = await listFindings(db, 10);
  check(
    "and records what it found before repairing it",
    findings.some((f) => f.kind === "holder_balance" && f.observed === (4_242n * WAD).toString()),
  );

  // A clean market produces no findings — otherwise the alert on this table
  // fires constantly and stops meaning anything.
  const before = (await listFindings(db, 100)).length;
  await holderReconciliationHandler(db)({ market, throughBlock: "21" });
  check("a second pass finds nothing", (await listFindings(db, 100)).length === before);

  // Health: the gap that was restored earlier must not be reported.
  await healthReconciliationHandler(db)({ fromBlock: "1", toBlock: "40" });
  const gapFindings = await listFindings(db, 100);
  check(
    "the health sweep reports no gap on a contiguous range",
    !gapFindings.some((f) => f.kind === "block_gap"),
  );

  // Candles for the intervals the chart serves, so the API has something to
  // return for each timeframe.
  for (const interval of [300, 900, 3_600, 14_400, 86_400]) {
    await candleHandler(db)({
      market,
      intervalSeconds: interval,
      bucket: Math.floor(1_020 / interval) * interval,
    });
  }

  const served = await listCandles(db, market, 300, 10);
  check("candles exist for the 5m timeframe", served.length > 0);
  check(
    "each bar bounds its own open and close",
    served.every((c) => c.high >= c.open && c.high >= c.close && c.low <= c.open && c.low <= c.close),
  );
}

section("Stockback funding and datasets");

  {
    await recordStockbackFunding(db, {
      blockNumber: 20n,
      logIndex: 20,
      market: MARKET,
      amount: 1_000_000n,
      totalFunded: 1_000_000n,
      timestamp: 86_400,
    });
    await recordStockbackFunding(db, {
      blockNumber: 21n,
      logIndex: 21,
      market: MARKET,
      amount: 500_000n,
      totalFunded: 1_500_000n,
      timestamp: 172_800,
    });

    check("funding totals to the cut-off", (await getTotalFundedThrough(db, MARKET, 200_000)) === 1_500_000n);
    // Bounded by the window, so a commitment cannot spend funding that arrived
    // after the epochs it covers.
    check("and excludes funding after it", (await getTotalFundedThrough(db, MARKET, 100_000)) === 1_000_000n);

    const byEpoch = await listFundingByEpoch(db, MARKET, 200_000, 86_400n);
    check("funding buckets by epoch", byEpoch.size === 2);
    check("epoch 1 holds the first contribution", byEpoch.get(1n) === 1_000_000n);

    const funded = await listFundedMarkets(db);
    check("a funded market is listed for finalization", funded.length === 1);
    check("with its quote asset as the reward asset", funded[0]?.quoteAsset === QUOTE);

    check("exclusions start empty", (await getExclusions(db, MARKET)).length === 0);

    await db.query(
      "INSERT INTO stockback_exclusions (market, account, reason) VALUES ($1,$2,'pool')",
      [Buffer.from(MARKET.slice(2), "hex"), Buffer.from(BOB.slice(2), "hex")],
    );
    check("a registered exclusion reads back", (await getExclusions(db, MARKET))[0] === BOB);

    const root = hash(0xabc);
    const datasetHash = hash(0xdef);
    const proof = [hash(1), hash(2)];

    await db.transaction((tx) =>
      recordDataset(tx, {
        market: MARKET,
        epochSequence: 2n,
        merkleRoot: root,
        datasetHash,
        totalCumulative: 900_000n,
        carryForward: 100n,
        totalFunded: 1_500_000n,
        computedThroughBlock: 25n,
        computedAt: 200_000,
        entitlements: [
          { account: ALICE, cumulative: 600_000n, proof },
          { account: BOB, cumulative: 300_000n, proof: [] },
        ],
        allocations: [
          { epochId: 1n, pool: 1_000_000n, allocated: 999_900n, carryForward: 100n, eligibleHolders: 2, totalWeight: 12n },
        ],
      }),
    );

    const latest = await getLatestDataset(db, MARKET);
    check("the dataset reads back", latest?.epochSequence === 2n);
    check("the root is a 32-byte value, not an address", latest?.merkleRoot === root);
    check("the dataset hash survives", latest?.datasetHash === datasetHash);
    check("carry-forward is recorded", latest?.carryForward === 100n);

    const entitlement = await getEntitlementForRoot(db, MARKET, ALICE, root);
    check("a holder's entitlement is found by root", entitlement?.cumulative === 600_000n);
    // bytea[] is the one column type here that could plausibly not round-trip.
    check("the proof round-trips as an array", entitlement?.proof.length === 2);
    check("with each node intact", entitlement?.proof[0] === hash(1));

    const empty = await getEntitlementForRoot(db, MARKET, BOB, root);
    check("an empty proof is an empty array, not null", empty?.proof.length === 0);

    // Keyed on the root, not on "the newest dataset": serving a newer proof
    // against an older active root hands the user calldata that reverts.
    check(
      "an unknown root yields nothing",
      (await getEntitlementForRoot(db, MARKET, ALICE, hash(0x999))) === null,
    );

    // §364 as a database constraint, not only as a check in the pipeline.
    check(
      "a dataset committing more than was funded is refused",
      await refuses(() =>
        db.transaction((tx) =>
          recordDataset(tx, {
            market: MARKET,
            epochSequence: 3n,
            merkleRoot: hash(0x111),
            datasetHash: hash(0x222),
            totalCumulative: 2_000_000n,
            carryForward: 0n,
            totalFunded: 1_500_000n,
            computedThroughBlock: 25n,
            computedAt: 200_000,
            entitlements: [{ account: ALICE, cumulative: 2_000_000n, proof: [] }],
            allocations: [],
          }),
        ),
      ),
    );
  }

  section("The job queue");

  {
    const now = 1_000;

    check(
      "a new job is scheduled",
      await enqueueJob(db, { id: "candles:a:60:0", kind: "candles", payload: { market: MARKET }, maxAttempts: 3, runAfter: now }, now),
    );

    // The deduplication that makes a producer safe to run every minute.
    check(
      "the same id does not queue twice",
      !(await enqueueJob(db, { id: "candles:a:60:0", kind: "candles", payload: {}, maxAttempts: 3, runAfter: now }, now)),
    );

    const claimed = await claimJob(db, now);
    check("a job is claimed", claimed?.id === "candles:a:60:0");
    check("the attempt is counted at claim time", claimed?.attempts === 1);
    check("the payload survives JSONB", (claimed?.payload as Record<string, unknown>).market === MARKET);

    check("a running job is not claimed again", (await claimJob(db, now)) === null);

    await completeJob(db, "candles:a:60:0", now);

    // The bug this design exists to avoid: a later trade in an already-computed
    // bucket must re-arm the job, or the candle stays stale forever.
    check(
      "a completed job is re-armed by a new enqueue",
      await enqueueJob(db, { id: "candles:a:60:0", kind: "candles", payload: {}, maxAttempts: 3, runAfter: now }, now),
    );

    const rearmed = await claimJob(db, now);
    check("and its attempt count restarts", rearmed?.attempts === 1);

    // Retry then dead-letter.
    check("a failure with a retry time stays pending", (await failJob(db, "candles:a:60:0", "boom", now + 10, now)) === "PENDING");
    check("a job scheduled for later is not claimed now", (await claimJob(db, now)) === null);
    check("but is claimed once its time comes", (await claimJob(db, now + 10))?.attempts === 2);

    check("a failure with no retry time is dead", (await failJob(db, "candles:a:60:0", "fatal", null, now)) === "DEAD");

    const dead = await listDeadJobs(db, 10);
    check("the dead letter is listed", dead.length === 1);
    check("with the reason it died", dead[0]?.lastError === "fatal");

    // A dead job must stay dead: reviving it silently would defeat the purpose
    // of a dead letter.
    check(
      "a dead job is not revived by enqueue",
      !(await enqueueJob(db, { id: "candles:a:60:0", kind: "candles", payload: {}, maxAttempts: 3, runAfter: now }, now)),
    );
    check("and is not claimable", (await claimJob(db, now + 1_000)) === null);

    const counts = await countJobsByStatus(db);
    check("statuses are counted", counts.DEAD === 1);
    check("and absent statuses read zero rather than undefined", counts.PENDING === 0);

    // Claim order: oldest eligible first, so a backlog drains in the order it
    // arrived rather than by whichever row the planner happened to reach.
    await enqueueJob(db, { id: "b", kind: "k", payload: {}, maxAttempts: 3, runAfter: now + 5 }, now);
    await enqueueJob(db, { id: "a", kind: "k", payload: {}, maxAttempts: 3, runAfter: now + 1 }, now);
    check("the oldest eligible job is claimed first", (await claimJob(db, now + 10))?.id === "a");
  }

  section("Reconciliation findings");

  {
    // Counted as a DELTA, not against an absolute. The worker section above runs
    // first and records findings of its own; asserting a total here made this
    // pass in isolation and fail in sequence, which is the least useful kind of
    // test there is.
    const before = (await listFindings(db, 500)).length;

    // Ordering is asserted BETWEEN these two rather than against position zero:
    // the reconciliation handler above stamps its findings with the wall clock,
    // so no fixed timestamp here is reliably the newest.
    await recordFinding(db, {
      kind: "holder_balance",
      market: MARKET,
      subject: ALICE,
      expected: "70",
      observed: "999",
      repaired: true,
      foundAt: 9_000_000,
    });

    await recordFinding(db, {
      kind: "block_gap",
      // A finding with no market is legal: a block gap belongs to the chain,
      // not to any one market.
      market: null,
      subject: "33",
      expected: "indexed",
      observed: "missing",
      repaired: false,
      foundAt: 9_000_001,
    });

    const findings = await listFindings(db, 500);
    check("both findings are recorded", findings.length === before + 2);

    const gapIndex = findings.findIndex((f) => f.kind === "block_gap" && f.subject === "33");
    const balanceIndex = findings.findIndex((f) => f.observed === "999");

    check("a finding with no market is stored", gapIndex >= 0);
    check("and one with a market is too", balanceIndex >= 0);
    // The later of the two comes first: newest first, whatever else is in the
    // table.
    check("newest first", gapIndex >= 0 && balanceIndex >= 0 && gapIndex < balanceIndex);
    check("a repaired finding is still kept", findings.some((f) => f.repaired));
  }

  section("Rollback removes everything above the fork");

  {
    const before = await listTrades(db, MARKET, 10);
    check("trades exist before the rollback", before.length === 4);

    const removed = await rollbackTo(db, 21n);
    check("blocks above the fork are deleted", removed > 0);

    const after = await listTrades(db, MARKET, 10);
    check("trades above the fork cascade away", after.length === 2);

    const events = await listBalanceEvents(db, MARKET, 0, 10_000);
    check("balance events cascade too", events.length === 2);

    // Recomputed from surviving trades, not adjusted. An incrementally corrected
    // aggregate is how a projection drifts from the chain unnoticed (§138).
    const state = await getMarketByToken(db, TOKEN);
    check("market state is recomputed, not decremented", state?.tradeCount === 2);
    check("distributed matches the surviving tape", state?.distributed === 20n * WAD);

    check("the head follows the rollback", (await headBlockIndexed(db)) === 21n);

    // The dataset was computed through block 25, which no longer exists.
    check("datasets computed above the fork are gone", (await getLatestDataset(db, MARKET)) === null);
    check(
      "and their entitlements with them",
      (await getEntitlementForRoot(db, MARKET, ALICE, hash(0xabc))) === null,
    );
  }

  section("Graduation");

  {
    await markGraduated(db, MARKET, ALICE, 4_242n, 21n);

    const state = await getMarketByToken(db, TOKEN);
    check("status becomes GRADUATED", state?.status === 2);
    check("the pool address is stored", state?.pool === ALICE);
  }
} finally {
  await db.close();
}

console.log(
  failures === 0 ? "\nintegration: all checks passed" : `\nintegration: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
