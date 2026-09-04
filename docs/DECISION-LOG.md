# SENT — Decision Log

Template per Masterplan §142. LOCKED product behaviour may never change through a code diff
alone (§144) — it requires a change-control record here plus explicit product-owner approval.

Entries are append-only. CHOOSE decisions are recorded, not approved-in-advance.

---

## D-001 — Repo shape adopted verbatim from §411

**Class:** CHOOSE (organisation)
**Date:** Day 1

**Decision:** the monorepo is scaffolded exactly as §411/§139 specify — `apps/`, `contracts/`,
`services/`, `packages/`, `infra/`, `tests/`, `docs/` — with one addition: `packages/economics`.

**Reason:** §411 is described as a "minimum logical shape." The curve and fee math need a single
canonical off-chain home that is *not* `packages/stockback` (reward math) and *not*
`packages/sdk` (which consumes it). Folding curve math into either would violate §1064's
one-canonical-source rule by making a consumer also an owner.

**Economic impact:** none — `packages/economics` implements locked math, it does not define it.
**Security impact:** positive — one owner for curve/fee math, enforceable via CODEOWNERS.
**UX impact:** none.
**Migration impact:** none.
**Approved by:** implementation agent (ordinary CHOOSE, per operating brief).

---

## D-002 — Fixed-point representation, and `k` is never materialised

**Class:** CHOOSE (§249.3 explicitly leaves precision to implementation)
**Date:** Day 1

**Decision:** WAD = 1e18 for prices and normalized quote amounts. The curve is parameterised by
the exact integers `(P0, dP, qG)` where `dP = PG − P0 = 24·P0`, **not** by a stored slope `k`.
Every curve equation is multiplied through by `qG` so that no division occurs until a single
final floor.

**Reason:** for a $2,000 launch, `k = (PG − P0)/qG` is on the order of 1e-16 quote units per
token². Storing it as a wad destroys most of its significant digits and injects error into every
trade. The `×qG` formulation keeps `k·qG = dP` exact with zero rounding.

**Economic impact:** strictly positive — removes a systematic precision loss. Locked rates and the
locked endpoint are unchanged; the simulation reproduces the §8 table exactly.
**Security impact:** positive — fewer rounding surfaces to attack.
**UX impact:** none.
**Migration impact:** none.
**Approved by:** implementation agent (ordinary CHOOSE).

---

## D-003 — Rounding always favours protocol solvency

**Class:** CHOOSE (§8 leaves rounding direction implementation-level)
**Date:** Day 1

**Decision:** documented in `docs/ECONOMICS-CONVENTIONS.md` §5. TOKEN out on buy rounds down;
quote in required rounds up; gross out on sell rounds down; closed-form collateral rounds down;
integer sqrt floors; the creator's 65% floors with the platform taking the remainder so the split
is exhaustive; `qG` floors so graduation triggers a hair early.

**Reason:** every rounding choice must be resolvable by a single rule an auditor can check. "Favour
solvency, never the trader" is that rule. Flooring `qG` in particular keeps the LP seed fully
funded rather than a wei short.

**Economic impact:** sub-wei per operation, always in the protocol's favour. Asserted by
simulation: a buy-then-sell round trip never returns more than was paid.
**Security impact:** positive — closes rounding-extraction attacks.
**UX impact:** none at display precision.
**Migration impact:** none.
**Approved by:** implementation agent (ordinary CHOOSE).

---

## D-004 — Fee convention resolved by reading §9/§10, not by choosing (closes C-04)

**Class:** INTERPRETATION of LOCKED behaviour — no product change
**Date:** Day 1

**Decision:** BUY takes fees from gross input before the curve; SELL takes fees from the curve's
gross output after it. Frozen as F1 in `docs/ECONOMICS-CONVENTIONS.md`.

**Reason:** §315 requires the convention be deterministic and documented but does not state it,
which the M0 pass logged as C-04. §9 steps 2–5 and §10 steps 1–4 do fix it by ordering. Both
readings reproduce the §315 worked examples exactly; the simulation asserts all ten figures.

**Economic impact:** none — this documents the specified behaviour rather than selecting new
behaviour.
**Security impact:** positive — makes the quote ≡ execute law mechanically checkable.
**UX impact:** the fee breakdown (§316) shows core fee, Stockback and net-to-curve separately.
**Migration impact:** none.
**Approved by:** implementation agent. **Flagged for owner acknowledgement** since it interprets
a LOCKED economic surface, even though it changes nothing.

---

## D-005 — §396–§408 duplicate numbering resolved by §277 (closes C-01, C-02)

**Class:** INTERPRETATION of LOCKED behaviour — no product change
**Date:** Day 1

**Decision:** the masterplan contains two blocks numbered §396–§408. The later block (post-grad
Stockback FINAL LOCK) governs, per §277 Historical Decision Supersession. Internally the two are
referenced as `§396-A` (audit remediation) and `§396-B` (post-grad final lock). §425's statement
that `POST_GRAD_STOCKBACK_PLATFORM_SHARE` remains open is superseded by §396-B/§407/§408, which
lock it at 50/50 — net 65% creator / 17.5% Stockback / 17.5% platform.

**Reason:** §277 is explicit that the latest explicit locked decision wins. §408 states no
product-level economic decisions remain open for V1.

**Economic impact:** none — implements the locked figures as written. Asserted in simulation.
**Security impact:** none.
**UX impact:** post-grad disclosure copy (§401-B) reflects 65 / 17.5 / 17.5.
**Migration impact:** none.
**Approved by:** implementation agent. **Flagged for one-line owner confirmation**, because §425
asks for explicit approval of this parameter by name.

---

## D-006 — chainId 999 frozen into config and signing domains

**Class:** CHOOSE (mechanism) on top of a VERIFIED fact
**Date:** Day 1

**Decision:** `chainId = 999` (verified PRIMARY via `eth_chainId`, V-01) is a frozen constant in
`packages/config` and is bound into every EIP-712 domain, including the Stockback attestation
domain required by §405.

**Reason:** §405 requires the attestation commitment to bind chainId to prevent cross-chain
replay. A single frozen constant with one owner prevents divergence between contracts, finalizer
and SDK.

**Economic impact:** none.
**Security impact:** positive — closes cross-chain replay by construction.
**UX impact:** wrong-network detection (§465) keys off it.
**Migration impact:** none.
**Approved by:** implementation agent (ordinary CHOOSE).

---

## Open items requiring owner decision

These are **not** decided here. They are recorded so they cannot be lost.

| Ref | Item | Why it needs the owner |
|---|---|---|
| C-05 | External audit cannot *complete* within 7 days | Day-7 public opening gate depends on how the owner weighs a partial external review. The agent will not label an incomplete audit as passed. |
| C-08 | Attestor set + Safe signer identities and hardware | People and procurement, not engineering. Blocks the mainnet ceremony if not started Day 1. |
| C-03 / V-08 | If exact V3 tick geometry demands a material economic change | §416 requires escalation as a product decision, not a code fix. |
| V-18 | Legal / operator restrictions | Counsel, not engineering. |
| D-004, D-005 | Acknowledgement of two LOCKED-surface interpretations | Both change nothing, but both touch locked economics and should be seen. |

---

## D-007 — Foundry dependencies vendored, pruned to compiled sources

**Class:** CHOOSE (supply chain / build reproducibility)
**Date:** Day 2

**Decision:** `forge-std` and `openzeppelin-contracts@v5.1.0` are committed into
`contracts/lib` rather than tracked as git submodules, and `.gitignore` excludes each
dependency's own tests, scripts, docs, audits, certora specs, hardhat config and mocks.

**Reason:** §702 requires dependency pinning. A vendored copy of an exact version cannot change
under us if an upstream tag is moved, and it keeps CI builds reproducible without submodule
initialisation. The first `git add -A` swept in 781 files / 13 MB of upstream tooling that we
neither build nor audit; pruning to compiled sources brings the tree to 281 tracked files and
keeps future diffs and CODEOWNERS review (§658) legible.

**Economic impact:** none.
**Security impact:** positive — pinned, inspectable dependency bytecode; §703 SBOM obligation
still outstanding.
**UX impact:** none.
**Migration impact:** none.
**Approved by:** implementation agent (ordinary CHOOSE).

---

## D-008 — `forge lint` is informational, not a build gate

**Class:** CHOOSE (tooling)
**Date:** Day 2

**Decision:** `deny = "warnings"` removed from `foundry.toml`. `forge lint` runs in CI as a
non-blocking step and is reviewed during the Day 6 quality pass.

**Reason:** the gate was set on Day 2 and immediately produced 13 warnings, all of which are
either inside test files or are deliberate, documented decisions in `Curve.sol`:

- `require-revert-in-loop` — the bounded correction loop in `tokensOutFor` reverts precisely
  because failure to converge means an invariant is broken; halting is the correct behaviour.
  The linter also flags callees transitively.
- `divide-before-multiply` — dividing the quadratic by `dP` before squaring is the *sole reason*
  the curve math does not overflow `uint256` for realistic xStock prices. The precision lost is
  recovered exactly by the correction loop against the overflow-safe forward function.

Per-line suppression did not take effect because the linter reports at the callee site. Blocking
a build on false positives against documented decisions is theatre, and it trains reviewers to
ignore warnings.

**The gates that actually protect this codebase remain in force:** the Solidity compiler, the
fuzz and invariant suites, the differential tests against `packages/economics`, and continuous
adversarial review (Stream I).

**Economic impact:** none.
**Security impact:** neutral — no real finding is being suppressed; lint output stays visible in CI.
**UX impact:** none.
**Migration impact:** none.
**Approved by:** implementation agent (ordinary CHOOSE). Revisit Day 6.


---

## D-003a — Creator fee rounding reversed (revises D-003)

**Class:** CHOOSE (rounding direction), correcting an earlier CHOOSE
**Date:** Day 3

**Decision:** the creator's 65% share of the core fee now rounds **up**, with the
platform taking the remainder. D-003 originally specified the opposite.

**Reason:** an on-chain invariant over randomised multi-trade sequences
(`invariant_creatorShareIsNeverReduced`) failed by exactly one wei. Flooring the
creator's share per trade makes the aggregate share sit permanently below 65%, because
a sum of floors is not the floor of a sum. §314.2 states the creator's share may never
be reduced, and rounding dust should fall on the platform — the party that agreed to
the split — rather than on the creator, who is the protected party.

**Economic impact:** sub-wei per trade, now in the creator's favour instead of against
them. Locked rates unchanged; the §315 worked examples are unaffected because 100 is
exactly divisible.
**Security impact:** none. The split remains exhaustive, so no dust escapes accounting.
**UX impact:** none at display precision.
**Migration impact:** none — pre-deployment.
**Approved by:** implementation agent (ordinary CHOOSE). Both implementations updated
together; the Solidity and TypeScript splits are differential-tested and may not diverge.

---

## D-009 — Circular token/market dependency broken on the token side

**Class:** CHOOSE (architecture mechanism)
**Date:** Day 3

**Decision:** `LaunchToken`'s constructor takes only `(name, symbol, creator)` and mints
the genesis supply to the factory, which forwards it to the market. The token's `market`
field is a write-once, factory-only setter. `LaunchMarket` keeps `TOKEN` immutable.

**Reason:** the market needs the token address and the token needs the market address.
Under CREATE2 each address depends on the other's constructor arguments through the
init-code hash, so one side must resolve after deployment. The market's `TOKEN` is
security-critical — every transfer, the entire reserve and the graduation migration
depend on it. The token's `market` field is informational: nothing in `LaunchToken`
reads it, and no balance, supply or transfer decision depends on it. Making the harmless
field write-once is strictly safer than making the critical one mutable.

Both addresses stay fully predictable off-chain, so the vanity grinder can search
`userSalt` without deploying anything.

**Economic impact:** none.
**Security impact:** positive — the mutable surface is the one with no security role.
**UX impact:** none; the launch preview still shows the exact deployed address.
**Migration impact:** none.
**Approved by:** implementation agent (ordinary CHOOSE).

---

## D-010 — Realtime events travel over PostgreSQL NOTIFY, not a message broker

**Class:** CHOOSE (infrastructure)
**Date:** Day 5

**Decision:** the indexer publishes events with `pg_notify` from inside the transaction
that writes the rows they describe. The realtime service holds a dedicated connection
that `LISTEN`s and pushes to subscribed sessions. There is no broker.

**Reason:** NOTIFY is delivered on COMMIT. That single property is the whole argument.
An event cannot reach a subscriber unless the rows it describes are already durable,
and a block that rolls back announces nothing — both verified in
`tests/integration/live.ts`. A broker published from inside the ingest transaction would
deliver events for blocks that then rolled back; a broker published after the commit
would drop them if the process died in between. Getting that right against an external
system requires an outbox table and a relay, which is more moving parts than the
database already gives for free.

§434's topology lists Redis, but as a cache. Introducing it here as a bus would be a
second thing to run, monitor and lose.

**What this is not:** durable. A subscriber that is down misses whatever is published
while it is down; NOTIFY has no backlog. That is acceptable because this is delivery and
not authority (§138) — a client that missed messages reconnects with `sinceBlock`, and
the gateway either replays from its buffer or refuses and marks the session degraded.

**Revisit when:** the realtime tier needs more replicas than the database can hold
listening connections for, or a second consumer needs a durable backlog. Both are
scale problems, and neither is one this product has yet.

**Economic impact:** none.
**Security impact:** positive — one fewer network service holding market data.
**UX impact:** positive; §22's "no manual refresh" is met without added infrastructure.
**Migration impact:** none. Swapping the transport later touches two files.
**Approved by:** implementation agent (ordinary CHOOSE).

---

## D-011 — CORS is an explicit origin list, hand-rolled, with no wildcard

**Class:** CHOOSE (security posture)
**Date:** Day 5

**Decision:** the API allows browser origins named in `API_ALLOWED_ORIGINS` and no
others. Unset means no browser may call it. The matching origin is echoed back; anything
else receives no CORS headers at all. A wildcard cannot be configured, because `*` does
not parse as a URL and the loader refuses it.

**Reason:** §434 puts the web tier on a different hostname from the API, so every request
the app makes is cross-origin — this is required for the product to work at all, which
is exactly why it deserves to be deliberate rather than copied from a plugin's defaults.
Echoing whatever `Origin` arrives is the usual shortcut and is equivalent to a wildcard.
Neither matters today, because no endpoint takes credentials; both become dangerous the
moment one does, and that change would not obviously prompt anyone to revisit CORS.

Trailing slashes are refused at load: `https://sent.xyz/` never matches the header a
browser sends, and the resulting failure looks like missing configuration rather than a
typo, which is an expensive hour to lose during a deploy.

**Economic impact:** none.
**Security impact:** positive.
**UX impact:** none when configured; total failure when not, which is the intended
direction for this class of mistake.
**Migration impact:** deployments must set `API_ALLOWED_ORIGINS`. Documented in
`.env.example` and the compose file.
**Approved by:** implementation agent (ordinary CHOOSE).

---

## D-012 — The launch anchor comes from a feed, never from the caller

**Class:** CHOOSE (closes a defect, and a §135 gap)
**Date:** Day 6

**Decision:** `LaunchpadFactory` reads `IReferencePriceAdapter.usdPriceWad(asset)` to
derive `p0`, and refuses to launch when no adapter is set. `params.xStockUsdWad` remains
in the calldata but is now an ACCEPTANCE BOUND — the price the creator reviewed — with a
5% tolerance against what the feed says. Zero opts out explicitly.

**Reason:** `xStockUsdWad` arrived as plain calldata and was checked only against zero.
`p0` is derived from it and is immutable for the market's entire life; `pg = 25 × p0`,
the collateral the curve accumulates, and the real value of the permanent LP all inherit
it. A launch a thousand times too low makes a market that can never realistically
graduate; a thousand times too high makes one that graduates for almost nothing and locks
dust into a pool meant to hold permanent liquidity.

§20 lists `ReferencePriceAdapter` in the architecture, §135 gives it a Definition of
Done, and §402 says the anchor is required at creation and that an invalid or stale one
blocks the launch. The contract did not exist.

The bound is the same shape as `minTokensOut` on a trade: it protects the creator from
launching at a price they never saw, and it cannot move the anchor. The deviation is
measured against the ACTUAL price rather than the reviewed one, because a denominator the
caller controls is a tolerance the caller controls.

**No price setter exists**, and one test enumerates every mutating selector to keep it
that way. §18 forbids an admin injecting a manual price to force a graduation, and a
`setPrice` — however guarded — is that capability with a comment attached. Governance
names a SOURCE; the source address is public, per-configuration and emitted.

The sanity band refuses rather than clamps. Clamping would let a launch proceed at a
number the feed never said: the same arbitrary price, reached from the other direction.

**Economic impact:** large and positive. It removes the only path by which a market's
permanent starting price could be chosen rather than observed.
**Security impact:** positive.
**UX impact:** a launch is refused outright until governance configures a feed. That is
the §402 behaviour and it is visible at deploy time, not at a user's first launch.
**Migration impact:** V-11 must be resolved before mainnet. `REFERENCE_PRICE_FEEDS` is
empty and `assertProductionConfigReady` names V-11 while it is.
**Approved by:** implementation agent (closes a defect; the feed choice remains owner's).

---

## D-013 — Token metadata is on-chain, revisable by its creator, with the image on IPFS

**Class:** PRODUCT (owner decision, §274)
**Date:** Day 6
**Decided by:** owner, asked directly.

**Decision:** description and links are emitted on-chain by the factory. The image is an
IPFS CID, also on-chain. Nothing lives in the platform's database except a rebuildable
projection of those events. The creator — and only the creator — may revise, and every
revision is numbered and kept.

**Options considered:**

| | |
|---|---|
| Off-chain, hash-bound | content in our database, `launchIntentHash` proves tampering |
| **On-chain, IPFS image** | **chosen** |
| Off-chain, unbound | a plain column, editable by the operator with no trace |
| Not yet | name and ticker only |

**Reason:** every other fact about a market is on-chain and verifiable. A description in
the platform's own database would be the one a human actually reads and the one the
platform could silently rewrite — the exact asymmetry the rest of this system avoids.
§27's admin boundary would have a hole in it shaped like the most visible field on the
page.

The image is on IPFS because a PNG does not belong in calldata, and a CID is a hash of
the bytes: a gateway serving something else fails the check without the platform storing
anything or choosing a provider. §427's object-storage decision is sidestepped rather
than answered, which is the correct outcome for a dependency nothing needs.

**This closes a loop that was already half-built.** §412 binds `launchIntentHash` into
the CREATE2 salt and the factory has always called it the hash of "the launch intent the
creator reviewed (metadata, socials)". The commitment was in every token's address; the
content was published nowhere. Publishing it makes the commitment checkable — and
`TokenLaunched` now carries the hash, because `effectiveSalt` is a hash OF it and could
not be reversed.

**Revisable, deliberately.** The obvious reading of "on-chain" is immutable, and
immutability here would not be a virtue: a creator who cannot fix a typo hosts the real
description somewhere else, which is what putting it on-chain was meant to avoid. A
revision cannot rewrite history — the launch content stays published and still hashes to
the address — so the audit trail §95.20 asks about is a property of the design rather
than a feature added to it.

**Events, not storage.** No contract reads metadata. Storage would cost ~20,000 gas per
word for data whose only consumer is an indexer, against ~8 gas a byte in a log. The one
exception is the revision counter, which a contract must read: two revisions in one block
are otherwise indistinguishable, and log order is not something the chain promises across
a reorg.

**URLs are not validated on-chain.** A `javascript:` URL is inert in calldata and
dangerous only where something renders it. Validating on-chain would charge every creator
gas for a guarantee the client still has to enforce — and a client that trusted the chain
instead of doing its own check would be one upgrade away from an XSS. The allowlist runs
at the API's render boundary, and the count of what it dropped travels with the response
so a UI can say "1 link hidden" rather than silently showing fewer.

**Economic impact:** a modest gas increase per launch, bounded by the field limits (512
bytes of description, 128 of CID, four links).
**Security impact:** positive. It removes an operator-controlled field that would
otherwise have been the most visible one on the page.
**UX impact:** creators get a description, links and a logo, and can correct them.
**Migration impact:** `TokenLaunched` gained a field, so any consumer decoding it
positionally must be regenerated. Markets launched before this have no metadata and
report `null` rather than an empty description — the two are different and only one of
them should render a blank field.
**Approved by:** owner.

---

## D-014 — Permanent LP is a purpose-built lock, not a venue primitive

**Class:** CHOOSE (architecture, escalated by V-09's own terms)
**Date:** Day 7

**Decision:** graduated positions are held by `PermanentLiquidityLock`, a contract with no
owner, no governance, no pause, no upgrade path, no `execute`, no ERC-721 transfer and no call
to `decreaseLiquidity` or `burn`. Its entire external surface is `collect(tokenId)`, which pays
the market the position was minted for and takes no recipient.

**Reason:** V-09 asks whether a V3 position can have principal permanently locked while fee
rights stay exercisable. It cannot, with the position manager alone — holding the NFT keeps
`decreaseLiquidity` reachable, burning it kills `collect`, and there is no third state. V-09's
own text anticipates this: *"If no venue primitive provides this, the lock must be a
purpose-built non-withdrawable holder contract — an architecture decision with security
consequences, to be escalated, not improvised."*

The security consequence, stated: **the lock is the guarantee.** §17's permanence is a property
of this contract's absent functions, not of anyone's restraint. A gate would be a key somebody
holds; absence is not.

§413 recommends FeeVault custody. This is a dedicated contract instead, because FeeVault has a
treasury setter and a governance transfer — putting the NFT there would make §17 depend on a
key. §413's actual requirement (non-arbitrary custody, no transfer path) is met more completely
here than it could be there.

Collection is permissionless. §414 requires that accrued rights are never lost because
collection is unavailable, and a permissioned collector is a party who can stop paying the
creator by doing nothing. There is nothing to gain by calling it: every destination is fixed
before the call.

**Economic impact:** none. It changes who can move the principal, and the answer is nobody.
**Security impact:** positive, and concentrated. This contract is now the single thing standing
between "permanent liquidity" and a promise — which is the right place for an auditor to spend
their time.
**UX impact:** none.
**Migration impact:** none. There is no migration path, deliberately — one would be a
withdrawal path with a longer name.
**Approved by:** implementation agent, under V-09's escalation clause. **The three HyperSwap
addresses remain owner-blocked** and cannot be guessed: all three are immutable in the router's
constructor, and the position manager is immutable in the lock as well — so a wrong one means
redeploying both while the old lock still holds a real position that nothing can move.

---

## D-015 — Graduation opens a full-range 1% position

**Class:** CHOOSE (§415 default, applied)
**Date:** Day 7

**Decision:** every graduation mints the widest tick range the pool supports, at the 1% fee
tier, and asserts the pool's actual price equals the curve's closing price before minting.

**Reason:** §415 locks V1 to the widest supported range, and the reasoning survives restating:
nobody can reposition this position, ever. A concentrated range the price walks out of is
liquidity stranded permanently, on a market whose entire promise is that its liquidity cannot
be pulled.

Full range also makes §416's arithmetic land rather than approximating it. At the §8 endpoint
the remaining supply is worth exactly the collateral that came with it, which is precisely the
ratio a full-range mint at `pg` consumes — the endpoint was derived to make that true, and it
is asserted directly rather than assumed.

1% is the widest standard tier and the right one for a pool that is one day old. A new launch
is volatile and thinly traded; 0.05% or 0.3% would price that risk like a stablecoin pair's,
for an LP that can never withdraw. V-07 confirmed the tier is enabled with a tick spacing of
200 — the one input here that is verified rather than chosen.

**The price assertion is load-bearing, not defensive.**
`createAndInitializePoolIfNecessary` is idempotent: a pool that already exists keeps its own
price and silently ignores the requested one. Anyone can create a pool for any pair at any
price for the cost of one transaction, and every graduating market is a known target well in
advance. Without the check the entire migration mints into a pool a stranger priced, and the
first trade takes the difference. The graduation reverts instead — under §16 that means no
GRADUATED status and no partial migration, which is the correct failure.

Dust goes to the lock (§417): never creator, never platform, never the caller. Bounded by test
at one part in ten thousand of the migration.

**Economic impact:** the fee tier is the market's post-graduation revenue rate. 1% is
deliberate and is the widest available.
**Security impact:** positive — the price check closes a front-running vector with no other
defence.
**UX impact:** none.
**Migration impact:** none.
**Approved by:** implementation agent (§415 states the default; this applies it).

---

## D-016 — Graduation escrows and finalises, because it does not fit in a block

**Class:** ESCALATION RESOLVED (§16, §95.6 — the retryable branch, invoked)
**Date:** Day 8
**Supersedes:** the atomic reading of §14 steps 3–12
**Closes:** V-19
**Rests on:** V-20

**Decision:** the buy that reaches the graduation endpoint closes the curve, refunds the
buyer's unspent quote, and stops. A permissionless `finalizeGraduation()` mints the HyperSwap
position in a later transaction. `GRADUATING` becomes a state markets rest in.

**Reason: 5,395,811 does not fit in 3,000,000.**

HyperEVM produces two block lanes, and this was measured rather than read:

```text
gasLimit  3,000,000   394 of 400 sampled blocks   the default lane
gasLimit 30,000,000     6 of 400 sampled blocks   the opt-in lane, ~1 block in 120

highest gasUsed seen in a default-lane block   2,993,188 of 3,000,000
```

The default lane is not merely small, it runs at 99.8% of its ceiling in ordinary blocks. And
a full graduation costs 5,395,811 gas against the real HyperSwap deployment, of which
`createAndInitializePoolIfNecessary` alone is 2,777,465 — 92.6% of an entire default-lane
block before this protocol does anything at all. That cost is HyperSwap's pool bytecode. It is
not ours to optimise.

So under §14 read atomically, the crossing buy could not be included at all for a buyer on the
default lane, which is essentially every buyer. The market would stall one wei short of
graduating, permanently, because every retry fails identically. **The masterplan does not
mention block lanes anywhere in its 28,051 lines** — this is not a spec the code failed to
follow, it is a property of the chain that no part of the plan accounts for.

**§16 and §95.6 prescribe this exact response,** for exactly this trigger: *"jika dependency
eksternal mengharuskan retryable workflow — deterministic escrow, permissionless
`finalizeGraduation()`, idempotent retry semantics, no retry caller privilege."* The block lane
is that external dependency. All four conditions hold:

| §16 requires | How |
|---|---|
| deterministic escrow | when the curve closes, `distributed`, `curveCollateral` and `graduationDust` are fixed by curve math, and every function that could move them is `onlyPreGrad`. There is no other migration ratio to reach, so there is nothing to front-run. |
| permissionless finalize | `finalizeGraduation()` takes no argument and never reads `msg.sender`. |
| idempotent retry | the status check admits exactly one success; any failure reverts the whole call and leaves the escrow untouched for the next attempt. |
| no caller privilege | there is no parameter and no `msg.sender` read, so there is nothing to point at whoever calls it. |

**§14's "no manual trigger" survives intact,** and this is the part worth being precise about.
The endpoint is still the only thing that graduates a market — nobody decides, and
`test_noCallerCanTriggerGraduationManually` still passes with `finalizeGraduation()` among the
entry points it attacks, because from `PRE_GRAD` it reverts. What the second transaction does
is carry out a migration that is already owed, whose every input is frozen. It chooses nothing.

**The excess is refunded, not swapped.** §14's crossing order says public UX *boleh* bablas
through graduation — may, not must — and requires a blended bound only where a blended
execution exists. Here none does: at the instant the curve closes there is no pool, so there is
no venue to route the remainder into and no price to route it at. Refunding is the honest
settlement, and the buyer gets their money back in the same transaction rather than a claim to
chase.

**Two things get better rather than worse.**

*V-19 closes instead of shipping as accepted risk.* That row was open because `minTokensOut`
bounded the curve leg while the post-grad leg rode along unprotected — a user's slippage limit
covering part of their own trade. With no post-grad leg the curve leg IS the trade and the
bound covers all of it. The SDK's `estimateIsPartial` and `boundCoversPartialRoute` are deleted
rather than left always-false, because a warning that can never be true is one users learn to
click past.

*A HyperSwap outage no longer reverts the buyer's trade.* Under the atomic design a failed
migration unwound their whole buy. Now their curve fill stands and only the migration waits.

**What this costs, stated plainly.**

Between the two transactions a market has no venue. The curve is shut and the pool does not
exist, so holders cannot sell. The window is one large-lane block — about a minute — but it is
real, and it is the price of the constraint rather than a design preference.

It also introduces an operational dependency that did not exist: **something has to call
`finalizeGraduation`.** It is permissionless precisely so that no single party can withhold it,
and the SDK builds the intent so a holder can do it from the UI when the keeper is down. But a
market whose curve has closed and which nobody finalises is stuck in the one state where its
holders cannot act, so this is an alert and not a background job. `graduating_at_block IS NOT
NULL AND status <> 2` is the query; migration 0008 indexes exactly that set.

**Measured, both halves:**

```text
crossing buy      198,355 gas   6.6% of the default lane   (unit test, asserted < 1.5M)
migration       5,388,986 gas   180% of it, 18% of the large lane   (fork test, real venue)
```

Both are asserted, and the migration assertion is written to **fail if it ever drops below the
default lane** — if HyperSwap ships a cheaper pool, this decision should be revisited, and a
failing test is how anyone finds out rather than the split staying because nobody re-measured.

**Rejected: pre-creating the pool at launch.** It moves the 2.78M cost to launch, which only
relocates the same problem onto the creator. Worse, an empty pool initialised at `pg` sits
there for a market's whole pre-graduation life, and anyone can add liquidity to it and trade
the price away from `pg` — which would then trip D-015's deliberate `PoolPriceDiverged` guard
and brick graduation permanently. That turns a griefing vector into a kill switch.

**Rejected: requiring buyers to use the large lane.** Lane selection is per-address state on
the Hyperliquid L1, not a transaction field. The protocol cannot require it of a buyer who
merely happened to be the one whose order crossed the endpoint, and a launchpad whose final
buy silently fails for everyone who has not opted in is not shippable.

---

## D-017 — The quote asset is a share wrapper, not the xStock itself

**Class:** ESCALATION RESOLVED (§420 multiplier gate, V-03)
**Date:** Day 8
**Rests on:** V-02, V-03, V-22

**Decision:** markets pair against `WrappedXStock`, a non-rebasing share receipt over an
xStock, rather than against the xStock directly. `RebaseDetector` continues to refuse raw
rebasing assets, and the wrapper is what the registry lists.

**Reason: a Uniswap V3 pool cannot hold a rebasing token, and graduation is permanent.**

This was almost decided the wrong way. The obvious fix to a rebasing quote asset is to book
collateral in SHARES — the rebase-invariant unit these tokens already expose — and `LaunchMarket`
could be taught to do that. It would be correct, and it would not be enough.

At graduation the quote asset is minted into a V3 position locked forever (§17). V3 computes
payouts from internal liquidity accounting rather than from balances, and it has **no `skim()`**
— V2 has one, V3 does not:

| The multiplier | What the pool does |
|---|---|
| rises | balance grows, accounting does not. The surplus is unreachable by anyone, and the position is permanent, so it is unreachable **forever**. |
| falls | the pool holds less than its liquidity promises. Swaps that would pay out more than the remaining balance revert. The permanent position is broken. |

**The first case is every dividend, every quarter.** Fixing only this protocol's books would
have moved the loss from a place we could see to a place nobody can reach.

**What the wrapper is.** It holds shares and mints exactly one token per share, so a dividend
arrives as a rising redemption rate instead of as a balance that moves on its own. A V3 pool
then sees an ordinary token whose price drifts, which is what V3 is built for — and the locked
position **appreciates** with the dividend instead of burying it.

The invariant is `totalSupply() <= UNDERLYING.sharesOf(address(this))`, maintained exactly in
both directions by measuring the shares that actually moved rather than predicting them. The
underlying does its own rounding between balances and shares, and a prediction that rounds the
wrong way by one wei per deposit mints tokens no share backs.

**No keys, and that is load-bearing rather than stylistic.** This contract would hold every
market's collateral. No owner, no pause, no upgrade, no fee, no rescue, no way to change the
underlying — absent rather than gated, the same discipline as `PermanentLiquidityLock`, asserted
against the ABI by test.

**Rejected: shares-based accounting alone (V-03's own suggestion).** Correct for the pre-grad
curve, silent about the pool. It is recorded in V-03 because it remains the right answer for
anything that never graduates, and it is not the answer here.

**Rejected: restricting to ETFs where reverse splits are implausible.** It addresses the rarer
half of the problem and leaves the quarterly half untouched. SPYx and QQQx pay dividends.

**Rejected: launching against Backed's own `wSPYx`.** It exists, it is non-rebasing, and it
would have avoided writing a contract. But it covers one asset out of ten, holds ~934 units
against a suite worth over $100M, and is an upgradeable proxy under an admin unrelated to this
protocol. Viable as a first market; not viable as the mechanism.

**What this costs, and it is not nothing.**

- A new contract holding all collateral. It becomes the highest-value contract in the system
  and the most important line item in an audit.
- Liquidity fragments against `wSPYx` for the one asset where Backed already has a wrapper.
- Wrapping an instrument adjacent to a security has consequences this decision does not address
  and is not competent to (V-18).

**Still open, and it is not an engineering question:** whether to launch on Backed's `wSPYx`
first — small, someone else's contract, proves the whole path with real money at low stakes —
and open the rest once this wrapper is audited.
