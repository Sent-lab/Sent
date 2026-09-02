-- SENT — background job queue (§431).
--
-- WHY A TABLE AND NOT A QUEUE SERVICE
--   Every job here is a pure function of projection state: recompute this
--   market's candles, reconcile these balances, check this range for gaps.
--   None of them carry data that would be lost if the queue vanished, because
--   the queue is not the source of anything — the projection is, and the
--   projection is itself rebuildable from the chain (§138).
--
--   That makes an extra piece of infrastructure a liability rather than a
--   feature: one more thing to run, monitor and lose, in exchange for durability
--   this workload does not need.
--
-- IDEMPOTENCY IS THE JOB ID
--   §431 asks for deterministic job identifiers. Here the id IS the idempotency
--   key: `candles:0xabc…:60:1738368000` names exactly one unit of work, so
--   enqueueing it twice is a no-op rather than a double-run. Handlers recompute
--   and replace rather than increment, so even a retry after a partial write
--   converges on the same answer.

CREATE TABLE jobs (
    -- Deterministic. Two producers deciding the same work is needed must
    -- produce the same id, or the ON CONFLICT that makes enqueue idempotent
    -- silently stops working.
    id              TEXT        PRIMARY KEY,
    kind            TEXT        NOT NULL,
    payload         JSONB       NOT NULL,

    status          TEXT        NOT NULL DEFAULT 'PENDING',
    attempts        INTEGER     NOT NULL DEFAULT 0,
    max_attempts    INTEGER     NOT NULL,

    -- Unix seconds. Backoff moves this forward rather than sleeping in the
    -- worker, so a delayed retry does not hold a process or a connection.
    run_after       BIGINT      NOT NULL,

    -- Kept on DEAD rows, which is the whole point of a dead letter: a job that
    -- failed four times and left no reason behind is an outage with no lead.
    last_error      TEXT,

    created_at      BIGINT      NOT NULL,
    updated_at      BIGINT      NOT NULL,

    CONSTRAINT jobs_status_valid CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'DEAD')),
    CONSTRAINT jobs_attempts_bounded CHECK (attempts <= max_attempts)
);

-- The claim query's index: pending work, oldest eligible first.
CREATE INDEX jobs_claimable_idx ON jobs (run_after) WHERE status = 'PENDING';

-- Dead letters are meant to be looked at, so they get their own index rather
-- than a scan over every job ever run.
CREATE INDEX jobs_dead_idx ON jobs (updated_at DESC) WHERE status = 'DEAD';

-- Drift found by reconciliation, kept rather than silently repaired.
--
-- A worker that quietly corrects the projection and moves on destroys the only
-- evidence that the indexer produced a wrong value. The repair still happens —
-- but it leaves a record, because repeated drift on one market is a bug in
-- ingestion, and the row is how anyone would ever notice.
CREATE TABLE reconciliation_findings (
    id              BIGSERIAL   PRIMARY KEY,
    kind            TEXT        NOT NULL,
    market          BYTEA,
    subject         TEXT        NOT NULL,

    expected        TEXT        NOT NULL,
    observed        TEXT        NOT NULL,
    repaired        BOOLEAN     NOT NULL,
    found_at        BIGINT      NOT NULL
);

CREATE INDEX reconciliation_findings_recent_idx ON reconciliation_findings (found_at DESC);
