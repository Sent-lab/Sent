# Review notes

Where the defects in this codebase have actually been, written down so the next
person reviewing it looks in the right places rather than the obvious ones.

Thirty-one defects were found and fixed during the build. **None of them was
found by a unit test.** Every one came from running real components against each
other. That is not an argument against the unit tests — they are what makes the
pure cores trustworthy, and several of them caught real errors during
development. It is an argument about where the *remaining* risk sits.

---

## Shape 1 — the seam

Twenty-two of the thirty-one lived between two components that were each
correct, and each individually tested.

| Where | What it did |
|---|---|
| Balances upsert | PostgreSQL evaluates a CHECK constraint on the proposed insert tuple before resolving the conflict, so a negative delta failed even for an account holding plenty. Every sell threw inside the ingest transaction — the first sell on the first market would have stopped indexing permanently. |
| Realtime server | `Gateway.open()` constructs a session; it is not a getter. The flush loop called it per connection every 50ms, wiping subscriptions. A client could connect, subscribe, and receive nothing forever. |
| Realtime transport | `broadcast()` existed and nothing called it. The tape read from a source that did not exist. |
| API CORS | Absent entirely. Every endpoint worked from curl and none from a browser. |
| Indexer blocks | Only each range's first block was recorded, while rows referencing every block were inserted. A 500-block batch meant 499 blocks of foreign key violations. |
| Indexer timestamps | Every log in a range took the range's first timestamp — wrong candle, and wrong TWAB epoch, which means a wrong entitlement. |
| Same-range launches | `getLogs` filters by address, learned only after the launch log is read, so everything a market emitted in its own launch range was never fetched. |
| In-memory market map | Mutated inside the transaction, so a rollback left it claiming a market the database did not have, and every later tick failed forever. |
| Genesis ordering | A token's mint and forward precede `TokenLaunched` in the same transaction, so the market's opening balance was dropped and the first buy drove it negative. |
| Same-height reorg | The tick loop only moves forward, so a one-block reorg that replaced the tip was invisible. The orphaned trade stayed in the projection permanently. |
| `rollbackTo` | Recomputed `market_state` and left `balances` stale, so the recovery path from a reorg was itself unrecoverable. |
| Balance event ordering | The credit side was offset by a million to avoid a key collision, silently reordering every block with more than one transfer. |
| Settlement boundary | Read from the reorg tracker, which is advanced after the transaction commits, so it always described the previous range. |
| `fee_accruals` | The table shipped in the first migration and nothing ever wrote to it. The indexer watched the factory, the reward vault and every market — never the fee vault — so a creator's earnings had no source. A populated schema made it look like they did. |
| Two decimal scales | Once the fee vault WAS watched, its raw token amounts landed beside the market's normalized ones: 174432 in `fee_accruals` and 174431738875981363 in `trades`, for the same fee. Both correct on their own side, differing by 10^12 in one database. |
| `stockback_commitments` | Keyed `(market, epoch_sequence)` with `dataset_hash NOT NULL` — neither value is in the vault's event. The table could not be written from a log at all, so `getActiveCommitment` returned NULL forever and every holder's claimable figure was zero regardless of what the vault would pay. |
| `stockback_claims` | Also never written. `getClaimedTotal` returned zero forever, so a holder who had already been paid was offered the same amount again — a claim the vault reverts. It points the opposite way from the one above, which is why neither looked broken. |
| `xstock_assets` | The registry projection: never written, and never read either, so nothing in the product looked wrong. §168 sources "Active xStock Pairs" from it and had nothing to source. |
| `fee_claims` | §21's event family is "FeesAccrued / FeesClaimed" and only the accrual half was indexed. No figure was wrong — claimable comes from the vault — but a creator saw "earned 4.2, claimable 0" with no way to tell a past withdrawal from a failure. |
| The `account` channel | Declared in the `Channel` union with nothing ever broadcasting to it. A wallet could subscribe and wait forever. |
| `MARKET_COLUMNS` | Adding the 24h window put two LATERAL-join columns into a shared SELECT list, and one of its three readers was not given the join. `/accounts` 500'd. Caught the same day, and only because the e2e exercises the endpoint. |

**What to do about it.** `tests/e2e/stack.ts` exists because of this list. It
deploys real contracts, launches, trades, performs a real reorg, graduates, and
distributes Stockback, then serves it all through the real API. When adding a
component, the question worth asking is not "is it tested" but "has anything
ever handed it real output from the thing upstream".

---

## Shape 2 — the placeholder

Ten defects, all the same:

```
priceAfter: 0n          // every trade priced at zero; a flat tape and a flat chart
quoteDecimals: 18       // a six-decimal xStock rendered a trillion times too small
estimatedAccrued: 0n    // holders with real entitlements shown nothing
claimable: 0n           //   ↑ and this one carried a comment explaining why
log.blockNumber ?? 0n   // a pending log written as a trade in block zero
CLAIM_CREATOR_FEES      // an IntentKind with no builder: earnings shown, no way to withdraw
<button disabled>       //   ↑ and a Connect button still saying wallet support was off
StockbackMessage        // a realtime message type nothing ever published
referenceMarketCapUsd   // declared in the realtime schema, produced by nobody
VOLUME: trade_count     // a sort labelled "volume" that ranked by number of trades
```

Each was defensible when written. Each typechecked forever. Each outlived the
reason it existed, silently, and produced a value indistinguishable from a real
one once it reached the database.

The one that carried an explanatory comment survived longest, which is the part
worth internalising: **a documented placeholder reads as considered.** The
comment said the Stockback service did not exist yet. It did by then.

The Connect button is the same lesson at a larger scale. It was disabled with a
paragraph explaining that §694's intent path was incomplete, so a wallet could
sign something the review never showed. That was true when written. By the time
it was noticed the trade panel beside it had been connecting and trading for
weeks — the reasoning was sound, the condition had passed, and the paragraph
was what kept anyone from re-checking.

**What to do about it.** Two rules, applied to this repository:

1. A placeholder for something that does not exist yet should fail loudly rather
   than return a plausible value. `assertProductionConfigReady` and the deploy
   script's mainnet guards are the pattern — they refuse rather than default.
2. A placeholder for a state that "cannot happen" should throw. `positionOf` in
   the indexer refuses a pending log rather than coercing it to block zero,
   precisely because `getLogs` should never produce one.

---

The `VOLUME` sort deserves its own note, because it is the placeholder shape at
its most quiet. `s.trade_count` is a real column holding a real number, and the
sort worked: it returned rows in an order. It just ranked a market with a
hundred dust trades above one with a single large one — the opposite of what its
own label promised — and nothing about it could fail.

---

## Shape 3 — correct, but not at scale

Three, and the first is the reason `tests/load/scale.ts` exists.

`getProof` rebuilds the entire Merkle tree from its leaves on every call and
finds the leaf by scanning. That is fine for the handful of holders every test
had ever given it. `Finalizer.persist` called it once per holder, inside the
transaction that writes the dataset — so at 2,500 holders it took 69.7 seconds
and held a write transaction open the whole time. Nothing was wrong with the
answer. It would simply have looked like a hung service in production.

`getAllProofs` builds the levels once: 30ms for the same set, and the surrounding
`recordDataset` went from 69,716ms to 339ms.

**What to do about it.** The question to ask of anything that loops over holders,
trades, epochs or blocks is not "is it correct" but "what is it doing per item,
and does that item count grow". Three places in this system have a natural
unbounded dimension:

- holders per market — Merkle proofs, entitlement inserts, TWAB weights
- epochs since launch — the finalizer folds ALL of them on every run, by design
- blocks per range — the indexer's catch-up path after any downtime

`tests/load/scale.ts` covers the first two. The third is covered by the reorg
and catch-up paths in the e2e, though not at a size that would expose a
quadratic.

The other two in this shape are the same idea one level up, and both are about
memory rather than time:

**Nine unbounded caches.** The API held plain `Map`s with no eviction, every one
keyed by something a caller controls. The quote cache is keyed on the amount, so
a user moving a slider creates a key per keystroke and anyone with curl can
create as many as they like. Correct answers, forever, until the process is
killed — and the symptom is an API that gets slower for a day and then dies,
which reads as a leak somewhere else entirely.

**No rate limiting.** `POST /quote` goes to the chain by design (§423), so every
unauthenticated request spends an RPC call on a shared provider quota. One bot
with a retry loop and no backoff exhausts it, and quoting stops working for
everybody while the API itself looks perfectly healthy.

---

## The largest group: a table with a reader and no writer

Five of the seams above are the same thing, and it is worth naming separately
because it is the only failure here that a schema makes *look* deliberate:

```
stockback_exclusions   read by the finalizer, written by nobody
stockback_commitments  read by the API, unwritable by its own schema
stockback_claims       read by the API, written by nobody
fee_accruals           read by the API, written by nobody
xstock_assets          read by nobody, written by nobody
fee_claims             did not exist
```

A migration that creates a table is a statement that the data exists. Every
query against these was correct, every join was right, and every one returned
zero rows forever — which is a perfectly ordinary answer.

**The worst of them.** `stockback_exclusions` is §323's list of addresses that
must never earn Stockback, and §324 states it as an invariant:
`DEX_POOL_WEIGHT = 0`. Empty, it meant the market contract entered the TWAB as a
holder — and the market contract holds every token nobody has bought yet, the
whole billion at launch and 35% of it even at the graduation threshold. At 1%
distributed it would have taken 99% of the epoch's pool.

Every pre-graduation distribution would have been arithmetically correct, would
have satisfied the §364 conservation invariant, and would have paid the bonding
curve instead of the holders.

The e2e never saw it because it only finalizes AFTER graduation, by which point
the curve's balance is zero.

**What to do about it.** For each table, ask two questions that are easy to
answer and easy to skip: what writes this, and what would it look like if
nothing did. The second is the one that matters — four of these six answered
"an empty list", "a zero", or "no active root", all of which are values the
product renders without complaint.

The e2e now asserts the CONTENTS of each of them against the chain that produced
them, rather than asserting that a query succeeds.

---

## Shape 4 — a failed read that looks like an answer

One, and it is worth its own heading because it is the only defect here that
would have produced a wrong number about money without anything being broken.

`claimable` was built by asking the vault for each asset's balance and skipping
any asset whose call threw. With one asset — the normal case — that leaves an
empty list, which the page renders as "nothing to claim". Identical to a
successful read of zero, and the creator has no way to tell which they are
looking at.

Nothing failed. The RPC error was caught, the page rendered, every type checked.

**What to do about it.** A partial answer about a balance is worse than a stated
gap. The failure now discards the whole list and clears the vault address, which
the page already treats as "claiming is unavailable" — so the figure becomes an
em dash with a reason rather than a zero. The rule generalises: when a read that
feeds a number fails, ask what the empty value renders as, and whether a user
could tell it apart from the real thing.

---

## What is deliberately not implemented

These are not placeholders. They are recorded refusals, and each names the
verification item blocking it:

- `XStockAssetAdapter` multiplier semantics — V-03
- The graduation router — V-06, V-09
- The xStock allowlist, empty — V-02, V-03, V-05
- Platform accounts, unset — C-08
- `Logo.tsx` geometry, pending the official SVG export
- `/account` holdings and P&L — needs a per-account position read that does not
  exist. Creator earnings moved to `/creator` rather than waiting for it.

§279 forbids a mock or placeholder standing in for any of them in production,
and `assertProductionConfigReady` enforces that at startup on chain 999.

---

## Still unverified

Stated so it is not mistaken for covered:

- the connected-wallet path against a real browser extension
- post-graduation candle aggregation from HyperSwap, and the stitched pre/post
  history §178.8 requires. Blocked on V-06/V-09 — there is no router deployed to
  read swaps from.
- the realtime tape under socket load. `tests/load/concurrency.ts` covers four
  workers over one queue; the gateway's backpressure is covered by its own
  simulation but has never had real sockets on it.
- several INDEXERS against one chain. `tests/load/concurrency.ts` covers workers
  and finalizers — four workers over one queue with a peak overlap of four, no
  job executed twice — but two indexers writing one projection is a different
  question, and the cursor is a single row.
- anything requiring the external facts above
