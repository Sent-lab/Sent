-- SENT — migration 0008: GRADUATING is a state markets rest in (D-016, V-20)
--
-- 0001 asserted the opposite, in a comment on `market_state.status`:
--
--     "GRADUATING must never be observed here: it exists only inside a single
--      transaction, so a persisted 1 means the indexer captured a partial state."
--
-- That was true of the design it was written for and is now false. Graduation
-- costs 5,388,986 gas against the real HyperSwap deployment; HyperEVM's default
-- block lane caps at 3,000,000 and runs at 99.8% of that in ordinary blocks. So
-- the migration cannot ride along in the buy that crosses the endpoint, and the
-- curve closes in one transaction while the position is minted in another.
--
-- A persisted 1 is therefore normal, and a market sitting in it is not evidence
-- of a broken indexer. What IS worth alerting on is a market sitting in it for
-- a long time, which is what `graduating_at_block` makes answerable.

COMMENT ON COLUMN market_state.status IS
    '0 = PRE_GRAD, 1 = GRADUATING, 2 = GRADUATED. Mirrors the enum (S19). '
    'GRADUATING is a resting state: the curve is permanently closed and the '
    'HyperSwap position is not yet minted (D-016). Trading is dead in it, in '
    'both directions.';

-- The block whose buy closed the curve.
--
-- NOT NULL-able-and-forgotten: it is set on GraduationPending and never cleared,
-- so `graduating_at_block IS NOT NULL AND status <> 2` is exactly the set of
-- markets waiting on a finaliser. That is the keeper's work queue and the
-- operator's alert, so it is one indexed predicate rather than a scan.
ALTER TABLE market_state
    ADD COLUMN IF NOT EXISTS graduating_at_block BIGINT;

COMMENT ON COLUMN market_state.graduating_at_block IS
    'Block in which the crossing buy closed the curve. Set on GraduationPending '
    'and on Graduated (a reindex from a later block never sees the first), and '
    'never cleared.';

-- Partial index: the pending set is small by construction - a market passes
-- through it once, briefly - so indexing only the rows in it keeps the keeper's
-- query proportional to the work outstanding rather than to the market count.
CREATE INDEX IF NOT EXISTS market_state_awaiting_finalisation_idx
    ON market_state (graduating_at_block)
    WHERE graduating_at_block IS NOT NULL AND status <> 2;

-- A market that graduated must record when its curve closed. Enforced rather
-- than assumed, because the reindex path is the one that can silently skip it.
ALTER TABLE market_state
    DROP CONSTRAINT IF EXISTS market_state_graduating_recorded;

ALTER TABLE market_state
    ADD CONSTRAINT market_state_graduating_recorded
    CHECK (status <> 2 OR graduating_at_block IS NOT NULL);
