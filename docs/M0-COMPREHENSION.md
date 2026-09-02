# SENT — Milestone 0: Agent Comprehension & Implementation Plan

**Status:** M0 deliverable per Masterplan §1028.
**Produced by:** primary implementation agent.
**Date:** 2026-09-02 (Day 0 — kickoff pending approval).

---

## 1. Masterplan Version Received — CONFIRMED

```text
FILE      Masterplan_xStock_Launchpad_HyperEVM_v19_7_DAY_MAINNET_MANDATE.md
BYTES     538,709
LINES     28,051
SECTIONS  §0 … §1082
TITLE     MASTER PLAN FINAL — xStock Launchpad on HyperEVM
FOOTER    "MASTERPLAN STATUS: V1 PRODUCT-AND-ENGINEERING SPECIFICATION FREEZE READY
           — SEVEN-DAY DELIVERY / MAJOR PRODUCT / ECONOMIC / SECURITY / WALLET /
           INFRASTRUCTURE / BRAND / DESIGN / PRIMARY UX / EXECUTION ARCHITECTURE
           LOCKED — FINAL LOGO VECTOR / EXTERNAL VERIFY / IMPLEMENT / TEST / AUDIT /
           MAINNET / RELEASE GATES REMAIN."
```

Referred to hereafter as **Masterplan v19**. It is the single canonical source of truth.

**Secondary input:** `Brand.png` — SENT brand board, **visual reference only**. Where it conflicts
with the masterplan, the masterplan wins. Values read from the board and adopted as design-token
seeds (subject to §260 Exact Design Tokens):

```text
Volt Lime      #C6F600   primary signature accent (LOCKED per §421 / brand)
Deep Lime      #7BA000   secondary
Lime Glow      #E8FF78   highlight
BG Primary     #050607
BG Secondary   #0D0F12
Surface        #12161A
Border         #1F262C
Text Primary   #F5F7FA
Text Secondary #9AA4B2
Typeface       Sora
Tagline        LAUNCH. PAIR. CREATE MARKET.
```

---

## 2. Seven-Calendar-Day Delivery Window — CONFIRMED

Understood and accepted as a mandatory execution constraint (§1051–§1082).

Day 7 target = **production-ready mainnet launch candidate**, not a prototype (§1052):
core product implemented, critical integrations verified, contracts tested, frontend/backend/
realtime operational, SENT design system implemented, creator/trader flows functional, security
review completed to the launch bar, production infra ready, mainnet deployment completed or
immediately deployable, controlled on-chain validation done, public opening **if and only if all
P0 gates PASS**.

**The deadline does not override P0 security, financial correctness, transaction integrity, or
release gates (§1072).** Where the two collide, the gate wins and the date slips — that is the
masterplan's own instruction, not a discretionary choice by this agent.

---

## 3. No Prolonged Public Testnet Phase — CONFIRMED

No public testnet campaign is planned (§1053). Validation path (§1054):

```text
LOCAL UNIT / FUZZ / INVARIANT
→ DETERMINISTIC ECONOMIC SIMULATION
→ HYPEREVM + HYPERSWAP FORK TESTS
→ E2E (contract + service + web + wallet)
→ ADVERSARIAL / SECURITY REVIEW (continuous from Day 2)
→ DEPLOYMENT REHEARSAL
→ MAINNET DEPLOYMENT CEREMONY
→ CONTROLLED MAINNET CANARY (platform funds only, tiny value)
→ PUBLIC OPENING IF ALL P0 GATES PASS
```

"No testnet" ≠ "no testing." The full mandated test matrix (§30, §307, §406, §532–§535, §606,
§641–§645, §178.x) is in scope and non-deferrable.

---

## 4. System Architecture — In My Own Words

SENT is a **permissionless fixed-supply token launchpad on HyperEVM whose quote asset is an
official canonical xStock** (tokenized equity), with an automatic graduation into permanently
locked HyperSwap V3 liquidity, and a holder-reward mechanism ("Stockback") that pays holders in
the market's own paired xStock.

**The economic life of a market has exactly two phases.**

**Phase PRE_GRAD — the launchpad's own curve.**
A creator connects a wallet, names a token, picks an official xStock pair, and pays ~$1–2 + gas.
`LaunchpadFactory` deploys, via creator-bound CREATE2, a `LaunchToken` (1,000,000,000 fixed supply,
one genesis mint, no tax, no blacklist, no owner mint, no proxy) and a `LaunchMarket`. Creator gets
**0%**. Platform gets **0%**. Nobody deposits liquidity. The market opens at a **$2,000 reference
market cap** and trades two-way against the paired xStock on a **linear curve denominated in xStock
units**, anchored by a launch-time xStock/USD reference snapshot so that the $2K→$50K product
anchors stay meaningful without routing every trade through a stablecoin.

Every trade is taxed twice, and the two taxes are structurally different:

- a **1% core trading fee**, booked 65% creator / 35% platform into `FeeVault`; and
- a **Stockback contribution** — +1% on buys, +2% on sells — routed 100% to `HolderRewardVault`.

Effective cost: **2% buy / 3% sell**. Both taxes sit **outside curve collateral**, so the curve's
solvency accounting is never diluted by fees.

When the marginal price reaches **25×** the launch price (the $50K reference MC endpoint), the
market **graduates automatically inside the triggering trade** — no manual step, no vote, no admin.
The analytic endpoint `qG = 2·PG·S / (P0 + 3·PG)` puts ~65.79% of supply in the market and leaves
~34.21% of supply plus ~$17.1K-equivalent of curve collateral to seed the HyperSwap V3 position
(~$34.2K reference TVL). `GraduationRouter` mints that V3 position at the tick geometry that
preserves spot-price continuity, and the **LP principal is locked permanently** — no withdrawal
path exists for anyone, including governance.

**Phase GRADUATED — HyperSwap is the venue.**
The curve stops. Sell-on-curve is permanently disabled. **The TOKEN address never changes.** The
creator keeps 65% of creator-eligible LP fee revenue forever; the platform's 35% share, when it
arrives denominated in the paired xStock, is split 50/50 into Stockback and platform retention
(net: 65% creator / 17.5% Stockback / 17.5% platform). TOKEN-denominated platform-side revenue goes
100% to platform with no forced conversion — the protocol never sells TOKEN to fund rewards.

**Stockback is a reward rail, not a staking product.**
Holding the TOKEN is the only requirement. Exposure is **time-weighted (TWAB)** over 24h epochs, so
snapshot farming does not work and no lockup exists. Off-chain, redundant independent indexers
compute a deterministic cumulative distribution dataset; threshold attestors sign a
domain-separated commitment binding chainId, vault, market, token, reward asset, version, epoch,
cumulative total, Merkle root and dataset hash; **anyone** may submit that quorum to
`HolderRewardVault`, which verifies it, waits an activation delay, then lets holders claim.
Submitters earn no privilege. Attestors never custody funds. Entitlement can never exceed funding —
that is a hard conservation invariant.

**Authority hierarchy is strict and one-directional.**
Chain/contracts are the only financial truth. PostgreSQL is a rebuildable projection of chain
events. Redis is cache and realtime coordination. WebSocket is delivery only. The frontend is
representation plus transaction orchestration. Off-chain state never becomes canonical money.

**Transaction integrity is a single-source law.**
`UI review = TransactionIntent = SDK builder = actual calldata`. One builder, in the SDK,
constructs every financial transaction; the UI renders what it will sign; nothing mutates between
review and signature. Frontend and backend do not re-derive fee or curve math independently.

**The platform's own money is compartmentalized** across six accounts (§555): Governance Safe
(parameters, no funds), Treasury Safe (platform revenue), Founder Profit Safe (explicit
distributions only), Deployer wallet (deploys, is *never* creator identity), Ops/Relayer (gas-only
automation, no custody), and Guardian Safe (pause only). Creator fees, Stockback obligations, curve
collateral and LP principal are **user/creator liabilities** and may never be routed to founder
profit.

**The product surface is two visual modes on one design system.** Experience Mode (homepage,
explore, roadmap, creator preview) is cinematic, spatial, 3D-capable, animation-rich. Trading Mode
(terminal, transaction flows, account) is calm, dense, quant-grade, low-distraction. The governing
motion law: **the closer the user gets to moving money, the calmer the motion becomes.** Volt Lime
is a restrained signature accent on refined dark neutrals — never flooded, never casino.

---

## 5. Major Subsystems

### 5.1 On-chain (canonical financial authority)

| Contract | Responsibility |
|---|---|
| `LaunchpadFactory` | creator-bound CREATE2 deploy, creator registry, pair registry, `TokenLaunched` authenticity |
| `LaunchToken` | 1B fixed supply, genesis mint only, vanilla ERC-20, no tax/blacklist/mint/proxy |
| `LaunchMarket` | lifecycle state machine, linear curve, buy/sell, fee split, curve collateral accounting, graduation trigger |
| `FeeVault` | creator 65% / platform 35% core-fee accounting and claims |
| `HolderRewardVault` | Stockback funding, attested cumulative Merkle roots, activation delay, claims, solvency |
| `XStockRegistry` | allowlist of verified canonical HyperEVM xStock quote assets |
| `XStockAssetAdapter` | normalized quote accounting (decimals, multiplier/share semantics, corporate actions) |
| `ReferencePriceAdapter` | launch-time USD anchor + live USD display feed (role-split per §402) |
| `GraduationRouter` | V3 mint geometry, price continuity, permanent LP lock, dust destination |

### 5.2 Off-chain services

| Service | Responsibility |
|---|---|
| `indexer` | reorg-safe HyperEVM + HyperSwap event ingestion → normalized event model |
| `api` | public/internal HTTP API (Fastify-class) |
| `realtime` | WebSocket fanout, Redis-coordinated |
| `stockback` | TWAB engine, deterministic cumulative distribution dataset, proof API |
| `finalizer` | attested epoch commitment submission |
| `worker` | backfill, OG/share cards, async jobs |

### 5.3 Shared packages

`sdk` (public TS SDK + **canonical TransactionIntent builder**), `contracts` (generated ABI/types),
`config` (chain + addresses, integrity-checked artifact), `database`, `realtime` (shared event
schemas), `ui` (SENT design system), `chart`, `stockback` (shared reward math/types), `types`,
`utils`.

### 5.4 Web surfaces

Homepage/Explore · Token Terminal · Create/Preview · Creator Control Center · Account/Portfolio +
Stockback Center · Roadmap/Changelog/Live Stats · Operator Console (internal) · Transaction Center.

### 5.5 Platform accounts & keys

Governance Safe · Treasury Safe · Founder Profit Safe · Deployer · Ops/Relayer · Guardian Safe ·
Stockback attestor set.

### 5.6 Infrastructure

pnpm + Turborepo monorepo · Postgres · Redis · S3-compatible object storage · containerized
services · CDN/edge web · CI/CD with OIDC cloud auth and no production contract keys in CI ·
observability (metrics/logs/traces/alerts) · IaC.

---

## 6. Requirement Classification

### 6.1 LOCKED — implement exactly; no reinterpretation without explicit approval

Sourced from §2, §421, §407, §408 and the operating brief.

**Supply & allocation**

- Total supply 1,000,000,000 TOKEN, fixed, one genesis mint, no post-genesis mint path.
- Creator allocation **0%**. Platform/team allocation **0%**. No premine of any kind.
- No creator liquidity deposit. No treasury top-up.
- LaunchToken is vanilla: no transfer tax, no blacklist, no max-wallet, no owner mint, no upgradeable proxy.

**Market & curve**

- HyperEVM target chain.
- Quote asset must be an **official/canonical HyperEVM xStock representation only**.
- Linear curve in xStock quote units, anchored by launch-time xStock/USD reference snapshot.
- Launch reference MC **$2,000**; graduation reference MC **$50,000** (25× P0).
- `qG = (2·PG·S)/(P0 + 3·PG)`; `qG/S = 50/76 ≈ 65.7894737%`.
- Two-way (buy **and** sell) trading throughout PRE_GRAD; sell permanently disabled after GRADUATED.
- No forced expiry for markets that never graduate.

**Fees & economics**

- Core trading fee **1.00%** of notional, pre-grad.
- Core fee split **65% creator / 35% platform**, unchanged by Stockback, never reduced as an engineering workaround.
- Stockback contribution **+1.00% BUY / +2.00% SELL**; 100% to eligible holders.
- Target effective **2% BUY / 3% SELL**.
- Core fee and Stockback contribution both sit **outside curve collateral**.
- Post-grad: creator 65% of creator-eligible LP fee revenue; platform-side 35%.
- Post-grad paired-xStock platform-side revenue: **50% → Stockback, 50% → platform** (net 65 / 17.5 / 17.5).
- Post-grad TOKEN-denominated platform-side revenue: **100% platform, 0% automatic conversion**.
- Per-market Stockback rate is **immutable once the market is launched**.
- Rates may not be tuned by an implementation agent. Simulation is a *gate*, not an authorization.

**Stockback mechanics**

- Reward asset = the market's official paired xStock.
- **No staking, no lockup** required to earn.
- **24h time-weighted (TWAB)** epochs; no snapshot farming.
- Threshold-attested cumulative Merkle commitment + permissionless submission + activation delay.
- Attestors never custody funds; submitter receives no economic privilege.
- Entitlement may never exceed funding (conservation invariant).
- Estimated accrual is derived/indexed and **never** canonical claim state.

**Graduation**

- Automatic, in-transaction, at the endpoint — no manual graduation, ever.
- **TOKEN address identical before and after graduation.**
- HyperSwap is the canonical post-grad venue.
- **LP principal permanently locked** — no withdrawal path for anyone.
- Spot price continuity across the boundary.
- Graduation dust must be holder-neutral; never credited to creator/platform as windfall.

**Identity, custody, integrity**

- CREATE2 vanity with **creator-bound anti-front-run** salt construction; vanity suffix is branding, **authenticity comes from Factory registry/events**.
- Creator wallet is canonical creator identity. **Deployer wallet is never creator identity.**
- Wallet/role separation across the six platform accounts; Governance/Treasury/Founder/Guardian/Ops/Deployer powers are disjoint.
- Treasury routing and Founder Profit routing as specified; user liabilities, creator fees, Stockback obligations, curve collateral and LP principal never enter founder profit.
- `UI review = TransactionIntent = SDK builder = actual calldata`.
- Chain = authority; Postgres = projection; Redis = cache; WS = delivery; frontend = representation.
- **Forbidden absolutely:** hidden admin withdrawal paths, arbitrary fund seizure, premine, transfer taxes, blacklists, manual graduation, creator-funded liquidity, forced TOKEN selling for Stockback, LP principal withdrawal, god-mode governance.

**Product surface & brand**

- Bot-first / realtime integration.
- Premium, quant-grade, responsive, accessible, performant UI quality is a **release requirement**, not polish (§450).
- Brand SENT; Volt Lime `#C6F600` restrained signature accent on dark refined neutrals; symbol-first paired-market mark.
- Experience Mode vs Trading Mode split; motion calms as the user approaches money.
- Not generic SaaS, not crypto casino, not neon spam, not over-rounded, not template.

### 6.2 DEFAULT — use unless there is a strong documented engineering reason

TypeScript everywhere + Solidity · pnpm + Turborepo-class monorepo · Next.js App Router + React ·
TanStack Query · wagmi + viem · bespoke design system (no generic component kit) · CSS/WAAPI +
GSAP-class orchestration + Three.js/R3F · TradingView Lightweight Charts + custom adapter ·
Node.js + Fastify-class API · WebSocket service + Redis fanout · owned reorg-safe TS/viem indexer ·
PostgreSQL primary · Redis cache · Redis Streams-class durable queue · S3-compatible storage ·
Postgres FTS/trigram search for V1 · Postgres analytics for V1 (ClickHouse only when measured) ·
Playwright-class E2E · Foundry + fuzz + invariants + fork · Safe as reference multisig ·
containerized backends + managed Postgres/Redis + CDN/edge frontend · GitHub Actions with OIDC ·
protected main + CODEOWNERS + protected deployment environments.

Deviation requires a written record per §443.

### 6.3 VERIFY — confirm against authoritative sources before production (never invent)

Full ledger in section 8 below. Headline items: canonical HyperEVM xStock addresses and mechanics;
HyperSwap addresses/fee tiers/tick spacing/capabilities and delegated-position lock behavior; exact
V3 mint geometry; reference-price/multiplier sources; Safe availability on HyperEVM; HyperEVM RPC/WS
characteristics; explorer/verification tooling; legal/operator restrictions.

### 6.4 CHOOSE — engineering discretion within masterplan boundaries

Fixed-point representation and rounding direction (must be documented, deterministic, and
conservative in the protocol's favor); Solidity library choices; storage layout and code
organization; indexer/database internals; chart and motion implementation details; CI/CD and
monitoring vendors; component internals; caching strategy; test framework specifics; exact
WebSocket message envelope.

**Proceeding without asking** on ordinary CHOOSE items, per the operating brief. Escalating only
where a CHOOSE materially touches security, economics, custody, or locked UX.

---

## 7. Contradictions, Ambiguities & Blockers

Ranked by risk to the 7-day mandate. Nothing here is silently resolved; each has a stated
disposition.

### C-01 — Duplicate section numbering §396–§408 · **RESOLVED BY RULE**

The document contains two blocks numbered §396–§408: the *Brutal Audit Remediation* block
(≈line 11405) and the *Post-Grad Stockback FINAL LOCK* block (≈line 12254).
**Disposition:** §277 Historical Decision Supersession Rule — *latest explicit locked decision
wins*. The later block governs. All internal references will be disambiguated as
`§396-A (audit remediation)` vs `§396-B (post-grad final lock)` in the traceability database.
No masterplan rewrite. **Not a blocker.**

### C-02 — §425 declares `POST_GRAD_STOCKBACK_PLATFORM_SHARE` open · **RESOLVED BY RULE**

§425 says this product-economic choice must be approved before the masterplan can be labeled
"no product decisions remaining." §396-B, §407 and §408 subsequently lock it at 50/50 and state
"NO KNOWN PRODUCT-LEVEL ECONOMIC OR BEHAVIORAL DECISIONS REMAIN OPEN FOR V1."
**Disposition:** locked at 50% Stockback / 50% platform of the paired-xStock platform-side share
(net 65 / 17.5 / 17.5). Implementing as locked. **Not a blocker.** Flagged for one-line owner
confirmation only.

### C-03 — Analytic curve endpoint vs real V3 mint geometry · **HIGHEST ECONOMIC RISK**

§8's `qG` is derived from a reserve-balance model. §416 explicitly warns that HyperSwap V3 mint is
tick/range liquidity math, forbids "pretending V2 reserve-ratio math is exact V3 mint math," and
requires proving that remaining TOKEN + curveCollateral are consumed within a documented dust
tolerance at the final marginal price.
**Disposition:** Day 1–3 executable simulation must prove tick-policy feasibility. If exact geometry
forces a material economic change, that is a **product escalation**, not a code fix. This is the
single most likely source of a genuine Day-3 escalation.

### C-04 — Fee-before-curve vs fee-after-quote arithmetic · **MUST FREEZE DAY 1**

§315 states the convention "must be deterministic and documented" and that quote and execution must
use the *exact* same convention — but does not fix which. It materially changes effective price and
every displayed number.
**Disposition:** CHOOSE, but frozen as an interface on Day 1, implemented **once** in the canonical
curve/fee library, consumed unchanged by contracts, SDK, API and UI. Documented in
`docs/ECONOMICS-CONVENTIONS.md`. Property test: `quote(x) == execute(x)` for all x, always.

### C-05 — External independent audit vs 7 calendar days · **SCHEDULING CONTRADICTION, DECLARED**

M20 (§1042) requires independent security review; §1067–§1068 acknowledge audit compression; the
GO gate requires "no unresolved Critical security issue"; and the operating brief forbids claiming
"audit passed" when an external audit has not completed. A genuinely independent external audit of a
system this size will not *complete* within 7 days.
**Disposition — stated plainly now, not on Day 7:** continuous internal adversarial review from
Day 2 (Stream I) plus incremental frozen-module handoff to external reviewers is achievable and
planned. **A completed external audit by Day 7 is not.** Day 7 will therefore report external audit
status honestly as *in progress / partial*, and the GO/NO-GO decision on public opening is the
product owner's call against that stated fact. This agent will not label the audit complete when it
is not. Mainnet deploy + controlled canary can still proceed on Day 7 per §1069–§1071.

### C-06 — No canonical HyperEVM xStock may pass the §420 allowlist gate · **PRODUCT-STOPPING RISK**

§420 requires an allowlist per *verified* HyperEVM deployment and forbids inferring availability
from the global xStocks catalog. §421 forbids guessing. If zero xStock assets pass all eight gates,
the product's LOCKED core pairing has no substrate.
**Disposition:** Day 1 top-priority VERIFY. If it fails → **BLOCKED**, escalate immediately. No
placeholder/mock xStock may ever reach a production build (§279).

### C-07 — HyperSwap permanent-lock primitive for a delegated position · **P0 DEPENDENCY**

"LP principal permanently locked" + "creator retains fee rights" together require a venue primitive
that separates fee collection from principal withdrawal (§413, §414, §415).
**Disposition:** Day 1 VERIFY. If HyperSwap V3 offers no such primitive, the lock must be achieved
by a purpose-built non-withdrawable holder contract — which is an architecture decision with
security consequences and will be escalated, not improvised.

### C-08 — Attestor quorum is a people/key dependency, not code · **OPS BLOCKER**

§592–§597 and §603 require a threshold attestor set with independently deployed indexer instances
and hardware-wallet-backed human signers, plus Safe signer-set separation (§601) across Governance /
Treasury / Founder / Guardian.
**Disposition:** signer identities, hardware procurement and key ceremony must start **Day 1 in
parallel with code** or Day 7 mainnet slips for non-engineering reasons. Escalated now as an owner
action item, not an engineering task.

### C-09 — Safe availability on HyperEVM · **VERIFY**

The entire platform-account architecture (§598–§600) assumes Safe. If Safe is not deployed on
HyperEVM, custody architecture needs an approved alternative.
**Disposition:** Day 1 VERIFY; escalate on failure.

### C-10 — "No hidden liquidity deduction" vs Stockback outside the curve · **UX/COPY, NOT ECONOMIC**

§9 promises no hidden deduction while routing 1–2% outside curve collateral. These are consistent
only if disclosure is complete.
**Disposition:** §316 fee-transparency surface is P0 UX; every quote shows core fee, Stockback
contribution, and net-to-curve explicitly. No aggregated "fee" number that hides the split.

### C-11 — §8 leaves rounding direction implementation-level

**Disposition:** CHOOSE, resolved conservatively — rounding always favors protocol solvency
(collateral never over-credited, entitlement never over-minted), documented, and invariant-tested.

### C-12 — Reference-price oracle provider unspecified (§253, §402)

Role-split is locked (launch anchor vs live USD display); the provider is not.
**Disposition:** VERIFY + CHOOSE. Anchor must be manipulation-resistant since it fixes P0 for the
market's entire life; live display may be softer and must degrade visibly, never silently.

---

## 8. External Dependencies Requiring Verification

Tracked in `docs/VERIFY-LEDGER.md` using the §143 Known-Unknowns template
(`UNKNOWN / WHY IT MATTERS / CURRENT ASSUMPTION / HOW TO VERIFY / BLOCKS / OWNER / STATUS`).
Every row starts `STATUS: UNVERIFIED`. No row may be silently assumed.

| # | Dependency | Blocks | Priority |
|---|---|---|---|
| V-01 | HyperEVM chain id, RPC + WebSocket endpoints, finality/reorg behavior, gas token (HYPE) | everything | Day 1 |
| V-02 | Canonical HyperEVM xStock representations + exact addresses | LOCKED core pairing | Day 1 · P0 |
| V-03 | xStock decimals, wrapper/multiplier/share semantics | XStockAssetAdapter, all accounting | Day 1 · P0 |
| V-04 | xStock trading-halt + corporate-action interfaces | §401 safety gate | Day 1 |
| V-05 | xStock transfer behavior (fee-on-transfer? rebasing? pausable?) | curve solvency | Day 1 · P0 |
| V-06 | HyperSwap V3 factory/router/position-manager addresses | graduation | Day 1 · P0 |
| V-07 | HyperSwap fee tiers + tick spacing available | V3 geometry | Day 1 · P0 |
| V-08 | Exact V3 mint math/geometry at final marginal price | C-03 | Day 1–3 · P0 |
| V-09 | Delegated-position permanent lock + fee-right custody capability | C-07 | Day 1 · P0 |
| V-10 | HyperSwap pause/upgrade/admin risk surface | §414 | Day 2 |
| V-11 | Reference price + multiplier source for launch anchor | P0 anchor integrity | Day 1 · P0 |
| V-12 | Live USD display feed | §402/§403 | Day 2 |
| V-13 | Safe deployment + supported addresses on HyperEVM | custody architecture | Day 1 · P0 |
| V-14 | Block explorer + source-verification tooling | §178.18 release gate | Day 2 |
| V-15 | HyperEVM RPC provider limits / official RPC limitations (§542) | indexer + realtime | Day 1 |
| V-16 | CREATE2 determinism + any chain-specific deployment nuance | vanity architecture | Day 2 |
| V-17 | Hardware wallet + Safe signing support for chosen signers | key ceremony | Day 1 (ops) |
| V-18 | Legal/operator restrictions on tokenized-equity-paired venues | §32, §1027 M22 | Day 1 (owner) |

---

## 9. Requirements Traceability Map — Core Wiring

Format: **Requirement → Canonical contract/state → Service/indexer → UI → Test → Release gate.**
Extract of the P0 core; the full matrix lives in `docs/TRACEABILITY.md` and is maintained per §422.

| Requirement | Canonical contract / state | Service / indexer | UI | Test | Release gate |
|---|---|---|---|---|---|
| 1B fixed supply, 0% creator, 0% platform | `LaunchToken` genesis mint | indexer verifies totalSupply on `TokenLaunched` | token terminal supply panel | unit + invariant `totalSupply == 1e9e18` forever; no mint path reachable | §178.1 |
| Token authenticity | `LaunchpadFactory` registry + `TokenLaunched` | indexer authenticity flag | verified badge; vanity suffix explicitly *not* proof | unit: unregistered token never renders verified | §178.1 |
| Creator identity = creator wallet | Factory-stored creator | indexer creator projection | creator profile, Control Center | test §641: deployer-launched token never claims creator identity | §178.9 |
| CREATE2 vanity, front-run safe | creator-bound `effectiveSalt` | — | launch preview address | adversarial: mempool copy cannot steal launch (§412) | §178.1 |
| Official xStock pairing only | `XStockRegistry` allowlist | registry sync | pair selector shows only allowlisted | unit: non-allowlisted pair reverts | §178.3 |
| xStock normalized accounting | `XStockAssetAdapter` | normalized quote projection | all quote amounts | fuzz across decimals/multiplier; corporate-action gate | §178.3 |
| $2K start / linear curve | `LaunchMarket` P0, k, q | trade event → price series | terminal chart + price | simulation: P(0)=P0; MC(0)≈$2K reference | §178.2 |
| 1% core fee, 65/35 | `LaunchMarket` → `FeeVault` | fee projection | fee breakdown, creator earnings | unit + invariant: creator credit == 65% of core fee, always | §178.2 |
| Stockback +1% buy / +2% sell | `LaunchMarket` → `HolderRewardVault` | funding projection | fee transparency panel (§316) | conservation: vault funding == Σ contributions | §178.2 |
| Fees outside curve collateral | `curveCollateral` accounting | collateral projection | — | invariant: collateral == curve liability, never raw balance | §178.2 · §178.5 |
| Sell solvency | `LaunchMarket` backward curve | — | sell quote | fuzz: any sell sequence stays solvent; no underflow | §178.2 |
| Auto graduation at 25× | `LaunchMarket` → `GraduationRouter` | `Graduated` event | milestone moment UX | crossing-order fee segmentation (§411-A); no manual path exists | §178.4 |
| Same TOKEN address post-grad | `LaunchToken` (untouched) | — | address unchanged | fork test: address identical pre/post | §178.4 |
| Price continuity | V3 mint geometry | chart splice | continuous chart | fork: spot price delta within documented tolerance | §178.4 |
| LP principal permanently locked | lock primitive / holder | LP position monitor | trust panel | adversarial: no caller, incl. governance, can withdraw principal | §178.4 · §178.5 |
| Graduation dust holder-neutral | dust account | dust monitor | — | bounded-dust simulation; never credited to creator/platform | §178.4 |
| Post-grad 65 / 17.5 / 17.5 | fee-right custody + routing | LP fee projection | creator earnings, Stockback source | unit + fork: TOKEN-side 100% platform, no auto-conversion | §178.4 |
| TWAB, no staking, no snapshot farming | `HolderRewardVault` entitlement | `stockback` TWAB engine | accrual vs claimable (§293) | flash-hold attack yields ≈0; transfer mid-epoch splits correctly | §178.5 |
| Attested cumulative Merkle root | vault quorum verify + domain | `finalizer` + attestors | epoch status | replay tests: cross-chain/market/vault/version all rejected | §178.5 |
| Entitlement ≤ funding | vault solvency check | reconciliation job | — | invariant: Σ claimable ≤ funded, all paths | §178.5 · P0 |
| Estimated ≠ claimable | derived only | TWAB estimate | clearly separated labels | UI test: estimate never presented as claimable | §178.10 |
| UI = intent = SDK = calldata | — | — | transaction review | property: rendered intent hashes to submitted calldata | §178.10 · §537 |
| Chain is authority | — | Postgres rebuildable from chain | — | full reindex reproduces identical state | §178.7 |
| Reorg safety | — | indexer reorg logic | freshness indicator | reorg simulation; no phantom finalized state | §178.7 |
| Treasury / Founder separation | Safe roles | treasury accounting | internal dashboards | §643/§644: no liability ever reaches Founder Profit Safe | §178.17 |
| No god-mode | role matrix (§683) | — | — | adversarial: enumerate every privileged fn; none can seize funds | §178.5 · P0 |
| Premium/accessible/performant UI | — | — | all surfaces | visual regression, a11y, Lighthouse-class budgets | §178.12–§178.15 · §450 |

---

## 10. Proposed Repo Structure

**Adopted verbatim from Masterplan §411 / §139.** Not redesigned.

```text
/
├── apps/
│   └── web/                    # Next.js App Router frontend
├── contracts/
│   ├── src/                    # Solidity
│   ├── test/                   # Foundry unit/fuzz
│   ├── script/                 # deployment scripts
│   └── invariants/             # invariant suites
├── services/
│   ├── indexer/                # HyperEVM / HyperSwap ingestion
│   ├── api/                    # public/internal HTTP API
│   ├── realtime/               # websocket fanout
│   ├── stockback/              # TWAB + distribution computation
│   ├── finalizer/              # attested commitment submission
│   └── worker/                 # backfill / OG / async jobs
├── packages/
│   ├── sdk/                    # public TS SDK + TransactionIntent builder
│   ├── contracts/              # generated ABI/types
│   ├── config/                 # chain + addresses
│   ├── database/               # schema/query layer
│   ├── realtime/               # shared event schemas
│   ├── ui/                     # SENT design system primitives
│   ├── chart/                  # chart adapters
│   ├── stockback/              # shared reward math/types
│   ├── types/
│   └── utils/
├── infra/
│   ├── docker/ migrations/ monitoring/ deployment/
├── tests/
│   ├── e2e/ integration/ load/
└── docs/
```

**Single-canonical-source enforcement** (§1064), by CODEOWNERS + CI:

```text
curve math + fee math      → contracts/src/lib + packages/stockback (mirrored, differential-tested)
Stockback accounting       → packages/stockback
xStock normalization       → XStockAssetAdapter + packages/sdk adapter binding
creator identity           → LaunchpadFactory only
TransactionIntent          → packages/sdk ONLY (web/api/bots consume, never rebuild)
graduation math            → GraduationRouter + simulation harness
contract ABIs/events       → packages/contracts (generated; hand-edits rejected in CI)
production address config  → packages/config (integrity-checked artifact, §700)
```

Additional M0 docs: `docs/VERIFY-LEDGER.md`, `docs/TRACEABILITY.md`,
`docs/ECONOMICS-CONVENTIONS.md`, `docs/DECISION-LOG.md` (§142), `docs/INTERFACE-FREEZE.md`.

---

## 11. Seven-Day Execution Schedule

Aligned to the operating brief's daily targets and §1056–§1062.

**Day 1 — Verification + Foundations**
M0 sign-off · VERIFY ledger opened and V-01…V-18 driven hard · monorepo + CI green from hour one ·
executable economic simulation (curve, fees, Stockback) · V3 graduation geometry proof started ·
**interface freeze round 1** · SENT design tokens from brand board · attestor/Safe key-ceremony
procurement kicked off in parallel (owner).

**Day 2 — Protocol Core**
LaunchToken · XStockRegistry · XStockAssetAdapter · FeeVault · HolderRewardVault primitives ·
canonical curve + fee library · LaunchMarket core (buy/sell/lifecycle) · unit + fuzz + invariants
running in CI · **security review begins (Stream I) and never stops**.

**Day 3 — Factory / Graduation / Security Proof**
LaunchpadFactory + creator-bound CREATE2 · GraduationRouter · ReferencePriceAdapter · HyperSwap
integration · LP lock proof · crossing-order fee segmentation · fork/integration tests ·
attestation pipeline design frozen.

**Day 4 — Data / Realtime / SDK**
Reorg-safe indexer · Postgres schema + migrations · Redis · API · WebSocket · **SDK +
TransactionIntent (canonical)** · TWAB engine · proof API · attestor services.

**Day 5 — Product Surfaces**
Homepage/Explore · Trading Terminal + trade flow · wallet integration · Creator Launch + Preview ·
Account/Portfolio · Stockback UX · Creator Control Center.

**Day 6 — Integration + Premium Pass**
Full E2E · mobile · reconnect/reorg/error states · SENT motion + 3D (Experience Mode) · visual
regression · performance · accessibility · Operator Console · production infra · **deployment
rehearsal** · security review continues in parallel.

**Day 7 — Remediation / Mainnet / Controlled Opening**
Close critical findings · production config freeze · deployment ceremony · mainnet deploy · source
verification · role handoff · Treasury/Guardian/attestor verification · **controlled mainnet canary
(platform funds only)** · GO/NO-GO · public opening only if all P0 PASS.

Daily report in the mandated format at each day boundary.

---

## 12. Parallel Streams

```text
DAY 1   A B C D E H I  (I = review of specs/interfaces; F/G blocked on E tokens + D intent)
DAY 2   A B I H        + C scaffolding, E primitives, D SDK skeleton against frozen ABI
DAY 3   A B C D E I H
DAY 4   B C D I H      + E/F/G ramp on frozen API + intent contracts
DAY 5   F G D C I H
DAY 6   F G H I        + A/B/C remediation only
DAY 7   H I A          + all streams on findings closure
```

Streams: **A** contracts/economics · **B** Stockback/TWAB/proof · **C** indexer/API/realtime ·
**D** SDK/TransactionIntent/wallet · **E** design system/primitives · **F** Homepage/Explore/
Terminal · **G** Creator/Account/Stockback UX · **H** infra/CI/observability/ops · **I** security/
adversarial/audit liaison.

**Safety rule (§1064):** parallel execution yes; parallel ownership of canonical financial logic
never. Streams C–G consume A/B/D interfaces; they do not reimplement curve math, fee math,
Stockback accounting, xStock normalization, creator identity, graduation math, ABIs,
TransactionIntent or address config.

---

## 13. Interface Freeze Points

| Freeze | When | Contents | Unblocks |
|---|---|---|---|
| **F1 — Economic conventions** | Day 1 EOD | fixed-point representation, rounding direction, fee-before/after-curve convention (C-04), quote≡execute law | A, B, and every downstream number |
| **F2 — Contract interfaces + events** | Day 2 midday | external fn signatures, event schemas, error taxonomy, lifecycle states | C indexer, D SDK, I review |
| **F3 — Normalized event/data model** | Day 3 EOD | indexer event model, Postgres schema, WS envelope | C, D, F, G |
| **F4 — TransactionIntent + SDK surface** | Day 4 midday | intent schema, builder API, simulation/quote API | D, F, G, bots |
| **F5 — Design tokens + UI primitives** | Day 1 EOD (tokens) / Day 4 (primitives) | color/space/type/motion tokens, core components | E, F, G |
| **F6 — API contract** | Day 4 EOD | REST/WS endpoints, pagination, error shape | F, G, external bots |
| **F7 — Production config artifact** | Day 7 pre-deploy | addresses, roles, chain config; integrity-checked | deployment ceremony |

After a freeze, changes go through the §144 change-control record — not a silent diff.

---

## 14. Day-1 Definition of Done

Day 1 is complete only when **all** of the following are true:

1. M0 comprehension pass approved by product owner.
2. `docs/VERIFY-LEDGER.md` exists with V-01…V-18; every P0 row either **VERIFIED with a cited
   authoritative source** or explicitly **BLOCKED + escalated**. No row left as a silent assumption.
3. V-02/V-03/V-05 (canonical xStock existence + mechanics) resolved, or the product is formally
   BLOCKED and escalated (C-06).
4. V-06/V-07/V-09 (HyperSwap addresses, tiers, lock capability) resolved or escalated.
5. V-13 (Safe on HyperEVM) resolved or escalated.
6. Monorepo scaffolded per §411; `pnpm install` + typecheck + lint + build + test **green in CI**
   on a protected main branch (§1065 — CI from hour one).
7. Executable economic simulation runs and reproduces the §8 reference outcomes:
   `qG/S ≈ 65.7894737%`, ~657.895M distributed, ~342.105M remaining, ~$17.1K collateral,
   ~$34.2K reference LP TVL.
8. Stockback simulation runs end-to-end on synthetic trade flow with the conservation invariant
   (`Σ entitlement ≤ Σ funding`) holding.
9. V3 graduation geometry proof **started** with a chosen candidate tick policy and a first
   dust-bound measurement (completion is Day 3, per C-03).
10. **F1 economic conventions frozen** and documented in `docs/ECONOMICS-CONVENTIONS.md`.
11. **F5 design tokens frozen** in `packages/ui` from the brand board, with Volt Lime usage rules
    (restrained accent) and the two-mode motion law encoded as tokens.
12. `docs/TRACEABILITY.md` seeded with the P0 matrix from section 9 above.
13. `docs/DECISION-LOG.md` opened; C-01, C-02, C-04, C-11 recorded with their dispositions.
14. Key-ceremony / attestor-signer procurement action item delivered to the owner (C-08).
15. Day 1 report published in the mandated daily format.

---

## 15. LOCKED-Decision Commitment — EXPLICIT

I confirm, explicitly and without reservation:

- I will **not** alter, retune, reinterpret, simplify, or "improve" any LOCKED decision without
  explicit product-owner approval recorded through the §144 change-control template.
- I will **not** silently modify supply, allocations, fee rates, the 65/35 split, Stockback
  economics, curve math, the $2K/$50K anchors, automatic graduation, address permanence, HyperSwap
  routing, LP permanence, creator post-grad fee rights, official xStock pairing, creator identity,
  CREATE2 creator-binding, wallet role separation, Treasury or Founder Profit routing, transaction
  integrity, Stockback claim accounting, canonical venue rules, or admin/security boundaries.
- I will **not** add hidden admin withdrawal paths, arbitrary seizure, premine, transfer taxes,
  blacklists, manual graduation, creator-funded liquidity, forced TOKEN selling, LP principal
  withdrawal, or god-mode governance.
- I will **not** invent addresses, protocol behavior, fee behavior, integrations, or capabilities.
  Unknown external facts stay in the VERIFY ledger until verified against authoritative sources, or
  get marked **BLOCKED** and escalated.
- I will **not** let a mock or placeholder reach a production build (§279).
- I will **not** claim an external audit has passed if it has not completed.
- I will **not** let off-chain state become canonical financial truth.
- I will escalate immediately — pausing the affected stream — when a LOCKED decision must change, a
  VERIFY result contradicts the masterplan, a P0/security issue appears, or economics/custody/
  security would materially change.
- I will not rewrite the masterplan or substitute a preferred architecture for the specified one.

Ordinary CHOOSE decisions proceed without waiting for approval, recorded in the decision log.

---

## Awaiting Approval

No production code has been written. On approval, execution begins at **Day 1 / Streams
A+B+C+D+E+H+I** per section 11 above, with the C-06 / C-07 / C-09 / C-12 verifications driven first
because they can invalidate LOCKED behavior.
