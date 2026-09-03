# Review notes

Where the defects in this codebase have actually been, written down so the next
person reviewing it looks in the right places rather than the obvious ones.

Sixteen defects were found and fixed during the build. **None of them was found
by a unit test.** Every one came from running real components against each
other. That is not an argument against the unit tests — they are what makes the
pure cores trustworthy, and several of them caught real errors during
development. It is an argument about where the *remaining* risk sits.

---

## Shape 1 — the seam

Thirteen of the sixteen lived between two components that were each correct, and
each individually tested.

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

**What to do about it.** `tests/e2e/stack.ts` exists because of this list. It
deploys real contracts, launches, trades, performs a real reorg, graduates, and
distributes Stockback, then serves it all through the real API. When adding a
component, the question worth asking is not "is it tested" but "has anything
ever handed it real output from the thing upstream".

---

## Shape 2 — the placeholder

Five defects, four of them in the last stretch, all the same:

```
priceAfter: 0n          // every trade priced at zero; a flat tape and a flat chart
quoteDecimals: 18       // a six-decimal xStock rendered a trillion times too small
estimatedAccrued: 0n    // holders with real entitlements shown nothing
claimable: 0n           //   ↑ and this one carried a comment explaining why
log.blockNumber ?? 0n   // a pending log written as a trade in block zero
```

Each was defensible when written. Each typechecked forever. Each outlived the
reason it existed, silently, and produced a value indistinguishable from a real
one once it reached the database.

The one that carried an explanatory comment survived longest, which is the part
worth internalising: **a documented placeholder reads as considered.** The
comment said the Stockback service did not exist yet. It did by then.

**What to do about it.** Two rules, applied to this repository:

1. A placeholder for something that does not exist yet should fail loudly rather
   than return a plausible value. `assertProductionConfigReady` and the deploy
   script's mainnet guards are the pattern — they refuse rather than default.
2. A placeholder for a state that "cannot happen" should throw. `positionOf` in
   the indexer refuses a pending log rather than coercing it to block zero,
   precisely because `getLogs` should never produce one.

---

## Shape 3 — correct, but not at scale

One so far, and it is the reason `tests/load/scale.ts` exists.

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

---

## What is deliberately not implemented

These are not placeholders. They are recorded refusals, and each names the
verification item blocking it:

- `XStockAssetAdapter` multiplier semantics — V-03
- The graduation router — V-06, V-09
- The xStock allowlist, empty — V-02, V-03, V-05
- Platform accounts, unset — C-08
- `Logo.tsx` geometry, pending the official SVG export

§279 forbids a mock or placeholder standing in for any of them in production,
and `assertProductionConfigReady` enforces that at startup on chain 999.

---

## Still unverified

Stated so it is not mistaken for covered:

- the connected-wallet path against a real browser extension
- several INDEXERS against one chain. `tests/load/concurrency.ts` covers workers
  and finalizers — four workers over one queue with a peak overlap of four, no
  job executed twice — but two indexers writing one projection is a different
  question, and the cursor is a single row.
- anything requiring the external facts above
