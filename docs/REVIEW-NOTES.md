# Review notes

Where the defects in this codebase have actually been, written down so the next
person reviewing it looks in the right places rather than the obvious ones.

Thirty-four defects were found and fixed during the build. **None of them was
found by a unit test.** Every one came from running real components against each
other — with one exception, which was found by being asked why something had not
been done and checking instead of answering. That is not an argument against the unit tests — they are what makes the
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

Twelve defects, all the same:

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
CLAIM_STOCKBACK         // an IntentKind with no builder — on a HOLDER's money path
LAUNCH                  //   ↑ and the primary creator action, same union
```

**`IntentKind` alone accounts for four of these.** `APPROVE_QUOTE`,
`CLAIM_CREATOR_FEES`, `CLAIM_STOCKBACK` and `LAUNCH` were all shipped as union
members with nothing behind them, and each read as implemented until somebody
tried to use it. Three of the four were money paths.

The last two are the worst instance, because of when they were found. The
creator-fee builder was written *in the same session*, for exactly this defect,
and nobody — including whoever wrote it — went back to ask whether the holder
half had the same gap. It did. The API served a holder their claimable amount
and the Merkle proof to spend it with, and the product had no way to spend
either.

**A union member is a claim that something exists.** The check that finds this
takes one grep per member and was worth doing three commits earlier than it
was.

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

## The near-miss worth keeping: a guard that refused a real state

Not a shipped defect — it was caught by the e2e on its first run — but it is
the only failure in this document that came from being *too* careful, and that
makes it worth writing down.

The Stockback claim builder refused an empty Merkle proof:

```ts
if (proof.length === 0 && cumulative > 0n) {
  throw new Error("no proof supplied");
}
```

The reasoning was sound as far as it went. A caller who forgot to fetch a proof
passes an empty array, and that is worth catching before a transaction is
signed.

What it missed is that **a single-leaf tree has no siblings**, so its proof is
legitimately empty — and a market with one holder is not an edge case, it is
every market on its first day. The guard cost the smallest markets their claims
entirely, to avoid one confusing revert. The vault verifies the proof against
the active root regardless, so the authority was never in doubt.

**What to do about it.** Every validation refuses a set of states. The question
worth asking is not "is this input suspicious" but "what legitimate state does
this reject, and how common is it" — and here the answer was "every market that
has just launched", which is most of them.

It failed on the first real run against a single-holder market. Nothing in the
unit tests would have caught it, because the fixtures all had several holders —
which is the same reason `tests/e2e/stack.ts` exists.

---

## Shape 5 — the argument nobody was checking

One, and it is the most expensive defect in this document.

```solidity
function referencePriceToP0(uint256 xStockUsdWad, address) public pure {
    if (xStockUsdWad == 0) revert InvalidReferencePrice();
    // ...that was the whole check
}
```

`xStockUsdWad` is the xStock's USD price at launch. It arrived as plain
calldata, from the caller, and the only thing verified about it was that it was
not zero.

`p0` is derived from it and is **immutable for the market's entire life**.
Everything inherits it: `pg = 25 × p0`, the collateral the curve accumulates,
and the real value of the permanent LP that graduation creates. A launch at a
price a thousand times too low produces a market that can never realistically
graduate. A thousand times too high produces one that graduates for almost
nothing and locks dust into a pool that is supposed to hold permanent liquidity.

§20 lists `ReferencePriceAdapter` in the contract architecture. §135 gives it a
Definition of Done. §402 says the anchor is "required once when creating a
market" and that "if invalid/stale, the launch is blocked". **The contract did
not exist.** Seven files in `contracts/src`, and none of them was it.

**Why every test passed.** Each one supplied a sensible price, because each was
written to exercise something else — the curve, the salt, the fee split — and a
sensible price is what you write when the price is not the subject. Nothing was
testing the argument itself, because nothing was treating it as an input that
could be wrong.

**What to do about it.** The question that finds this class is not "is this
value validated" — it obviously was, against zero. It is: **who chooses this
value, and what happens if they choose badly.** For every argument that reaches
storage and stays there, the answer has to be something other than "they
wouldn't".

The anchor now comes from a feed. The caller's number became an acceptance
bound, in the same shape as `minTokensOut` on a trade: it protects the creator
from launching at a price they never saw, and it cannot move the anchor.

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

## Shape 6 — the assumption written down in three places

Every defect above is something the code got wrong. This one is different: the code was right
about a chain that does not exist.

Graduation was atomic — the buy that crossed the endpoint also created the pool, minted the
position and locked it. That is what §14 describes, it is what the contract did, and it was
covered by unit tests, an invariant, a schema comment and a projection check. All of them
passed. All of them were wrong together, because they encoded the same assumption.

The assumption was that a transaction can cost 5.4M gas. HyperEVM's default block lane caps at
3,000,000 and runs at 99.8% of that in ordinary blocks (V-20). Nothing in the codebase was
inconsistent with anything else in the codebase. It was inconsistent with the chain.

**Where the assumption had been written down, and what each one did when it broke:**

| Location | What it said | What happened |
|---|---|---|
| `LaunchMarket` lifecycle comment | "GRADUATING transient, single-transaction" | changed with the code |
| `invariant_neverRestsInGraduatingState` | asserted it directly | **failed immediately** — the fuzzer found it before the fork did |
| `market_state.status` schema comment | "a persisted 1 means the indexer captured a partial state" | silent; a projection would have reported closed curves as open |
| `sim/projection.ts` | "the projection never rests in GRADUATING" | **passed for the wrong reason** — the fixture ends GRADUATED, so it held no matter what the reducer did |
| SDK `boundCoversPartialRoute` | described a HyperSwap leg | silent; described a route that no longer exists |

Only one of the five failed honestly. One passed vacuously and three said nothing at all —
they were prose, and prose does not run.

**What actually found it: a test that would not run offline.**

Not review, and not reasoning. The fork suite refused to execute against real HyperSwap,
failing as `OutOfGas` inside pool deployment. The first instinct was to treat that as a tooling
problem and raise a limit; `--gas-limit` and `--block-gas-limit` both had no effect, which was
the signal. Foundry's `isolate` mode models each top-level call as a real transaction, and it
was faithfully reproducing the chain's ceiling. The tool was right and the assumption was wrong.

**The lesson is about where assumptions get to hide.** A comment cannot fail. A schema note
cannot fail. A check that returns early in the wrong state cannot fail once the fixture stops
reaching that state. Of the five recordings of this assumption, the only one that told the
truth on its own was the executable one — and it told the truth the moment the code changed
underneath it, which is the whole argument for writing invariants instead of comments.

Two of the replacements were nearly decoration in the same way. `invariant_graduatingEscrowIsFrozen`
and `invariant_finalisingConfersNothing` both return early unless the market is in a particular
state, and a coverage check showed the fuzz campaign reached `GRADUATING` but never finalised —
so one of them had never once looked at what it guards. Reachability is now proven
deterministically through the same handler the fuzzer drives.

---

## Shape 7 — an empty index read as an empty world

Every shape above is a defect in the code. This one is a defect in the *verification*, and it
produced a wrong P0 conclusion that was written into the ledger and reported as fact.

**The claim:** "there is no canonical xStock ERC-20 on HyperEVM."

**The truth:** all ten of the largest xStocks are deployed there, at Backed's canonical
addresses, running byte-identical code to Optimism and BNB — and HyperEVM holds *more* supply
than either. Over $100M of assets.

**How the wrong answer was reached.** Two searches, both empty, both empties read as absence of
the thing itself:

| Searched | Came back | What empty actually meant |
|---|---|---|
| HyperSwap V3 positions, sampled for their token pairs | no xStocks | xStocks have **no pools**. A token can be widely held and never pooled. |
| HyperCore `tokenInfo.evmContract`, 400 HIP-1 indices | every equity `address(0)` | xStocks are **EVM-native**. They were never HyperCore tokens, so there is no HIP-1 record to link. Wrong table. |

Neither search was wrong. Both were answered correctly. The error was reading a **derived
index** as a **census**: a pool registry indexes what trades, a HIP-1 table indexes what was
bridged from Core, and neither is a list of what exists.

The tell was there and was explained away. `SPYx` *was* found — through a pool belonging to its
wrapper — and was treated as an anomaly rather than as the edge of a suite. One contradicting
data point against two confident absences, and the data point lost.

**The check never run was the cheapest one available.** Take a published address, call
`eth_getCode`. One RPC call. It would have answered the row on day one and refuted the
conclusion in seconds.

**Why this belongs in a document about code defects.** It is the same shape as Shape 1 and
Shape 5 — a reader with no writer, an argument nobody checked — turned on the process that is
supposed to catch them. An absence is evidence only if you know the index would have contained
the thing. Both indices here were guaranteed *not* to contain it, for reasons that were
knowable before the search.

The correction is recorded inside V-02 rather than replacing the wrong text, because a ledger
that silently repairs itself teaches nobody anything.

---

## What is deliberately not implemented

These are not placeholders. They are recorded refusals, and each names the
verification item blocking it:

- `XStockAssetAdapter` multiplier semantics — V-03
- The graduation router's **deployment** — V-06. The router, the permanent lock
  and `V3Math` are all built, and V-09 closed on Day 8 against the real
  HyperSwap `NonfungiblePositionManager`. What is not done is putting an address
  in `packages/config`: all three HyperSwap addresses are immutable in the
  router's constructor, so a wrong one means redeploying both contracts while
  the old lock still holds a real LP position that nothing can move. The
  addresses are located and mutually verified on-chain; first-party confirmation
  is the missing half, and `Deploy.s.sol` refuses rather than guessing.
- The xStock allowlist, empty — V-02, V-03, V-05
- Platform accounts, unset — C-08
- `Logo.tsx` geometry, pending the official SVG export
- PNG rasterisation of the share card. The card itself is built and tested
  (§117, §95.25) and served as SVG; most crawlers want PNG for `og:image`, and
  rasterising needs a native dependency whose choice depends on a runtime §434
  has not fixed. Everything carrying product knowledge is in `preview.ts`; what
  is left is a mechanical transform behind a documented seam.

  Neither token metadata nor the share card needs object storage any more.
  Metadata went on-chain (D-013) with the image as an IPFS CID, and the card
  derives its mark from the token address rather than fetching anything — which
  sidesteps §427 rather than answering it, and is the right outcome for a
  dependency nothing actually needs.
- `liveMarketCapUsd` (§403). Needs the live xStock/USD DISPLAY feed, V-12. The
  field is ABSENT from the response rather than zero: an absent field renders as
  nothing, a zero renders as a market worth nothing.
- The launch-anchor feed itself (V-11). The adapter, its refusals and the
  factory's dependency on it are built and tested; which aggregator to point at
  is a decision with §253's criteria attached, and manipulation resistance rules
  out the easy answer. Every launch is refused until it is made.
- `/account` **P&L** — holdings and portfolio value now ship; realised and
  unrealised P&L do not. They need a cost basis per account per market, which
  means folding every trade rather than reading a balance, and the trade history
  to fold it from only exists from the indexer's start block. A P&L that
  silently began mid-history would be wrong in the direction that flatters,
  which is the worst direction for a number a user might act on.

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
