/**
 * SENT — query layer.
 *
 * Every statement is written out. §424 asks for visible SQL and inspectable query
 * plans, and a financial read is exactly where a generated query nobody has seen
 * becomes a problem — the plan changes silently, the numbers do not.
 *
 * Reads return domain types with quantities as `bigint`, converted at the
 * boundary through `big()`. Writes take `bigint` and serialise to strings, since
 * NUMERIC parameters must arrive as text or the driver routes them through a JS
 * number on the way in.
 *
 * §138/§423: nothing here is authoritative. Every row is derived from a chain
 * event, and every table can be dropped and rebuilt by replaying logs.
 */

import { Database, Transaction, big, bigOrNull, addr, hexBytes, toBytes } from "./client.ts";

export type Db = Database | Transaction;

export interface MarketRecord {
  readonly token: `0x${string}`;
  readonly market: `0x${string}`;
  readonly creator: `0x${string}`;
  readonly quoteAsset: `0x${string}`;
  readonly quoteDecimals: number;
  readonly name: string;
  readonly symbol: string;
  readonly p0: bigint;
  readonly pg: bigint;
  readonly qG: bigint;
  readonly launchedAt: number;
  readonly launchedAtBlock: bigint;
}

export interface MarketStateRecord {
  readonly market: `0x${string}`;
  readonly status: number;
  readonly distributed: bigint;
  readonly curveCollateral: bigint;
  readonly holderCount: number;
  readonly tradeCount: number;
  readonly pool: `0x${string}` | null;
  readonly lastBlock: bigint;
  /** Set once the market graduated; null before that. */
  readonly graduatedAtBlock: bigint | null;
  /** Chain timestamp of that block, for the §57 chart marker. */
  readonly graduatedAt: number | null;
}

export interface TradeRecord {
  readonly txHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly market: `0x${string}`;
  readonly trader: `0x${string}`;
  readonly side: 0 | 1;
  readonly notional: bigint;
  readonly net: bigint;
  readonly tokens: bigint;
  readonly coreFee: bigint;
  readonly creatorFee: bigint;
  readonly platformFee: bigint;
  readonly stockback: bigint;
  readonly distributedAfter: bigint;
  readonly collateralAfter: bigint;
  readonly priceAfter: bigint;
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Chain cursor
// ---------------------------------------------------------------------------

export async function getCursor(
  db: Db,
): Promise<{ lastBlock: bigint; lastHash: `0x${string}` | null } | null> {
  const row = await db.queryOne<{ last_processed_block: string; last_processed_hash: unknown }>(
    "SELECT last_processed_block, last_processed_hash FROM indexer_state WHERE id = 1",
  );
  if (row === null) return null;

  return {
    lastBlock: big(row.last_processed_block, "last_processed_block"),
    lastHash: row.last_processed_hash === null ? null : hexBytes(row.last_processed_hash, "last_hash"),
  };
}

export async function setCursor(db: Db, block: bigint, hash: string): Promise<void> {
  await db.query(
    `INSERT INTO indexer_state (id, last_processed_block, last_processed_hash, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET last_processed_block = EXCLUDED.last_processed_block,
           last_processed_hash  = EXCLUDED.last_processed_hash,
           updated_at           = NOW()`,
    [block.toString(), toBytes(hash)],
  );
}

export async function recordBlock(
  db: Db,
  block: { number: bigint; hash: string; parentHash: string; timestamp: bigint },
): Promise<void> {
  await db.query(
    `INSERT INTO blocks (number, hash, parent_hash, timestamp)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (number) DO UPDATE
       SET hash = EXCLUDED.hash, parent_hash = EXCLUDED.parent_hash, timestamp = EXCLUDED.timestamp`,
    [block.number.toString(), toBytes(block.hash), toBytes(block.parentHash), block.timestamp.toString()],
  );
}

/**
 * Roll the projection back to a fork point.
 *
 * Every derived table cascades from `blocks`, so deleting the orphaned blocks
 * removes their rows too. `market_state` is then RECOMPUTED from surviving
 * trades rather than adjusted — an incrementally corrected aggregate is how a
 * projection drifts from the chain without anyone noticing (§138).
 */
export async function rollbackTo(db: Db, blockNumber: bigint): Promise<number> {
  const deleted = await db.query<{ number: string }>(
    "DELETE FROM blocks WHERE number > $1 RETURNING number",
    [blockNumber.toString()],
  );

  await db.query(
    `UPDATE market_state ms SET
       distributed      = COALESCE(t.distributed_after, 0),
       curve_collateral = COALESCE(t.collateral_after, 0),
       trade_count      = COALESCE(t.trade_count, 0),
       last_block       = LEAST(ms.last_block, $1),
       status           = CASE WHEN ms.graduated_at_block > $1 THEN 0 ELSE ms.status END,
       pool             = CASE WHEN ms.graduated_at_block > $1 THEN NULL ELSE ms.pool END,
       updated_at       = NOW()
     FROM (
       SELECT DISTINCT ON (market)
              market,
              distributed_after,
              collateral_after,
              COUNT(*) OVER (PARTITION BY market) AS trade_count
       FROM trades
       ORDER BY market, block_number DESC, log_index DESC
     ) t
     WHERE ms.market = t.market`,
    [blockNumber.toString()],
  );

  // Markets whose every trade was rolled back have no surviving row above.
  await db.query(
    `UPDATE market_state SET distributed = 0, curve_collateral = 0, trade_count = 0, updated_at = NOW()
     WHERE market NOT IN (SELECT DISTINCT market FROM trades)`,
  );

  return deleted.length;
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export async function insertMarket(db: Db, m: MarketRecord): Promise<void> {
  await db.query(
    `INSERT INTO markets (
       token, market, creator, quote_asset, name, symbol,
       p0, pg, qg, quote_decimals, launched_at_block, launched_at, effective_salt
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (token) DO NOTHING`,
    [
      toBytes(m.token),
      toBytes(m.market),
      toBytes(m.creator),
      toBytes(m.quoteAsset),
      m.name,
      m.symbol,
      m.p0.toString(),
      m.pg.toString(),
      m.qG.toString(),
      m.quoteDecimals,
      m.launchedAtBlock.toString(),
      m.launchedAt,
      toBytes("0x00"),
    ],
  );

  await db.query(
    `INSERT INTO market_state (market, last_block) VALUES ($1, $2)
     ON CONFLICT (market) DO NOTHING`,
    [toBytes(m.market), m.launchedAtBlock.toString()],
  );
}

const MARKET_COLUMNS = `
  m.token, m.market, m.creator, m.quote_asset, m.quote_decimals,
  m.name, m.symbol, m.p0, m.pg, m.qg, m.launched_at, m.launched_at_block,
  s.status, s.distributed, s.curve_collateral, s.holder_count, s.trade_count,
  s.pool, s.last_block, s.graduated_at_block,
  -- The chain timestamp of the graduating block, so a chart can mark the moment
  -- rather than approximating it. A LEFT JOIN: a market that has not graduated
  -- has no block to join to, and an inner join here would drop every pre-grad
  -- market from the listing entirely.
  gb.timestamp AS graduated_at
`;

interface MarketRow {
  token: unknown;
  market: unknown;
  creator: unknown;
  quote_asset: unknown;
  quote_decimals: number;
  name: string;
  symbol: string;
  p0: string;
  pg: string;
  qg: string;
  launched_at: string;
  launched_at_block: string;
  status: number;
  distributed: string;
  curve_collateral: string;
  holder_count: number;
  trade_count: number;
  pool: unknown;
  last_block: string;
  graduated_at_block: string | null;
  graduated_at: string | null;
}

export interface MarketView extends MarketRecord, Omit<MarketStateRecord, "market"> {}

function toMarketView(row: MarketRow): MarketView {
  return {
    token: addr(row.token, "token"),
    market: addr(row.market, "market"),
    creator: addr(row.creator, "creator"),
    quoteAsset: addr(row.quote_asset, "quote_asset"),
    quoteDecimals: row.quote_decimals,
    name: row.name,
    symbol: row.symbol,
    p0: big(row.p0, "p0"),
    pg: big(row.pg, "pg"),
    qG: big(row.qg, "qg"),
    launchedAt: Number(big(row.launched_at, "launched_at")),
    launchedAtBlock: big(row.launched_at_block, "launched_at_block"),
    status: row.status,
    distributed: big(row.distributed, "distributed"),
    curveCollateral: big(row.curve_collateral, "curve_collateral"),
    holderCount: row.holder_count,
    tradeCount: row.trade_count,
    pool: row.pool === null ? null : addr(row.pool, "pool"),
    lastBlock: big(row.last_block, "last_block"),
    graduatedAtBlock: bigOrNull(row.graduated_at_block, "graduated_at_block"),
    graduatedAt:
      row.graduated_at === null ? null : Number(big(row.graduated_at, "graduated_at")),
  };
}

export async function getMarketByToken(db: Db, token: string): Promise<MarketView | null> {
  const row = await db.queryOne<MarketRow>(
    `SELECT ${MARKET_COLUMNS}
     FROM markets m
       JOIN market_state s ON s.market = m.market
       LEFT JOIN blocks gb ON gb.number = s.graduated_at_block
     WHERE m.token = $1`,
    [toBytes(token)],
  );
  return row === null ? null : toMarketView(row);
}

export type ExploreSort = "NEWEST" | "PROGRESS" | "VOLUME" | "HOLDERS";

/**
 * Explore listing (§50).
 *
 * Ordering is chosen from a fixed set rather than interpolated, so no caller can
 * push arbitrary SQL into an ORDER BY.
 */
export async function listMarkets(
  db: Db,
  options: { sort: ExploreSort; status?: number; quoteAsset?: string; limit: number },
): Promise<MarketView[]> {
  const order: Record<ExploreSort, string> = {
    NEWEST: "m.launched_at DESC",
    PROGRESS: "(s.distributed::NUMERIC / NULLIF(m.qg, 0)) DESC",
    VOLUME: "s.trade_count DESC",
    HOLDERS: "s.holder_count DESC",
  };

  const params: unknown[] = [];
  const where: string[] = [];

  if (options.status !== undefined) {
    params.push(options.status);
    where.push(`s.status = $${params.length}`);
  }
  if (options.quoteAsset !== undefined) {
    params.push(toBytes(options.quoteAsset));
    where.push(`m.quote_asset = $${params.length}`);
  }

  params.push(options.limit);

  const rows = await db.query<MarketRow>(
    `SELECT ${MARKET_COLUMNS}
     FROM markets m
       JOIN market_state s ON s.market = m.market
       LEFT JOIN blocks gb ON gb.number = s.graduated_at_block
     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${order[options.sort]}
     LIMIT $${params.length}`,
    params,
  );

  return rows.map(toMarketView);
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export async function insertTrade(db: Db, t: TradeRecord, logIndex: number): Promise<void> {
  await db.query(
    `INSERT INTO trades (
       block_number, log_index, tx_hash, market, trader, side,
       notional, net, tokens, core_fee, creator_fee, platform_fee, stockback,
       distributed_after, collateral_after, price_after, timestamp
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (block_number, log_index) DO NOTHING`,
    [
      t.blockNumber.toString(),
      logIndex,
      toBytes(t.txHash),
      toBytes(t.market),
      toBytes(t.trader),
      t.side,
      t.notional.toString(),
      t.net.toString(),
      t.tokens.toString(),
      t.coreFee.toString(),
      t.creatorFee.toString(),
      t.platformFee.toString(),
      t.stockback.toString(),
      t.distributedAfter.toString(),
      t.collateralAfter.toString(),
      t.priceAfter.toString(),
      t.timestamp,
    ],
  );
}

export async function listTrades(db: Db, market: string, limit: number): Promise<TradeRecord[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT tx_hash, block_number, market, trader, side, notional, net, tokens,
            core_fee, creator_fee, platform_fee, stockback,
            distributed_after, collateral_after, price_after, timestamp
     FROM trades WHERE market = $1
     ORDER BY block_number DESC, log_index DESC
     LIMIT $2`,
    [toBytes(market), limit],
  );

  return rows.map((r) => ({
    txHash: hexBytes(r.tx_hash, "tx_hash"),
    blockNumber: big(r.block_number, "block_number"),
    market: addr(r.market, "market"),
    trader: addr(r.trader, "trader"),
    side: Number(r.side) as 0 | 1,
    notional: big(r.notional, "notional"),
    net: big(r.net, "net"),
    tokens: big(r.tokens, "tokens"),
    coreFee: big(r.core_fee, "core_fee"),
    creatorFee: big(r.creator_fee, "creator_fee"),
    platformFee: big(r.platform_fee, "platform_fee"),
    stockback: big(r.stockback, "stockback"),
    distributedAfter: big(r.distributed_after, "distributed_after"),
    collateralAfter: big(r.collateral_after, "collateral_after"),
    priceAfter: big(r.price_after, "price_after"),
    timestamp: Number(big(r.timestamp, "timestamp")),
  }));
}

// ---------------------------------------------------------------------------
// Market state
// ---------------------------------------------------------------------------

export async function updateMarketState(
  db: Db,
  market: string,
  state: { distributed: bigint; curveCollateral: bigint; lastBlock: bigint; status?: number },
): Promise<void> {
  await db.query(
    `UPDATE market_state SET
       distributed      = $2,
       curve_collateral = $3,
       last_block       = $4,
       status           = COALESCE($5, status),
       trade_count      = trade_count + 1,
       updated_at       = NOW()
     WHERE market = $1`,
    [
      toBytes(market),
      state.distributed.toString(),
      state.curveCollateral.toString(),
      state.lastBlock.toString(),
      state.status ?? null,
    ],
  );
}

export async function markGraduated(
  db: Db,
  market: string,
  pool: string,
  positionId: bigint,
  block: bigint,
): Promise<void> {
  await db.query(
    `UPDATE market_state SET
       status = 2, curve_collateral = 0, pool = $2, position_id = $3,
       graduated_at_block = $4, last_block = $4, updated_at = NOW()
     WHERE market = $1`,
    [toBytes(market), toBytes(pool), positionId.toString(), block.toString()],
  );
}

// ---------------------------------------------------------------------------
// Balances — the TWAB input
// ---------------------------------------------------------------------------

export async function insertBalanceEvent(
  db: Db,
  e: { blockNumber: bigint; logIndex: number; market: string; account: string; delta: bigint; timestamp: number },
): Promise<void> {
  await db.query(
    `INSERT INTO balance_events (block_number, log_index, market, account, delta, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (block_number, log_index, account) DO NOTHING`,
    [
      e.blockNumber.toString(),
      e.logIndex,
      toBytes(e.market),
      toBytes(e.account),
      e.delta.toString(),
      e.timestamp,
    ],
  );

  // TWO statements, and they cannot be collapsed into one.
  //
  // The obvious form — INSERT ... ON CONFLICT DO UPDATE SET balance = balance +
  // EXCLUDED.balance — is broken here. PostgreSQL evaluates CHECK constraints on
  // the PROPOSED insert tuple before it resolves the conflict, so a negative
  // delta trips `balances_non_negative` with the raw delta as the failing row,
  // even when the account holds plenty and the update would have landed at a
  // perfectly positive number.
  //
  // That would have made every sell and every transfer-out throw inside the
  // indexer's ingest transaction: the block never commits, the cursor never
  // advances, and the indexer retries the same range forever. The first sell on
  // the first market would have stopped indexing permanently.
  //
  // Seeding zero always satisfies the constraint, and the UPDATE that follows is
  // checked on its own result — so a real negative balance still fails, which is
  // what the constraint is for.
  await db.query(
    `INSERT INTO balances (market, account, balance, last_block)
     VALUES ($1, $2, 0, $3)
     ON CONFLICT (market, account) DO NOTHING`,
    [toBytes(e.market), toBytes(e.account), e.blockNumber.toString()],
  );

  await db.query(
    `UPDATE balances SET balance = balance + $3, last_block = $4
     WHERE market = $1 AND account = $2`,
    [toBytes(e.market), toBytes(e.account), e.delta.toString(), e.blockNumber.toString()],
  );
}

export async function refreshHolderCount(db: Db, market: string): Promise<number> {
  const row = await db.queryOne<{ count: string }>(
    "SELECT COUNT(*)::TEXT AS count FROM balances WHERE market = $1 AND balance > 0",
    [toBytes(market)],
  );
  const count = row === null ? 0 : Number(big(row.count, "count"));

  await db.query("UPDATE market_state SET holder_count = $2 WHERE market = $1", [
    toBytes(market),
    count,
  ]);

  return count;
}

/** Balance deltas for a time window — what the TWAB engine integrates over. */
export async function listBalanceEvents(
  db: Db,
  market: string,
  fromTimestamp: number,
  toTimestamp: number,
): Promise<{ account: `0x${string}`; delta: bigint; timestamp: bigint }[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT account, delta, timestamp FROM balance_events
     WHERE market = $1 AND timestamp >= $2 AND timestamp < $3
     ORDER BY block_number, log_index`,
    [toBytes(market), fromTimestamp, toTimestamp],
  );

  return rows.map((r) => ({
    account: addr(r.account, "account"),
    delta: big(r.delta, "delta"),
    timestamp: big(r.timestamp, "timestamp"),
  }));
}

// ---------------------------------------------------------------------------
// Stockback
// ---------------------------------------------------------------------------

export async function recordStockbackFunding(
  db: Db,
  f: { blockNumber: bigint; logIndex: number; market: string; amount: bigint; totalFunded: bigint; timestamp: number },
): Promise<void> {
  await db.query(
    `INSERT INTO stockback_funding (block_number, log_index, market, amount, total_funded, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (block_number, log_index) DO NOTHING`,
    [
      f.blockNumber.toString(),
      f.logIndex,
      toBytes(f.market),
      f.amount.toString(),
      f.totalFunded.toString(),
      f.timestamp,
    ],
  );
}

export async function getActiveCommitment(
  db: Db,
  market: string,
): Promise<{ merkleRoot: `0x${string}`; totalCumulative: bigint; epochSequence: bigint } | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT merkle_root, total_cumulative, epoch_sequence
     FROM stockback_commitments
     WHERE market = $1 AND activated_at_block IS NOT NULL AND cancelled_at_block IS NULL
     ORDER BY epoch_sequence DESC LIMIT 1`,
    [toBytes(market)],
  );
  if (row === null) return null;

  return {
    merkleRoot: hexBytes(row.merkle_root, "merkle_root"),
    totalCumulative: big(row.total_cumulative, "total_cumulative"),
    epochSequence: big(row.epoch_sequence, "epoch_sequence"),
  };
}

export async function getClaimedTotal(db: Db, market: string, account: string): Promise<bigint> {
  const row = await db.queryOne<{ total: string | null }>(
    `SELECT COALESCE(MAX(cumulative), 0)::TEXT AS total
     FROM stockback_claims WHERE market = $1 AND account = $2`,
    [toBytes(market), toBytes(account)],
  );
  return row === null || row.total === null ? 0n : big(row.total, "claimed_total");
}

// ---------------------------------------------------------------------------
// Finalizer output
//
// Distinct from the commitment tables above on purpose: those project what the
// chain accepted, these hold what this node computed and nobody has signed.
// ---------------------------------------------------------------------------

export interface DatasetRecord {
  readonly market: string;
  readonly epochSequence: bigint;
  readonly merkleRoot: string;
  readonly datasetHash: string;
  readonly totalCumulative: bigint;
  readonly carryForward: bigint;
  readonly totalFunded: bigint;
  readonly computedThroughBlock: bigint;
  readonly computedAt: number;
  readonly entitlements: readonly {
    account: string;
    cumulative: bigint;
    proof: readonly string[];
  }[];
  readonly allocations: readonly {
    epochId: bigint;
    pool: bigint;
    allocated: bigint;
    carryForward: bigint;
    eligibleHolders: number;
    totalWeight: bigint;
  }[];
}

/**
 * Persist a computed dataset with its entitlements and per-epoch breakdown.
 *
 * Must be called inside a transaction. A dataset whose header landed without its
 * entitlements would make the claim endpoint report zero for every holder while
 * a root sits there looking authoritative.
 */
export async function recordDataset(db: Db, d: DatasetRecord): Promise<void> {
  await db.query(
    `INSERT INTO stockback_datasets (
       market, epoch_sequence, merkle_root, dataset_hash, total_cumulative,
       carry_forward, total_funded, holder_count, computed_through_block, computed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (market, epoch_sequence) DO NOTHING`,
    [
      toBytes(d.market),
      d.epochSequence.toString(),
      toBytes(d.merkleRoot),
      toBytes(d.datasetHash),
      d.totalCumulative.toString(),
      d.carryForward.toString(),
      d.totalFunded.toString(),
      d.entitlements.length,
      d.computedThroughBlock.toString(),
      d.computedAt,
    ],
  );

  // Chunked rather than one statement per holder: a market with ten thousand
  // holders would otherwise be ten thousand round trips inside one transaction,
  // which is how a finalizer run turns into a lock held for minutes.
  const CHUNK = 500;

  for (let i = 0; i < d.entitlements.length; i += CHUNK) {
    const chunk = d.entitlements.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const rows: string[] = [];

    for (const e of chunk) {
      const base = values.length;
      rows.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
      values.push(
        toBytes(d.market),
        d.epochSequence.toString(),
        toBytes(e.account),
        e.cumulative.toString(),
        e.proof.map((node) => toBytes(node)),
      );
    }

    await db.query(
      `INSERT INTO stockback_entitlements (market, epoch_sequence, account, cumulative, proof)
       VALUES ${rows.join(",")}
       ON CONFLICT (market, epoch_sequence, account) DO NOTHING`,
      values,
    );
  }

  for (const a of d.allocations) {
    await db.query(
      `INSERT INTO stockback_epoch_allocations (
         market, epoch_sequence, epoch_id, pool, allocated, carry_forward,
         eligible_holders, total_weight
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (market, epoch_sequence, epoch_id) DO NOTHING`,
      [
        toBytes(d.market),
        d.epochSequence.toString(),
        a.epochId.toString(),
        a.pool.toString(),
        a.allocated.toString(),
        a.carryForward.toString(),
        a.eligibleHolders,
        a.totalWeight.toString(),
      ],
    );
  }
}

/** Addresses registered as ineligible for Stockback (§323, §324). */
export async function getExclusions(db: Db, market: string): Promise<`0x${string}`[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT account FROM stockback_exclusions WHERE market = $1 ORDER BY account",
    [toBytes(market)],
  );
  return rows.map((r) => addr(r.account, "excluded_account"));
}

/**
 * Total Stockback funding received up to a cut-off.
 *
 * Bounded by timestamp, not "latest", because the conservation ceiling must
 * match the window being distributed. Using the current total against an older
 * window would let a commitment spend funding that arrived after the epochs it
 * claims to cover.
 */
export async function getTotalFundedThrough(
  db: Db,
  market: string,
  toTimestamp: number,
): Promise<bigint> {
  const row = await db.queryOne<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount), 0)::TEXT AS total
     FROM stockback_funding WHERE market = $1 AND timestamp < $2`,
    [toBytes(market), toTimestamp],
  );
  return row === null || row.total === null ? 0n : big(row.total, "total_funded");
}

/** Stockback contributions bucketed by 24h epoch (§329), up to a cut-off. */
export async function listFundingByEpoch(
  db: Db,
  market: string,
  toTimestamp: number,
  epochSeconds: bigint,
): Promise<Map<bigint, bigint>> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT timestamp, amount FROM stockback_funding
     WHERE market = $1 AND timestamp < $2
     ORDER BY block_number, log_index`,
    [toBytes(market), toTimestamp],
  );

  const byEpoch = new Map<bigint, bigint>();

  for (const row of rows) {
    const epoch = big(row.timestamp, "timestamp") / epochSeconds;
    byEpoch.set(epoch, (byEpoch.get(epoch) ?? 0n) + big(row.amount, "amount"));
  }

  return byEpoch;
}

/**
 * Markets that have ever received Stockback funding.
 *
 * A market with no funding has nothing to distribute, so finalizing it would
 * only produce the "no holder earned anything" refusal on every run.
 */
export async function listFundedMarkets(db: Db): Promise<
  { market: `0x${string}`; token: `0x${string}`; quoteAsset: `0x${string}` }[]
> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT m.market, m.token, m.quote_asset
     FROM markets m
     WHERE EXISTS (SELECT 1 FROM stockback_funding f WHERE f.market = m.market)
     ORDER BY m.market`,
  );

  return rows.map((r) => ({
    market: addr(r.market, "market"),
    token: addr(r.token, "token"),
    quoteAsset: addr(r.quote_asset, "quote_asset"),
  }));
}

/** Highest epoch sequence this node has computed for a market, or null. */
export async function getLatestDataset(
  db: Db,
  market: string,
): Promise<{
  epochSequence: bigint;
  merkleRoot: `0x${string}`;
  datasetHash: `0x${string}`;
  totalCumulative: bigint;
  carryForward: bigint;
} | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT epoch_sequence, merkle_root, dataset_hash, total_cumulative, carry_forward
     FROM stockback_datasets WHERE market = $1
     ORDER BY epoch_sequence DESC LIMIT 1`,
    [toBytes(market)],
  );
  if (row === null) return null;

  return {
    epochSequence: big(row.epoch_sequence, "epoch_sequence"),
    merkleRoot: hexBytes(row.merkle_root, "merkle_root"),
    datasetHash: hexBytes(row.dataset_hash, "dataset_hash"),
    totalCumulative: big(row.total_cumulative, "total_cumulative"),
    carryForward: big(row.carry_forward, "carry_forward"),
  };
}

/**
 * A holder's entitlement under a specific attested root.
 *
 * Keyed on the root rather than on "the newest dataset": a proof is only valid
 * against the root it was built for, and the root the vault currently accepts is
 * whatever the attestors last activated — which may lag what this node computed.
 * Serving the newest proof against an older active root would hand the user
 * calldata that reverts.
 */
export async function getEntitlementForRoot(
  db: Db,
  market: string,
  account: string,
  merkleRoot: string,
): Promise<{ cumulative: bigint; proof: `0x${string}`[]; epochSequence: bigint } | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT e.cumulative, e.proof, e.epoch_sequence
     FROM stockback_entitlements e
     JOIN stockback_datasets d
       ON d.market = e.market AND d.epoch_sequence = e.epoch_sequence
     WHERE e.market = $1 AND e.account = $2 AND d.merkle_root = $3`,
    [toBytes(market), toBytes(account), toBytes(merkleRoot)],
  );
  if (row === null) return null;

  const proof = row.proof;
  if (!Array.isArray(proof)) {
    throw new TypeError("entitlement proof: expected an array of BYTEA nodes");
  }

  return {
    cumulative: big(row.cumulative, "cumulative"),
    proof: proof.map((node, i) => hexBytes(node, `proof[${i}]`)),
    epochSequence: big(row.epoch_sequence, "epoch_sequence"),
  };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Mark every block at or below `throughBlock` as settled (§335).
 *
 * Set-once and never cleared. That is safe only because the caller passes a
 * height the reorg tracker has already put `confirmations` below the head, and
 * rollback deletes blocks ABOVE the fork — so a finalized block is by
 * construction one a rollback cannot reach. If that ever stops being true, this
 * flag becomes a lie that Stockback finalization acts on.
 */
export async function markFinalized(db: Db, throughBlock: bigint): Promise<number> {
  if (throughBlock <= 0n) return 0;

  const rows = await db.query<{ number: string }>(
    `UPDATE blocks SET finalized = TRUE
     WHERE number <= $1 AND finalized = FALSE
     RETURNING number`,
    [throughBlock.toString()],
  );
  return rows.length;
}

/** Highest settled block, and its chain timestamp. */
export async function finalizedHead(
  db: Db,
): Promise<{ number: bigint; timestamp: number } | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT number, timestamp FROM blocks
     WHERE finalized = TRUE ORDER BY number DESC LIMIT 1`,
  );
  if (row === null) return null;

  return {
    number: big(row.number, "finalized_number"),
    timestamp: Number(big(row.timestamp, "finalized_timestamp")),
  };
}

export async function headBlockIndexed(db: Db): Promise<bigint> {
  const row = await db.queryOne<{ number: string | null }>(
    "SELECT MAX(number)::TEXT AS number FROM blocks",
  );
  return row === null || row.number === null ? 0n : big(row.number, "head_block");
}

export { bigOrNull };
