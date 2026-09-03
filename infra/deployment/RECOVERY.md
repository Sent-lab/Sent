# Backups and recovery

§436, and the reason it exists:

> Rebuilding years of indexed history during an incident is technically possible
> but operationally unacceptable if avoidable.

That sentence is the whole design. Everything below assumes the projection *can*
be rebuilt from chain — §138 says so and `fullReindex` implements it — and is
about not having to.

---

## What is actually at risk

Nothing financial. It is worth being precise about this, because it changes what
a backup is for.

| | Lives in | Recoverable from |
|---|---|---|
| Token supply, balances | chain | the chain |
| Curve state, graduation | chain | the chain |
| Creator fee balances | FeeVault | the chain |
| Stockback entitlements | HolderRewardVault roots | the chain, plus a recomputed dataset |
| Everything in PostgreSQL | PostgreSQL | the chain, slowly |

**Losing the database loses no money.** It loses availability, for as long as a
full reindex takes. That is the cost being insured against.

The one asymmetry worth noticing: a dataset can be recomputed, but only from
indexed events, and only if those events are indexed the same way. Determinism
is what makes that true, and `packages/stockback/sim/determinism.ts` is what
proves it.

---

## Backups

**Automated, daily, retained thirty days.** Point-in-time recovery where the
provider supports it — a WAL archive turns "yesterday's snapshot" into "the
minute before the mistake", and the mistakes that need it are the ones made by
an operator rather than by the code.

```bash
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > sent-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Custom format rather than plain SQL: it restores selectively, in parallel, and a
plain dump of a large `trades` table is a file nobody can partially restore.

`--no-owner --no-privileges` because the role names in production are not the
role names in a restore rehearsal, and a dump that only restores onto its own
cluster is a dump that has never been tested.

### What is NOT backed up, deliberately

- **The realtime replay buffer.** In memory, disposable by design. A client that
  misses messages reconnects with `sinceBlock` and either replays or is told it
  cannot.
- **API caches.** Bounded, in-process, rebuilt on the next request.
- **Any Redis instance,** if one is ever introduced. §425 forbids it being the
  sole storage for anything financial, and §436 says treat it as disposable
  unless durable queue semantics require otherwise. Nothing here requires it.

---

## Restore

```bash
createdb sent_restore
pg_restore --dbname=sent_restore --no-owner --jobs=4 sent-20260903T000000Z.dump
```

Then check the projection agrees with itself before pointing anything at it:

```sql
-- The cursor must not be ahead of the blocks it claims to have indexed.
SELECT (SELECT block_number FROM indexer_state) AS cursor,
       (SELECT MAX(number) FROM blocks)        AS highest_block;

-- Every derived row references a block that exists. Zero rows, or the restore
-- is partial.
SELECT COUNT(*) FROM trades t LEFT JOIN blocks b ON b.number = t.block_number
 WHERE b.number IS NULL;

-- Balances reconcile with their own event log.
SELECT COUNT(*) FROM (
  SELECT market, account, SUM(delta) AS computed FROM balance_events
   GROUP BY market, account HAVING SUM(delta) > 0
) e JOIN balances b USING (market, account)
 WHERE b.balance <> e.computed;
```

The third query is the one that matters. It is the same invariant the worker's
`holder_balance` reconciliation checks continuously, so a non-zero answer here
means the backup captured a torn state rather than that the restore failed.

**Start the indexer before the API.** The indexer will catch up from the cursor;
the API serving a projection that is hours behind is honest — it reports
`DELAYED` — but there is no reason to show it to anyone.

---

## Migration rollback

Migrations are forward-only and are applied by the indexer at startup, in
filename order, recorded in `schema_migrations`.

**There are no down-migrations, on purpose.** A down-migration is code that runs
exactly once, under pressure, having never been executed successfully. The
rollback strategy is:

1. **Additive migrations** — a new table, a new nullable column, a new index.
   Roll back the CODE and leave the schema. The old code does not know the
   column exists.

2. **Destructive migrations** — a dropped column, a narrowed type, a rekeyed
   table. Restore from backup and replay. `0004_commitments.sql` is the one
   example so far: it drops and recreates `stockback_commitments` because the
   original could not be written from a chain log at all. It was safe to drop
   precisely because it had never held a row.

3. **Never edit an applied migration.** `schema_migrations` records the name,
   not a hash, so an edited file silently does not re-run — and every
   environment then has a different schema under the same version.

A migration that cannot be rolled back by (1) needs a deploy plan written before
it is merged, not after it is applied.

---

## Rehearsal

**A backup that has not been restored is a hypothesis.** Quarterly, and after
any migration in category (2):

1. Restore the newest dump into a scratch database.
2. Run the three checks above. All three must return the expected zero.
3. Point an indexer at it with a real RPC and let it catch up.
4. Run `tests/e2e/stack.ts` against it.

Step 4 is the point. The first three prove the data arrived; only the fourth
proves the system can still be run on it.

---

## Full reindex, if it comes to that

The last resort, and it works:

```bash
DATABASE_URL=… RPC_URL=… node --experimental-strip-types services/indexer/src/main.ts
```

with `START_BLOCK` set to the factory's deployment block and the projection
truncated. `fullReindex` does this in-process when the reorg tracker detects a
history it cannot reconcile.

Duration scales with `batchSize` and the RPC's `getLogs` limit, neither of which
has been measured against HyperEVM (V-15). **That is why the backups exist.**

---

## A market stuck between its two graduation transactions

**Symptom:** `sent_keeper_worst_wait_blocks` above
`sent_keeper_stall_threshold_blocks`, or `GET /graduations/pending` returning
`stalled: true`.

**What the user sees:** nothing works. The market's curve is permanently closed
and its HyperSwap pool does not exist yet, so buys and sells both revert and
there is no other venue to send them to. This is the only state in the protocol
where a holder can do nothing at all, which is why it pages.

**Why it exists.** A full graduation costs 5,388,986 gas against the real
HyperSwap deployment. HyperEVM's default block lane caps at 3,000,000 and runs
at 99.8% of that in ordinary blocks, so the migration cannot ride along in the
buy that crosses the endpoint. D-016 split it; V-20 has the measurements.

**Nothing is lost while it waits.** The escrow is frozen: `distributed`,
`curveCollateral` and `graduationDust` were fixed when the curve closed, and
every function that could move them is `onlyPreGrad`. There is no deadline, no
decay, and no way for the numbers to drift. The migration is late, not at risk.

### First: anyone can fix this, including you, from a wallet

`finalizeGraduation()` is permissionless (§16). It takes no arguments, reads no
`msg.sender`, and pays its caller nothing. So before diagnosing the keeper:

```bash
cast send <MARKET_ADDRESS> "finalizeGraduation()" --gas-limit 8000000 --rpc-url "$RPC_URL"
```

The sending account must be opted into the **large block lane** — see below.
This is also what the UI's finalise button does, through
`buildFinalizeGraduationIntent`, so a user looking at their own stalled market
can resolve it without an operator.

### Then: why did the keeper not do it

Read `GET /graduations/pending` and the keeper's `/metrics` together.

| Reading | Meaning | Action |
|---|---|---|
| `sent_keeper_can_send == 0`, log says `watch-only` | no `KEEPER_PRIVATE_KEY` | set it, restart |
| `can_send == 0`, log names a balance | account is empty | fund it with HYPE |
| `can_send == 0`, log says the balance could not be read | RPC is down | fix the RPC; the keeper is refusing to send blind on purpose |
| `can_send == 1`, `last_sweep_failures > 0` | the finalise itself reverts | read the reason in the logs, then the table below |
| `absent(sent_keeper_pending_graduations)` | the keeper cannot see the database | it is not a keeper problem |
| `sent_keeper_seconds_since_sweep` climbing | the sweep loop died | restart; the loop is meant to survive errors, so this is a bug worth keeping the logs for |

### The large block lane

**This is the failure mode most likely to look like something else.** A finalise
needs ~5.4M gas. An account that has not opted into HyperEVM's large lane cannot
have such a transaction included at all.

`FINALISE_GAS_LIMIT` is set to 8,000,000 — deliberately above the 3,000,000
default-lane ceiling — so an un-opted account is **rejected at send time** with a
clear error rather than posting transactions that sit unmined forever. If the
keeper's logs show sends failing outright rather than reverting, check this
first.

Opting in is a **Hyperliquid L1 action, not an EVM call**. Nothing in this
repository can perform it, and V-20 records explicitly that the mechanism has
**not been verified first-hand** — confirm it against current Hyperliquid
documentation before relying on any specific procedure here.

### If the finalise itself reverts

| Revert | Meaning | Action |
|---|---|---|
| `NotGraduating()` | already finalised by someone else | none — this is the permissionless path working |
| `RouterNotSet()` | the factory never wired a router to this market | governance calls `setRouter`; the market cannot graduate until it does |
| `PoolPriceDiverged(expected, actual)` | a pool already exists for this pair at a different price | **escalate, do not retry.** See below. |
| `GraduationIncomplete()` | the router returned no pool | HyperSwap-side failure; retry, and if it persists escalate |

`PoolPriceDiverged` is the one that needs a person. Anyone can create a
HyperSwap pool for any pair at any price, and every graduating market is a known
target well in advance. D-015's price check exists so that the migration reverts
rather than minting a market's entire liquidity into a pool a stranger priced —
so this revert is the guard doing its job, and retrying it will fail identically
forever. The market stays safely escrowed while the response is decided; §15
makes spot-price continuity a hard invariant, so there is no correct way to
finalise into a mispriced pool.

### What NOT to do

- **Do not add a way to skip the price check.** It is the only thing standing
  between a graduating market and a pool an attacker priced.
- **Do not "unstick" a market by reopening its curve.** There is no such path and
  there must not be: §19 makes the closure permanent, and a market that could
  reopen would let the endpoint be crossed twice.
- **Do not wait for the keeper if a market is genuinely stalled.** The call is
  permissionless so that nobody has to wait for one particular process, and that
  includes you.
