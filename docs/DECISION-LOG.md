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
