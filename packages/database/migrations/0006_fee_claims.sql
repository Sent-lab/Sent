-- SENT — fee claims (§178.7, §21, §499).
--
-- §21's canonical event family is "FeesAccrued / FeesClaimed" and §178.7's
-- readiness list has "Fee claim indexing works" as its own line. Only the
-- accrual side was indexed.
--
-- WHY THE ACCRUAL SIDE ALONE IS NOT ENOUGH
--   What a creator can withdraw is read from the vault (§423), so the missing
--   claims did not make any figure wrong. What they made impossible is HISTORY:
--   a creator could see that they had earned 4.2 xStock in total and that 0 was
--   payable, with nothing to say whether that was because they withdrew it last
--   Tuesday or because something failed.
--
--   §499's creator claim flow ends with the claim being visible afterwards, and
--   "your money is somewhere" is not a state a product should leave someone in.
--
-- BOTH SIDES OF THE VAULT
--   `CreatorClaimed(creator, asset, amount, to)` and
--   `PlatformClaimed(asset, amount, to)`. The platform's claims are recorded in
--   the same table with a NULL creator rather than in a second one: they are
--   the same event shape from the same contract, and §12's accounting
--   separation is about the BUCKETS the money came from, which the vault has
--   already applied by the time either is emitted.
--
--   The `to` address is stored because it can differ from the claimer. The
--   vault pays msg.sender's balance to an address they nominate, so "who
--   claimed" and "where it went" are two facts and a row that carried only one
--   of them would be unable to answer the more interesting question.

CREATE TABLE fee_claims (
    block_number    BIGINT      NOT NULL REFERENCES blocks (number) ON DELETE CASCADE,
    log_index       INTEGER     NOT NULL,

    /* NULL for a platform claim. See above. */
    creator         BYTEA,
    asset           BYTEA       NOT NULL,
    amount          NUMERIC(78, 0) NOT NULL,
    recipient       BYTEA       NOT NULL,
    timestamp       BIGINT      NOT NULL,

    PRIMARY KEY (block_number, log_index),

    /* A zero-value claim is a revert in the vault (`NothingToClaim`), so a row
       carrying one means the projection has misread a log rather than that the
       chain did something unusual. */
    CONSTRAINT fee_claims_positive CHECK (amount > 0)
);

CREATE INDEX fee_claims_creator_idx ON fee_claims (creator, block_number DESC)
    WHERE creator IS NOT NULL;

CREATE INDEX fee_claims_asset_idx ON fee_claims (asset, block_number DESC);
