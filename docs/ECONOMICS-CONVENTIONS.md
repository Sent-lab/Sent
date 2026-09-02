# SENT — Economic Conventions (INTERFACE FREEZE F1)

**Status:** FROZEN, Day 1.
**Authority:** Masterplan §8, §9, §10, §11, §12, §249.3, §314, §315, §407.
**Canonical implementation:** `packages/economics/` — the only off-chain source (§1064).
**Proof:** `pnpm sim` — 39 checks reproducing §8 / §315 / §407 from the implementation.

Changes to this document after freeze require a §144 change-control record.

---

## 1. Why this document exists

§315 requires that the fee-before-curve vs fee-after-quote arithmetic "must be
deterministic and documented" and that "the quote function and execution function must use
the exact same convention" — but §315 itself does not state which convention. That gap was
logged as **C-04** in the M0 pass.

**C-04 is resolved by reading, not by choosing.** §9 and §10 fix the convention through
step ordering. This document makes it explicit and binding.

---

## 2. Fee convention — FROZEN

### BUY (§9)

Notional = **gross quote input**. Fees are removed *before* the curve runs.

```text
grossIn                                   user's xStockIn
  - coreFee     = 1.00% of grossIn        -> FeeVault (65% creator / 35% platform)
  - stockback   = 1.00% of grossIn        -> HolderRewardVault (100% holders)
  = netToCurve                            -> curve computes TOKEN out
```

Effective cost **2.00%** before slippage. §9 step ordering: take gross (1), separate core
fee (2), book 65/35 (3), separate Stockback (4), remainder enters curve (5).

### SELL (§10)

Notional = **gross quote output from the curve**. The curve runs *first*.

```text
curve grossOut                            from moving backward along P(q)
  - coreFee     = 1.00% of grossOut       -> FeeVault (65% creator / 35% platform)
  - stockback   = 2.00% of grossOut       -> HolderRewardVault (100% holders)
  = netToSeller
```

Effective cost **3.00%** before slippage. §10 step ordering: curve computes gross (1),
core fee deducted (2), booked 65/35 (3), Stockback deducted (4), collateral reduced by
curve liability (5), seller receives net (6).

### Verification against §315

Both conventions reproduce the §315 worked examples exactly, and the simulation asserts it:

| Case | Core | Creator | Platform | Stockback | Net |
|---|---|---|---|---|---|
| BUY 100 quote in | 1.00 | 0.65 | 0.35 | 1.00 | 98.00 |
| SELL 100 quote gross out | 1.00 | 0.65 | 0.35 | 2.00 | 97.00 |

### The quote ≡ execute law

`quote(side, amount)` and `execute(side, amount)` **must** call the same function in the
same order with the same rounding. This is enforced by construction — both paths call
`computeFees()` and the curve functions in `packages/economics/`, mirrored by a single
Solidity library — and by a property test asserting equality for all sampled inputs.

Frontend, backend, SDK and bots consume these; none of them re-derive fee math (§1064).

---

## 3. Fees never enter curve collateral

LOCKED (§8, §12). `curveCollateral` is a **liability accounting figure**, not the contract's
raw token balance. On sell it is reduced by the curve liability, never by the raw balance
(§10 step 5).

Consequence asserted in simulation: after any buy, collateral ≤ net input, and
gross input − collateral ≥ total fee.

---

## 4. Fixed-point representation (D-002, CHOOSE per §249.3)

```text
WAD              = 1e18
token amounts    = token wei, 18 decimals
quote amounts    = NORMALIZED quote wei, 18 decimals (via XStockAssetAdapter)
price            = quote wei per 1e18 token wei ("wad price")
rates            = basis points, BPS = 10_000
```

Quote amounts are always **normalized** by `XStockAssetAdapter` before reaching curve or fee
math. Raw xStock decimals, wrapper and multiplier semantics are the adapter's problem and
never leak into the economics layer (§399, §400).

### `k` is never materialised — precision decision

The naive parameterisation stores `k = (PG − P0) / qG`. For a $2K launch, `k` lands around
1e-16 quote units per token², and storing it as a wad destroys most significant digits.

Instead the curve is parameterised by the exact integers **(P0, dP, qG)** where
`dP = PG − P0 = 24·P0`, and every equation is multiplied through by `qG` so no division
occurs until one final floor. `k·qG = dP` exactly, with no rounding at all.

Buy solve, after multiplying by `qG·WAD`:

```text
(dP/2)·Δ² + B·Δ − netIn·qG·WAD = 0        where B = P0·qG + dP·q
Δ = (sqrt(B² + 2·dP·netIn·qG·WAD) − B) / dP
```

All terms are exact integers. The same treatment applies to sell and to collateral.

---

## 5. Rounding direction (D-003, CHOOSE per §8)

**Rule: rounding always favours protocol solvency. Never the trader.**

| Quantity | Direction | Reason |
|---|---|---|
| TOKEN out on buy | **down** | never distribute more supply than paid for |
| quote in required for a given TOKEN out | **up** | never undercharge |
| gross quote out on sell | **down** | never pay out more than the curve owes |
| collateral at q (closed form) | **down** | never claim collateral that is not there |
| integer sqrt | **floor** | smaller root ⇒ fewer TOKEN out |
| core fee, Stockback | **down** | fee is a deduction; flooring favours the user, and the |
| | | protocol's solvency is unaffected because fees sit outside collateral |
| creator 65% split | **down**, platform takes remainder | creator + platform ≡ coreFee exactly, no dust escapes, creator never exceeds 65% |
| graduation endpoint qG | **down** | graduation triggers a hair early, keeping the LP seed fully funded |

Asserted in simulation: a buy-then-sell round trip never returns more than was paid
(pre-fee), and stepwise collateral accumulation is always ≥ the closed form.

---

## 6. Graduation endpoint

```text
S  = 1,000,000,000 TOKEN
PG = 25 · P0
qG = (2·PG·S) / (P0 + 3·PG) = 50/76 · S ≈ 65.7894737% of S
```

`P0` cancels out of the formula, so **the endpoint is a pure fraction of supply and is
identical for every xStock pair.** The simulation proves this with a deliberately awkward
xStock price ($137.42).

The defining property — and the reason no creator or treasury top-up is needed:

```text
collateral(qG) == (S − qG) · PG
```

Curve collateral exactly equals the value of the remaining supply at the final marginal
price. Both sides seed the HyperSwap V3 position.

Reference outcomes, reproduced by `pnpm sim`:

| Metric | Value |
|---|---|
| Supply distributed | 657,894,736 TOKEN (65.7894736%) |
| Supply remaining | 342,105,263 TOKEN (34.2105263%) |
| Curve collateral | $17,105.26 equivalent |
| Remaining @ PG | $17,105.26 equivalent |
| Initial LP TVL | $34,210.52 equivalent |

> **Open dependency — C-03.** These are the *analytic* endpoint figures. §416 forbids
> treating reserve-ratio math as exact V3 mint math. The tick-geometry proof (V-08) must
> show that remaining TOKEN + collateral are consumed within a documented dust tolerance at
> PG. Until that proof lands, the LP seeding figures above are the economic reference
> model, not the confirmed on-chain mint amounts.

---

## 7. Post-graduation split (§396-B, §397, §407)

Of **creator-eligible LP fee revenue**:

```text
                                  creator   stockback   platform
paired-xStock-denominated          65.00%      17.50%     17.50%
TOKEN-denominated                  65.00%       0.00%     35.00%
```

The 17.50/17.50 is the platform's 35% share split in half. The creator's 65% is never
diluted by either rule. TOKEN-side revenue is **never** auto-converted to fund Stockback —
the protocol does not sell TOKEN.

---

## 8. Rates — LOCKED, not tunable by implementation

```text
core trading fee          1.00%   of notional
  creator                 65%     of the core fee
  platform                35%     of the core fee
stockback BUY             1.00%   of notional
stockback SELL            2.00%   of notional
effective BUY             2.00%
effective SELL            3.00%
```

§9, §10 and §314.2 are explicit: economic simulation is a **validation gate**, not an
authorisation to retune. If the locked rates fail approved market-quality criteria, the
implementation is **BLOCKED** and escalates as a new product decision. The creator's share
may never be reduced as an engineering workaround.

Per-market Stockback rates are **immutable once the market is launched** (§387).
