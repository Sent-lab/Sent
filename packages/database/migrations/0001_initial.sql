-- SENT — initial schema.
--
-- AUTHORITY (Masterplan §138)
--   The chain is the only financial authority. This database is a REBUILDABLE
--   PROJECTION of chain events and nothing more. Every table here can be dropped
--   and reconstructed by replaying logs from genesis, and a full reindex must
--   produce byte-identical state.
--
--   Nothing in this schema may become a source of truth. If a number cannot be
--   derived from an event, it does not belong here.
--
-- REORG SAFETY
--   HyperEVM can reorganise. Every row that derives from a log carries the block
--   number and block hash it came from, so a reorg is handled by deleting rows
--   above the fork point and replaying — not by patching values in place.
--
--   That is why there are no UPDATE-only aggregates. Running totals live in
--   `market_state`, which is itself derived and is recomputed on rollback rather
--   than incrementally corrected.

-- ---------------------------------------------------------------------------
-- Chain tracking
-- ---------------------------------------------------------------------------

-- Canonical chain view. The indexer compares each new block's parent_hash
-- against the hash it recorded; a mismatch IS the reorg signal, and it is the
-- only reliable one — block numbers alone cannot detect a same-height swap.
CREATE TABLE blocks (
    number          BIGINT      PRIMARY KEY,
    hash            BYTEA       NOT NULL UNIQUE,
    parent_hash     BYTEA       NOT NULL,
    timestamp       BIGINT      NOT NULL,
    -- Set once the block is deep enough to be treated as settled. Finalized
    -- blocks are never rolled back, which is what makes Stockback finalization
    -- safe to act on (§335).
    finalized       BOOLEAN     NOT NULL DEFAULT FALSE,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX blocks_finalized_idx ON blocks (finalized, number DESC);

-- Single-row cursor. Kept separate from `blocks` so a crash mid-batch cannot
-- leave the cursor ahead of the data it claims to have processed.
CREATE TABLE indexer_state (
    id                      SMALLINT    PRIMARY KEY DEFAULT 1,
    last_processed_block    BIGINT      NOT NULL,
    last_processed_hash     BYTEA,
    -- Reindexing from scratch is a supported operation, not an incident.
    -- Recording when it last happened makes "is this projection current?"
    -- answerable without guessing.
    last_full_reindex_at    TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT indexer_state_singleton CHECK (id = 1)
);

-- ---------------------------------------------------------------------------
-- Markets
-- ---------------------------------------------------------------------------

-- One row per launch. Authenticity comes from this table having a row at all,
-- because rows are only written from a factory TokenLaunched event (§4, §138).
-- A vanity suffix is never authenticity, and there is deliberately no column
-- for one.
CREATE TABLE markets (
    token               BYTEA       PRIMARY KEY,
    market              BYTEA       NOT NULL UNIQUE,
    creator             BYTEA       NOT NULL,
    quote_asset         BYTEA       NOT NULL,

    name                TEXT        NOT NULL,
    symbol              TEXT        NOT NULL,

    -- Curve parameters, fixed at launch and never re-anchored (§402).
    p0                  NUMERIC(78, 0) NOT NULL,
    pg                  NUMERIC(78, 0) NOT NULL,
    qg                  NUMERIC(78, 0) NOT NULL,

    -- Quote decimals as recorded by the REGISTRY, not read from the token.
    quote_decimals      SMALLINT    NOT NULL,

    launched_at_block   BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    launched_at         BIGINT      NOT NULL,
    effective_salt      BYTEA       NOT NULL,

    CONSTRAINT markets_decimals_sane CHECK (quote_decimals BETWEEN 0 AND 36)
);

CREATE INDEX markets_creator_idx ON markets (creator);
CREATE INDEX markets_quote_asset_idx ON markets (quote_asset);
CREATE INDEX markets_launched_idx ON markets (launched_at DESC);

-- Derived running state. Recomputed on rollback rather than patched, because an
-- incrementally-corrected aggregate is exactly how a projection silently
-- diverges from the chain.
CREATE TABLE market_state (
    market              BYTEA       PRIMARY KEY REFERENCES markets (market) ON DELETE CASCADE,

    -- 0 = PRE_GRAD, 1 = GRADUATING, 2 = GRADUATED. Mirrors the enum (§19).
    -- GRADUATING must never be observed here: it exists only inside a single
    -- transaction, so a persisted 1 means the indexer captured a partial state.
    status              SMALLINT    NOT NULL DEFAULT 0,

    distributed         NUMERIC(78, 0) NOT NULL DEFAULT 0,
    -- Normalized to 18 decimals, matching the contract's own accounting.
    curve_collateral    NUMERIC(78, 0) NOT NULL DEFAULT 0,

    holder_count        INTEGER     NOT NULL DEFAULT 0,
    trade_count         INTEGER     NOT NULL DEFAULT 0,

    pool                BYTEA,
    position_id         NUMERIC(78, 0),
    graduated_at_block  BIGINT,

    last_block          BIGINT      NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT market_state_status_valid CHECK (status IN (0, 1, 2))
);

CREATE INDEX market_state_status_idx ON market_state (status);

-- ---------------------------------------------------------------------------
-- Trades
-- ---------------------------------------------------------------------------

-- Every pre-graduation trade, straight from Bought/Sold events (§423).
--
-- The full fee split is stored per trade rather than recomputed on read. §316
-- requires the breakdown to be shown in full, and recomputing it in the API
-- would be a second implementation of fee math, which §1064 forbids.
CREATE TABLE trades (
    block_number        BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    log_index           INTEGER     NOT NULL,
    tx_hash             BYTEA       NOT NULL,

    market              BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    trader              BYTEA       NOT NULL,
    side                SMALLINT    NOT NULL,  -- 0 = BUY, 1 = SELL

    -- BUY: gross quote in. SELL: gross quote out from the curve. This is the
    -- fee basis in both cases (§9, §10), normalized to 18 decimals.
    notional            NUMERIC(78, 0) NOT NULL,
    net                 NUMERIC(78, 0) NOT NULL,
    tokens              NUMERIC(78, 0) NOT NULL,

    core_fee            NUMERIC(78, 0) NOT NULL,
    creator_fee         NUMERIC(78, 0) NOT NULL,
    platform_fee        NUMERIC(78, 0) NOT NULL,
    stockback           NUMERIC(78, 0) NOT NULL,

    -- State after this trade, so a chart never has to replay to rebuild a point.
    distributed_after   NUMERIC(78, 0) NOT NULL,
    collateral_after    NUMERIC(78, 0) NOT NULL,
    price_after         NUMERIC(78, 0) NOT NULL,

    timestamp           BIGINT      NOT NULL,

    -- (block, log_index) is the chain's own unique ordering. Using it as the key
    -- makes replay idempotent: reprocessing a block cannot duplicate a trade.
    PRIMARY KEY (block_number, log_index),
    CONSTRAINT trades_side_valid CHECK (side IN (0, 1)),
    CONSTRAINT trades_split_exhaustive CHECK (creator_fee + platform_fee = core_fee)
);

CREATE INDEX trades_market_time_idx ON trades (market, timestamp DESC);
CREATE INDEX trades_trader_idx ON trades (trader, timestamp DESC);
CREATE INDEX trades_tx_idx ON trades (tx_hash);

-- ---------------------------------------------------------------------------
-- Balances — the TWAB input
-- ---------------------------------------------------------------------------

-- Raw ERC-20 Transfer deltas. This is what the Stockback TWAB engine integrates
-- over, so it must be complete: a missing transfer is a wrong reward, and the
-- error is invisible until someone's claim is short.
--
-- Deltas rather than snapshots, because §288 rewards amount held x time held and
-- the integral needs every segment boundary, not periodic samples.
CREATE TABLE balance_events (
    block_number    BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    log_index       INTEGER     NOT NULL,

    market          BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    account         BYTEA       NOT NULL,
    delta           NUMERIC(78, 0) NOT NULL,
    timestamp       BIGINT      NOT NULL,

    PRIMARY KEY (block_number, log_index, account)
);

CREATE INDEX balance_events_market_time_idx ON balance_events (market, timestamp);
CREATE INDEX balance_events_account_idx ON balance_events (market, account, timestamp);

-- Current balances, derived. Kept because the holder count and the eligible set
-- are read constantly, and replaying every delta per request would be absurd.
CREATE TABLE balances (
    market      BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    account     BYTEA       NOT NULL,
    balance     NUMERIC(78, 0) NOT NULL,
    last_block  BIGINT      NOT NULL,

    PRIMARY KEY (market, account),
    CONSTRAINT balances_non_negative CHECK (balance >= 0)
);

CREATE INDEX balances_market_holders_idx ON balances (market) WHERE balance > 0;

-- Addresses that must never earn Stockback (§323, §324). Populated from the
-- factory's deployment record, not inferred — §323 requires exclusions to be
-- registered or deterministically exposed.
CREATE TABLE stockback_exclusions (
    market      BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    account     BYTEA       NOT NULL,
    reason      TEXT        NOT NULL,
    PRIMARY KEY (market, account)
);

-- ---------------------------------------------------------------------------
-- Fees and Stockback
-- ---------------------------------------------------------------------------

CREATE TABLE fee_accruals (
    block_number    BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    log_index       INTEGER     NOT NULL,

    market          BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    creator         BYTEA       NOT NULL,
    asset           BYTEA       NOT NULL,
    creator_amount  NUMERIC(78, 0) NOT NULL,
    platform_amount NUMERIC(78, 0) NOT NULL,
    timestamp       BIGINT      NOT NULL,

    PRIMARY KEY (block_number, log_index)
);

CREATE INDEX fee_accruals_creator_idx ON fee_accruals (creator, timestamp DESC);

CREATE TABLE stockback_funding (
    block_number    BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    log_index       INTEGER     NOT NULL,

    market          BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    amount          NUMERIC(78, 0) NOT NULL,
    total_funded    NUMERIC(78, 0) NOT NULL,
    timestamp       BIGINT      NOT NULL,

    PRIMARY KEY (block_number, log_index)
);

-- Attested cumulative commitments (§404, §407).
--
-- `activated_at_block` stays NULL until the activation actually happens, so the
-- API can distinguish "submitted and waiting" from "claimable" without inferring
-- it from timestamps. §293 requires estimated accrual and claimable entitlement
-- to be visibly different things.
CREATE TABLE stockback_commitments (
    market              BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    epoch_sequence      BIGINT      NOT NULL,

    merkle_root         BYTEA       NOT NULL,
    dataset_hash        BYTEA       NOT NULL,
    total_cumulative    NUMERIC(78, 0) NOT NULL,

    submitted_at_block  BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    submitter           BYTEA       NOT NULL,
    active_at           BIGINT      NOT NULL,
    activated_at_block  BIGINT,
    cancelled_at_block  BIGINT,

    PRIMARY KEY (market, epoch_sequence)
);

CREATE INDEX stockback_commitments_active_idx ON stockback_commitments (market, activated_at_block DESC);

CREATE TABLE stockback_claims (
    block_number    BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    log_index       INTEGER     NOT NULL,

    market          BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    account         BYTEA       NOT NULL,
    amount          NUMERIC(78, 0) NOT NULL,
    cumulative      NUMERIC(78, 0) NOT NULL,
    timestamp       BIGINT      NOT NULL,

    PRIMARY KEY (block_number, log_index)
);

CREATE INDEX stockback_claims_account_idx ON stockback_claims (account, timestamp DESC);

-- ---------------------------------------------------------------------------
-- Chart data
-- ---------------------------------------------------------------------------

-- OHLC candles derived from trades (§57, §1069 chart data). Derived, so a reorg
-- rebuilds the affected buckets from `trades` rather than adjusting them.
CREATE TABLE candles (
    market      BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    interval_s  INTEGER     NOT NULL,
    bucket      BIGINT      NOT NULL,

    open        NUMERIC(78, 0) NOT NULL,
    high        NUMERIC(78, 0) NOT NULL,
    low         NUMERIC(78, 0) NOT NULL,
    close       NUMERIC(78, 0) NOT NULL,
    volume      NUMERIC(78, 0) NOT NULL,
    trade_count INTEGER     NOT NULL,

    PRIMARY KEY (market, interval_s, bucket)
);

-- ---------------------------------------------------------------------------
-- Registry mirror
-- ---------------------------------------------------------------------------

-- Mirror of the on-chain XStockRegistry. A projection, like everything else: the
-- contract decides what is launchable, and this only lets the UI ask cheaply.
CREATE TABLE xstock_assets (
    asset                   BYTEA       PRIMARY KEY,
    symbol                  TEXT,
    decimals                SMALLINT    NOT NULL,
    core_token_index        BIGINT      NOT NULL,
    evm_extra_wei_decimals  SMALLINT    NOT NULL,

    -- The eight §420 gates, stored individually so a half-verified asset is
    -- visible rather than encoded into a single boolean.
    gate_canonical          BOOLEAN     NOT NULL DEFAULT FALSE,
    gate_transfer           BOOLEAN     NOT NULL DEFAULT FALSE,
    gate_multiplier         BOOLEAN     NOT NULL DEFAULT FALSE,
    gate_price_source       BOOLEAN     NOT NULL DEFAULT FALSE,
    gate_halt_source        BOOLEAN     NOT NULL DEFAULT FALSE,
    gate_hyperswap          BOOLEAN     NOT NULL DEFAULT FALSE,
    gate_accounting         BOOLEAN     NOT NULL DEFAULT FALSE,
    gate_legal              BOOLEAN     NOT NULL DEFAULT FALSE,

    enabled_for_new_launches BOOLEAN    NOT NULL DEFAULT FALSE,
    verified_at             BIGINT,
    last_block              BIGINT      NOT NULL
);
