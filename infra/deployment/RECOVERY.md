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

---

## Listing a quote asset (the wrapper flow)

Not a recovery procedure — the ordinary path, written here because it is the one
sequence where doing the steps out of order produces something that looks
correct and is not.

Markets are quoted in a wrapper, never in the xStock itself (D-017). The registry
enforces that structurally: `RebaseDetector` refuses any rebasing asset whatever
the §420 gates say, and **every xStock rebases**.

### The order, and why it is this order

```bash
# 1. Create the wrapper. Permissionless, one per asset, address is derivable.
cast send $WRAPPER_FACTORY "create(address)" $XSTOCK --rpc-url "$RPC_URL"

# 2. Check it is the one you expected, BEFORE listing it.
cast call $WRAPPER_FACTORY "predict(address)(address)" $XSTOCK --rpc-url "$RPC_URL"
cast call $WRAPPER "UNDERLYING()(address)" --rpc-url "$RPC_URL"
cast call $WRAPPER "symbol()(string)"      --rpc-url "$RPC_URL"

# 3. Register it, naming the underlying explicitly. Governance only.
#    The registry verifies PROVENANCE - that this factory named this wrapper for
#    this underlying - so a lookalike cannot be listed even if it answers every
#    question correctly.
cast send $REGISTRY \
  "registerWrappedAsset(address,address,uint8,uint32,uint8)" \
  $WRAPPER $XSTOCK 18 $CORE_TOKEN_INDEX 0 --rpc-url "$RPC_URL"

# 4. Attest the eight S420 gates, then enable. Both governance only.
cast send $REGISTRY "setGates(address,(bool,bool,bool,bool,bool,bool,bool,bool))" ...
cast send $REGISTRY "enableAsset(address)" $WRAPPER --rpc-url "$RPC_URL"
```

**Step 2 is not optional and cannot be automated away.** The registry's
provenance check proves the wrapper's CODE is the known bytecode. It cannot
prove you passed the right `$XSTOCK` — that is the human judgement §420's
`canonicalRepresentation` gate exists for, and it is the one thing here nobody
else checks for you.

### What will refuse you, and what each refusal means

| Revert | Meaning |
|---|---|
| `AssetRebases` | you tried to list the xStock itself. Wrap it first. |
| `NotFromWrapperFactory` | the address is not this factory's wrapper for that underlying. Either the wrong wrapper, or a lookalike. **Do not work around this.** |
| `WrapperUnderlyingMismatch` | the wrapper disagrees with the underlying you named. Treat as a factory-mapping bug and stop. |
| `NoWrapperFactory` | the registry was deployed with no factory bound. It is immutable — the registry has to be redeployed. |
| `AlreadyRegistered` | already listed. Check `underlyingOf` before assuming it is wrong. |

### After listing

Verify the projection agrees with the chain, because a UI that shows the wrapper
symbol without its underlying is the failure this whole path exists to prevent:

```bash
curl -s "$API/v1/markets/$TOKEN" | jq '{quoteAsset, quoteSymbol, quoteUnderlying}'
```

`quoteUnderlying` must be the xStock. If it is `null`, the indexer missed
`WrappedAssetRegistered` — reindex from the registration block rather than
patching the row.

---

## Deploying, in order

The sequence, with the two steps that fail silently if taken out of order.

### Before anything: the deployer needs the large block lane

Measured with `forge script script/GasProbe.s.sol:GasProbe`:

```text
WrappedXStockFactory      1,552,649    fits the default lane
XStockRegistry            1,385,239    fits
LaunchpadFactory (+2)     7,360,896    2.45x the 3,000,000 ceiling
ReferencePriceAdapter       691,542    fits
```

`LaunchpadFactory`'s constructor also deploys `FeeVault` and `HolderRewardVault`,
so that one transaction pays for three contracts and **cannot be included in a
default-lane block** (V-20).

**Opt the deployer account into the large lane first.** It is a Hyperliquid L1
action, not an EVM call, and nothing in this repository can perform it. The
failure mode if you skip it is a transaction that never mines — no revert, no
error, just a hash that stays pending — which is the worst symptom to debug
mid-deployment.

Re-run `GasProbe` before trusting these numbers. They move whenever the contracts
do, and the instruction above is only correct while the factory is over the
ceiling.

### The accounts, and why they are separate

| Account | Type | Why |
|---|---|---|
| Governance | **Safe, ≥ 2-of-3** | controls every parameter, and has a path to the reward vault. `Deploy.s.sol` refuses anything weaker on mainnet. |
| Treasury | Safe | receives fees, controls nothing. Any contract is accepted. |
| Deployer | **EOA** | must sign transactions directly. A Safe has no private key and cannot be a deployer. |

The deployer holds nothing afterwards — every authority goes to Governance through
constructors, in the same transaction. Its key is used once, on an
internet-connected machine, and that is a different risk profile from a key that
controls the protocol for its lifetime.

### The deploy

```bash
export GOVERNANCE=0x...          # the Safe
export TREASURY=0x...            # a different Safe
export LAUNCH_FEE=...            # wei; changeable later via governance
export DEPLOYER_PRIVATE_KEY=0x...

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --broadcast --slow
```

`--slow` matters here: it waits for each transaction to confirm before sending the
next. The registry binds the wrapper factory's address immutably and the factory
binds the registry's, so a nonce-ordering surprise produces contracts pointing at
addresses that do not exist yet.

Dry-run first by omitting `--broadcast` and `--rpc-url`. The script prints both
what it deployed and what is still missing, and the second half is the one to
read.

### What refuses you, and what it means

| Message | Meaning |
|---|---|
| `governance threshold must be at least 2` | the Safe is 1-of-N. One stolen key controls the protocol; one lost key freezes it forever. |
| `governance needs more owners than its threshold` | 2-of-2. Survives theft, not loss. |
| `governance is not a Safe` | the address is a contract whose authority structure cannot be read. |
| `governance and treasury must differ` | protocol authority and fee withdrawal collapsed into one signer set. |
| `mainnet governance must be a contract` | governance is on an EOA. |

None of these should be worked around. Each names a failure that cannot be
recovered from after markets are live.

### After it succeeds

The deployment log lists four steps that are NOT done, and a launch is refused
until at least two of them are. Read it rather than the address list — a log that
ends in addresses reads as "finished" and this one is not.
