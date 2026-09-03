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

  /*
   * Rebuild `balances` from the events that survived.
   *
   * `market_state` was recomputed above and `balances` was not, which left it
   * holding deltas from blocks that no longer exist. That is not a cosmetic
   * drift: the next block re-applies its own transfers on top of the stale
   * total, the running balance goes negative, and the schema's own check
   * constraint refuses the write — so the indexer fails every tick from then on
   * and never recovers.
   *
   * Rebuilt rather than adjusted, for the same reason `market_state` is: an
   * incrementally corrected aggregate is how a projection drifts from the chain
   * without anyone noticing (§138). The event log is the derived truth, so it
   * wins outright.
   */
  await db.query("DELETE FROM balances");

  await db.query(
    `INSERT INTO balances (market, account, balance, last_block)
     SELECT market, account, SUM(delta), MAX(block_number)
     FROM balance_events
     GROUP BY market, account
     HAVING SUM(delta) > 0`,
  );

  // Holder counts derive from `balances`, so they can only be trusted once the
  // balances themselves have been rebuilt.
  await db.query(
    `UPDATE market_state ms SET holder_count = COALESCE(b.holders, 0)
     FROM (
       SELECT market, COUNT(*) AS holders FROM balances WHERE balance > 0 GROUP BY market
     ) b
     WHERE ms.market = b.market`,
  );

  await db.query(
    `UPDATE market_state SET holder_count = 0
     WHERE market NOT IN (SELECT DISTINCT market FROM balances)`,
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

/**
 * Register the addresses that must never earn Stockback (§323, §324).
 *
 * WHY THIS IS NOT COSMETIC
 * ------------------------
 * The market contract holds every token that has not been bought yet — the
 * whole billion at launch, and 35% of it even at the graduation threshold. It
 * receives `Transfer` events like any other address, so without this it enters
 * the TWAB as a holder, with a weight no real holder can approach.
 *
 * At 1% distributed it would take 99% of every epoch's pool. §324 states the
 * invariant as `DEX_POOL_WEIGHT = 0`, and the same reasoning covers the curve:
 * protocol custody must not compete with holders for rewards.
 *
 * The set is DERIVED, not configured. §323 says the factory must "register or
 * deterministically expose" exclusions, and deriving them from the launch event
 * means a market cannot be created with the wrong ones — there is no second
 * place for the list to be right or wrong.
 *
 * The HyperSwap pool is added at graduation instead, because it does not exist
 * yet here.
 */
export async function registerExclusions(
  db: Db,
  market: string,
  system: {
    readonly factory: string;
    readonly feeVault: string;
    readonly rewardVault: string;
    readonly router?: string;
  },
): Promise<void> {
  const entries: [string, string][] = [
    [ZERO_ADDRESS, "zero address"],
    [DEAD_ADDRESS, "burn address"],
    [market, "the curve holds undistributed supply, not an economic position"],
    [system.factory, "protocol custody"],
    [system.feeVault, "protocol custody"],
    [system.rewardVault, "the reward vault must not earn from itself"],
    ...(system.router === undefined ? [] : ([[system.router, "protocol custody"]] as [string, string][])),
  ];

  for (const [account, reason] of entries) {
    await db.query(
      `INSERT INTO stockback_exclusions (market, account, reason) VALUES ($1,$2,$3)
       ON CONFLICT (market, account) DO NOTHING`,
      [toBytes(market), toBytes(account), reason],
    );
  }
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

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

export type ExploreSort =
  | "NEWEST"
  | "PROGRESS"
  | "VOLUME"
  | "HOLDERS"
  | "TRENDING"
  | "GAINERS"
  | "RECENTLY_GRADUATED";

/** The window every rate-based sort and stat is measured over (§50, §166). */
export const WINDOW_SECONDS = 86_400;

/**
 * The 24h window, joined once and reused by every rate-based sort.
 *
 * `s.trade_count` is a lifetime COUNT. It was standing in for "volume", which
 * meant a market with a hundred dust trades outranked one with a single large
 * one — a ranking that says the opposite of what its label promises. Volume is
 * notional, and §50's sorts are windowed rather than lifetime, or a market that
 * was busy last month outranks one that is busy now, forever.
 */
const WINDOW_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(t.notional), 0) AS volume,
           COUNT(*)                     AS trades,
           (ARRAY_AGG(t.price_after ORDER BY t.block_number, t.log_index))[1] AS first_price,
           (ARRAY_AGG(t.price_after ORDER BY t.block_number DESC, t.log_index DESC))[1] AS last_price
    FROM trades t
    WHERE t.market = m.market AND t.timestamp >= $WINDOW_START::BIGINT
  ) w ON TRUE
`;

export interface ExploreOptions {
  readonly sort: ExploreSort;
  readonly status?: number;
  readonly quoteAsset?: string;
  readonly limit: number;
  /**
   * Free text: a name fragment, a ticker, or an address (§95.21).
   *
   * Addresses match EXACTLY and text matches fuzzily, because a near-miss on
   * twenty bytes is a different market — offering it is how someone lands on the
   * wrong token page with the right-looking name.
   */
  readonly query?: string;
  /** Rows to skip. Deliberately an offset rather than a cursor — see below. */
  readonly offset?: number;
  /** Seconds. Defaults to 24h; passed explicitly so the window is never implied. */
  readonly windowSeconds?: number;
  readonly now?: number;
}

/**
 * Explore listing (§50, §95.21).
 *
 * Ordering is chosen from a fixed set rather than interpolated, so no caller can
 * push arbitrary SQL into an ORDER BY. Everything variable is a bound parameter.
 *
 * TRENDING IS DEFINED, NOT VIBES
 * ------------------------------
 * §95.21 requires the trending formula to be documented so it does not become a
 * black-box ranking with no stated reason. It is:
 *
 *   trending = 24h volume × log2(2 + 24h trade count) / (2 + age in days)
 *
 * Volume is the base, because it is the part that cannot be faked for free. The
 * trade-count term is logarithmic so many small trades add confidence without
 * letting a wash-trading loop outrank a market with real size. The age divisor
 * is what makes this TRENDING rather than "biggest": a market that did the same
 * volume on its first day outranks one that did it on its thirtieth.
 *
 * OFFSET, NOT A CURSOR
 * --------------------
 * A cursor is the right answer for a stable, append-only feed. These orderings
 * are neither: volume, holders and trending all reorder between requests, so a
 * cursor encoding "after this row's sort key" would silently skip or repeat rows
 * as the data moved — and it would look correct while doing it. An offset is
 * honestly approximate, and the freshness envelope already says the projection
 * is moving.
 */
export async function listMarkets(db: Db, options: ExploreOptions): Promise<MarketView[]> {
  const order: Record<ExploreSort, string> = {
    NEWEST: "m.launched_at DESC",
    PROGRESS: "(s.distributed::NUMERIC / NULLIF(m.qg, 0)) DESC",
    VOLUME: "w.volume DESC",
    HOLDERS: "s.holder_count DESC",
    TRENDING: `
      (w.volume * LOG(2, 2 + w.trades))
      / (2 + GREATEST(($NOW - m.launched_at)::NUMERIC / 86400, 0))
      DESC`,
    // Measured against the window's OPENING price, so this is the change over
    // the window rather than distance from the launch price. A market with no
    // trade in the window sorts last rather than as a zero gain, because "no
    // data" and "did not move" are different answers.
    GAINERS: `
      CASE WHEN w.first_price > 0
           THEN (w.last_price::NUMERIC / w.first_price)
           ELSE NULL END DESC NULLS LAST,
      w.volume DESC`,
    RECENTLY_GRADUATED: "s.graduated_at_block DESC NULLS LAST",
  };

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const windowStart = now - (options.windowSeconds ?? WINDOW_SECONDS);

  /*
   * Only bound when the chosen ordering actually uses it.
   *
   * PostgreSQL infers a parameter's type from where it appears, so a parameter
   * that appears NOWHERE is a hard error — `could not determine data type of
   * parameter $2` — and it fires on every sort except the one that reads it.
   * The cast makes the type explicit rather than leaving it to inference across
   * a division.
   */
  const params: unknown[] = [windowStart];
  let nowParam = "";

  if (options.sort === "TRENDING") {
    params.push(now);
    nowParam = `$${params.length}::BIGINT`;
  }

  const where: string[] = [];

  if (options.status !== undefined) {
    params.push(options.status);
    where.push(`s.status = $${params.length}`);
  }
  if (options.quoteAsset !== undefined) {
    params.push(toBytes(options.quoteAsset));
    where.push(`m.quote_asset = $${params.length}`);
  }
  if (options.sort === "RECENTLY_GRADUATED") {
    where.push("s.graduated_at_block IS NOT NULL");
  }

  const search = buildSearchClause(options.query, params);
  if (search !== null) where.push(search);

  params.push(options.limit);
  const limitParam = `$${params.length}`;

  params.push(options.offset ?? 0);
  const offsetParam = `$${params.length}`;

  const rows = await db.query<MarketRow>(
    `SELECT ${MARKET_COLUMNS}
     FROM markets m
       JOIN market_state s ON s.market = m.market
       LEFT JOIN blocks gb ON gb.number = s.graduated_at_block
       ${WINDOW_JOIN.replace("$WINDOW_START", "$1")}
     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${order[options.sort].replace("$NOW", nowParam)}, m.token
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  return rows.map(toMarketView);
}

/**
 * Search across the four identities §95.21 names, plus the quote asset.
 *
 * An address matches exactly on whichever column it could be. Anything else is
 * a trigram match on name and ticker, which is what a partial ticker actually
 * is — a full-text parser would stem it and then drop it as a stop word.
 *
 * Appends its own bound parameters, so the caller's numbering stays correct.
 */
function buildSearchClause(query: string | undefined, params: unknown[]): string | null {
  const q = query?.trim();
  if (q === undefined || q === "") return null;

  if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    params.push(toBytes(q));
    const p = `$${params.length}`;
    return `(m.token = ${p} OR m.market = ${p} OR m.creator = ${p} OR m.quote_asset = ${p})`;
  }

  // Bounded before it reaches the index. A trigram scan over a megabyte of
  // input is a denial of service wearing a search box.
  params.push(`%${q.slice(0, 64)}%`);
  const p = `$${params.length}`;
  return `(m.name ILIKE ${p} OR m.symbol ILIKE ${p})`;
}

/** How many markets a listing would return without its limit (§50 pagination). */
export async function countMarkets(
  db: Db,
  options: Pick<ExploreOptions, "status" | "quoteAsset" | "query" | "sort">,
): Promise<number> {
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
  if (options.sort === "RECENTLY_GRADUATED") {
    where.push("s.graduated_at_block IS NOT NULL");
  }

  const search = buildSearchClause(options.query, params);
  if (search !== null) where.push(search);

  const row = await db.queryOne<{ c: string }>(
    `SELECT COUNT(*)::TEXT AS c
     FROM markets m JOIN market_state s ON s.market = m.market
     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}`,
    params,
  );

  return Number(row?.c ?? "0");
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

export interface FeeAccrualRecord {
  readonly blockNumber: bigint;
  readonly market: `0x${string}`;
  readonly creator: `0x${string}`;
  readonly asset: `0x${string}`;
  readonly creatorAmount: bigint;
  readonly platformAmount: bigint;
  readonly timestamp: number;
}

/**
 * Record a fee accrual from the vault's own event.
 *
 * Separate from `trades.creator_fee`, which is re-derived from the core fee by
 * the canonical split. That derivation is a projection of what SHOULD have been
 * credited; this is what the vault says it actually credited, and the two are
 * worth being able to compare. A market that ever paid a different amount than
 * the rule predicts is a defect nobody would otherwise see.
 */
export async function insertFeeAccrual(
  db: Db,
  a: FeeAccrualRecord,
  logIndex: number,
): Promise<void> {
  await db.query(
    `INSERT INTO fee_accruals (
       block_number, log_index, market, creator, asset,
       creator_amount, platform_amount, timestamp
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (block_number, log_index) DO NOTHING`,
    [
      a.blockNumber.toString(),
      logIndex,
      toBytes(a.market),
      toBytes(a.creator),
      toBytes(a.asset),
      a.creatorAmount.toString(),
      a.platformAmount.toString(),
      a.timestamp,
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

  // §324, and the reason it is a named invariant: the pool holds the permanent
  // liquidity, which after graduation is the single largest TOKEN balance in
  // existence. Left eligible it would absorb most of every epoch's rewards, and
  // the LP would be competing with the holders the rewards are for.
  await db.query(
    `INSERT INTO stockback_exclusions (market, account, reason) VALUES ($1,$2,$3)
     ON CONFLICT (market, account) DO NOTHING`,
    [toBytes(market), toBytes(pool), "permanent liquidity, not a holder (§324)"],
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

/**
 * Record a commitment the vault accepted (§332).
 *
 * The merkle root is the key, because it is how the CHAIN identifies a
 * commitment. The epoch sequence and dataset hash are local annotations — this
 * node only has them if it also computed the distribution, and §406 expects
 * plenty of nodes that only index.
 *
 * They are backfilled from `stockback_datasets` when the root matches, in the
 * same statement, so a finalizer's own indexer records them without a second
 * pass and a bare indexer records NULL rather than guessing.
 */
export async function recordCommitmentSubmitted(
  db: Db,
  c: {
    market: string;
    merkleRoot: string;
    totalCumulative: bigint;
    submitter: string;
    activeAt: number;
    blockNumber: bigint;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO stockback_commitments (
       market, merkle_root, total_cumulative, submitter, active_at,
       submitted_at_block, epoch_sequence, dataset_hash
     )
     SELECT $1,$2,$3,$4,$5,$6, d.epoch_sequence, d.dataset_hash
     FROM (SELECT 1) AS one
     LEFT JOIN stockback_datasets d ON d.market = $1 AND d.merkle_root = $2
     ON CONFLICT (market, merkle_root) DO NOTHING`,
    [
      toBytes(c.market),
      toBytes(c.merkleRoot),
      c.totalCumulative.toString(),
      toBytes(c.submitter),
      c.activeAt,
      c.blockNumber.toString(),
    ],
  );
}

/**
 * Mark a commitment live.
 *
 * Nothing is payable before this. §334's activation delay is the window in
 * which a bad root can still be cancelled, and a projection that treated a
 * submitted root as claimable would be handing out proofs against a root the
 * vault will not honour for another six hours.
 */
export async function markCommitmentActivated(
  db: Db,
  market: string,
  merkleRoot: string,
  block: bigint,
): Promise<void> {
  await db.query(
    `UPDATE stockback_commitments
     SET activated_at_block = $3
     WHERE market = $1 AND merkle_root = $2 AND cancelled_at_block IS NULL`,
    [toBytes(market), toBytes(merkleRoot), block.toString()],
  );
}

/** A pending root withdrawn before it went live (§365). It never pays. */
export async function markCommitmentCancelled(
  db: Db,
  market: string,
  merkleRoot: string,
  block: bigint,
): Promise<void> {
  await db.query(
    `UPDATE stockback_commitments
     SET cancelled_at_block = $3
     WHERE market = $1 AND merkle_root = $2 AND activated_at_block IS NULL`,
    [toBytes(market), toBytes(merkleRoot), block.toString()],
  );
}

/**
 * Record a claim the vault paid.
 *
 * `cumulative` is the running total the vault now has on record for this
 * account, not the amount transferred — that is `amount`. Storing both is what
 * lets `getClaimedTotal` answer "how much has already been paid" without
 * re-deriving it from a sum that a reorg could leave half-applied.
 */
export async function recordClaim(
  db: Db,
  c: {
    blockNumber: bigint;
    logIndex: number;
    market: string;
    account: string;
    amount: bigint;
    cumulative: bigint;
    timestamp: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO stockback_claims (
       block_number, log_index, market, account, amount, cumulative, timestamp
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (block_number, log_index) DO NOTHING`,
    [
      c.blockNumber.toString(),
      c.logIndex,
      toBytes(c.market),
      toBytes(c.account),
      c.amount.toString(),
      c.cumulative.toString(),
      c.timestamp,
    ],
  );
}

export async function getActiveCommitment(
  db: Db,
  market: string,
): Promise<{
  merkleRoot: `0x${string}`;
  totalCumulative: bigint;
  epochSequence: bigint | null;
  activatedAtBlock: bigint;
} | null> {
  // Ordered by CHAIN position, not by epoch sequence. The sequence is nullable
  // on a node that never computed the dataset, and the vault's own monotonicity
  // check already makes chain order and sequence order agree.
  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT merkle_root, total_cumulative, epoch_sequence, activated_at_block
     FROM stockback_commitments
     WHERE market = $1 AND activated_at_block IS NOT NULL AND cancelled_at_block IS NULL
     ORDER BY submitted_at_block DESC LIMIT 1`,
    [toBytes(market)],
  );
  if (row === null) return null;

  return {
    merkleRoot: hexBytes(row.merkle_root, "merkle_root"),
    totalCumulative: big(row.total_cumulative, "total_cumulative"),
    // Null on a node that only indexes. Callers that need a sequence for
    // display fall back to the newest dataset; nothing financial depends on it.
    epochSequence: bigOrNull(row.epoch_sequence),
    activatedAtBlock: big(row.activated_at_block, "activated_at_block"),
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

/**
 * Markets launched by one creator, newest first.
 *
 * Keyed on `markets.creator`, which the factory recorded at launch — never on
 * anything a token could claim about itself (§4).
 */
export async function listMarketsByCreator(
  db: Db,
  creator: string,
  limit = 100,
): Promise<MarketView[]> {
  const rows = await db.query<MarketRow>(
    `SELECT ${MARKET_COLUMNS}
     FROM markets m
       JOIN market_state s ON s.market = m.market
       LEFT JOIN blocks gb ON gb.number = s.graduated_at_block
     WHERE m.creator = $1
     ORDER BY m.launched_at DESC
     LIMIT $2`,
    [toBytes(creator), Math.max(1, Math.min(limit, 200))],
  );

  return rows.map(toMarketView);
}

/**
 * Fees a creator has accrued, per asset, from indexed events.
 *
 * This is the PROJECTION's view: what the chain has emitted. It is not what the
 * vault will pay — a claim already made is still an accrual here. The API reads
 * the payable figure from the vault itself, because that is the number a creator
 * acts on (§423).
 */
export async function creatorAccruals(
  db: Db,
  creator: string,
): Promise<{ asset: `0x${string}`; accrued: bigint; markets: number }[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT asset,
            SUM(creator_amount)::TEXT AS accrued,
            COUNT(DISTINCT market)::TEXT AS markets
     FROM fee_accruals
     WHERE creator = $1
     GROUP BY asset`,
    [toBytes(creator)],
  );

  return rows.map((r) => ({
    asset: addr(r.asset, "asset"),
    accrued: big(r.accrued, "accrued"),
    markets: Number(big(r.markets, "markets")),
  }));
}

// ---------------------------------------------------------------------------
// Accounts (§64, §347)
// ---------------------------------------------------------------------------

export interface HoldingView {
  readonly token: `0x${string}`;
  readonly market: `0x${string}`;
  readonly name: string;
  readonly symbol: string;
  readonly quoteAsset: `0x${string}`;
  readonly quoteDecimals: number;
  readonly status: number;
  readonly balance: bigint;
  /** Curve price at the market's current distribution, in normalized quote. */
  readonly price: bigint;
  /** balance × price, in normalized quote. The mark, not a cost basis. */
  readonly value: bigint;
  readonly lastBlock: bigint;
}

/**
 * Every position one wallet holds (§64).
 *
 * The value is a MARK at the curve's current price, not a portfolio valuation:
 * selling the whole position walks down the curve and returns less. §64 asks for
 * portfolio value and this is the honest version of it — the same number the
 * token page shows, multiplied out — with the difference left to the sell quote,
 * which is the only thing that can answer it correctly.
 *
 * Zero balances are excluded. A wallet that fully exited holds nothing, and a
 * row saying "0 TOKEN" in a holdings list is noise that grows forever.
 */
export async function listHoldings(
  db: Db,
  account: string,
  limit = 100,
): Promise<HoldingView[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT m.token, m.market, m.name, m.symbol, m.quote_asset, m.quote_decimals,
            m.p0, m.pg, m.qg, s.status, s.distributed, b.balance, b.last_block
     FROM balances b
       JOIN markets m ON m.market = b.market
       JOIN market_state s ON s.market = b.market
     WHERE b.account = $1 AND b.balance > 0
     ORDER BY b.balance DESC
     LIMIT $2`,
    [toBytes(account), Math.max(1, Math.min(limit, 200))],
  );

  return rows.map((r) => {
    const p0 = big(r.p0, "p0");
    const pg = big(r.pg, "pg");
    const qG = big(r.qg, "qg");
    const distributed = big(r.distributed, "distributed");
    const balance = big(r.balance, "balance");

    // The same linear interpolation `toMarketView`'s consumers use. Written
    // once here rather than recomputed by every caller, because a second
    // implementation of a price is how two screens start disagreeing.
    const price = qG > 0n ? p0 + ((pg - p0) * distributed) / qG : p0;

    return {
      token: addr(r.token, "token"),
      market: addr(r.market, "market"),
      name: String(r.name),
      symbol: String(r.symbol),
      quoteAsset: addr(r.quote_asset, "quote_asset"),
      quoteDecimals: Number(r.quote_decimals),
      status: Number(r.status),
      balance,
      price,
      value: (balance * price) / 10n ** 18n,
      lastBlock: big(r.last_block, "last_block"),
    };
  });
}

export interface AccountStockbackRow {
  readonly token: `0x${string}`;
  readonly market: `0x${string}`;
  readonly symbol: string;
  readonly rewardAsset: `0x${string}`;
  readonly quoteDecimals: number;
  /** Payable against the ACTIVE root, already net of what was claimed. */
  readonly claimable: bigint;
  /** Everything the vault has ever paid this account on this market. */
  readonly lifetimeClaimed: bigint;
  /** The active root, or null when nothing is attested yet. */
  readonly merkleRoot: `0x${string}` | null;
}

/**
 * One account's Stockback across every market it holds or has claimed on (§347).
 *
 * Only ACTIVE roots contribute to `claimable`. §293 keeps estimated accrual and
 * claimable entitlement apart, and this endpoint answers the second question
 * only: a cross-market "claim everything" figure that included unattested
 * arithmetic would be a total the vault will not pay.
 *
 * Driven from entitlements joined to the active commitment, so a holder who has
 * exited but is still owed for a past epoch is included — leaving them out
 * because their balance is now zero would strand money they earned.
 */
export async function accountStockback(
  db: Db,
  account: string,
): Promise<AccountStockbackRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `WITH active AS (
       SELECT DISTINCT ON (c.market) c.market, c.merkle_root
       FROM stockback_commitments c
       WHERE c.activated_at_block IS NOT NULL AND c.cancelled_at_block IS NULL
       ORDER BY c.market, c.submitted_at_block DESC
     ),
     claimed AS (
       SELECT market, MAX(cumulative) AS cumulative
       FROM stockback_claims WHERE account = $1 GROUP BY market
     ),
     owed AS (
       /* Entitlements are keyed by epoch sequence, not by root; the dataset is
          what carries the root. Joining through it is what ties an entitlement
          to the commitment the chain actually activated — an entitlement from a
          newer, unattested dataset must not count as claimable. */
       SELECT e.market, e.cumulative
       FROM stockback_entitlements e
         JOIN stockback_datasets d
           ON d.market = e.market AND d.epoch_sequence = e.epoch_sequence
         JOIN active a ON a.market = e.market AND a.merkle_root = d.merkle_root
       WHERE e.account = $1
     )
     SELECT m.token, m.market, m.symbol, m.quote_asset, m.quote_decimals,
            a.merkle_root,
            COALESCE(o.cumulative, 0) AS cumulative,
            COALESCE(cl.cumulative, 0) AS claimed
     FROM markets m
       LEFT JOIN active a  ON a.market = m.market
       LEFT JOIN owed o    ON o.market = m.market
       LEFT JOIN claimed cl ON cl.market = m.market
     WHERE o.cumulative IS NOT NULL OR cl.cumulative IS NOT NULL
     ORDER BY m.launched_at DESC`,
    [toBytes(account)],
  );

  return rows.map((r) => {
    const cumulative = big(r.cumulative, "cumulative");
    const claimed = big(r.claimed, "claimed");

    return {
      token: addr(r.token, "token"),
      market: addr(r.market, "market"),
      symbol: String(r.symbol),
      rewardAsset: addr(r.quote_asset, "quote_asset"),
      quoteDecimals: Number(r.quote_decimals),
      // Floored at zero. A holder who claimed under a LATER root than the one
      // currently active would otherwise show a negative balance, which is not
      // a state the vault can be in — it reverts on the underflow.
      claimable: cumulative > claimed ? cumulative - claimed : 0n,
      lifetimeClaimed: claimed,
      merkleRoot: r.merkle_root === null ? null : hexBytes(r.merkle_root, "merkle_root"),
    };
  });
}

export interface ClaimRow {
  readonly market: `0x${string}`;
  readonly token: `0x${string}`;
  readonly symbol: string;
  readonly amount: bigint;
  readonly cumulative: bigint;
  readonly blockNumber: bigint;
  readonly timestamp: number;
}

/** An account's claim history, newest first (§346). */
export async function listClaimsByAccount(
  db: Db,
  account: string,
  limit = 50,
): Promise<ClaimRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT c.market, m.token, m.symbol, c.amount, c.cumulative,
            c.block_number, c.timestamp
     FROM stockback_claims c JOIN markets m ON m.market = c.market
     WHERE c.account = $1
     ORDER BY c.block_number DESC, c.log_index DESC
     LIMIT $2`,
    [toBytes(account), Math.max(1, Math.min(limit, 200))],
  );

  return rows.map((r) => ({
    market: addr(r.market, "market"),
    token: addr(r.token, "token"),
    symbol: String(r.symbol),
    amount: big(r.amount, "amount"),
    cumulative: big(r.cumulative, "cumulative"),
    blockNumber: big(r.block_number, "block_number"),
    timestamp: Number(big(r.timestamp, "timestamp")),
  }));
}

// ---------------------------------------------------------------------------
// Platform statistics (§166, §168)
// ---------------------------------------------------------------------------

export interface PlatformStats {
  readonly totalLaunches: number;
  readonly activePreGrad: number;
  readonly graduated: number;
  /** Lifetime notional, normalized to 18 decimals. */
  readonly totalVolume: bigint;
  readonly windowVolume: bigint;
  readonly creatorFeesEarned: bigint;
  readonly stockbackDistributed: bigint;
  readonly activeQuoteAssets: number;
  readonly launchableQuoteAssets: number;
  readonly uniqueTraders: number;
  readonly windowLaunches: number;
  readonly windowGraduations: number;
  readonly windowTrades: number;
  /** The highest block any of this was read through. */
  readonly asOfBlock: bigint;
}

/**
 * §166's metrics, from §168's sources.
 *
 * Every figure here is counted from the projection's own tables — the same rows
 * the market pages are built from — rather than kept as running totals. A
 * counter that is incremented per event is the thing that survives a reorg and
 * then quietly disagrees with the data it claims to summarise; §168's rule
 * against vanity metrics is easier to keep when nothing is stored separately to
 * go wrong.
 *
 * ONE ROUND TRIP
 * --------------
 * Written as a single statement with CTEs rather than a dozen queries. This is
 * a homepage endpoint, so it will be called by everyone who visits, and twelve
 * sequential round trips is how a stats block becomes the slowest thing on the
 * page.
 *
 * "Active xStock Pairs" is the registry's count (§168), not a DISTINCT over
 * markets: an asset that is verified and enabled is an available pair whether or
 * not anyone has launched against it yet.
 */
export async function platformStats(
  db: Db,
  options: { now?: number; windowSeconds?: number } = {},
): Promise<PlatformStats> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const windowStart = now - (options.windowSeconds ?? WINDOW_SECONDS);

  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT
       (SELECT COUNT(*) FROM markets)::TEXT                                    AS total_launches,
       (SELECT COUNT(*) FROM market_state WHERE status = 0)::TEXT              AS active_pre_grad,
       (SELECT COUNT(*) FROM market_state WHERE status = 2)::TEXT              AS graduated,
       (SELECT COALESCE(SUM(notional), 0) FROM trades)::TEXT                   AS total_volume,
       (SELECT COALESCE(SUM(notional), 0) FROM trades WHERE timestamp >= $1)::TEXT
                                                                               AS window_volume,
       (SELECT COALESCE(SUM(creator_amount), 0) FROM fee_accruals)::TEXT       AS creator_fees,
       (SELECT COALESCE(SUM(amount), 0) FROM stockback_claims)::TEXT           AS stockback_claimed,
       (SELECT COUNT(*) FROM xstock_assets)::TEXT                              AS assets,
       (SELECT COUNT(*) FROM xstock_assets WHERE enabled_for_new_launches)::TEXT
                                                                               AS launchable_assets,
       (SELECT COUNT(DISTINCT trader) FROM trades)::TEXT                       AS unique_traders,
       (SELECT COUNT(*) FROM markets WHERE launched_at >= $1)::TEXT            AS window_launches,
       (SELECT COUNT(*) FROM market_state s JOIN blocks b ON b.number = s.graduated_at_block
         WHERE b.timestamp >= $1)::TEXT                                        AS window_graduations,
       (SELECT COUNT(*) FROM trades WHERE timestamp >= $1)::TEXT               AS window_trades,
       (SELECT COALESCE(MAX(number), 0) FROM blocks)::TEXT                     AS as_of_block`,
    [windowStart],
  );

  const n = (key: string): number => Number(row?.[key] ?? "0");
  const b = (key: string): bigint => BigInt(String(row?.[key] ?? "0"));

  return {
    totalLaunches: n("total_launches"),
    activePreGrad: n("active_pre_grad"),
    graduated: n("graduated"),
    totalVolume: b("total_volume"),
    windowVolume: b("window_volume"),
    creatorFeesEarned: b("creator_fees"),
    // What holders have actually been PAID, not what has been funded. §168
    // wants figures that mean what they say, and "distributed" claimed for
    // money still sitting in the vault would be one of the vanity metrics it
    // forbids.
    stockbackDistributed: b("stockback_claimed"),
    activeQuoteAssets: n("assets"),
    launchableQuoteAssets: n("launchable_assets"),
    uniqueTraders: n("unique_traders"),
    windowLaunches: n("window_launches"),
    windowGraduations: n("window_graduations"),
    windowTrades: n("window_trades"),
    asOfBlock: b("as_of_block"),
  };
}

// ---------------------------------------------------------------------------
// xStock registry projection (§420, §252)
// ---------------------------------------------------------------------------

export interface XStockAsset {
  readonly asset: `0x${string}`;
  readonly decimals: number;
  readonly coreTokenIndex: bigint;
  readonly evmExtraWeiDecimals: number;
  readonly gates: {
    readonly canonical: boolean;
    readonly transfer: boolean;
    readonly multiplier: boolean;
    readonly priceSource: boolean;
    readonly haltSource: boolean;
    readonly hyperSwap: boolean;
    readonly accounting: boolean;
    readonly legal: boolean;
  };
  readonly launchable: boolean;
  readonly verifiedAt: number | null;
  readonly lastBlock: bigint;
}

/**
 * Record an asset the registry accepted.
 *
 * `xstock_assets` was the fourth table shipped in the first migration with no
 * writer — and unlike the others it had no reader either, so nothing was
 * visibly wrong. §168 needs it: "Active xStock Pairs" is sourced from the
 * registry, and there was nothing to source it from.
 *
 * The eight §420 gates are stored individually rather than as one boolean, so a
 * half-verified asset is visible as exactly which checks passed. An asset that
 * is one gate short of launchable is a very different thing from one that has
 * had no review at all, and a single flag cannot say which.
 */
export async function upsertXStockAsset(
  db: Db,
  a: {
    asset: string;
    decimals: number;
    coreTokenIndex: bigint;
    evmExtraWeiDecimals: number;
    lastBlock: bigint;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO xstock_assets (
       asset, decimals, core_token_index, evm_extra_wei_decimals, last_block
     ) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (asset) DO UPDATE SET
       decimals = EXCLUDED.decimals,
       core_token_index = EXCLUDED.core_token_index,
       evm_extra_wei_decimals = EXCLUDED.evm_extra_wei_decimals,
       last_block = EXCLUDED.last_block`,
    [
      toBytes(a.asset),
      a.decimals,
      a.coreTokenIndex.toString(),
      a.evmExtraWeiDecimals,
      a.lastBlock.toString(),
    ],
  );
}

/** The eight §420 gates, as the registry last set them. */
export async function setAssetGates(
  db: Db,
  asset: string,
  gates: readonly boolean[],
  lastBlock: bigint,
): Promise<void> {
  if (gates.length !== 8) {
    throw new Error(`setAssetGates: expected 8 gates, got ${gates.length}`);
  }

  await db.query(
    `UPDATE xstock_assets SET
       gate_canonical = $2, gate_transfer = $3, gate_multiplier = $4,
       gate_price_source = $5, gate_halt_source = $6, gate_hyperswap = $7,
       gate_accounting = $8, gate_legal = $9, last_block = $10
     WHERE asset = $1`,
    [toBytes(asset), ...gates, lastBlock.toString()],
  );
}

/**
 * Enable or disable an asset for new launches.
 *
 * Disabling never touches markets that already launched against it. §420's
 * availability rule governs what may be CREATED; an existing market's holders
 * are not stranded because governance stopped accepting new pairs.
 */
export async function setAssetLaunchable(
  db: Db,
  asset: string,
  launchable: boolean,
  verifiedAt: number | null,
  lastBlock: bigint,
): Promise<void> {
  await db.query(
    `UPDATE xstock_assets SET
       enabled_for_new_launches = $2,
       verified_at = COALESCE($3, verified_at),
       last_block = $4
     WHERE asset = $1`,
    [toBytes(asset), launchable, verifiedAt, lastBlock.toString()],
  );
}

export async function listXStockAssets(db: Db, onlyLaunchable = false): Promise<XStockAsset[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT asset, decimals, core_token_index, evm_extra_wei_decimals,
            gate_canonical, gate_transfer, gate_multiplier, gate_price_source,
            gate_halt_source, gate_hyperswap, gate_accounting, gate_legal,
            enabled_for_new_launches, verified_at, last_block
     FROM xstock_assets
     ${onlyLaunchable ? "WHERE enabled_for_new_launches" : ""}
     ORDER BY asset`,
  );

  return rows.map((r) => ({
    asset: addr(r.asset, "asset"),
    decimals: Number(r.decimals),
    coreTokenIndex: big(r.core_token_index, "core_token_index"),
    evmExtraWeiDecimals: Number(r.evm_extra_wei_decimals),
    gates: {
      canonical: r.gate_canonical === true,
      transfer: r.gate_transfer === true,
      multiplier: r.gate_multiplier === true,
      priceSource: r.gate_price_source === true,
      haltSource: r.gate_halt_source === true,
      hyperSwap: r.gate_hyperswap === true,
      accounting: r.gate_accounting === true,
      legal: r.gate_legal === true,
    },
    launchable: r.enabled_for_new_launches === true,
    verifiedAt: r.verified_at === null ? null : Number(r.verified_at),
    lastBlock: big(r.last_block, "last_block"),
  }));
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
