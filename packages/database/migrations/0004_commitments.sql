-- SENT — the commitment projection, keyed the way the chain keys it.
--
-- WHAT WAS WRONG
--   `stockback_commitments` was written in 0001 with PRIMARY KEY
--   (market, epoch_sequence) and NOT NULL on `epoch_sequence` and
--   `dataset_hash`. Neither of those is in the vault's event:
--
--     CommitmentSubmitted(market, merkleRoot, totalCumulative, activeAt, submitter)
--     CommitmentActivated(market, merkleRoot, totalCumulative)
--
--   The epoch sequence and the dataset hash are LOCAL artefacts — they exist
--   because this node happened to compute the distribution. §406 has each
--   attestor running their own indexer, and a node that only indexes has never
--   computed a dataset and cannot supply either value.
--
--   So the table could not be written from a log at all, which is why nothing
--   wrote it. `getActiveCommitment` returned NULL forever, which made every
--   holder's claimable figure zero regardless of what the vault would pay.
--
-- WHAT THIS CHANGES
--   The merkle root is the chain's own identity for a commitment: the vault
--   stores one pending and one active root per market, and monotonicity is
--   enforced against them. So (market, merkle_root) is the key.
--
--   `epoch_sequence` and `dataset_hash` become nullable and are filled in when
--   this node knows the matching dataset. They are annotations on chain truth,
--   not part of it.
--
--   Ordering moves to `submitted_at_block`. Chain order is the only order a
--   pure indexer has, and the vault's own monotonicity check makes it agree
--   with the sequence anyway.

DROP TABLE IF EXISTS stockback_commitments;

CREATE TABLE stockback_commitments (
    market              BYTEA       NOT NULL REFERENCES markets (market) ON DELETE CASCADE,
    merkle_root         BYTEA       NOT NULL,

    total_cumulative    NUMERIC(78, 0) NOT NULL,
    submitter           BYTEA       NOT NULL,
    /* Unix seconds after which activation is permitted (§334). */
    active_at           BIGINT      NOT NULL,

    submitted_at_block  BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    /* Set when CommitmentActivated is seen. Until then this root pays nothing. */
    activated_at_block  BIGINT      REFERENCES blocks (number) ON DELETE SET NULL,
    /* Set when PendingCommitmentCancelled is seen. A cancelled root never pays. */
    cancelled_at_block  BIGINT      REFERENCES blocks (number) ON DELETE SET NULL,

    /* Local annotations. NULL on a node that has not computed this dataset. */
    epoch_sequence      BIGINT,
    dataset_hash        BYTEA,

    PRIMARY KEY (market, merkle_root),

    /* A commitment cannot be both live and withdrawn. The vault refuses to
       activate a cancelled root, so a row in that state means the projection
       has misread the chain rather than that the chain did something odd. */
    CONSTRAINT stockback_commitments_not_both
        CHECK (activated_at_block IS NULL OR cancelled_at_block IS NULL)
);

/* The lookup on the hot path: the newest ACTIVE root for a market. */
CREATE INDEX stockback_commitments_active_idx
    ON stockback_commitments (market, submitted_at_block DESC)
    WHERE activated_at_block IS NOT NULL AND cancelled_at_block IS NULL;

-- ---------------------------------------------------------------------------
-- Claims
--
-- Also never written. `getClaimedTotal` reads this table to compute
-- `cumulative - claimed`, which is exactly what the vault pays. With the table
-- empty it always returned zero, so a holder who had already claimed was shown
-- the full amount again — and the claim they were invited to make would revert.
--
-- The table itself was correct in 0001; only its index is added here, because
-- the query is per (market, account) and the primary key is positional.
CREATE INDEX IF NOT EXISTS stockback_claims_account_idx
    ON stockback_claims (market, account, block_number DESC);

/* §347's account-level Stockback centre reads across markets for one account. */
CREATE INDEX IF NOT EXISTS stockback_claims_by_account_idx
    ON stockback_claims (account, block_number DESC);
