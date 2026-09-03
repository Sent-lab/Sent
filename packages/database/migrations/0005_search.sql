-- SENT — search and account indexes (§95.21, §428, §64).
--
-- §428 is explicit that V1 search is PostgreSQL, not Elasticsearch: indexes
-- plus trigram/full-text/address lookup. §95.21 lists what has to be findable —
-- token name, ticker, contract address, creator address — and none of it had an
-- index, because none of it had a query.
--
-- WHY TRIGRAM RATHER THAN FULL-TEXT
--   `to_tsvector` is built for prose: it stems words and drops stop-words. A
--   ticker is neither. "SENT" and "SEN" are unrelated to a text-search parser
--   and are the same prefix to a person typing, and a name like "0xLabs" gets
--   lexed into pieces nobody would search for.
--
--   Trigram similarity matches the way a partial ticker is actually typed, and
--   `gin_trgm_ops` makes `ILIKE '%...%'` an index scan rather than a table scan.
--
-- Addresses are matched exactly, on the primary key or a dedicated index. A
-- fuzzy match on an address is never what someone wants: a near-miss on twenty
-- bytes is a different market, and offering it is how a person ends up on the
-- wrong token page with the right-looking name.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX markets_name_trgm_idx ON markets USING GIN (name gin_trgm_ops);
CREATE INDEX markets_symbol_trgm_idx ON markets USING GIN (symbol gin_trgm_ops);

/* Exact-address lookups. `token` is already the primary key; these are the
   other two identities §95.21 requires to be searchable. */
CREATE INDEX IF NOT EXISTS markets_creator_idx ON markets (creator);
CREATE INDEX IF NOT EXISTS markets_quote_asset_idx ON markets (quote_asset);

/* §64's account dashboard reads every position one wallet holds, across
   markets. The primary key is (market, account), which cannot answer that. */
CREATE INDEX IF NOT EXISTS balances_account_idx ON balances (account)
    WHERE balance > 0;

/* §166's platform stats count launches and graduations in a time window. */
CREATE INDEX IF NOT EXISTS markets_launched_at_idx ON markets (launched_at DESC);
CREATE INDEX IF NOT EXISTS trades_timestamp_idx ON trades (timestamp DESC);
