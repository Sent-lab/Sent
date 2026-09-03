-- SENT — token metadata (§95.20, §115).
--
-- WHY THIS IS A PROJECTION AND NOT THE RECORD
--   The record is on-chain. §138 makes that the authority for everything else
--   and there is no reason for a description to be the exception — a description
--   in the platform's own database is one the platform can silently rewrite,
--   and it is the field a human actually reads.
--
--   So these rows are a cache of events, rebuildable like every other table
--   here. Dropping them loses nothing.
--
-- EVERY REVISION IS KEPT
--   §95.20 asks whether metadata may change post-launch and whether an audit
--   trail is relevant. It may, and it is: the creator can revise, and each
--   revision is its own row.
--
--   Keeping only the latest would make the launch-time content unrecoverable —
--   and the launch-time content is the only one that hashes to the commitment
--   in the token's address. Discarding it would throw away the one version that
--   can be verified.

CREATE TABLE token_metadata (
    token           BYTEA       NOT NULL REFERENCES markets (token) ON DELETE CASCADE,
    /* 0 is the launch. Increments on every revision, from the contract's own
       counter — not from a row count here, which a reorg could leave short. */
    revision        BIGINT      NOT NULL,

    description     TEXT        NOT NULL,
    /* IPFS CID. Empty means no image; the CID is a hash of the bytes, so a
       gateway serving something else fails the check without us storing it. */
    image_cid       TEXT        NOT NULL,
    /* [{label, url}], at most four. JSONB rather than a child table: it is read
       whole, written whole, never joined and never filtered on. */
    links           JSONB       NOT NULL DEFAULT '[]'::JSONB,

    author          BYTEA       NOT NULL,
    block_number    BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    log_index       INTEGER     NOT NULL,
    timestamp       BIGINT      NOT NULL,

    PRIMARY KEY (token, revision)
);

/* The hot read: the newest revision for a token. */
CREATE INDEX token_metadata_latest_idx ON token_metadata (token, revision DESC);

/*
 * The launch-time commitment, kept beside the market it belongs to.
 *
 * `launch_intent_hash` is in the CREATE2 salt and therefore in the token's
 * address (§412). Storing it lets a reader check revision 0's content against
 * it without re-deriving an address — and the answer is a fact about the chain
 * rather than an assurance from this API (§231).
 */
ALTER TABLE markets ADD COLUMN launch_intent_hash BYTEA;
