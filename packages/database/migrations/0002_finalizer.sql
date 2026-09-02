-- SENT — finalizer output.
--
-- WHY THESE ARE NOT THE COMMITMENT TABLES
--   `stockback_commitments` is a projection of what the vault accepted on-chain.
--   Everything here is the opposite: a LOCAL COMPUTATION that no one has signed
--   and the chain has never seen.
--
--   Keeping them in one table would be a category error with a financial edge.
--   `getActiveCommitment` would start returning roots that were never attested,
--   and the API would tell a holder their reward is claimable when no contract
--   would honour the proof.
--
--   So: separate tables, and the only thing that ever writes to the commitment
--   tables is the indexer reading a log.
--
-- REORG SAFETY
--   A dataset is computed over indexed events. If those events are rolled back,
--   the dataset describes a chain that no longer exists and must be recomputed,
--   not adjusted — hence the FK to `blocks` with ON DELETE CASCADE, which makes
--   the existing rollback path delete it for free.

-- The commitment this node would ask attestors to sign, and the inputs that
-- produced it. §367 requires the dataset to be public and reproducible; it is
-- stored rather than recomputed per request because a claim page cannot afford
-- to re-run TWAB over a market's whole history.
CREATE TABLE stockback_datasets (
    market                  BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    epoch_sequence          BIGINT      NOT NULL,

    merkle_root             BYTEA       NOT NULL,
    dataset_hash            BYTEA       NOT NULL,
    total_cumulative        NUMERIC(78, 0) NOT NULL,
    -- Dust rolled into the next epoch (§327). Recorded because it is holder
    -- money that this commitment deliberately does NOT pay out, and a number
    -- that is deliberately withheld has to be visible.
    carry_forward           NUMERIC(78, 0) NOT NULL,
    -- The §364 conservation ceiling as it stood when this was computed.
    total_funded            NUMERIC(78, 0) NOT NULL,
    holder_count            INTEGER     NOT NULL,

    computed_through_block  BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    computed_at             BIGINT      NOT NULL,

    PRIMARY KEY (market, epoch_sequence),

    CONSTRAINT stockback_datasets_within_funding CHECK (total_cumulative <= total_funded)
);

CREATE INDEX stockback_datasets_latest_idx ON stockback_datasets (market, epoch_sequence DESC);

-- One holder's entitlement under one dataset, with the proof already built.
--
-- The proof is stored, not derived on read: rebuilding the tree to answer a
-- single claim would make the claim endpoint cost O(holders) per request, and
-- the tree is immutable once the root is fixed.
CREATE TABLE stockback_entitlements (
    market          BYTEA       NOT NULL,
    epoch_sequence  BIGINT      NOT NULL,
    account         BYTEA       NOT NULL,

    -- Cumulative, never per-epoch. The vault pays `cumulative - claimed`, so a
    -- per-epoch figure here would be the wrong number in the right column.
    cumulative      NUMERIC(78, 0) NOT NULL,
    proof           BYTEA[]     NOT NULL,

    PRIMARY KEY (market, epoch_sequence, account),
    FOREIGN KEY (market, epoch_sequence)
        REFERENCES stockback_datasets (market, epoch_sequence) ON DELETE CASCADE
);

CREATE INDEX stockback_entitlements_account_idx ON stockback_entitlements (market, account);

-- Per-epoch breakdown behind a dataset — the transparency artefact of §367.
--
-- Without it "you earned 12.4 xSTOCK" is an assertion. With it a holder can see
-- which epochs they were counted in, what the pool was, and what carried.
CREATE TABLE stockback_epoch_allocations (
    market            BYTEA     NOT NULL,
    epoch_sequence    BIGINT    NOT NULL,
    epoch_id          BIGINT    NOT NULL,

    pool              NUMERIC(78, 0) NOT NULL,
    allocated         NUMERIC(78, 0) NOT NULL,
    carry_forward     NUMERIC(78, 0) NOT NULL,
    eligible_holders  INTEGER   NOT NULL,
    total_weight      NUMERIC(78, 0) NOT NULL,

    PRIMARY KEY (market, epoch_sequence, epoch_id),
    FOREIGN KEY (market, epoch_sequence)
        REFERENCES stockback_datasets (market, epoch_sequence) ON DELETE CASCADE,

    -- Allocation can never exceed the pool it came from; the remainder is the
    -- carry. An equality check would be wrong (rounding leaves dust), but this
    -- direction is a hard invariant of `distributeEpoch`.
    CONSTRAINT stockback_epoch_allocations_conserved CHECK (allocated + carry_forward <= pool)
);
