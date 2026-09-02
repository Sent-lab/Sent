# MASTER PLAN FINAL — xStock Launchpad on HyperEVM

> **Single source of truth** untuk product vision, economics, UX, graduation, fees, branding, security, dan implementation baseline V1.

## 0. Baseline

| Area | Decision |
|---|---|
| Network | HyperEVM |
| Core pairing | Official / canonical xStocks |
| Starting valuation | **$2,000 reference market cap** |
| Graduation valuation | **$50,000 reference market cap** |
| Total supply | **1,000,000,000 TOKEN** |
| Creator allocation | **0%** |
| Platform/team allocation | **0%** |
| Core pre-grad trading fee | **1% per buy/sell** |
| Stockback contribution target | **+1% BUY / +2% SELL** |
| Target effective pre-grad fee | **2% BUY / 3% SELL** |
| Core fee split | **65% creator / 35% platform** |
| Post-grad venue | **HyperSwap V3** |
| LP principal | **Permanently locked** |
| Vanity address | **Mandatory via CREATE2** |
| Token detail UX | **Real-time trading terminal** |
| Homepage UX | **Conventional launchpad discovery** |

---

# 1. Product Vision

Launchpad permissionless di HyperEVM yang memungkinkan siapa pun meluncurkan fixed-supply token dan memperdagangkannya terhadap **official xStock**.

Creator tidak perlu menyediakan liquidity sendiri, tidak menerima premine, dan dimonetisasi melalui recurring trading-fee revenue.

Token dimulai pada **$2K reference market cap**, diperdagangkan dua arah melalui pre-graduation market, lalu otomatis graduate pada **$50K reference market cap** ke HyperSwap dengan liquidity yang terbentuk dari market activity dan dikunci permanen.

### One-line product

> **Launch for a few dollars, trade against stocks from $2K MC, and graduate automatically at $50K into permanently locked HyperSwap liquidity.**

### Product positioning

- Pure degen / speed-first.
- Permissionless launches.
- Bot-friendly.
- Market-driven.
- Security kuat di layer kontrak, tetapi bukan safety-first / institutional branding.
- xStock pairing adalah diferensiasi utama.

---

# 2. Locked Product Decisions

Semua poin berikut dianggap **locked untuk V1** kecuali ada product-level review baru.

- Launch cost target: **~$1–$2 equivalent + gas**.
- Total supply: **1B fixed TOKEN**.
- Creator allocation: **0%**.
- Platform/team allocation: **0%**.
- Creator tidak wajib menyediakan liquidity.
- Token name dan ticker bebas.
- Duplicate ticker diperbolehkan.
- Quote/pair asset wajib official/canonical xStock.
- Starting valuation: **$2K reference MC**.
- Graduation valuation: **$50K reference MC**.
- Pre-grad market mendukung **buy dan sell**.
- Core pre-grad trading fee: **1%**.
- Stockback contribution target: **+1% BUY / +2% SELL**.
- Target effective pre-grad fee: **2% BUY / 3% SELL**.
- Core fee split: **65% creator / 35% platform**.
- 100% Stockback contribution funds eligible holders in the official paired xStock.
- Creator's locked 65% share of the core fee is not reduced by Stockback.
- Creator boleh membeli tokennya sendiri dengan rule yang sama seperti trader lain.
- Graduation otomatis dan seamless.
- HyperSwap menjadi venue post-graduation.
- LP principal permanent-lock.
- Vanity contract-address branding wajib via CREATE2.
- Homepage seperti launchpad pada umumnya.
- Token-detail page seperti real-time trading terminal.
- Token yang tidak pernah graduate tidak memiliki forced expiry.

---

# 3. Creator Launch Flow

Creator experience harus sesingkat mungkin.

1. Connect wallet.
2. Isi:
   - token name;
   - ticker;
   - image/logo;
   - pilih official xStock pair.
3. Optional:
   - description;
   - X/Twitter;
   - Telegram;
   - website.
4. Frontend/backend mencari **CREATE2 salt** untuk vanity token address.
5. Creator melihat preview vanity address dan fixed launch parameters.
6. Creator membayar launch fee kecil + gas.
7. `LaunchpadFactory`:
   - deploy TOKEN;
   - register creator;
   - register xStock pair;
   - create/register `LaunchMarket`;
   - emit `TokenLaunched`.
8. Token langsung live di pre-grad market pada **$2K reference MC**.

Creator **tidak melakukan liquidity deposit**.

---

# 4. Vanity Contract Address — Mandatory Branding

Setiap token launch menargetkan suffix/pattern hexadecimal khas brand melalui **CREATE2**.

Flow:

`Launch form -> salt grinder -> preview address -> creator confirm -> Factory deploy via CREATE2`

Rules:

- Vanity suffix adalah **branding**, bukan authenticity proof.
- Authenticity tetap berasal dari Factory registry / `TokenLaunched` event.
- Factory wajib memverifikasi salt menghasilkan predicted address yang benar.
- Recommended V1 suffix: **4–5 hexadecimal characters**.
- Token address tetap sama sebelum dan sesudah graduation.

---

# 5. Token Rules

Setiap launch token:

- Supply fixed **1,000,000,000 TOKEN**.
- Creator allocation = **0%**.
- Platform/team allocation = **0%**.
- One-time genesis mint.
- Tidak ada mint path setelah genesis.
- Tidak ada transfer tax.
- Tidak ada blacklist.
- Tidak ada max-wallet gimmick.
- Tidak ada owner mint.
- Tidak ada creator trading toggle.
- Tidak ada upgradeable token proxy.
- Name/ticker bebas dan boleh duplicate.
- Contract address adalah canonical token identity.

Creator yang ingin memiliki TOKEN harus membeli melalui market seperti trader lain.

---

# 6. Official xStock Pair Policy

Token identity permissionless, tetapi **quote asset canonical**.

Rules:

- Creator memilih xStock dari supported official list.
- Creator tidak memasukkan arbitrary quote-token address.
- Ticker TOKEN boleh sama dengan ticker xStock.
- Contoh `NVDAx / NVDAx` diperbolehkan selama dua contract address berbeda dan sisi quote adalah official NVDAx.
- Fake token yang hanya memakai nama/ticker xStock tidak dianggap xStock resmi.
- Existing market pair fixed pada saat launch.
- Registry update boleh menambah xStock baru atau memblokir xStock untuk **new launches**.
- Registry tidak boleh menjadi alat confiscation atau forced-close market existing.

---

# 7. Pre-Graduation Market

Sebelum graduation, trading berjalan melalui `LaunchMarket` / Launchpad Router.

User mental model tetap normal:

`quote -> slippage -> buy/sell -> receive output`

User tidak perlu memahami bonding mathematics.

Rules:

- Buy dan sell dua arah menggunakan xStock pair.
- Starting reference MC = **$2K**.
- Pricing V1 = **deterministic linear pre-grad curve**.
- Current curve state — bukan cumulative volume — menentukan progress.
- Jika market naik lalu dump, graduation progress ikut turun.
- Tidak ada hidden 20% liquidity deduction.
- Tidak ada claim-after-buy.
- Tidak ada mandatory cooldown.
- Tidak ada whitelist.
- Token yang tidak graduate tetap tradable di pre-grad market.

---

# 8. Curve Baseline V1

V1 menggunakan curve linear dalam selected xStock quote unit.

Karena xStock sendiri volatile terhadap USD, curve di-anchor menggunakan **launch-time xStock/USD reference snapshot**. Dengan begitu, product anchors `$2K -> $50K` tetap menjadi reference-valuation path tanpa harus diam-diam menukar setiap trade melalui stablecoin.

Definitions:

```text
S  = 1,000,000,000 TOKEN
P0 = starting TOKEN price dalam xStock unit
PG = 25 x P0
P(q) = P0 + kq
q = TOKEN sold dari launch reserve
```

Graduation endpoint dipilih supaya curve collateral dan remaining-token value balance pada final marginal price:

```text
qG = (2 x PG x S) / (P0 + 3 x PG)
```

Karena `PG / P0 = 25`:

```text
qG / S = 50 / 76 ~= 65.7894737%
```

Reference outcome pada graduation:

| Metric | Reference outcome |
|---|---:|
| Supply distributed | ~657.895M TOKEN |
| Supply remaining | ~342.105M TOKEN |
| Reference curve collateral | ~$17,105 equivalent |
| Reference initial LP TVL | ~$34,211 equivalent |

Maknanya:

- sekitar **65.79% supply** sudah berada di market melalui net buys/sells;
- sekitar **34.21% supply** tersisa untuk HyperSwap LP;
- tidak dibutuhkan creator liquidity top-up;
- tidak dibutuhkan treasury top-up;
- tidak ada unexplained leftover reserve;
- core trading fee **dan seluruh Stockback contribution** berada **di luar curve collateral**.

Exact Solidity fixed-point representation dan rounding direction tetap implementation-level.

---

# 9. Buy Semantics

User memberikan:

- `xStockIn`;
- `minTokensOut`;
- deadline.

Execution:

1. Ambil gross xStock input.
2. Pisahkan **1% core trading fee**.
3. Core fee dibukukan **65% creator / 35% platform**.
4. Pisahkan **target 1% Stockback contribution** untuk HolderRewardVault.
5. Sisa net xStock masuk ke curve accounting.
6. Curve menghitung exact TOKEN output.
7. State di-update sebelum external transfer.
8. TOKEN dikirim ke buyer.
9. Buyer mulai memperoleh time-weighted Stockback exposure setelah balance TOKEN ter-update.
10. Jika order mencapai endpoint graduation, graduation otomatis dimulai.

Locked V1 target effective BUY fee = **2%** sebelum slippage/price impact.

Economic simulation is a mandatory validation gate. It does **not** authorize an implementation agent to change the rate. If this locked rate fails the approved market-quality/economic criteria, implementation is **BLOCKED** and must be escalated as a new product decision.

Tidak ada hidden liquidity deduction dari order user.

---

# 10. Sell Semantics

User memberikan:

- `tokenIn`;
- `minXStockOut`;
- deadline.

Execution:

1. Curve menghitung gross xStock output dengan bergerak mundur dari current state.
2. **1% core trading fee** dipotong dari gross output.
3. Core fee dibukukan **65% creator / 35% platform**.
4. **Target 2% Stockback contribution** dipotong dan diarahkan ke HolderRewardVault.
5. `curveCollateral` dikurangi berdasarkan curve liability, bukan raw contract balance.
6. Seller menerima net xStock output.
7. Sold TOKEN berhenti menambah time-weighted exposure setelah sell; remaining TOKEN terus eligible.

Locked V1 target effective SELL fee = **3%** sebelum slippage/price impact.

Economic simulation is a mandatory validation gate. It does **not** authorize an implementation agent to change the rate. If this locked rate fails the approved market-quality/economic criteria, implementation is **BLOCKED** and must be escalated as a new product decision.

Sell tersedia selama status `PRE_GRAD` dan berhenti permanen setelah `GRADUATED`.

---

# 11. Trading Fees & Creator Economics

Recurring creator/deployer revenue adalah **core product requirement**.

## Pre-grad

```text
CORE TRADING FEE
1.00%
-> 65% creator
-> 35% platform

STOCKBACK CONTRIBUTION TARGET
BUY  +1.00%
SELL +2.00%
-> 100% eligible holders
-> paid in official paired xStock
```

Target effective user fee:
- BUY: **2%**
- SELL: **3%**

The Stockback rates above are the **locked V1 product baseline**. Economic simulation must validate them before production; simulation failure blocks release and requires explicit product re-decision rather than silent engineering adjustment. Creator/platform split applies only to the core 1% fee.

## Post-grad

HyperSwap protocol economics berlaku terlebih dahulu.

Bagian LP fee revenue yang menjadi hak position launchpad:

```text
creator-eligible LP fee revenue
-> 65% creator
-> 35% platform
```

Creator revenue tidak bergantung pada ownership LP principal.

Rules:

- Creator tidak mendapatkan privileged inventory.
- Creator boleh self-buy/self-sell hanya melalui market normal.
- Creator tidak mendapatkan special pricing.
- Fee menggunakan accrued accounting + pull claim.
- Failed creator claim tidak boleh brick trading.
- Fee-right tidak boleh berubah menjadi LP-principal withdrawal right.

Product wording post-grad:

> **Creator receives 65% of creator-eligible fee revenue.**

Bukan klaim 65% dari seluruh raw HyperSwap pool fee.

---

# 12. Accounting Separation

Bucket ekonomi wajib dipisahkan secara eksplisit:

```text
curveCollateral
creatorFees
platformFees
stockbackOpenEpoch
stockbackFinalizedUnclaimed
LP principal
```

Hard rule:

> Creator fees, platform fees, dan Stockback obligations adalah liabilities terpisah dari curve collateral, dan tidak boleh pernah dihitung sebagai graduation liquidity.

Raw `balanceOf()` contract tidak boleh digunakan sebagai satu-satunya sumber kebenaran collateral.

Core solvency invariant:

> `curveCollateral` harus merepresentasikan liability curve saat ini, independent dari creator/platform fee balances.

---

# 13. Graduation Threshold

Graduation endpoint:

**$50K reference market cap / 25x launch reference valuation.**

Graduation berdasarkan **current state**, bukan cumulative volume.

Token yang pernah menyentuh $40K lalu dump ke $15K kembali memiliki state/progress sesuai market saat itu.

---

# 14. Instant Graduation Flow

Graduation harus terasa **bablas / seamless**.

Tidak ada tombol manual dari creator atau user.

Normal path:

1. User melakukan buy.
2. Buy mencapai exact graduation endpoint.
3. `LaunchMarket` masuk ke execution path `GRADUATING`.
4. Tidak ada pre-grad state mutation lain selama migration.
5. Remaining TOKEN + exact eligible `curveCollateral` diroute ke `GraduationRouter`.
6. HyperSwap V3 position dibuat pada final curve marginal price.
7. LP position langsung dimasukkan ke permanent-lock/delegation primitive.
8. Fee-right diarahkan ke `FeeVault`.
9. `LaunchMarket` menyimpan pool/position metadata.
10. Migrated `curveCollateral` di-zero sesuai accounting.
11. Status menjadi `GRADUATED`.
12. Emit `Graduated`.
13. Subsequent trading menggunakan HyperSwap.

### Crossing order

Public UX boleh “bablas” melewati graduation dalam satu user flow.

Implementation wajib mempunyai **single user-wide minimum-output bound** supaya blended execution antara final curve segment dan post-grad HyperSwap tidak memberikan output yang lebih buruk dari batas yang diset user.

---

# 15. Price Continuity

Hard invariant:

> **Initial HyperSwap spot price harus match final pre-grad marginal price within defined tick/rounding tolerance.**

Caller tidak boleh memilih arbitrary TOKEN/xStock migration ratio.

Migration ratio harus derived dari deterministic market state.

Tujuannya:

- chart tidak mengalami artificial reset;
- mengurangi free arbitrage dari migration mismatch;
- trader terakhir tidak terkena hidden valuation jump;
- HyperSwap market mulai dari state ekonomis yang konsisten dengan pre-grad market.

---

# 16. Graduation Failure Handling

Normal path tetap mencoba instant graduation di buy yang menyentuh threshold.

Preferred behavior:

- Jika semua critical HyperSwap steps bisa atomic, migration failure **revert seluruh critical transition**.
- Tidak boleh ada status `GRADUATED` jika migration/locking belum lengkap.
- Tidak boleh ada TOKEN atau xStock orphaned akibat partial transition.

Jika dependency eksternal mengharuskan retryable workflow:

- reserves tetap deterministic/escrowed;
- gunakan permissionless `finalizeGraduation()`;
- retry caller tidak memperoleh collateral ownership;
- retry caller tidak memperoleh LP ownership;
- retry caller tidak memperoleh creator rights;
- retry caller tidak memperoleh special economic privilege.

---

# 17. Permanent Liquidity

LP principal setelah graduation harus **permanent**.

Tidak boleh dapat ditarik oleh:

- creator;
- platform;
- admin;
- upgrader;
- fee recipient.

V1 memprioritaskan native HyperSwap lock/delegation primitive jika memenuhi invariants daripada membangun large custom LP wrapper.

No launchpad-controlled `removeLiquidity()` authority setelah permanent lock.

Fee rights tetap hidup dan diarahkan ke `FeeVault`.

---

# 18. xStock Price Reference & USD Display

Trades settle menggunakan selected xStock.

Product anchors tetap ditampilkan sebagai USD-equivalent reference values:

- Start: **$2K reference MC**.
- Graduation: **$50K reference MC**.

Untuk menjaga solvency dan deterministic curve:

- V1 menggunakan launch-time xStock/USD reference snapshot sebagai curve anchor.
- Curve berjalan native dalam selected xStock quote unit.
- UI dapat menampilkan **live USD-equivalent MC** berdasarkan current xStock reference price.
- Reference-price adapter tidak boleh custody user funds.
- Launch creation requires a valid, non-stale launch-time reference snapshot.
- After launch, canonical curve pricing and graduation progress derive from immutable launch anchor + on-chain curve state; a stale live USD display feed must NOT by itself halt buy/sell/graduation.
- Live reference feed is display/monitoring input unless a separately documented operation explicitly depends on it.
- Admin tidak boleh memasukkan arbitrary manual price untuk memaksa graduation.

Exact production oracle/provider tetap implementation-level dan wajib diverifikasi sebelum mainnet.

---

# 19. Lifecycle State Machine

```text
PRE_GRAD -> GRADUATING -> GRADUATED
```

### PRE_GRAD

- LaunchMarket quote/buy/sell aktif.
- HyperSwap belum menjadi normal execution venue.

### GRADUATING

- Transient deterministic migration state atau retry escrow state.
- Tidak boleh ada competing curve-state mutation.

### GRADUATED

- LaunchMarket `buy()` / `sell()` permanently unavailable.
- HyperSwap adalah normal execution venue.

Hard invariant:

> **Exactly one protocol-canonical execution venue exists for each token lifecycle state.**

Because LaunchToken is a freely transferable vanilla ERC-20, the protocol cannot honestly guarantee that third parties will never create unofficial external pools. The invariant applies to protocol-controlled/canonical liquidity and routing:

- PRE_GRAD canonical venue = LaunchMarket;
- GRADUATED canonical venue = stored HyperSwap pool;
- LaunchMarket is permanently disabled after graduation;
- unofficial third-party pools are never treated as canonical graduation/price/accounting sources.

The UI/SDK must label canonical venue/address explicitly.

---

# 20. Contract Architecture V1

## `LaunchpadFactory`

Responsibilities:

- creator entrypoint;
- launch fee;
- CREATE2 vanity token deployment;
- token authenticity registry;
- creator/xStock registration;
- LaunchMarket creation;
- `TokenLaunched` event.

Factory tidak menjadi general custody contract untuk market collateral.

## `LaunchToken`

Minimal immutable ERC-20:

- one-time 1B mint;
- no tax;
- no blacklist;
- no owner mint;
- no proxy;
- no creator admin control.

## `LaunchMarket`

Responsibilities:

- pre-grad curve;
- quote buy/sell;
- execute buy/sell;
- xStock curve collateral custody/accounting;
- graduation threshold detection;
- graduation trigger.

## `FeeVault`

Responsibilities:

- accrued creator fee accounting;
- accrued platform fee accounting;
- pull-based claims;
- custody/control post-grad delegated fee rights/revenue.

## `HolderRewardVault`

Responsibilities:

- custody official paired xStock reserved for Stockback;
- track open-epoch funding;
- track finalized-but-unclaimed obligations;
- verify/execute Stockback claims;
- prevent double claims;
- expose canonical finalized reward state;
- remain isolated from curve collateral and LP principal.

Must NOT:

- control trading;
- control graduation;
- own LP principal withdrawal authority;
- redirect finalized holder obligations.

## `StockbackAccounting / Distribution Layer`

Logical responsibilities:

- compute/reconstruct time-weighted holder exposure;
- exclude deterministic protocol/system addresses and DEX pool balances;
- finalize 24-hour epochs;
- publish deterministic distribution commitment (e.g. Merkle root or equivalent);
- expose public auditable distribution dataset;
- support permissionless/redundant finalization where feasible.

This may be implemented through a combination of on-chain contracts + indexer/service, but the responsibility must exist explicitly.

## `XStockRegistry`

Canonical supported xStock addresses for **new launches**.

## `XStockAssetAdapter`

Logical normalization layer for each supported canonical HyperEVM xStock representation.

Responsibilities:

- normalize transferable wrapper-token units into stable protocol accounting/share units;
- expose conversion back to transferable units;
- account for verified multiplier/rebase/corporate-action mechanics;
- expose asset-health / halted / conversion-validity state where supported;
- prevent raw-token-unit changes from silently corrupting curve collateral, fee liabilities, Stockback obligations, or graduation math.

The adapter may be implemented per asset or through a common verified interface, but normalized accounting behavior is mandatory.

## `ReferencePriceAdapter`

- launch-time xStock/USD snapshot/reference;
- live-price adapter for display/status where required;
- cannot custody user funds.

## `GraduationRouter`

Minimal/stateless migration adapter:

- consume deterministic remaining TOKEN + collateral;
- create/init HyperSwap V3 position;
- verify price ratio;
- permanent lock / delegation;
- route fee-right to FeeVault.

---

# 21. Bot-First Integration

Bots, Telegram trading tools, apps, dan automated traders adalah first-class clients.

Conceptual interface:

```solidity
quoteBuy(token, xStockIn)
buy(token, xStockIn, minTokensOut, deadline)
quoteSell(token, tokenIn)
sell(token, tokenIn, minXStockOut, deadline)
marketState(token)
graduatedPool(token)
```

`marketState()` should expose enough data for:

- lifecycle status;
- curve price;
- reference MC;
- live USD-equivalent MC;
- graduation progress.

Required core event family:

```text
TokenLaunched
Trade
Graduating
Graduated
FeesAccrued / FeesClaimed
StockbackFunded
StockbackCommitmentSubmitted
StockbackRootActivated
StockbackClaimed
```

Exact ABI names/fields may be refined, but downstream consumers must receive equivalent canonical event/state signals.

Bot routes pre-grad trades to LaunchMarket and switches to HyperSwap after graduation.

Ticker is display metadata; token contract address is identity.

---

# 22. Real-Time UX Requirement

**Real-time is mandatory.**

Every trade should update, without manual refresh:

- price;
- chart;
- candle;
- market cap;
- volume;
- recent trades;
- graduation progress;
- holder/state metrics where supported.

On-chain state is source of truth.

Frontend, bot, dan indexer harus converge pada market state yang sama.

---

# 23. Homepage / Discovery UX

Homepage tetap seperti launchpad pada umumnya.

Core sections:

- Trending
- New Launches
- Near Graduation
- Recently Graduated
- Top Volume
- Top Gainers
- Search
- xStock filters
- Create Token CTA

Search:

- name;
- ticker;
- contract address;
- creator wallet.

Token cards tetap scan-friendly:

- logo;
- name/ticker;
- xStock pair;
- MC;
- price change;
- volume;
- graduation progress;
- token age;
- creator;
- PRE-GRAD / GRADUATED badge.

xStock dapat menjadi discovery narrative, misalnya browse semua launches yang dipair dengan NVDAx atau QQQx.

---

# 24. Token Detail Page = Trading Terminal

Token detail page adalah real-time terminal, bukan generic launch page.

Core display:

- name / ticker;
- contract address;
- creator;
- xStock pair;
- status;
- current price;
- market cap;
- price change;
- volume;
- holder count;
- graduation progress.

Central chart:

- real-time candlestick;
- short degen-friendly timeframes;
- continuous history across graduation;
- graduation marker pada chart.

Trading panel:

- Buy / Sell;
- amount;
- expected output;
- slippage;
- price impact;
- fee;
- transaction confirmation.

Additional terminal data:

- recent trades/tape;
- holder list;
- creator label;
- socials;
- token info;
- HyperSwap pool metadata setelah graduation.

Chart history **tidak reset** ketika venue berubah dari LaunchMarket ke HyperSwap.

---

# 25. Mobile UX

Mobile harus tetap trading-first.

Recommended flow:

```text
Chart
-> Price / MC / Graduation
-> Sticky BUY / SELL
-> Bottom-sheet trade form
```

Tidak perlu memaksakan full desktop terminal ke layar mobile.

---

# 26. Creator Profile

Optional product layer yang cocok ditambahkan tanpa mengubah contract economics.

Creator profile berbasis wallet dapat menampilkan:

- launches;
- graduated launches;
- total volume;
- creator fees earned;
- graduation rate.

Ini menjadi reputation layer yang market-driven tanpa memerlukan privileged creator allocation.

---

# 27. Admin / Governance Boundary

## Allowed

Platform boleh:

- add official xStock untuk new launches;
- disable xStock untuk new launches jika perlu;
- maintain metadata/indexing infrastructure;
- update platform fee recipient only through the approved Governance Safe / timelock path; production platform fee recipient defaults to the Treasury Safe.

## Forbidden

Platform/admin tidak boleh:

- mint launch tokens;
- withdraw curve collateral;
- withdraw delegated LP principal;
- change creator existing launch;
- take creator-accrued fees;
- change existing token supply;
- change existing market curve/endpoints;
- change graduation threshold existing launch;
- force arbitrary graduate/ungraduate;
- confiscate user assets melalui registry/admin control.

---

# 28. AUDITCORE Hard Invariants

## Supply

- No mint path setelah one-time genesis mint.
- No privileged unexplained reserve ownership.

## Creator

- Creator receives zero privileged TOKEN inventory.
- Creator self-buy allowed only via normal market execution.
- Creator cannot obtain special price or special fee treatment.

## Collateral

- `curveCollateral` distinct dari creator/platform fee liabilities.
- Creator/platform/admin cannot withdraw curve collateral.

## Sell solvency

- Sell cannot extract more xStock than deterministic curve liability.

## Graduation

- Graduation can complete at most once.
- Critical migration cannot leave partial graduated state.
- Caller-supplied params cannot choose graduation LP price/reserve ratio.

## Price continuity

- Initial HyperSwap price matches final curve marginal price within defined tolerance.

## LP

- LP principal permanently non-withdrawable.
- Fee-right cannot be transformed into principal-withdrawal authority.

## Fee claims

- Claim failure cannot brick buy, sell, graduation, or post-grad trading.
- Reentrancy-safe pull-payment accounting.

## xStock authenticity

- Only canonical registered xStock can be selected as quote asset for new launches.
- Ticker is never authenticity proof.

## Venue exclusivity

- Pre-grad market cannot remain an independently active venue after graduation.

## Vanity authenticity

- Vanity suffix is branding only.
- Factory state/events are authenticity source of truth.

## External calls

- External dependency failure cannot create orphan collateral or partial ownership state.

---

# 29. Failure & Degraded-Dependency Policy

### HyperSwap migration failure

Revert or enter safely retryable deterministic graduation state. Never mark graduated prematurely.

### Creator claim failure

Fee remains accrued. Trading continues.

### Frontend/indexer failure

Contracts remain directly callable.

### Official xStock issue

Block new launches if necessary, but do not introduce arbitrary asset confiscation for existing markets.

### Reference/oracle stale

- If the launch-time snapshot cannot be obtained safely, block the new launch.
- For an already-live market, stale live USD/reference display data is marked delayed/stale but does not stop deterministic curve trading or graduation merely because the display oracle is stale.
- Quote-asset health/multiplier discontinuity is handled separately through the xStock Asset Health Gate.

### Dead token

No forced expiry, forced refund, forced burn, atau treasury subsidy.

---

# 30. Mandatory Test Plan Before Mainnet

## Unit tests

- exact quote/execution equivalence;
- buy/sell inverse behavior within rounding tolerance;
- fee split and claim accounting;
- CREATE2 address prediction;
- registry gating;
- state transition permissions.

## Invariant / fuzz tests

- accounting conservation;
- collateral solvency after arbitrary buy/sell sequences;
- no token mint inflation;
- no double graduation;
- no LP principal withdrawal;
- fee claims cannot affect curve state;
- migration price continuity.

## Adversarial scenarios

- creator self-buy and dump;
- whale buy at low MC;
- whale sell immediately before graduation;
- sniper crossing graduation;
- reentrancy from malicious fee recipient;
- malformed/non-standard ERC-20 behavior;
- HyperSwap migration revert;
- reference adapter failure;
- repeated dust-trade rounding attacks;
- fake xStock attempt;
- arbitrary migration-ratio attempt.

---

# 31. Go-To-Market

Positioning tetap **pure degen**.

Potential messaging:

> **Launch cheap. Trade against stocks. Graduate to HyperSwap.**

atau:

> **Memecoins meet stocks.**

Content strategy:

- reactive;
- meme-driven;
- momentum-based;
- tied to stock/market narratives;
- permissionless feel;
- speed-first.

Permanent LP lock, audit, dan security tetap ada secara teknis tetapi tidak harus menjadi headline marketing.

---

# 32. Legal / Compliance

Tokenized-stock pairing membawa regulatory considerations yang lebih besar daripada generic crypto quote assets.

Sebelum production mainnet launch:

- specialist legal review wajib;
- ToS/restricted-jurisdiction policy perlu disusun;
- frontend-level jurisdiction controls dapat dipertimbangkan;
- regulatory developments perlu dimonitor.

Smart-contract permissionlessness tidak menghilangkan legal/compliance exposure pada operator/front-end/product layer.

---

# 33. Implementation-Level Items Still Open

Poin berikut boleh berubah selama engineering **selama tidak mengubah approved user flow atau core economics**:

- exact Solidity fixed-point representation;
- rounding direction per quote/execution path;
- exact HyperSwap V3 fee tier dan tick spacing;
- exact production xStock reference-price provider;
- LaunchMarket clone vs dedicated deployment strategy;
- exact blended crossing-order implementation;
- final permanent-lock/delegation integration calls;
- post-grad fee collection cadence;
- production multisig/timelock addresses;
- final verified canonical xStock contract list;
- vanity suffix exact brand pattern;
- salt-grinding performance implementation.

Any implementation choice that:

- changes creator economics;
- gives privileged token inventory;
- weakens permanent LP;
- adds hidden trade deductions;
- breaks instant graduation;
- permits collateral extraction;

requires **product-level review**, bukan sekadar engineering decision.

---

# 34. Final User Stories

## Creator

> I pay a small launch fee, choose an official xStock pair, get a branded vanity token address, receive no free token allocation, and earn recurring creator fees when people trade my launch.

## Trader

> I buy or sell the token using the canonical HyperEVM xStock quote asset from a $2K reference starting market cap, transparently contribute to Stockback on canonical pre-grad trades, accrue time-weighted paired-xStock rewards while holding, and can claim finalized rewards without staking. If the market reaches the $50K reference graduation endpoint, it automatically graduates to HyperSwap without changing the token address or resetting chart/reward history.

## Bot / Trading App

> I discover launch events, query deterministic all-in quotes including core fee + Stockback, execute canonical pre-grad buys/sells, query Stockback/claim state, detect graduation programmatically, and switch routing to the canonical HyperSwap pool.

---

# 35. Final End-to-End Flow

```text
CREATOR OPENS LAUNCHPAD
        |
        v
Fill name / ticker / image / official xStock / optional socials
        |
        v
CREATE2 salt grinder -> branded vanity address preview
        |
        v
Creator pays ~$1-$2 equivalent + gas
        |
        v
LaunchpadFactory deploys 1B TOKEN
Creator allocation = 0%
Platform allocation = 0%
        |
        v
PRE_GRAD MARKET LIVE @ $2K REFERENCE MC
        |
        v
Users BUY / SELL using canonical HyperEVM xStock quote asset
        |
        +--> CORE FEE 1%
        |      +--> 65% Creator
        |      +--> 35% Platform
        |
        +--> STOCKBACK TARGET
        |      +--> BUY +1%
        |      +--> SELL +2%
        |      +--> 100% -> HolderRewardVault
        |      +--> 24h TWAB -> paired xStock holder rewards
        |
        v
Real-time market / terminal / Stockback / bot feeds
        |
        v
Current curve state reaches $50K graduation endpoint
        |
        v
INSTANT AUTO-GRADUATION
        |
        +--> Remaining TOKEN
        +--> Exact curveCollateral
        |
        v
HyperSwap V3 position created at final curve price
        |
        v
LP PRINCIPAL PERMANENTLY LOCKED
        |
        v
Fee-right -> FeeVault
        |
        v
GRADUATED
        |
        +--> HyperSwap becomes trading venue
        +--> Same TOKEN address
        +--> Same continuous chart history
        +--> Creator continues earning 65% of creator-eligible LP fee revenue
        +--> Stockback history/claims remain continuous
        +--> Post-grad Stockback uses only verified eligible revenue
```

---

# 36. Major Change From Original Brainstorming Draft

Original brainstorming menggunakan **creator-provided USDC** sebagai sumber liquidity dan direct-to-DEX seed.

Model final menghapus requirement tersebut.

Creator sekarang:

- tidak menyediakan liquidity;
- tidak menerima premine;
- membayar launch fee kecil;
- memperoleh recurring creator fee revenue.

Liquidity graduation berasal dari **market activity / xStock collateral accumulated during pre-grad trading**.

Konsep original yang tetap dipertahankan karena kompatibel:

- xStock pairing;
- permanent liquidity;
- creator fee share;
- pure-degen positioning;
- bot-friendly operation;
- canonical xStock validation.

---

# 37. Reference Integration Notes

Engineering validation sebelumnya menggunakan referensi resmi berikut sebagai integration targets / assumptions yang masih harus diverifikasi kembali saat implementation:

- Hyperliquid HyperEVM / HyperCore interaction documentation.
- HyperSwap V3 contract documentation.
- HyperSwap Burn & Delegate / DelegatedPositionVault documentation.
- HyperSwap protocol fee documentation.

External contract addresses, fee tiers, oracle/provider details, dan integration behavior harus diverifikasi ulang terhadap deployment resmi sebelum production mainnet.

---
---

# 38. UI/UX Product Experience — Core Standard

Website bukan sekadar frontend untuk smart contract. Website adalah **core product, acquisition engine, retention layer, discovery surface, creator workspace, dan trading experience**.

Semua implementasi UI/UX harus tunduk pada standard berikut:

- **Premium**
- **Luxurious**
- **Smooth**
- **Interactive**
- **Real-time**
- **Quant-grade**
- **High-quality**
- **Refined**
- **Clean**
- **Comfortable**
- **Fast**
- **Accessible**
- **Responsive**
- **Consistent**
- **State-aware**
- **Visually sophisticated**
- **Highly polished**

Website tidak boleh terasa seperti generic crypto dashboard, template SaaS, atau launchpad clone dengan skin baru.

Target visual experience:

> **High-end quant terminal × luxury digital product × advanced interactive 3D web experience.**

Premium bukan berarti ramai.

> **Premium berarti setiap detail terasa intentional.**

Real-time bukan berarti noisy.

> **Website harus terasa alive, tetapi tidak pernah terasa chaotic.**

---

# 39. Two Visual Modes

Satu design system harus mampu bekerja dalam dua mode experience.

## 39.1 Experience Mode

Digunakan pada:

- homepage;
- explore;
- creator onboarding;
- launch preview;
- market heat;
- ecosystem discovery;
- milestone moments;
- storytelling sections.

Karakter:

- cinematic;
- spatial;
- immersive;
- interactive;
- expressive;
- high-end 3D;
- scroll-responsive;
- visually memorable.

## 39.2 Trading Mode

Digunakan pada:

- token detail terminal;
- buy/sell;
- chart analysis;
- transaction review;
- portfolio/account views;
- creator analytics.

Karakter:

- focused;
- controlled;
- precise;
- low-distraction;
- fast;
- data-dense;
- quant-grade;
- highly readable.

Rule:

> Ketika user sedang membuat keputusan trading, clarity selalu mengalahkan spectacle.

---

# 40. Design System — Mandatory

Seluruh website wajib menggunakan **single coherent design system**.

Design system harus mendefinisikan:

- typography scale;
- font hierarchy;
- numeric typography;
- spacing grid;
- container widths;
- panel density;
- border treatment;
- corner radius;
- surface elevation;
- opacity system;
- shadows;
- glow rules;
- icon system;
- input states;
- button states;
- tabs;
- dropdowns;
- modals;
- drawers;
- tooltips;
- badges;
- charts;
- tables;
- skeletons;
- empty states;
- loading states;
- error states;
- success states;
- motion timing;
- spring/inertia behavior;
- breakpoints;
- accessibility states.

Tidak boleh ada screen yang terasa seperti dibuat oleh tim/design language berbeda.

---

# 41. Typography & Text Hierarchy

Text harus selalu rapi, tenang, terstruktur, dan mudah discan.

Mandatory rules:

- Heading hierarchy jelas.
- Body text tidak terlalu kecil.
- Secondary text tetap readable.
- Placeholder tidak terlalu faint.
- Numeric data menggunakan tabular figures jika relevan.
- Alignment angka presisi.
- Large values memiliki reserved width untuk mencegah layout shift.
- Decimal precision mengikuti konteks user, bukan raw blockchain precision.
- Long address harus truncation yang konsisten.
- Copy tidak boleh terlalu verbose di trading surfaces.
- Advanced explanation menggunakan tooltip / expandable detail.

Contoh data formatting:

```text
$12,842.38
1.24M
+18.42%
0.82%
0x84...21AF
```

Bukan raw 18-decimal blockchain output.

---

# 42. Microcopy — Mandatory

Microcopy adalah bagian dari perceived product quality.

Semua harus memiliki tone yang konsisten dan premium:

- placeholders;
- helper text;
- tooltips;
- transaction status;
- validation;
- warnings;
- empty states;
- confirmations;
- errors;
- network states;
- graduation states;
- creator states.

Avoid:

```text
Error.
Failed.
No data.
Invalid.
```

Prefer contextual recovery-oriented copy:

```text
Price moved beyond your slippage tolerance.
Refresh quote and retry.
```

atau:

```text
Market data is reconnecting.
Your funds and on-chain position are unchanged.
```

---

# 43. Motion Design System — Advanced / Bespoke

Motion bukan finishing effect. Motion adalah bagian dari design system sejak awal.

Standard motion tidak boleh berhenti pada:

- fade-in;
- basic hover scale;
- generic gradient animation;
- random particles;
- basic glassmorphism;
- card tilt template.

Level yang ditargetkan adalah **bespoke high-end motion system**.

Approved motion capabilities:

- scroll-driven storytelling;
- pinned scroll sequences;
- scroll-scrubbed animation;
- spatial depth;
- perspective transforms;
- 3D composition;
- layered foreground / midground / background;
- physically coherent parallax;
- inertial motion;
- spring behavior;
- magnetic interaction;
- cursor-responsive depth;
- lighting response;
- fluid morph transitions;
- object continuity between sections;
- data-reactive motion;
- market-state-reactive visuals;
- procedural visual fields;
- kinetic typography;
- 3D milestone transitions;
- responsive spatial composition.

Motion harus terasa custom-built, bukan component-library demo.

---

# 44. Scroll-Driven Experience

Scroll boleh menjadi bagian dari interaction model.

Contoh yang diperbolehkan:

- section tetap pinned sementara data layer berubah;
- headline berubah perspective mengikuti scroll progress;
- xStock market visualization berkembang dari abstract data field ke live market view;
- creator flow bergerak dari token concept ke deployed token card;
- market heat scene berubah berdasarkan category yang masuk viewport;
- section dapat morph menjadi section berikutnya tanpa hard visual break.

Rule:

> Scroll-driven motion harus membantu narrative dan hierarchy, bukan menghalangi user mencapai informasi.

Tidak boleh membuat user harus “menonton animasi” sebelum dapat menggunakan website.

---

# 45. 3D & Spatial Interaction

3D diperbolehkan dan didorong jika memberi value.

Examples:

- depth-aware token surfaces;
- 3D market objects;
- spatial market heat;
- subtle volumetric grid;
- parallax data structures;
- perspective token cards;
- spatial graduation transition;
- creator preview scene;
- market-state-responsive scene.

Namun:

- chart readability tidak boleh turun;
- form usability tidak boleh turun;
- input accuracy tidak boleh turun;
- page performance tidak boleh rusak;
- mobile tidak boleh dipaksa menjalankan desktop-grade 3D;
- reduced-motion mode wajib tersedia.

Rule:

> 3D memperkuat experience; 3D tidak boleh menjadi demo teknologi.

---

# 46. Animated Background — Mandatory

Background memiliki motion.

Tetapi bukan basic looping gradient saja.

Background dapat menggunakan:

- procedural data field;
- spatial grid;
- depth layers;
- dynamic lighting;
- soft vector movement;
- market-reactive geometry;
- subtle parallax;
- volumetric depth;
- flow lines;
- data particles;
- abstract market structures;
- contextual 3D elements.

Background dapat merespons:

- scroll;
- pointer position;
- current page;
- market state;
- volume intensity;
- near-graduation state;
- ecosystem selection.

Rules:

- tidak mengganggu chart;
- tidak menurunkan readability;
- tidak menghasilkan layout shift;
- tidak menyebabkan GPU overload;
- motion intensity menurun pada trading pages;
- device capability dapat menurunkan detail;
- prefers-reduced-motion harus dihormati.

---

# 47. Interaction Budget

Tidak semua hal boleh bergerak bersamaan.

Setiap screen harus memiliki hierarchy:

1. **Primary motion** — paling penting.
2. **Secondary motion** — mendukung context.
3. **Ambient motion** — sangat subtle.
4. **Static anchors** — memberi visual stability.

Rule:

> Semakin penting keputusan user, semakin rendah distraction motion.

Contoh:

Homepage hero:
- motion expressive diperbolehkan.

Trading amount input:
- motion harus minimal dan precise.

---

# 48. Button & Control Behavior

Buttons harus terasa tactile dan mahal.

Required:

- smooth hover response;
- controlled depth;
- press feedback;
- clear disabled state;
- clear loading state;
- clear success state;
- focus-visible state;
- touch-friendly size;
- stable width saat text berubah;
- no layout jumping.

Boleh menggunakan:

- magnetic proximity response;
- subtle lighting response;
- spring compression;
- controlled 3D depth;
- animated border geometry;
- state morphing.

Jangan menggunakan efek yang mengurangi readability atau terasa gimmicky.

---

# 49. Homepage / Explore Experience

Homepage harus langsung menunjukkan bahwa market **hidup**.

User tanpa wallet tetap dapat:

- browse;
- search;
- sort;
- melihat real-time market data;
- membuka token terminal;
- melihat creator;
- melihat xStock ecosystem.

Connect wallet baru diperlukan untuk action seperti:

- buy;
- sell;
- launch;
- claim;
- account personalization.

Core homepage sections:

- Trending
- New Launches
- Near Graduation
- Recently Graduated
- Top Volume
- Top Gainers
- Market Heat
- Personalized Home section
- Live Market Pulse
- Real-time Activity Tape

---

# 50. Explore Sorting & Filtering

Explore harus terasa seperti market discovery tool, bukan product catalog.

Primary sort examples:

```text
Trending
Volume
Gainers
New
Near Graduation
Recently Graduated
```

Filter examples:

```text
All xStocks
NVDAx
SPYx
QQQx
...
```

Advanced filter dapat ditambahkan secara progressive disclosure.

Rules:

- default simple;
- power-user controls tidak memenuhi layar;
- sort state deep-linkable;
- filter state responsive;
- state tetap saat user kembali dari token page jika sesuai.

Global command palette **tidak diperlukan**.

Watchlist / smart lists **tidak diperlukan untuk V1**.

---

# 51. Personalized Home — Approved

Personalization muncul setelah wallet/account context tersedia.

Homepage global discovery tetap menjadi foundation.

Personalized blocks dapat menampilkan:

- recently viewed markets;
- recently traded tokens;
- user holdings highlights;
- user launches;
- creator earnings snapshot;
- relevant xStock ecosystem activity;
- recent transaction context.

Personalization tidak boleh membuat homepage menjadi closed personal dashboard.

---

# 52. Market Heat — Approved

Market Heat adalah visual discovery layer untuk melihat ecosystem mana yang sedang aktif.

Data examples:

- xStock ecosystem volume;
- active launches;
- trade velocity;
- buy/sell pressure;
- number near graduation;
- top mover;
- graduation momentum.

Visual harus premium, spatial, dan data-driven.

Tidak boleh berubah menjadi heatmap warna-warni yang noisy.

Market Heat dapat menjadi salah satu signature visual experiences platform.

---

# 53. Live Presence / Market Pulse — Approved

Website harus menunjukkan activity secara subtle.

Examples:

```text
128 traders active
34 launches live
7 near graduation
2 graduated in the last hour
```

Presence tidak harus menyiratkan exact realtime concurrency jika data source tidak mendukungnya; implementation harus jujur pada metric yang digunakan.

Market Pulse harus terasa hidup tanpa menjadi notification noise.

---

# 54. Real-Time Activity Tape — Mandatory

Global activity feed/tape menampilkan recent activity secara real-time.

Examples:

```text
BUY  •  $4.2K  BONKAI / NVDAx  •  0x84...21AF  •  now
SELL •  $870   MOON / SPYx     •  0x12...93CE  •  3s ago
```

Behavior:

- smooth incoming events;
- stable text widths;
- subtle buy/sell distinction;
- clickable event;
- event deep-links ke token;
- no flashing;
- no marquee-style cheap animation;
- graceful overflow;
- mobile-adapted presentation.

Trade tape dapat muncul:

- homepage;
- explore;
- token page;
- creator control center jika relevant.

---

# 55. Token Activity Timeline — Approved

Setiap token memiliki timeline event penting.

Examples:

- launched;
- first trade;
- large trade;
- 25% graduation progress;
- 50%;
- 75%;
- 90%;
- graduation started;
- graduated;
- HyperSwap live.

Timeline membantu user memahami “apa yang terjadi” tanpa membaca raw logs.

---

# 56. Token Detail = Quant-Grade Trading Terminal

Token page adalah core trading experience.

Chart adalah centerpiece.

Required major zones:

- token identity;
- pair;
- market status;
- current price;
- reference MC;
- live USD-equivalent MC;
- volume;
- price change;
- holders;
- graduation progress;
- chart;
- trade panel;
- recent trades;
- activity timeline;
- token metadata;
- creator context;
- venue information.

Trading Mode harus lebih tenang daripada homepage.

---

# 57. Chart System — Mandatory

Chart bukan generic embedded widget.

Chart harus terasa seperti professional trading terminal.

Required:

- real-time candles;
- smooth updates;
- zero chart reset saat graduation;
- graduation marker;
- current venue indicator;
- volume;
- smooth crosshair;
- polished tooltip;
- responsive resizing;
- precise price axis;
- stable time axis;
- appropriate decimals;
- consistent color semantics;
- keyboard/touch-friendly interaction where applicable.

Supported timeframes dapat mencakup:

```text
1s
5s
1m
5m
15m
1h
4h
```

Exact set dapat disesuaikan engineering/data capacity.

Optional advanced controls melalui progressive disclosure:

- Price / MC toggle;
- volume visibility;
- chart settings;
- display density;
- selected overlays jika akhirnya diperlukan.

Chart controls yang matang adalah **mandatory**.

---

# 58. Graduation Real-Time Milestone Moments — Mandatory

Graduation progress harus benar-benar live.

Milestone states dapat mencakup:

- 25%
- 50%
- 75%
- 90%
- 100%
- GRADUATING
- GRADUATED

Motion:

- subtle state change;
- progress animation;
- controlled lighting/depth shift;
- activity event;
- chart marker;
- badge update;
- possibly spatial graduation scene.

Saat 100%:

```text
GRADUATING
```

lalu:

```text
GRADUATED • Now trading on HyperSwap
```

Tanpa page reload.

Graduation experience harus memorable tetapi tetap premium, bukan casino-confetti.

---

# 59. Buy / Sell UX

Trading flow harus sesingkat mungkin.

Trade panel menampilkan:

- You pay;
- You receive;
- selected asset;
- expected output;
- price impact;
- fee;
- slippage;
- current venue;
- review / submit action.

Advanced details dapat collapse.

No hidden fee.

Transaction preview harus mudah dibaca dalam beberapa detik.

---

# 60. Transaction Review & Recovery

Sebelum critical action, user mendapat compact review.

Example:

```text
You Pay
1.25 NVDAx

Expected Receive
18.42M TOKEN

Trading Fee
1.00%

Price Impact
0.82%

Route
LaunchMarket
```

Error recovery harus actionable:

- slippage fail -> Update Quote;
- wrong network -> Switch Network;
- stale quote -> Refresh;
- RPC issue -> Retry;
- transaction rejected -> Return to Trade;
- graduation state changed -> Requote on new venue.

---

# 61. Transaction Center — Approved

User memiliki centralized transaction context.

States:

- Pending
- Confirming
- Confirmed
- Failed
- Replaced / superseded jika implementation memerlukannya

Transaction center:

- tidak blocking;
- accessible dari account/header;
- context tetap ada saat user pindah page;
- deep-link ke relevant token;
- dapat menunjukkan explorer link jika tersedia.

---

# 62. Persistent Trading Context — Approved

Important settings tidak reset secara random.

Preserve where appropriate:

- slippage preference;
- chart timeframe;
- selected amount preset;
- panel state;
- layout customization;
- advanced/simple mode;
- recently selected xStock;
- transaction context.

Persistence dapat menggunakan local device state dan/atau account state sesuai implementasi.

---

# 63. Session Resilience — Approved

Refresh, reconnect wallet, pindah tab, atau temporary network interruption tidak boleh membuat user merasa “kehilangan state”.

Preserve where safe:

- chart timeframe;
- layout;
- selected token;
- form amount draft jika aman;
- slippage;
- pending transaction state;
- creator draft metadata where appropriate.

Never silently resubmit a transaction.

---

# 64. Dashboard / Account

Dashboard harus terasa seperti **personal trading cockpit**, bukan admin panel.

Top-level examples:

- Portfolio Value
- 24h P&L
- Creator Earnings
- Claimable Fees
- Holdings
- Recent Activity
- My Launches

Suggested navigation:

```text
Overview
Holdings
Activity
My Launches
Creator Earnings
Transactions
```

No watchlist required.

---

# 65. Creator Control Center — Mandatory

Creator Control Center adalah salah satu core retention surfaces.

Creator dapat melihat:

- total launches;
- active pre-grad launches;
- graduated launches;
- live token MC;
- token performance;
- live volume;
- total trades;
- current graduation progress;
- creator fees earned;
- creator fees claimable;
- historical fee activity;
- recent token activity;
- share actions;
- token-page shortcut;
- launch-new-token CTA.

Control Center **tidak memberi privileged smart-contract admin powers**.

Ini adalah analytics/workspace, bukan token-control panel.

---

# 66. Serious Creator Launch Preview — Mandatory

Sebelum creator confirm launch, creator melihat bagaimana project tampil secara publik.

Preview modes dapat mencakup:

```text
Token Card Preview
Token Page Preview
```

Show:

- logo crop;
- name;
- ticker;
- xStock pair;
- description;
- socials;
- vanity contract address;
- starting MC;
- graduation MC;
- creator fee share;
- supply;
- creator allocation;
- launch cost;
- public visual identity.

Creator dapat memperbaiki metadata sebelum final confirmation.

---

# 67. Creator Success Loop

Habis launch sukses:

Jangan berhenti pada:

```text
Transaction Confirmed
```

Flow:

```text
Launch Success
-> Open Token Page
-> Open Creator Control Center
-> Share
-> View Live Trading
-> Track Graduation
```

Creator langsung diarahkan ke next useful action.

---

# 68. Premium Share UX — Approved

Share harus cepat dan high quality.

Supported surfaces dapat mencakup:

- Copy Link
- X
- Telegram

Share preview ideally membawa:

- token logo;
- ticker;
- xStock pair;
- MC;
- graduation progress;
- token URL;
- polished preview card.

Share UX adalah bagian acquisition loop.

---

# 69. Deep Links — Mandatory

Important state harus shareable.

Examples:

```text
/token/<address>
/creator/<wallet>
/explore?pair=NVDAx&sort=volume
/market/NVDAx
/account/transactions
```

Exact route syntax implementation-level.

Deep links harus:

- stable;
- shareable;
- load correct state;
- work tanpa previously opened session.

---

# 70. Network & Dependency Status — Approved

Platform harus memiliki elegant status awareness.

Possible statuses:

- Live
- Syncing
- Delayed
- Reconnecting
- Degraded
- xStock unavailable
- HyperSwap dependency issue

Status dapat muncul global atau contextual.

User jangan baru mengetahui dependency bermasalah setelah transaksi gagal.

---

# 71. Latency Awareness — Approved

Real-time UI harus berkomunikasi tentang freshness data.

Examples:

```text
LIVE
SYNCING
DELAYED
RECONNECTING
```

Style:

- subtle;
- consistent;
- not alarmist;
- accessible.

UI tidak boleh pura-pura live ketika feed sudah stale.

---

# 72. Proper Onboarding — Approved

Onboarding tidak boleh menjadi 12-step tutorial modal.

Use contextual onboarding:

- short explanation;
- helper text;
- progressive hints;
- empty-state actions;
- contextual tooltip.

First-time user harus memahami:

1. pilih token;
2. trade menggunakan xStock;
3. token pre-grad;
4. $50K reference endpoint;
5. auto-graduate ke HyperSwap.

Creator harus memahami:

1. create token;
2. pilih xStock;
3. no liquidity deposit;
4. zero creator allocation;
5. creator earns fee revenue.

---

# 73. First 30 Seconds Experience

User baru harus memahami product dalam 30 detik pertama tanpa membaca documentation.

Website harus menjawab:

- Apa ini?
- Market apa yang sedang aktif?
- Token apa yang trending?
- xStock pair apa yang digunakan?
- Bagaimana token graduate?
- Bagaimana mulai trading?
- Bagaimana launch token?

Discovery data tampil sebelum wallet connection.

---

# 74. Progressive Disclosure

Advanced data tidak boleh memenuhi layar default.

Primary information terlebih dahulu.

Secondary/advanced detail muncul melalui:

- tooltip;
- hover;
- expand;
- drawer;
- advanced mode;
- contextual details.

Rule:

> Banyak data boleh. Banyak clutter tidak boleh.

---

# 75. Trust Through Transparency — Mandatory

Transparency bukan safety-first branding.

User harus dapat melihat secara mudah:

- trading fee;
- creator fee share;
- official xStock pair;
- token contract;
- creator identity;
- PRE_GRAD / GRADUATED;
- graduation progress;
- LP locked status;
- current execution venue;
- HyperSwap destination setelah graduation.

Informasi harus jelas tanpa membuat interface menjadi warning dashboard.

---

# 76. Lightweight User & Creator Identity — Approved

Wallet address tetap canonical identity.

Optional readability layer:

- avatar;
- display name;
- ENS-like label;
- shortened wallet;
- creator profile metadata.

Tidak boleh menjadi mandatory identity/KYC layer untuk product UX.

Activity tape dan creator pages dapat menggunakan label ini agar lebih human-readable.

---

# 77. Smart Default States — Mandatory

User harus mendapatkan pengalaman yang bagus tanpa configuration.

Defaults harus dipilih secara sengaja untuk:

- Explore sort;
- xStock filter;
- chart timeframe;
- slippage;
- trade amount presets;
- chart volume visibility;
- panel size;
- layout;
- mobile tab;
- transaction drawer state;
- onboarding hints.

Power user boleh mengubah, tetapi default harus sudah “terasa benar”.

---

# 78. Light Layout Customization — Approved

Token terminal dapat memiliki limited customization.

Examples:

- resize chart / trade tape;
- collapse secondary panels;
- expand chart;
- choose compact / comfortable density;
- remember panel arrangement.

Jangan menjadi Bloomberg-level workspace builder.

Customization tidak boleh merusak responsive behavior.

---

# 79. Premium Data Density — Mandatory

Quant-grade bukan berarti semua data dijejalkan.

High data density dicapai dengan:

- strong hierarchy;
- spacing;
- grouping;
- separators;
- typography;
- precise alignment;
- tabular numerals;
- subdued secondary data;
- progressive disclosure;
- stable widths;
- responsive prioritization.

---

# 80. Zero Layout Shift — Mandatory

Real-time update tidak boleh membuat screen lompat.

Required:

- reserved numeric widths;
- tabular numerals;
- stable card heights;
- stable skeletons;
- reserved icon space;
- fixed metric zones;
- predictable loading placeholders;
- no text reflow karena counters berubah;
- no unexpected modal/page jumps.

CLS/perceived stability adalah bagian quality bar.

---

# 81. Loading / Skeleton Quality

Loading state harus mencerminkan final layout.

Avoid generic spinner as only loading state.

Use:

- chart skeleton;
- token-card skeleton;
- metrics placeholder;
- shimmer very subtle;
- reserved dimensions.

When live data reconnects, preserve previous state where safe daripada menghapus seluruh screen.

---

# 82. Empty State Quality

Empty states tetap terlihat premium.

Examples:

Dashboard tanpa launch:

```text
No launches yet.
Create your first token.
```

Creator fees kosong:

```text
No creator fees yet.
Fees will appear here as your launches trade.
```

Empty state selalu memberi context dan natural next action jika ada.

---

# 83. Performance as UX — Mandatory / Critical

Performance adalah bagian dari design quality.

Website yang cantik tapi lag dianggap gagal.

Mandatory:

- smooth animation;
- fast input response;
- responsive chart;
- low interaction latency;
- optimized data subscriptions;
- efficient DOM rendering;
- virtualize long feeds where necessary;
- GPU-conscious 3D;
- adaptive motion detail;
- lazy-load non-critical visual scenes;
- avoid blocking animation with data processing;
- no heavy animation inside critical trading interactions;
- mobile performance target terpisah dari desktop.

Motion quality harus adaptif terhadap device capability.

---

# 84. Accessibility Without Compromising Luxury — Mandatory / Critical

Accessibility wajib.

Luxury look tidak boleh menjadi alasan:

- contrast rendah;
- text terlalu kecil;
- focus state hilang;
- hover-only controls;
- tiny targets;
- unreadable placeholder;
- color-only meaning;
- motion overload.

Mandatory:

- keyboard navigation where practical;
- clear focus states;
- adequate contrast;
- readable type;
- accessible form labels;
- large enough touch targets;
- semantic controls;
- color + shape/text for buy/sell/status;
- `prefers-reduced-motion`;
- animation alternative state;
- screen-reader-appropriate labels for critical actions.

Reduced motion bukan broken version; harus tetap premium dan coherent.

---

# 85. Responsive Design — Mandatory

Responsive bukan desktop yang diperkecil.

Desktop, tablet, dan mobile memiliki composition sendiri.

## Desktop

- high data density;
- multi-panel terminal;
- richer spatial interactions;
- advanced hover/cursor behavior.

## Tablet

- adaptive panels;
- simplified spatial hierarchy;
- touch-first chart interaction.

## Mobile

Priority:

```text
Chart
-> Price / MC / Graduation
-> Sticky BUY / SELL
-> Trade sheet
-> Activity / Info tabs
```

Rules:

- sticky critical actions;
- bottom-sheet trade form;
- no horizontal page overflow;
- touch-friendly;
- chart remains useful;
- motion complexity automatically reduced if needed;
- no desktop-only hover dependency.

---

# 86. Cross-Device Continuity — Approved

Jika account/wallet context memungkinkan, light preferences dapat mengikuti user.

Examples:

- chart timeframe;
- layout preference;
- display density;
- onboarding dismissed state.

Exact sync mechanism implementation-level.

Critical transactional drafts tidak boleh disinkronkan secara unsafe.

---

# 87. Data Freshness Hierarchy

UI harus membedakan tipe informasi:

- on-chain live;
- indexed;
- calculated;
- estimated;
- reference valuation;
- delayed.

User tidak perlu melihat technical jargon, tetapi consistency harus jelas.

Jika dua metrics memiliki freshness berbeda, UI harus menghindari memberi kesan keduanya update pada timestamp yang sama jika tidak benar.

---

# 88. Visual Hierarchy for Urgency

Urgency harus digunakan dengan discipline.

States yang boleh mendapat stronger emphasis:

- high price impact;
- near graduation;
- graduation in progress;
- stale data;
- wrong network;
- tx pending;
- tx failed;
- dependency degraded.

Tidak boleh semua card menggunakan bright urgency colors.

---

# 89. Milestone & Market-State Reactive Visual System

Visual dapat berubah sesuai state nyata.

Examples:

- near graduation -> ambient intensity naik sedikit;
- large trade -> tape highlight;
- market heat -> ecosystem panel berubah activity level;
- HyperSwap graduation -> spatial transition;
- degraded feed -> motion sedikit menurun + status indicator;
- high velocity market -> data field lebih aktif secara subtle.

Motion harus data/state-aware, bukan random.

---

# 90. Error Recovery UX

Semua error state penting harus memiliki next action.

Examples:

| Problem | Recovery |
|---|---|
| Slippage exceeded | Update Quote |
| Wrong network | Switch Network |
| Quote stale | Refresh Quote |
| RPC failure | Retry |
| Wallet disconnected | Reconnect |
| Graduation happened mid-flow | Re-route / Requote |
| HyperSwap unavailable | Show safe current state |
| Data feed delayed | Continue with freshness indicator |

Error copy harus memberi tahu user apa yang berubah dan apa yang tetap aman jika relevant.

---

# 91. Design QA Acceptance Criteria

Screen dianggap **belum selesai** jika masih memiliki:

- inconsistent spacing;
- misalignment;
- clipping;
- overflow;
- poor mobile behavior;
- lag;
- unreadable text;
- wrong hierarchy;
- bad empty states;
- abrupt loading;
- janky animation;
- layout shift;
- inconsistent button states;
- poor focus states;
- inaccessible controls;
- random placeholder copy;
- chart glitches;
- stale-state ambiguity;
- broken deep links;
- inconsistent error language.

Every screen harus diuji untuk:

- desktop;
- tablet;
- mobile;
- keyboard;
- touch;
- slow connection;
- reconnect;
- no-wallet;
- wallet connected;
- reduced motion;
- high activity;
- zero activity;
- error state;
- loading state;
- live state.

Polish adalah acceptance criteria, bukan post-launch bonus.

---

# 92. UI/UX Non-Goals

V1 tidak perlu:

- global command palette;
- watchlist;
- smart lists;
- excessive customization;
- social-media feed clone;
- gaming achievements;
- random gamification;
- confetti-heavy casino UX;
- unnecessary onboarding wizard;
- full Bloomberg workspace system.

Setiap tambahan feature harus membuktikan value terhadap:

- discovery;
- trading;
- creator retention;
- market understanding;
- acquisition;
- conversion;
- trust;
- usability.

---

# 93. Final UI/UX Philosophy

## For Trader

> Open the site, understand the market immediately, find something interesting, inspect it like a professional terminal, trade without friction, and always know what the system is doing.

## For Creator

> Launch in minutes, preview exactly how the token will appear, see live market activity, understand creator earnings, track graduation, share the token easily, and return to a premium creator workspace.

## For New Visitors

> The website itself should communicate quality before the user connects a wallet.

## Overall

> **Every screen should answer the user’s next question before they need to ask it.**

> **Every interaction should feel intentional.**

> **Every real-time update should feel alive without becoming noisy.**

> **Every animation should either create meaning, reinforce state, or improve perceived continuity.**

> **When the website needs to impress, it can be cinematic. When the user needs to trade, it becomes precise.**

---

# 94. Final Website Experience Standard

The final website must feel like:

```text
Premium market product
+
Quant-grade trading terminal
+
Luxury digital experience
+
Advanced real-time launchpad
+
Bespoke 3D / spatial interactive web system
+
Creator growth and analytics workspace
```

The UI/UX is a **core competitive advantage**, not a presentation layer added after smart-contract development.

Any implementation team receiving this masterplan should treat the following as product-level requirements:

- premium visual quality;
- advanced motion;
- real-time behavior;
- quant-grade charting;
- responsive layouts;
- accessibility;
- performance;
- consistency;
- creator experience;
- trader experience;
- state transparency;
- deep-linkable discovery;
- polished error/loading/empty states;
- zero layout shift;
- advanced but controlled 3D interaction.

A functional implementation that ignores this quality bar is **not considered complete**.

---
---

# 95. Implementation Handoff Checklist

Bagian ini mencatat semua area yang membutuhkan keputusan implementation agar tim engineering/desain tidak perlu menebak scope dari masterplan.

Tujuan:

> **Product behavior sudah dikunci; implementation detail boleh dipilih oleh tim selama tidak melanggar product rules, economics, UX standard, dan security invariants.**

## 95.1 Smart Contract Implementation

Tim smart-contract perlu menentukan dan memvalidasi:

- exact Solidity fixed-point math;
- rounding direction untuk buy;
- rounding direction untuk sell;
- minimum trade amount;
- dust handling;
- fee rounding;
- curve endpoint integer representation;
- exact `qG` boundary;
- buy yang tepat menyentuh endpoint;
- buy yang melewati endpoint;
- sell behavior dekat lower boundary;
- exact collateral accounting storage;
- accrued fee accounting storage;
- reentrancy protection;
- CEI ordering;
- safe ERC-20 transfer behavior;
- handling token decimals untuk supported xStocks;
- storage layout;
- immutables vs storage;
- event schema final;
- revert/error schema;
- factory authenticity registry;
- per-market deployment strategy;
- minimal clone vs dedicated market deployment;
- CREATE2 init-code hash consistency;
- salt validation;
- launch-fee collection;
- fee recipient governance;
- market state transitions;
- permissionless graduation retry path jika diperlukan;
- emergency dependency handling tanpa privileged fund seizure.

## 95.2 Curve Math Implementation

Implementation team wajib membuktikan:

- quote function dan execution function identik within documented rounding;
- buy/sell tidak menciptakan collateral leak;
- repeated dust trading tidak menciptakan rounding-profit exploit;
- collateral selalu solvent;
- fees tidak pernah ikut dianggap curve collateral;
- endpoint menghasilkan deterministic remaining TOKEN;
- migration reserves balance terhadap target final marginal price;
- no unexpected reserve leftovers;
- no hidden subsidy;
- no hidden haircut.

Deliverable yang diharapkan sebelum production:

- executable curve simulation;
- property tests;
- invariant tests;
- reference vectors untuk quote buy/sell;
- boundary vectors di start, midpoint, near-grad, exact-grad.

## 95.3 xStock Reference-Price Implementation

Tim harus memilih production reference-price strategy.

Harus ditentukan:

- oracle/provider source;
- fallback source jika ada;
- launch-time snapshot method;
- live USD-equivalent display method;
- stale threshold;
- decimal normalization;
- invalid-price behavior;
- update cadence;
- dependency trust model;
- per-xStock configuration;
- behavior jika feed tidak tersedia;
- behavior jika feed stale saat graduation;
- monitoring untuk feed health.

Product constraint:

> Admin tidak boleh bebas memasukkan arbitrary price untuk memaksa state transition.

## 95.4 Official xStock Registry Implementation

Harus ditentukan:

- final canonical xStock contract addresses;
- token decimals;
- symbol/display metadata;
- registry storage;
- add/remove/disable governance;
- timelock policy;
- event schema;
- launch-time pair snapshot;
- treatment existing markets setelah xStock disabled for new launches;
- dependency-health metadata jika dibutuhkan.

Sebelum mainnet, semua address wajib diverifikasi terhadap sumber resmi.

## 95.5 HyperSwap Integration

Tim perlu memverifikasi deployment HyperSwap resmi dan menentukan:

- V3 factory address;
- router address;
- quoter address;
- NonfungiblePositionManager address;
- permanent lock / delegation primitive address;
- exact pool fee tier;
- tick spacing;
- V1 widest/full-range policy and exact supported min/max ticks;
- any alternative range only if permanent-lock compatibility and long-term activity are proven;
- initial price encoding;
- tick rounding;
- pool creation path;
- approval flow;
- position mint flow;
- permanent-lock/delegation flow;
- delegated fee-right custody;
- post-grad fee collection;
- fee collection gas strategy;
- exact migration revert semantics;
- integration fork tests;
- dependency-change monitoring.

No hardcoded integration address masuk production tanpa verification.

## 95.6 Graduation Implementation

Harus dibuktikan end-to-end:

```text
PRE_GRAD
-> exact endpoint
-> GRADUATING
-> migrate reserves
-> create/mint HyperSwap position
-> permanent lock
-> handoff fee rights
-> record pool
-> GRADUATED
```

Required implementation properties:

- can graduate at most once;
- no partial ownership state;
- no orphan TOKEN;
- no orphan xStock;
- no post-grad curve trading;
- migration price matches final curve price within tolerance;
- user slippage protection remains valid for crossing order;
- failed migration cannot silently consume user funds.

Jika atomic migration tidak memungkinkan:

- deterministic escrow;
- permissionless finalize;
- idempotent retry semantics;
- no retry caller privilege.

## 95.7 FeeVault Implementation

Harus ditentukan:

- creator accrued balance model;
- platform accrued balance model;
- post-grad fee-right custody;
- fee collection cadence;
- claim function;
- batch claim if needed;
- failed receiver behavior;
- reentrancy protection;
- recipient update rules jika creator wallet migration feature someday diperlukan;
- accounting events;
- unclaimed fee treatment.

Rule:

> Claim mechanism tidak boleh berada di critical trading path.

## 95.8 CREATE2 Vanity Infrastructure

Frontend/backend infra harus menyediakan:

- salt grinder;
- expected suffix/pattern;
- estimated search complexity;
- worker concurrency;
- client-side vs backend grinding decision;
- prediction endpoint;
- init-code hash versioning;
- deployment replay protection;
- creator preview;
- verification sebelum submit;
- fallback jika target suffix terlalu mahal dicari.

Vanity suffix exact branding masih implementation/branding decision.

## 95.9 Bot / SDK Implementation

Recommended deliverables:

- public ABI;
- TypeScript SDK;
- deterministic quote helpers;
- token discovery helpers;
- launch event parser;
- market-state parser;
- graduation detector;
- HyperSwap routing metadata;
- error-code documentation;
- example Telegram-bot integration;
- example trading-app integration.

Bots harus dapat berfungsi tanpa frontend.

## 95.10 Indexer / Realtime Data Layer

Tim harus menentukan realtime architecture untuk:

- TokenLaunched events;
- Trade events;
- Graduating;
- Graduated;
- FeesClaimed;
- candles;
- volume;
- holders;
- creator stats;
- activity tape;
- market heat;
- graduation progress;
- account activity.

Harus memiliki:

- chain reorg handling;
- reconnect behavior;
- missed-block recovery;
- deduplication;
- timestamp normalization;
- event ordering;
- data freshness metadata;
- source-of-truth policy;
- cache invalidation;
- websocket/subscription strategy;
- fallback polling strategy jika diperlukan.

## 95.11 Chart Data Implementation

Harus ditentukan:

- candle aggregation engine;
- supported timeframes;
- pre-grad trade source;
- post-grad HyperSwap trade source;
- chart history stitching;
- graduation marker generation;
- venue-switch continuity;
- volume aggregation;
- decimal precision;
- historical backfill;
- reorg correction;
- low-liquidity candle behavior;
- zero-trade intervals;
- live candle mutation model.

Core requirement:

> Pre-grad dan post-grad terlihat sebagai satu continuous market history.

## 95.12 Frontend Architecture

Tim frontend dapat memilih framework/stack, tetapi wajib memenuhi:

- SSR/CSR strategy yang sesuai;
- fast first render;
- real-time subscriptions;
- stable layout;
- responsive composition;
- accessible semantic controls;
- route/deep-link support;
- account/session persistence;
- error boundaries;
- dependency status;
- reduced-motion support;
- device capability adaptation;
- transaction state persistence.

Framework choice bukan product decision.

## 95.13 Motion / 3D Technology Stack

Tim visual/engineering harus memilih stack yang mampu mencapai quality bar.

Potential implementation categories:

- WebGL / WebGPU where appropriate;
- Three.js / React Three Fiber or equivalent;
- GSAP-style timeline/scrubbing or equivalent;
- performant spring/inertia system;
- CSS transforms for lightweight interactions;
- shaders/procedural fields for signature scenes;
- worker/off-main-thread calculation when needed.

Exact library tidak dikunci.

Mandatory constraints:

- performance budget;
- reduced-motion fallback;
- mobile fallback;
- no critical trading dependency on heavy 3D;
- graceful degradation;
- no blocking page usability while visual layer loads.

## 95.14 Motion Performance Budget

Engineering/design harus menetapkan measurable budgets untuk:

- FPS target;
- input latency;
- chart interaction latency;
- animation frame cost;
- bundle size;
- shader complexity;
- memory;
- mobile thermal behavior;
- low-end device fallback.

Motion harus dapat menurunkan detail secara adaptif.

## 95.15 UI Component Implementation

Komponen yang wajib memiliki documented states:

- Button;
- Icon Button;
- Input;
- Amount Input;
- Token Selector;
- xStock Selector;
- Tabs;
- Segmented Control;
- Dropdown;
- Modal;
- Drawer;
- Tooltip;
- Toast;
- Transaction Card;
- Token Card;
- Metric Card;
- Table;
- Activity Row;
- Status Badge;
- Progress;
- Chart Toolbar;
- Trade Panel;
- Skeleton;
- Empty State;
- Error State.

Setiap komponen minimal memiliki:

- default;
- hover;
- focus;
- active;
- disabled;
- loading;
- error jika applicable;
- mobile/touch behavior.

## 95.16 Responsive Implementation

Tim harus membuat breakpoint-specific layouts, bukan sekadar scaling.

Harus diuji minimal:

- narrow mobile;
- standard mobile;
- tablet portrait;
- tablet landscape;
- laptop;
- desktop;
- wide desktop.

Chart, trading controls, tables, creator dashboard, dan activity feed harus punya fallback composition yang jelas.

## 95.17 Accessibility Implementation

Implementation checklist:

- semantic HTML;
- accessible labels;
- focus management;
- keyboard navigation;
- modal focus trap;
- escape behavior;
- screen-reader transaction feedback;
- non-color-only status;
- touch-target sizing;
- contrast audit;
- reduced-motion;
- animated content pause/reduction where needed;
- chart accessibility summary where practical.

Accessibility QA wajib sebelum release.

## 95.18 Performance Implementation

Harus memiliki performance strategy untuk:

- bundle splitting;
- code splitting;
- image optimization;
- asset compression;
- font loading;
- realtime-feed batching;
- list virtualization;
- chart rendering;
- memoization;
- 3D lazy loading;
- WebSocket reconnect;
- cache strategy;
- server/API response;
- RPC failover where appropriate.

User-perceived speed lebih penting daripada benchmark kosmetik.

## 95.19 Account / Session Implementation

Canonical V1 wallet/account behavior is defined in **Sections 454–493: Wallet, Identity & Transaction-Signing Architecture**.

At minimum implementation must provide:

- non-custodial external-wallet connection;
- EIP-6963 injected-wallet discovery with safe fallback;
- WalletConnect-compatible cross-device/mobile flow;
- HyperEVM chain detection/switching;
- disconnect and account-switch behavior;
- address-bound optional SIWE session for off-chain account/profile features;
- local preferences;
- creator identity metadata;
- pending transaction persistence;
- transaction reconciliation after reload/disconnect;
- multi-tab synchronization;
- smart-wallet/multisig compatibility where standard EVM behavior allows;
- explicit signature/approval/transaction review.

No platform code may silently sign, approve, or submit a transaction.

## 95.20 Creator Metadata Implementation

Harus ditentukan:

- image upload;
- image compression;
- accepted dimensions;
- safe file handling;
- description limits;
- social URL validation;
- metadata storage location;
- editing rules;
- whether metadata can change post-launch;
- audit trail/versioning jika relevant;
- content moderation policy pada frontend/operator layer.

Smart-contract creator identity tidak boleh berubah hanya karena metadata berubah.

## 95.21 Search / Explore Backend

Tanpa global command palette, Explore search tetap membutuhkan:

- token-name search;
- ticker search;
- contract-address search;
- creator-address search;
- xStock filter;
- sort indexes;
- pagination/infinite load;
- ranking definition for Trending;
- volume windows;
- gain windows;
- Near Graduation ranking;
- Recently Graduated ranking.

Trending formula harus documented agar tidak menjadi black-box arbitrary ranking tanpa alasan.

## 95.22 Personalized Home Implementation

Harus ditentukan sumber personalization:

- wallet history;
- recently viewed;
- recently traded;
- user launches;
- creator earnings;
- ecosystem preferences inferred dari activity.

Rules:

- global discovery tetap visible;
- personalization tidak boleh memblok user baru;
- privacy-aware;
- graceful no-history state.

## 95.23 Market Heat Implementation

Harus ditentukan:

- metrics used;
- aggregation window;
- normalization;
- buy/sell pressure calculation;
- active launches metric;
- near-grad metric;
- top-mover logic;
- realtime update cadence;
- visual mapping.

Visual harus merepresentasikan data secara jujur.

## 95.24 Live Presence Implementation

Harus dipilih metric yang benar-benar dapat dihitung.

Potential proxies:

- active wallets in recent window;
- trades in recent window;
- live launches;
- near-grad launches;
- recent graduates.

Jangan menampilkan fake exact concurrency jika infrastructure tidak benar-benar mengukurnya.

## 95.25 Share Card / Social Preview Implementation

Harus dibuat:

- dynamic Open Graph image;
- X preview;
- Telegram preview;
- token logo treatment;
- ticker;
- pair;
- current MC;
- graduation progress;
- canonical URL.

Share preview harus tetap bagus walaupun token image buruk atau tidak ada.

## 95.26 Transaction UX Implementation

Setiap tx flow harus memiliki:

```text
Idle
-> Quote
-> Review
-> Wallet Signature
-> Submitted
-> Pending
-> Confirmed / Failed
```

UI harus reconcile jika:

- user reload;
- chain delayed;
- transaction replacement;
- transaction confirmed di tab lain;
- market graduated sebelum second action;
- quote stale.

## 95.27 Network / Dependency Monitoring

Operator layer perlu monitor:

- HyperEVM RPC;
- websocket/indexer;
- xStock price/reference source;
- supported xStock contract health;
- HyperSwap integration;
- backend API;
- vanity grinder;
- metadata service.

Status system harus dapat memberi user contextual degraded-state message.

## 95.28 Analytics / Product Metrics

Implementation team sebaiknya instrument:

- visits;
- wallet connections;
- token-detail views;
- trade funnel;
- quote -> submit conversion;
- transaction failure reasons;
- launches started;
- launches completed;
- creator preview abandonment;
- share actions;
- graduation rate;
- creator repeat-launch rate;
- dashboard return usage;
- mobile vs desktop;
- performance metrics;
- realtime disconnect rate.

Analytics tidak boleh menjadi alasan mengurangi privacy/security secara berlebihan.

## 95.29 Security Testing

Sebelum production:

- unit tests;
- invariant tests;
- fuzz tests;
- fork tests;
- integration tests;
- adversarial simulations;
- static analysis;
- manual review;
- external audit;
- bug bounty plan.

AUDITCORE focus areas:

- money flow;
- state transitions;
- cross-contract assumptions;
- privilege;
- oracle dependency;
- migration;
- fee accounting;
- LP ownership;
- rounding;
- reentrancy;
- failure recovery.

## 95.30 Frontend Security

Harus memperhatikan:

- wallet-signing clarity;
- transaction simulation if available;
- malicious metadata rendering;
- XSS;
- unsafe URL handling;
- image/content sanitization;
- dependency supply chain;
- phishing-resistant contract display;
- canonical domain;
- CSP where appropriate;
- address-copy correctness;
- fake xStock prevention in UI.

## 95.31 Deployment / Release

Implementation team perlu menyiapkan:

- environments;
- deployment scripts;
- verified contracts;
- source verification;
- config management;
- production contract registry;
- rollback strategy untuk frontend/backend;
- immutable contract-change policy;
- monitoring;
- alerting;
- incident playbook;
- RPC failover;
- domain/DNS security.

## 95.32 Legal / Compliance Implementation

Specialist review perlu menentukan:

- ToS;
- restricted jurisdictions;
- frontend geoblocking jika diperlukan;
- disclosures;
- tokenized-stock-related restrictions;
- operator entity considerations;
- marketing wording;
- data/privacy policy.

Ini wajib diselesaikan sebelum production mainnet exposure yang relevan.

---

# 96. Implementation Deliverables Expected From the Build Team

Build team idealnya menyerahkan:

1. **Architecture document**
2. **Final contract interfaces**
3. **Curve simulation**
4. **Smart-contract source**
5. **Foundry test suite**
6. **Invariant/fuzz report**
7. **HyperSwap fork-test report**
8. **xStock registry verification**
9. **Oracle/reference-price design**
10. **Frontend design system**
11. **Responsive layouts**
12. **Motion/3D specification**
13. **Accessibility QA report**
14. **Performance QA report**
15. **Indexer/realtime architecture**
16. **Chart aggregation specification**
17. **Bot/SDK documentation**
18. **Deployment runbook**
19. **Monitoring/incident runbook**
20. **Security audit findings + fixes**
21. **Stockback economics/sensitivity simulation**
22. **Stockback TWAB + cumulative distribution specification**
23. **Stockback attestor/root-publication threat model**
24. **xStock normalized-accounting / multiplier integration report**
25. **HyperSwap V3 graduation geometry report**
26. **Canonical venue / unofficial-pool behavior specification**

---

# 97. Product Rules That Implementation May Not Change

Implementation team **tidak boleh** mengubah poin berikut tanpa explicit product approval:

- creator menyediakan liquidity;
- creator mendapat premine;
- platform mendapat token allocation;
- 1B fixed supply;
- 1% **core** pre-grad trading fee;
- 65/35 creator/platform split of the core fee;
- Stockback is protocol-standard for V1 canonical pre-grad trades;
- Stockback reward asset is the canonical paired xStock quote asset;
- Stockback uses 24h time-weighted holder accounting with no staking;
- Stockback rate is locked at +1% BUY / +2% SELL for V1; economic simulation remains a mandatory GO/NO-GO validation gate and does not authorize autonomous engineering retuning;
- the production Stockback rate selected for a market is snapshotted and immutable after that market launches;
- creator's locked 65% core-fee entitlement cannot be reduced to fund Stockback;
- official xStock-only quote asset;
- $2K reference starting valuation;
- $50K reference graduation endpoint;
- buy + sell pre-grad;
- no forced expiry;
- seamless auto-graduation;
- same token address across lifecycle;
- HyperSwap post-grad target;
- permanent LP principal;
- creator continues post-grad fee revenue;
- mandatory vanity CREATE2 branding;
- bot-friendly deterministic interfaces;
- real-time terminal experience;
- premium / luxury / quant-grade UI quality;
- responsive design;
- accessibility;
- performance;
- zero layout shift;
- advanced motion / spatial quality bar;
- no privileged admin fund extraction.

Jika engineering limitation tampak memerlukan perubahan salah satu poin di atas, issue harus dinaikkan sebagai **product decision**, bukan diam-diam diubah dalam implementation.

---

# 98. Final Handoff Rule

Masterplan ini adalah **single source of truth untuk intent produk**.

Tim implementasi bertanggung jawab untuk:

- memilih teknologi;
- membuktikan math;
- memverifikasi external dependencies;
- mengoptimalkan performance;
- memenuhi security invariants;
- memenuhi UI/UX quality bar;
- mendokumentasikan deviation.

Jika terdapat konflik antara convenience implementation dan locked product behavior:

> **Locked product behavior menang sampai product owner secara eksplisit mengubah keputusan tersebut.**

---
---

# 99. Branding & Naming — Optional but Recommended

Bagian ini belum mengunci nama final brand, tetapi memberi arah agar branding konsisten dengan product positioning.

## 99.1 Brand Personality

Brand harus terasa:

- premium;
- sharp;
- modern;
- fast;
- quant-grade;
- confident;
- degen-aware;
- culturally current;
- visually refined;
- tidak childish;
- tidak corporate-boring;
- tidak terlalu institutional.

## 99.2 Naming Direction

Nama ideal:

- pendek;
- mudah diingat;
- mudah dibaca;
- mudah diketik;
- domain/social-handle friendly;
- tidak terlalu generic;
- punya potensi menjadi verb/community reference;
- compatible dengan premium visual language.

Avoid:

- nama terlalu panjang;
- nama terlalu mirip exchange/DEX besar;
- nama yang hanya terdengar seperti meme sesaat;
- nama yang membuat positioning terlalu safety-first;
- nama yang terlalu dekat dengan trademark existing.

## 99.3 Vanity Address Brand Suffix

Exact hexadecimal suffix masih optional branding decision.

Criteria:

- recognizable;
- visually distinctive;
- realistic untuk CREATE2 grinding;
- tidak terlalu panjang;
- mudah menjadi signature brand.

Recommended exploration:

- 4 hex chars;
- 5 hex chars jika performance grinder memadai.

Suffix tetap **branding only**, bukan authenticity proof.

---

# 100. Logo & Visual Identity System — Optional but Recommended

Logo system sebaiknya dibuat sebagai scalable identity system, bukan satu static mark.

Potential deliverables:

- primary wordmark;
- compact symbol;
- favicon/app icon;
- monochrome variant;
- light/dark variant;
- motion logo;
- loading-state logo animation;
- social avatar;
- social header;
- token-share watermark;
- creator card watermark.

## 100.1 Visual Identity Direction

Visual identity harus kompatibel dengan:

- dark premium UI;
- quant terminal;
- spatial motion;
- 3D scenes;
- high contrast;
- dense market data;
- mobile iconography.

Avoid logo yang terlalu detail sehingga gagal pada 16–24 px.

## 100.2 Motion Identity

Brand motion dapat memiliki signature:

- logo reveal;
- data-line formation;
- spatial extrusion;
- controlled light sweep;
- geometric morph;
- market-state pulse.

Motion identity harus konsisten dengan website motion system.

---

# 101. Color & Material Direction — Optional Creative Layer

Exact palette belum perlu dikunci di masterplan, tetapi system harus memiliki:

- neutral dark foundation;
- premium surface hierarchy;
- controlled accent;
- clear positive/negative trading semantics;
- status colors;
- accessible contrast;
- non-neon default environment.

Avoid:

- rainbow gradient everywhere;
- excessive neon;
- over-glowing surfaces;
- low-contrast grey text;
- red/green sebagai satu-satunya meaning.

Material language dapat menggunakan:

- depth;
- glass-like transparency;
- subtle reflectivity;
- precision borders;
- controlled blur;
- dynamic lighting.

Tetapi harus terasa bespoke, bukan template glassmorphism.

---

# 102. Tagline & Copy Direction — Optional

Potential messaging direction:

> **Launch cheap. Trade against stocks. Graduate to HyperSwap.**

> **Memecoins meet stocks.**

> **Launch fast. Trade live. Graduate on-chain.**

> **Stock-paired launches, built for speed.**

Final tagline belum dikunci.

## 102.1 Copy Tone

Copy harus:

- concise;
- confident;
- modern;
- direct;
- degen-aware;
- understandable;
- non-corporate;
- non-cringe.

Avoid:

- jargon overload;
- fake institutional language;
- exaggerated security promises;
- “guaranteed” wording;
- overly meme-heavy copy pada critical trading surfaces.

---

# 103. Marketing Landing Narrative — Optional

Jika homepage memiliki storytelling layer sebelum/di sela discovery market, narrative dapat mengikuti urutan:

```text
What it is
-> Why xStock pairing is different
-> Launch in a few clicks
-> Trade live
-> Earn as creator
-> Graduate automatically
-> Market already moving
```

Storytelling tidak boleh menghalangi user yang ingin langsung masuk market.

Fast path ke Explore/Trade selalu tersedia.

---

# 104. GTM Campaign Framework — Optional

Go-to-market dapat dikembangkan sebagai separate execution plan, tetapi baseline masterplan:

## 104.1 Launch Phase

- stealth / controlled awareness;
- creator seeding;
- crypto-native social distribution;
- X / Telegram focus;
- market-timing around stock narratives;
- creator-driven launches;
- real-time graduation clips.

## 104.2 Content Style

Content:

- reactive;
- visual;
- real-time;
- meme-aware;
- data-aware;
- market-event-driven.

Examples:

- “NVDA moving? Launch against NVDAx.”
- graduation clips;
- live market heat screenshots;
- creator earnings milestones;
- real-time trade activity;
- new-stock-pair announcements.

## 104.3 Distribution Loops

Potential loops:

```text
Creator launches
-> shares premium token card
-> traders arrive
-> activity tape / market heat increases
-> token nears graduation
-> milestone content shared
-> graduation creates new content
-> creator earns fees
-> creator launches again
```

---

# 105. Creator Acquisition Strategy — Optional

Creator acquisition sangat penting karena creator adalah supply-side growth engine.

Potential creator value proposition:

- launch cheap;
- zero liquidity deposit;
- zero premine requirement;
- recurring creator fee share;
- premium public token page;
- creator control center;
- realtime analytics;
- share-ready assets;
- automatic HyperSwap graduation.

Possible programs:

- early creator spotlight;
- creator leaderboard;
- featured launches;
- ecosystem themes;
- referral experiments;
- creator analytics summaries.

Tidak boleh memberi creator privileged on-chain inventory hanya untuk growth.

---

# 106. Trader Acquisition & Retention — Optional

Trader value proposition:

- unique xStock-paired markets;
- fast discovery;
- real-time terminal;
- transparent fees;
- smooth buy/sell;
- clear graduation;
- advanced realtime data;
- premium mobile experience.

Retention drivers:

- market activity;
- near-grad opportunities;
- creator ecosystem;
- real-time events;
- market heat;
- personalized home;
- quality charting;
- transaction reliability.

---

# 107. Analytics KPI Framework — Optional but Useful

Product analytics sebaiknya memiliki KPI hierarchy.

## 107.1 Acquisition

- unique visitors;
- wallet connections;
- token-page views;
- creator landing visits;
- source/referral;
- social-share traffic.

## 107.2 Activation

Trader:

- first token viewed;
- first quote;
- first buy/sell;
- wallet-connect-to-trade conversion.

Creator:

- create flow started;
- preview reached;
- launch submitted;
- launch completed.

## 107.3 Market Health

- daily launches;
- active launches;
- graduated launches;
- graduation rate;
- total volume;
- median volume per launch;
- buy/sell balance;
- unique traders;
- repeat traders;
- xStock-pair distribution.

## 107.4 Creator Economics

- total creator fees;
- median creator fee earned;
- creator repeat-launch rate;
- percentage creators with repeat activity;
- fees per graduated token;
- creator claim frequency.

## 107.5 Retention

- D1/D7/D30 trader retention;
- creator return rate;
- repeat launches;
- repeat trades;
- dashboard return usage;
- personalized-home engagement.

## 107.6 UX / Reliability

- transaction failure rate;
- slippage failure rate;
- quote latency;
- chart reconnect rate;
- RPC error rate;
- realtime disconnect rate;
- Core Web Vitals / equivalent;
- mobile crash/error rate.

Exact KPI targets belum dikunci.

---

# 108. Success Criteria — Optional Product-Level Framework

Potential V1 success indicators:

- creators dapat launch tanpa bantuan manual;
- trader memahami pre-grad/graduation flow tanpa documentation;
- creator fee accounting berjalan otomatis;
- graduation berhasil secara reliable;
- UI realtime stabil;
- chart continuity bekerja;
- mobile trading usable;
- transaction failure messaging jelas;
- returning creator behavior muncul;
- market activity dapat ditemukan dari Explore tanpa external explanation.

Success bukan hanya “contract deployed”.

---

# 109. Support & Help Strategy — Optional

Support experience harus sesuai premium product bar.

Potential surfaces:

- compact Help Center;
- contextual FAQ;
- transaction troubleshooting;
- wallet/network troubleshooting;
- creator launch FAQ;
- graduation explanation;
- fee explanation;
- xStock pair explanation;
- official contract / links page.

Avoid intrusive support widgets di trading terminal.

## 109.1 FAQ Topics

Suggested:

- What is an xStock pair?
- Why does the token start at $2K reference MC?
- What happens at graduation?
- Can creators withdraw liquidity?
- How do creator fees work?
- Can creators buy their own token?
- Why is my transaction pending?
- Why did my quote change?
- What does GRADUATING mean?
- Where does trading happen after graduation?
- How do I verify an official launch token?
- What happens if an xStock is temporarily unavailable?

---

# 110. Documentation Strategy — Optional

Public docs dapat dibagi:

## User Docs

- trading basics;
- graduation;
- fee model;
- creator launch guide;
- account/dashboard;
- transaction troubleshooting.

## Developer Docs

- contracts;
- ABIs;
- SDK;
- bot integration;
- events;
- market-state interfaces;
- HyperSwap transition logic.

## Security Docs

- contract verification;
- canonical addresses;
- admin boundaries;
- LP-lock explanation;
- audit reports;
- bug bounty.

Masterplan tetap source of truth untuk product intent; docs adalah public presentation layer.

---

# 111. Status / Transparency Page — Optional

Public status page dapat menampilkan:

- HyperEVM connectivity;
- indexer;
- realtime feed;
- HyperSwap integration;
- reference-price services;
- metadata service.

Historical incidents dapat dipublikasikan jika operator memilih transparency model tersebut.

Status page tidak menggantikan contextual in-app latency/dependency indicators.

---

# 112. Incident Communication — Optional

Jika terjadi degraded service:

Communication harus:

- factual;
- specific;
- short;
- timestamped;
- non-alarmist;
- clear apakah on-chain funds affected atau hanya frontend/data layer.

Example:

```text
Realtime charts are delayed.
On-chain trading remains available.
We are resyncing market data.
```

Avoid vague:

```text
Something went wrong.
```

---

# 113. Legal Wording / Disclosure Layer — Optional Placeholder

Exact wording harus dibuat dengan specialist legal counsel.

Potential disclosure areas:

- xStock/tokenized-equity nature;
- jurisdiction restrictions;
- platform role;
- no investment advice;
- token launch risks;
- creator-generated content;
- smart-contract risk;
- market volatility;
- third-party dependency;
- HyperSwap dependency;
- price/reference methodology;
- front-end availability.

No legal copy should make unverified claims.

---

# 114. Privacy & Data Handling — Optional

Jika product menyimpan off-chain preferences/analytics:

Need policy untuk:

- wallet-linked analytics;
- cookies/local storage;
- personalization data;
- creator metadata;
- IP/geolocation if legal controls require it;
- retention period;
- third-party analytics;
- deletion requests where applicable.

Minimize unnecessary personal data collection.

Wallet address sendiri bersifat public-chain identifier dan tetap harus diperlakukan dengan care di off-chain profile/analytics context.

---

# 115. Content Moderation / Metadata Policy — Optional

Permissionless token launch dapat menghasilkan abusive metadata.

Frontend/operator layer perlu menentukan policy untuk:

- hate/illegal imagery;
- impersonation;
- phishing URLs;
- malicious external links;
- NSFW content;
- trademark impersonation;
- scam metadata.

Important distinction:

> On-chain token existence dan frontend discoverability/moderation adalah dua hal berbeda.

Moderation tidak boleh menjadi hidden ability untuk seize user funds.

---

# 116. SEO / Discoverability — Optional

Public token/creator/xStock ecosystem pages dapat dibuat indexable jika product strategy menginginkan organic discovery.

Potential SEO surfaces:

- token pages;
- creator pages;
- xStock ecosystem pages;
- graduated markets;
- educational explainers.

Need:

- canonical URLs;
- metadata;
- social previews;
- structured data if useful;
- fast server rendering or equivalent discoverability strategy.

---

# 117. Social Preview System — Optional but High-Leverage

Setiap public page idealnya menghasilkan visual preview berkualitas tinggi.

Token preview:

- token logo;
- ticker;
- pair;
- current MC;
- graduation progress;
- status;
- brand mark.

Creator preview:

- creator label;
- launches;
- volume;
- graduated count.

xStock ecosystem preview:

- pair name;
- active launches;
- top movers;
- market heat snapshot.

Visual preview harus tetap premium dan consistent.

---

# 118. Brand Asset Toolkit — Optional

Untuk creator/community distribution, platform dapat menyediakan:

- token-share cards;
- graduation cards;
- creator earnings cards;
- xStock ecosystem cards;
- launch announcement templates;
- short motion clips;
- embed cards.

Assets harus generated dari realtime data jika memungkinkan dan tidak menampilkan stale metrics tanpa timestamp/context.

---

# 119. Future Roadmap — Optional / Not V1 Locked

Potential future exploration:

- additional official xStocks;
- more creator analytics;
- advanced market filters;
- APIs/data subscriptions;
- institutional-grade historical datasets;
- richer creator profiles;
- more sophisticated chart tools;
- social graph;
- referral system;
- notification system;
- native mobile app;
- additional DEX routing;
- creator collaboration features;
- ecosystem-level analytics.

Tidak ada item roadmap ini yang otomatis menjadi V1 requirement.

---

# 120. V1 Scope Discipline

Walaupun masterplan lengkap, V1 harus tetap disiplin.

V1 harus memprioritaskan:

1. secure launch;
2. deterministic pre-grad trading;
3. creator fee economics;
4. graduation reliability;
5. permanent liquidity;
6. realtime market data;
7. premium trading UX;
8. premium creator UX;
9. responsive/performance/accessibility;
10. reliable discovery.

Optional branding/marketing/support systems dapat dirilis bersamaan jika tidak mengganggu core reliability.

Rule:

> Jangan korbankan reliability core market demi tambahan cosmetic feature.

---

# 121. Final Optional Layer Principle

Optional sections di masterplan bukan berarti harus langsung dibangun semuanya pada hari pertama.

Mereka dicatat supaya:

- future team tidak perlu brainstorming ulang;
- brand direction tetap konsisten;
- GTM tidak bertentangan dengan product behavior;
- analytics tidak dilupakan;
- support/legal/privacy tidak muncul terlambat;
- roadmap punya context.

Implementation priority tetap mengikuti locked core product behavior.

---

---

# 122. Execution Contract for Build Teams & AI Coding Agents

Bagian ini menentukan **cara masterplan harus dieksekusi**, bukan hanya apa yang harus dibangun.

Tujuan:

> Jika dokumen ini diberikan ke Claude, coding agent, engineer, designer, atau build team lain, mereka harus dapat langsung bekerja dengan urutan yang benar, tanpa mengubah locked product behavior secara diam-diam.

## 122.1 Mandatory Handoff Instruction Block

Setiap agent/team yang menerima masterplan ini harus:

1. Baca seluruh masterplan sebelum implementasi.
2. Jangan redesign locked economics.
3. Jangan mengubah creator fee, supply, graduation, LP permanence, atau xStock rules untuk convenience.
4. Kerjakan module-by-module sesuai dependency order.
5. Verifikasi external dependency sebelum hardcode address/ABI/behavior.
6. Jangan mengarang data yang belum diverifikasi.
7. Jika detail implementation-level tidak mengubah product behavior, pilih opsi engineering terbaik dan catat keputusan.
8. Jika keputusan mengubah locked behavior, escalate sebagai product decision.
9. Jangan menandai module selesai hanya karena compile/build berhasil.
10. Gunakan Definition of Done dan acceptance criteria.
11. Pertahankan security invariants.
12. Jangan mengorbankan accessibility/performance untuk visual polish.
13. Jangan mengorbankan trading correctness untuk motion/3D.
14. Simpan decision log.
15. Jalankan end-to-end acceptance scenarios sebelum release.
16. Jangan deploy production dengan unresolved Critical/High security issue.
17. Semua production external addresses wajib verified.
18. Semua realtime state wajib punya freshness/reconnect behavior.
19. Setiap deviation dari masterplan harus documented.
20. Masterplan ini adalah source of truth untuk product intent.

# 123. Decision Hierarchy

Jika terjadi konflik, gunakan urutan:

```text
1. User fund safety
2. Security invariants
3. Locked product economics
4. Trading/accounting correctness
5. Graduation correctness
6. Contract state integrity
7. Accessibility
8. Performance / reliability
9. Core UX behavior
10. Realtime data correctness
11. Visual polish
12. Motion / 3D sophistication
13. Implementation convenience
```

> Implementation convenience selalu berada paling bawah.

# 124. No-Assumption Rule

Jika belum verified, jangan menganggap sebagai fakta:

- HyperSwap contract address;
- canonical xStock address;
- xStock decimals;
- oracle/provider;
- fee tier;
- ABI;
- tick spacing;
- RPC/WebSocket endpoint;
- external protocol behavior.

Gunakan status:

```text
VERIFY BEFORE IMPLEMENTATION
```

atau:

```text
BLOCKED ON EXTERNAL VERIFICATION
```

Source preference:

1. official protocol docs;
2. verified on-chain deployment;
3. official repository;
4. official explorer verification;
5. audited integration reference.

# 125. Build Dependency Order

```text
PHASE 0  External verification
   ↓
PHASE 1  Economics / curve simulation
   ↓
PHASE 2  Core smart contracts
   ↓
PHASE 3  Unit / invariant / fuzz testing
   ↓
PHASE 4  HyperSwap + xStock integration tests
   ↓
PHASE 5  Indexer + realtime data model
   ↓
PHASE 6  SDK / bot interface
   ↓
PHASE 7  Frontend shell + design system
   ↓
PHASE 8  Explore / terminal / trading
   ↓
PHASE 9  Creator flow + control center
   ↓
PHASE 10 Motion / 3D / premium interaction
   ↓
PHASE 11 Accessibility / performance / responsive QA
   ↓
PHASE 12 Security audit / remediation
   ↓
PHASE 13 Production deploy / monitoring
```

> Jangan mulai advanced visual polish sebelum economics, contract state, dan realtime market model terbukti benar.

# 126. Phase 0 — External Verification Gate

Sebelum production coding, verify:

- HyperEVM chain config;
- canonical xStock list;
- xStock decimals;
- official xStock source;
- canonical HyperEVM wrapped-xStock contract for each supported underlying;
- xStock multiplier/share/rebase semantics;
- xStock trading-halted / pending-corporate-action signals;
- normalized quote-unit conversion method;
- HyperSwap compatibility of each quote asset;
- HyperSwap V3 contracts;
- permanent-lock/delegation primitive;
- HyperSwap fee behavior;
- reference-price options;
- explorer;
- RPC/WebSocket availability;
- tooling compatibility.

Deliverable: `verified-integrations.md` atau equivalent.

# 127. Phase 1 — Economics / Simulation Gate

Required sebelum LaunchMarket production:

- executable curve model;
- start/mid/near-grad/exact-grad vectors;
- buy/sell inverse simulation;
- core-fee / Stockback / collateral separation;
- Stockback target-rate sensitivity simulation;
- TWAB/reward conservation simulation;
- normalized xStock quote-unit / multiplier scenarios;
- rounding/dust model;
- crossing-order model including segment-specific fees;
- exact HyperSwap V3 mint geometry at graduation;
- collateral solvency simulation.

Definition of Done:

```text
No unexplained reserve drift
No hidden subsidy
No fee/collateral mixing
No Stockback/collateral subsidy
No dust-profit loop
Normalized xStock accounting survives multiplier/corporate-action scenarios
Deterministic graduation reserves compatible with exact V3 mint math
```

# 128. Core Contract Build Order

```text
LaunchToken
→ XStockRegistry
→ XStockAssetAdapter / normalized xStock accounting
→ FeeVault
→ HolderRewardVault
→ Stockback accounting/distribution primitives
→ Curve math/library
→ LaunchMarket
→ LaunchpadFactory
→ GraduationRouter
→ ReferencePriceAdapter
```

# 129. Definition of Done — LaunchToken

Selesai jika:

- exactly 1B supply;
- one-time mint;
- no post-genesis mint;
- no owner privilege;
- no blacklist / no transfer tax / no proxy;
- normal ERC-20 transfer;
- metadata correct;
- CREATE2 prediction test passes.

# 130. Definition of Done — XStockRegistry

Selesai jika:

- canonical addresses configurable melalui approved governance;
- invalid/duplicate cases handled;
- disable-for-new-launch works;
- existing markets unaffected;
- events emitted;
- no seizure power;
- governance-boundary tests pass.

# 131. Definition of Done — FeeVault

Selesai jika:

- creator/platform accounting separate;
- exact 65/35;
- pull claims;
- failed claim tidak brick market;
- reentrancy safe;
- post-grad fee intake supported;
- fee rights tidak expose LP principal;
- arbitrary claim-order invariant passes.

# 131A. Definition of Done — HolderRewardVault / Stockback Distribution

Selesai jika:

- official paired xStock funding only;
- open-epoch and finalized-unclaimed accounting separate;
- TWAB inputs reproducible;
- deterministic system-address exclusions enforced;
- DEX pool balance excluded;
- 24h epoch boundary deterministic;
- finalized distribution commitment immutable under normal operation;
- public distribution dataset reproducible;
- claim proof verification correct;
- double claim impossible;
- no-expiry finalized liability accounting works;
- dust rolls forward;
- zero-eligible-holder pool carries forward;
- vault solvency invariant passes;
- claim failure cannot brick trading/graduation;
- reorg/finality policy tested;
- xStock rebase/corporate-action behavior verified per supported asset.

# 132. Definition of Done — LaunchMarket

Selesai jika:

- quoteBuy/execution parity;
- quoteSell/execution parity;
- buy/sell broad range;
- core-fee / Stockback / collateral separation exact;
- target Stockback BUY/SELL routing tested;
- collateral solvent;
- arbitrary sequence invariants pass;
- creator has no special path;
- PRE_GRAD enforcement;
- endpoint deterministic;
- graduation only once;
- reentrancy safe;
- dust loops unprofitable;
- fuzz suite passes.

# 133. Definition of Done — GraduationRouter

Selesai jika:

- ratio derived from state;
- caller cannot choose LP price;
- HyperSwap initial price matches endpoint within tolerance;
- exact remaining TOKEN/collateral;
- position creation passes integration/fork tests;
- permanent lock proven;
- fee-right routed correctly;
- failure safe/retry deterministic;
- no orphan assets;
- no double migration.

# 134. Definition of Done — Factory / Vanity Deployment

Selesai jika:

- launch fee correct;
- CREATE2 prediction exact;
- invalid salt rejected;
- authenticity registry correct;
- creator/pair fixed;
- LaunchMarket connected;
- events indexer-ready;
- creator receives zero premine;
- gas profiled.

# 135. Definition of Done — ReferencePriceAdapter

Selesai jika:

- production source verified;
- decimals normalized;
- stale detection;
- invalid-price behavior;
- launch snapshot reproducible;
- no custody;
- no arbitrary manual override;
- stale/zero/extreme tests pass.

# 136. Core Contract Acceptance Scenario

Mandatory E2E:

```text
Creator launch
→ creator gets 0 TOKEN
→ user A buys
→ user B buys
→ user A sells
→ creator self-buys normally
→ whale buys
→ whale sells
→ market recovers
→ buys approach graduation
→ crossing buy
→ graduation
→ LP created
→ LP locked permanently
→ FeeVault gets fee rights
→ LaunchMarket disabled
→ HyperSwap trading active
→ creator claims fee
→ platform claims fee
```

Expected:

- no accounting leak;
- no privilege;
- no price discontinuity beyond tolerance;
- no double venue;
- no unlock path.

# 137. Priority Framework — P0 / P1 / P2

## P0 — Launch Blocker

- correct contracts;
- curve solvency;
- fee accounting;
- Stockback fee routing;
- HolderRewardVault solvency;
- TWAB correctness;
- epoch finalization;
- claim correctness;
- distribution reproducibility;
- official xStock validation;
- graduation;
- permanent LP;
- creator post-grad fees;
- tests;
- integration verification;
- realtime trade/token data;
- token terminal;
- buy/sell UX;
- create flow;
- responsive core;
- critical accessibility;
- transaction recovery;
- monitoring;
- security review.

## P1 — Premium Public Product

- Personalized Home;
- Creator Control Center;
- Market Heat;
- Activity Tape;
- advanced chart controls;
- creator preview;
- share UX;
- transaction center;
- milestone motion;
- onboarding;
- deep links;
- zero-layout-shift polish;
- premium motion system;
- advanced desktop spatial interaction.

## P2 — Can Follow

- richer analytics;
- additional visual scenes;
- more share-card variants;
- broader SEO content;
- expanded public docs;
- richer cross-device sync;
- roadmap extras.

# 138. Source-of-Truth Map

| Domain | Source of Truth |
|---|---|
| Token authenticity | LaunchpadFactory state/events |
| Official xStock | XStockRegistry + verified canonical deployment |
| xStock normalized accounting / multiplier state | XStockAssetAdapter + verified canonical asset mechanics |
| Token supply | LaunchToken |
| Lifecycle | LaunchMarket |
| Curve collateral | LaunchMarket accounting |
| Creator/platform fees | FeeVault |
| Stockback open-epoch funds | HolderRewardVault accounting |
| Stockback finalized entitlement | Finalized distribution commitment + HolderRewardVault |
| Stockback claim state | HolderRewardVault |
| Stockback estimated accrual | Derived/indexed TWAB estimate; never canonical claim state |
| Graduation | LaunchMarket + Graduated event |
| Post-grad venue | Stored HyperSwap pool |
| LP state | HyperSwap position + lock primitive |
| Pre-grad trades | LaunchMarket events/state |
| Post-grad trades | HyperSwap pool events |
| Chart | Derived from canonical trades |
| Homepage metrics | Derived/indexed |
| Creator analytics | Derived/indexed |
| UI | Representation only |
| Vanity authenticity | Factory registry, not suffix |

# 139. Recommended Repository Map — Minimum Logical Shape

This earlier map is the minimum logical separation. **Section 411 Reference Production Technology Stack contains the authoritative expanded V1 monorepo layout and supersedes this abbreviated map where they differ.**

```text
/
├── contracts/
│   ├── src/
│   ├── test/
│   └── script/
├── apps/
│   └── web/
├── packages/
│   ├── sdk/
│   ├── ui/
│   ├── config/
│   └── types/
├── services/
│   ├── indexer/
│   └── api/
├── tests/
│   └── e2e/
├── docs/
└── ops/
    ├── monitoring/
    └── deployment/
```

# 140. Configuration Registry

Centralize:

- chain ID;
- RPC/WebSocket;
- explorer;
- Factory;
- Registry;
- XStockAssetAdapter / per-xStock normalization config;
- FeeVault;
- HolderRewardVault;
- Stockback distribution/finalizer config;
- GraduationRouter;
- HyperSwap contracts;
- xStock addresses/decimals;
- reference feeds;
- platform fee recipient;
- API/indexer endpoints.

No random production addresses scattered through source.

# 141. Environment Matrix

## Local
Mocks, fixtures, local tests.

## Fork / Integration
Real external behavior where tooling permits.

## Staging
Real frontend/realtime stack with controlled config.

## Production
Verified deployments, governance, monitoring, immutable config records.

# 142. Decision Log Template

```text
Decision ID:
Date:
Area:
Decision:
Alternatives Considered:
Reason:
Security Impact:
UX Impact:
Product Impact:
Reversible?:
Owner:
Verification/Test:
```

# 143. Known Unknowns Register

```text
UNKNOWN:
WHY IT MATTERS:
CURRENT ASSUMPTION:
HOW TO VERIFY:
BLOCKS:
OWNER:
STATUS:
```

# 144. Change-Control Rule

```text
Change:
Previous Decision:
New Decision:
Reason:
Economic Impact:
Security Impact:
UX Impact:
Migration Impact:
Approved By:
Date:
```

Locked product behavior tidak boleh berubah hanya lewat code diff.

# 145. Versioning Rule

Recommended:

```text
Masterplan v1.x — clarification / implementation detail
Masterplan v2.x — product-level behavior change
```

Agent harus mencatat masterplan version yang dipakai.

# 146. Observability Requirements

Monitor:

- RPC health;
- WebSocket health;
- indexer lag;
- event delay;
- missed-block recovery;
- quote latency;
- tx failure rate;
- graduation success/failure;
- graduation retries;
- fee collection failures;
- Stockback finalization lag/failure;
- HolderRewardVault solvency;
- Stockback claim failures;
- distribution-root publication freshness;
- reference-price freshness;
- API latency;
- frontend errors;
- chart reconnects.

Critical condition wajib alert.

# 147. Smart Contract Release Gate

Tidak boleh production jika ada:

- unresolved Critical;
- unresolved High tanpa explicit acceptance;
- invariant failure;
- fuzz failure;
- migration integration failure;
- unverified canonical address;
- LP lock unproven;
- fee mismatch;
- double-graduation path;
- unexplained collateral drift;
- Stockback vault insolvency;
- invalid/reproducibility failure in finalized distribution;
- claim double-spend path;
- unresolved post-grad Stockback behavior.

# 148. Frontend Release Gate

Critical flows wajib lulus:

- wallet connect;
- network switch;
- create;
- quote;
- buy;
- sell;
- graduation display;
- post-grad rerouting;
- creator fee claim;
- Stockback claim;
- Estimated vs Claimable Stockback state;
- Stockback claim reconciliation;
- tx reconciliation;
- mobile core trading;
- reconnect;
- stale-data status;
- critical accessibility.

# 149. UI/UX Release Gate

Before broad public launch:

- no major layout shift;
- no clipping/overflow;
- mobile usable;
- chart responsive;
- reduced motion usable;
- focus visible;
- touch targets valid;
- contrast valid;
- loading/error/empty states complete;
- motion never blocks action;
- 3D adapts to capability;
- creator preview correct;
- activity feed stable at high volume;
- milestone state reliable.

# 150. Performance Release Gate

Measure:

- first meaningful render;
- interaction latency;
- route transition;
- chart FPS;
- scroll FPS;
- 3D FPS;
- memory;
- realtime feed throughput;
- mobile thermal/performance;
- reconnect time.

> Jika motion merusak trading/chart performance, kurangi motion.

# 151. Security Review Workflow

```text
Developer self-review
→ static analysis
→ unit tests
→ fuzz/invariant tests
→ AUDITCORE manual threat review
→ fork/integration tests
→ external audit
→ remediation
→ regression tests
→ deploy gate
```

# 152. AI Coding Agent Working Protocol

## Before Work

Agent:

- reads masterplan;
- identifies current phase;
- inspects repository;
- reads decision log;
- reads known unknowns;
- verifies current config.

## During Work

Agent:

- works in small modules;
- preserves invariants;
- writes tests with implementation;
- avoids unrelated refactors;
- documents external assumptions;
- updates decision log.

## After Each Module

Agent reports:

```text
Implemented:
Tests:
Invariants Checked:
Files Changed:
External Assumptions:
Known Remaining Issues:
Next Dependency:
```

## Agent Must Not

- silently alter economics;
- silently add admin powers;
- silently remove accessibility;
- weaken xStock validation;
- change graduation silently;
- use mock address as production;
- mark TODO as complete;
- bypass failing tests.

# 153. End-to-End Product Acceptance

## New Trader

```text
Open without wallet
→ understand product
→ Explore
→ sort/filter
→ open token
→ inspect realtime chart
→ connect
→ review buy
→ buy
→ see transaction center
→ live chart/activity update
→ sell partially
→ refresh
→ state preserved
```

## Creator

```text
Connect
→ Create
→ fill metadata
→ select xStock
→ preview card/page
→ preview vanity address
→ launch
→ token live
→ control center updates
→ share
→ watch activity
→ graduation
→ creator continues earning
→ claim fee
```

## Graduation

```text
Near endpoint
→ milestone live
→ crossing trade
→ GRADUATING
→ migration
→ permanent lock
→ GRADUATED
→ chart continuous
→ HyperSwap active
→ stale pre-grad form gone
```

# 154. Failure Acceptance Scenarios

Must test:

- RPC disconnect;
- indexer delay;
- reverting creator fee recipient;
- HyperSwap migration revert;
- stale reference price;
- browser reload during tx;
- graduation while user's page is stale.

Normal recovery must not require unsafe manual intervention.

# 155. Handoff Package Recommendation

```text
Masterplan
Decision Log
Known Unknowns
Verified Integration Addresses
Architecture Diagram
Contract ABIs
Deployment Registry
Test Reports
Audit Report
SDK Docs
API/Indexer Docs
Design System
Motion Spec
Monitoring Runbook
Incident Runbook
Environment Config Guide
```

# 156. Final Build Team Definition of Success

Build berhasil jika:

1. Locked economics preserved.
2. Contract invariants proven.
3. Graduation reliable.
4. LP permanently locked.
5. Creator revenue works pre/post-grad.
6. Bots integrate deterministically.
7. Realtime data works.
8. Chart continuity works.
9. Creator workflow effortless.
10. Trader workflow fast and precise.
11. UI meets premium/quant-grade quality.
12. Motion meets bespoke high-end bar.
13. Accessibility works.
14. Mobile works.
15. Performance strong.
16. Failure states recover safely.
17. Production observable.
18. External dependencies verified.
19. No hidden admin/fund extraction.
20. Documentation sufficient for another team.

# 157. Final Execution Principle

> **The masterplan defines intent. Tests prove correctness. Monitoring proves production health. Design QA proves experience quality.**

A build is not complete because:

```text
“It compiles.”
```

A build is complete only when:

```text
It behaves correctly
+ survives adversarial cases
+ preserves economics
+ feels premium
+ remains accessible
+ performs reliably
+ can be operated and maintained
```

---

---

# 158. Public Roadmap — Website Feature

Website wajib memiliki **public roadmap** yang terasa premium, hidup, dan transparan.

Roadmap bukan sekadar daftar quarter atau janji marketing. Ia harus menjadi product-development surface yang menunjukkan apa yang:

```text
LIVE
BUILDING
NEXT
EXPLORING
```

## 158.1 Roadmap Status Model

### LIVE

Fitur yang sudah tersedia secara public/production.

Contoh:

- Core Launchpad
- Official xStock Pairing
- Pre-Grad Buy/Sell
- Auto Graduation
- HyperSwap Routing
- Creator Fee Revenue
- Real-Time Token Terminal

### BUILDING

Fitur yang aktif dikerjakan dan sudah committed.

Contoh:

- Advanced Creator Analytics
- Improved Mobile Terminal
- Expanded Market Heat
- Performance/Latency Improvements

### NEXT

Fitur committed yang akan dikerjakan setelah current build queue.

Contoh:

- Additional Official xStock Pairs
- Expanded Creator Control Center
- Advanced Market Data Views

### EXPLORING

Ide yang sedang dipertimbangkan tetapi **belum dijanjikan**.

Contoh:

- Native Mobile App
- Advanced Data API
- Additional DEX Routing
- More Creator Collaboration Features

Rule:

> Jangan mengubah item EXPLORING menjadi implied promise.

---

# 159. Roadmap Visual Experience

Roadmap tidak boleh tampil seperti generic SaaS timeline.

Target experience:

- premium;
- spatial;
- interactive;
- scroll-responsive;
- high-end;
- clean;
- readable;
- motion-rich without noise.

Potential interaction:

```text
LIVE
  ↓
BUILDING
  ↓
NEXT
  ↓
EXPLORING
```

Saat user scroll:

- visual depth berubah;
- roadmap rail/progression bergerak;
- item masuk dengan controlled perspective;
- state transition mengikuti scroll;
- background/motion field ikut berubah;
- typography tetap stable dan readable;
- mobile menggunakan simpler vertical flow.

Roadmap dapat menggunakan:

- pinned sequence;
- spatial progression;
- animated route/rail;
- controlled 3D depth;
- state-aware glow/material shift;
- smooth section morphing.

Tetapi:

- user tidak boleh dipaksa menunggu animasi;
- accessibility tetap prioritas;
- reduced-motion version wajib;
- performance budget tetap berlaku.

---

# 160. Roadmap Item Detail

Setiap roadmap item dapat dibuka untuk melihat detail.

Recommended fields:

```text
Title
Status
Short Description
Why It Matters
Who It Helps
Dependencies
Last Updated
```

Optional:

- related changelog entry;
- related product surface;
- linked docs.

Avoid:

- fake completion percentage;
- fake ETA;
- arbitrary countdown;
- vague “coming soon” forever.

Jika progress percentage ditampilkan, harus berasal dari internal measurable milestone yang benar.

---

# 161. Roadmap Placement

Recommended:

- dedicated `/roadmap` route;
- compact homepage teaser;
- footer/navigation link;
- optional Creator Control Center shortcut if relevant.

Homepage teaser cukup menunjukkan:

```text
Live
Building
Next
```

Tidak perlu membawa seluruh roadmap ke homepage.

---

# 162. Changelog / Product Updates — Website Feature

Website juga sebaiknya memiliki **Changelog / Updates**.

Roadmap menjawab:

> Apa yang akan datang?

Changelog menjawab:

> Apa yang baru selesai?

Recommended route:

```text
/updates
```

atau:

```text
/changelog
```

---

# 163. Changelog Entry Structure

Setiap update dapat memiliki:

```text
Date
Title
Short Description
Affected Surface
Optional Visual
Optional Link
```

Example:

```text
Sep 02
Improved Real-Time Trade Tape

Trade activity now updates with lower visual latency and smoother event transitions across Explore and token pages.
```

atau:

```text
Aug 28
New NVDAx Market Heat View

Explore can now surface activity across NVDAx-paired launches using live volume and graduation momentum.
```

---

# 164. Changelog UX

Changelog harus:

- clean;
- chronological;
- fast to scan;
- premium;
- shareable;
- deep-linkable.

Optional visual features:

- subtle animated timeline;
- expanding update cards;
- before/after preview;
- short motion clip;
- linked roadmap item.

No noisy notification-wall design.

---

# 165. Roadmap → Changelog Lifecycle

Feature lifecycle:

```text
EXPLORING
→ NEXT
→ BUILDING
→ LIVE
→ CHANGELOG ENTRY
```

Jika fitur masuk LIVE:

- roadmap state diperbarui;
- changelog entry dibuat;
- optional social/share asset dibuat.

Ini membuat roadmap dan product updates tetap konsisten.

---

# 166. Platform Live Stats — Website Feature

Website dapat menampilkan **live platform stats** sebagai proof-of-activity dan market health.

Recommended metrics:

- Total Launches
- Active Pre-Grad Markets
- Graduated Tokens
- Total Trading Volume
- Creator Fees Earned
- Active xStock Pairs
- Recent Graduations
- Recent Trades / Activity Velocity

Optional metrics:

- Unique Traders
- 24h Volume
- 24h Launches
- 24h Graduations

Metrics harus meaningful dan dapat dihitung dengan benar.

---

# 167. Platform Stats UX

Platform stats dapat muncul di:

- homepage;
- roadmap;
- ecosystem page;
- footer summary;
- About/Product section.

Design:

- quant-grade;
- live;
- stable layout;
- smooth number transitions;
- no flashing;
- no large layout shift;
- source/freshness aware.

Number animation:

- subtle count interpolation;
- tabular numerals;
- reserved width;
- no bouncing numbers.

---

# 168. Live Stats Data Integrity

Live stats harus mengikuti source-of-truth rules.

Examples:

| Metric | Source |
|---|---|
| Total Launches | Factory / indexed TokenLaunched events |
| Active Markets | LaunchMarket lifecycle index |
| Graduated Tokens | Graduated events/state |
| Trading Volume | Indexed pre-grad + HyperSwap trade events |
| Creator Fees Earned | FeeVault accounting / indexed events |
| Active xStock Pairs | Registry |
| Recent Graduations | Graduated events |
| Activity Velocity | Indexed trade window |

No fake vanity metrics.

If a metric is estimated/derived:

- label appropriately;
- keep methodology consistent.

---

# 169. Roadmap / Changelog Admin Workflow

Operator/admin tooling may provide content management for roadmap/changelog metadata.

Permitted:

- update roadmap status;
- update descriptive copy;
- add changelog entries;
- attach visuals;
- update last-modified timestamp.

Not permitted:

- change on-chain product behavior through roadmap UI;
- fake protocol stats;
- fake graduation/activity events.

Roadmap content layer and smart-contract state remain separate.

---

# 170. Roadmap Freshness Rules

Roadmap harus dijaga agar tidak menjadi stale.

Recommended rules:

- every BUILDING item reviewed regularly;
- stale items moved/reclassified;
- completed items moved to LIVE;
- abandoned ideas removed or marked clearly;
- changelog records completion.

Avoid roadmap with years-old “coming soon” items.

---

# 171. Homepage Integration

Homepage dapat memiliki a compact section seperti:

```text
PRODUCT PROGRESS

LIVE
Real-Time Trading Terminal

BUILDING
Advanced Creator Analytics

NEXT
Additional xStock Markets
```

CTA:

```text
View Roadmap
```

Section ini harus sekunder terhadap market discovery.

Market tetap menjadi hero experience utama.

---

# 172. Platform Progress Storytelling

Roadmap, changelog, dan live stats dapat bekerja bersama sebagai product trust/growth loop:

```text
User sees live market
→ sees real platform activity
→ sees product actively improving
→ sees shipped updates
→ understands upcoming direction
→ returns later
```

Ini meningkatkan perceived product maturity tanpa mengandalkan institutional/safety-first branding.

---

# 173. Roadmap Motion Acceptance Criteria

Roadmap motion dianggap selesai jika:

- scroll progression smooth;
- readability preserved;
- no scroll hijacking;
- no interaction blocking;
- reduced-motion version works;
- mobile fallback works;
- layout stable;
- deep links work;
- motion fits overall luxury/quant-grade language;
- Roadmap still useful with animation disabled.

---

# 174. Changelog Acceptance Criteria

Changelog dianggap selesai jika:

- chronological order reliable;
- each update deep-linkable;
- update cards responsive;
- no layout shift from media loading;
- search/filter optional but not required;
- copy concise and consistent;
- mobile readable;
- social preview works where implemented.

---

# 175. Live Stats Acceptance Criteria

Live Stats dianggap selesai jika:

- values derive from real data;
- source methodology documented;
- values update reliably;
- stale state detectable;
- reconnect handled;
- zero-layout-shift preserved;
- number formatting consistent;
- mobile layout stable;
- no fake activity simulation.

---

# 176. New Website Navigation Surface

Recommended top-level navigation may include:

```text
Explore
Create
Roadmap
Updates
Account
```

Exact header composition can change with responsive layout.

Roadmap/Updates should not overpower the primary market/trading actions.

---

# 177. Website Growth Surface Principle

Roadmap, Changelog, dan Live Stats adalah **growth/trust surfaces**, bukan core trading dependencies.

Jika salah satu down:

- trading tetap berfungsi;
- creator launch tetap berfungsi;
- on-chain market tidak terganggu.

They must never become critical dependencies for transaction execution.

---

**ROADMAP + CHANGELOG + LIVE PLATFORM STATS APPROVED AS WEBSITE PRODUCT SURFACES.**

---

# 178. Launch Readiness Checklist — Final GO / NO-GO Gate

Bagian ini adalah checklist final sebelum production/mainnet launch.

Tujuan:

> Tidak ada production launch hanya karena “fiturnya kelihatan selesai”. Semua critical product, security, integration, realtime, UX, dan operational checks harus lulus.

Setiap item harus memiliki salah satu status:

```text
PASS
FAIL
BLOCKED
NOT APPLICABLE
```

Rule:

> Jika ada item P0 berstatus FAIL atau BLOCKED, launch = NO-GO.

---

## 178.1 Smart Contract Readiness

- [ ] Production contract source final.
- [ ] LaunchToken supply exactly 1,000,000,000 TOKEN.
- [ ] No post-genesis mint path.
- [ ] No creator premine.
- [ ] No platform token allocation.
- [ ] No hidden admin mint.
- [ ] No blacklist/tax/transfer restriction outside intended ERC-20 behavior.
- [ ] Factory authenticity registry tested.
- [ ] CREATE2 address prediction verified.
- [ ] Launch fee behavior verified.
- [ ] Official xStock-only launch enforcement verified.
- [ ] Pre-grad buy works.
- [ ] Pre-grad sell works.
- [ ] Creator self-buy follows identical market rules.
- [ ] Curve collateral accounting separate from fees and Stockback obligations.
- [ ] Stockback contribution routing verified.
- [ ] HolderRewardVault solvency verified.
- [ ] Creator/platform fee accounting exact.
- [ ] 65/35 fee split verified.
- [ ] Pull-based fee claims verified.
- [ ] Failed fee claim cannot brick trading.
- [ ] Reentrancy protections verified.
- [ ] Lifecycle state transitions verified.
- [ ] Graduation can execute at most once.
- [ ] Pre-grad trading permanently disabled after graduation.
- [ ] No privileged collateral withdrawal path.
- [ ] No privileged LP-principal withdrawal path.

---

## 178.2 Curve / Economics Readiness

- [ ] Curve simulation completed.
- [ ] Starting reference MC matches approved $2K anchor.
- [ ] Graduation reference MC matches approved $50K anchor.
- [ ] Linear curve implementation matches approved model.
- [ ] `qG` endpoint verified.
- [ ] Remaining TOKEN at graduation verified.
- [ ] Curve collateral at graduation verified.
- [ ] Fee buckets excluded from curve collateral.
- [ ] Buy quote/execution parity tested.
- [ ] Sell quote/execution parity tested.
- [ ] Boundary rounding documented.
- [ ] Dust behavior documented.
- [ ] Repeated dust trades do not produce exploitable profit.
- [ ] Arbitrary buy/sell sequences preserve solvency.
- [ ] Crossing-order behavior and segment-specific fee treatment tested.
- [ ] Stockback 1% BUY / 2% SELL target-rate simulation completed or approved production replacement documented.
- [ ] xStock multiplier/rebase normalization scenarios tested.
- [ ] Exact HyperSwap V3 mint math consumes migration reserves within documented dust tolerance.
- [ ] No unexplained reserve drift.
- [ ] No hidden subsidy/haircut.

---

## 178.3 xStock Readiness

- [ ] Canonical supported xStock addresses verified from official sources.
- [ ] Token decimals verified.
- [ ] Symbol/display metadata verified.
- [ ] Registry config matches production contracts.
- [ ] Unsupported/fake xStock pair rejected.
- [ ] Disabled-for-new-launch behavior tested.
- [ ] Existing markets remain valid if pair later disabled for new launches.
- [ ] Reference-price dependency behavior documented.
- [ ] Stale/invalid price behavior tested.
- [ ] No arbitrary manual price override that can force graduation.

---

## 178.4 HyperSwap / Graduation Readiness

- [ ] HyperSwap production addresses verified.
- [ ] Factory/router/quoter/position-manager addresses verified where applicable.
- [ ] Fee tier verified.
- [ ] Tick spacing verified.
- [ ] Initial price encoding tested.
- [ ] Migration reserve ratio deterministic.
- [ ] Caller cannot select arbitrary migration price.
- [ ] Final curve marginal price and initial HyperSwap price match within documented tolerance.
- [ ] Remaining TOKEN migrated correctly.
- [ ] Exact curve collateral migrated correctly.
- [ ] LP position successfully created in integration/fork test.
- [ ] LP principal permanent-lock/delegation path proven.
- [ ] Creator/platform cannot withdraw LP principal.
- [ ] Post-grad fee rights route to FeeVault.
- [ ] Graduation failure behavior tested.
- [ ] No orphan TOKEN.
- [ ] No orphan xStock.
- [ ] No partial graduated ownership state.
- [ ] Retry path permissionless/idempotent if retry exists.
- [ ] Same TOKEN address preserved before/after graduation.

---

## 178.5 Security Readiness

- [ ] Unit test suite passing.
- [ ] Foundry fuzz tests passing.
- [ ] Invariant tests passing.
- [ ] Integration/fork tests passing.
- [ ] Static analysis completed.
- [ ] AUDITCORE manual review completed.
- [ ] External security review/audit completed where required.
- [ ] Audit remediation completed.
- [ ] Regression tests pass after remediation.
- [ ] No unresolved Critical finding.
- [ ] No unresolved High finding without explicit documented acceptance.
- [ ] Money-flow review completed.
- [ ] Privilege review completed.
- [ ] External dependency review completed.
- [ ] Graduation attack scenarios reviewed.
- [ ] Fee-accounting attack scenarios reviewed.
- [ ] Rounding/dust attack scenarios reviewed.
- [ ] Reentrancy scenarios reviewed.
- [ ] LP ownership/withdrawal invariants reviewed.

---

## 178.6 Bot / SDK Readiness

- [ ] Final public ABI exported.
- [ ] `quoteBuy` documented.
- [ ] `buy` documented.
- [ ] `quoteSell` documented.
- [ ] `sell` documented.
- [ ] `marketState` documented.
- [ ] `graduatedPool` documented.
- [ ] TokenLaunched event documented.
- [ ] Trade event documented.
- [ ] Graduating event documented.
- [ ] Graduated event documented.
- [ ] FeesClaimed event documented.
- [ ] Bot can discover tokens by contract address.
- [ ] Bot can detect graduation.
- [ ] Bot can switch routing after graduation.
- [ ] Contract address is canonical identity; symbol is not.
- [ ] `stockbackState` / equivalent documented.
- [ ] Stockback claim/proof flow documented.
- [ ] Stockback events documented.
- [ ] SDK examples execute successfully against target environment.

---

## 178.7 Indexer / Realtime Data Readiness

- [ ] Token launch indexing works.
- [ ] Trade indexing works.
- [ ] Graduation indexing works.
- [ ] Fee claim indexing works.
- [ ] LaunchToken Transfer indexing for TWAB works.
- [ ] Stockback funding/finalization/claim indexing works.
- [ ] Cumulative distribution proof API works.
- [ ] Reorg handling tested.
- [ ] Missed-block recovery tested.
- [ ] Event deduplication tested.
- [ ] Event ordering tested.
- [ ] WebSocket reconnect tested.
- [ ] Fallback behavior tested where implemented.
- [ ] Data freshness metadata available.
- [ ] Stale-data state visible to frontend.
- [ ] Pre-grad and post-grad history stitched correctly.
- [ ] Realtime activity tape stable under expected load.
- [ ] Market Heat calculations validated.
- [ ] Platform Live Stats derive from real canonical data.

---

## 178.8 Chart Readiness

- [ ] Pre-grad candle aggregation verified.
- [ ] Post-grad HyperSwap candle aggregation verified.
- [ ] Continuous chart history across graduation verified.
- [ ] Graduation marker appears at correct point.
- [ ] Current venue indicator correct.
- [ ] Volume aggregation correct.
- [ ] Required timeframes work.
- [ ] Live candle update stable.
- [ ] No-trade interval behavior defined.
- [ ] Historical backfill tested.
- [ ] Reorg correction tested.
- [ ] Chart resize responsive.
- [ ] Crosshair/tooltip smooth.
- [ ] Mobile chart usable.

---

## 178.9 Creator Flow Readiness

- [ ] Create Token entrypoint works.
- [ ] Name/ticker validation works.
- [ ] Duplicate ticker/name remains allowed as designed.
- [ ] Official xStock selector works.
- [ ] Logo upload/crop works where enabled.
- [ ] Social metadata validation works.
- [ ] Vanity address preview works.
- [ ] Token Card Preview works.
- [ ] Token Page Preview works.
- [ ] Launch transaction review works.
- [ ] Creator receives zero token allocation.
- [ ] Post-launch redirect/success flow works.
- [ ] Creator Control Center updates after launch.
- [ ] Creator fees display correctly.
- [ ] Claimable creator fees match canonical accounting.
- [ ] Creator can claim successfully.
- [ ] Creator post-grad revenue remains visible.

---

## 178.10 Trader UX Readiness

- [ ] Site browsable without wallet.
- [ ] Explore loads correctly.
- [ ] Search by name works.
- [ ] Search by ticker works.
- [ ] Search by contract address works.
- [ ] Search by creator works.
- [ ] xStock filtering works.
- [ ] Sorting works.
- [ ] Token detail loads live market state.
- [ ] Buy flow works.
- [ ] Sell flow works.
- [ ] Transaction review shows expected receive.
- [ ] Core fee and Stockback contribution shown separately.
- [ ] All-in effective fee shown before submit.
- [ ] Estimated Stockback vs finalized Claimable state is clear.
- [ ] Stockback claim/reconciliation works.
- [ ] Slippage shown.
- [ ] Current venue shown.
- [ ] Pending state clear.
- [ ] Confirmed state clear.
- [ ] Failed state actionable.
- [ ] Graduation occurring while page is open handled correctly.
- [ ] Post-grad routing updates automatically.
- [ ] Persistent trading settings work.
- [ ] Transaction Center reconciles after reload.

---

## 178.11 Roadmap / Changelog / Live Stats Readiness

- [ ] `/roadmap` surface works.
- [ ] LIVE status renders correctly.
- [ ] BUILDING status renders correctly.
- [ ] NEXT status renders correctly.
- [ ] EXPLORING status clearly marked non-committed.
- [ ] No fake progress percentages.
- [ ] No fake ETA/countdown.
- [ ] Roadmap works with animation disabled.
- [ ] Roadmap mobile fallback works.
- [ ] Changelog/update route works.
- [ ] Changelog entries deep-link correctly.
- [ ] Roadmap-to-changelog lifecycle supported.
- [ ] Live platform stats use real data.
- [ ] Live stats freshness/reconnect behavior works.
- [ ] Live stats do not cause layout shift.

---

## 178.12 Responsive Readiness

Test minimum:

- [ ] Narrow mobile.
- [ ] Standard mobile.
- [ ] Tablet portrait.
- [ ] Tablet landscape.
- [ ] Laptop.
- [ ] Desktop.
- [ ] Wide desktop.

Across supported layouts:

- [ ] No horizontal overflow.
- [ ] No clipped controls.
- [ ] Buy/Sell remains easily reachable.
- [ ] Touch targets usable.
- [ ] Charts usable.
- [ ] Creator flow usable.
- [ ] Dashboard usable.
- [ ] Tables/cards degrade gracefully.

---

## 178.13 Accessibility Readiness

- [ ] Semantic HTML.
- [ ] Form labels accessible.
- [ ] Keyboard focus visible.
- [ ] Keyboard navigation works where applicable.
- [ ] Modal/drawer focus management works.
- [ ] Escape behavior correct.
- [ ] Transaction feedback available beyond visual-only cues.
- [ ] Status does not rely only on color.
- [ ] Contrast passes agreed standard.
- [ ] Touch targets adequate.
- [ ] Reduced-motion mode works.
- [ ] Critical flows usable without advanced motion/3D.
- [ ] Screen-reader semantics implemented for critical controls.

---

## 178.14 Motion / 3D Readiness

- [ ] Experience Mode meets intended premium spatial quality.
- [ ] Trading Mode remains focused and calm.
- [ ] No scroll hijacking.
- [ ] No action blocked by animation.
- [ ] Advanced motion has graceful fallback.
- [ ] Reduced-motion implementation tested.
- [ ] Low-capability device fallback tested.
- [ ] Mobile motion behavior tested.
- [ ] Graduation animation does not obscure market state.
- [ ] Motion system consistent across surfaces.
- [ ] 3D layer never becomes critical dependency for trading.

---

## 178.15 Performance Readiness

- [ ] Initial load acceptable under agreed production budget.
- [ ] Route transitions responsive.
- [ ] Chart interactions fluid.
- [ ] Hover/cursor interactions fluid.
- [ ] Scroll remains fluid.
- [ ] Realtime updates do not stutter.
- [ ] Large activity feed does not degrade UI.
- [ ] Lazy loading works.
- [ ] Heavy visual assets deferred appropriately.
- [ ] 3D assets degrade gracefully.
- [ ] Memory behavior tested.
- [ ] Mobile performance tested.
- [ ] No meaningful cumulative layout shift from realtime data.
- [ ] Tabular numerals/fixed metric zones implemented where needed.

---

## 178.16 Network / Dependency Status Readiness

- [ ] Wrong-network handling works.
- [ ] RPC degraded state detectable.
- [ ] RPC reconnect works.
- [ ] Indexer delay state detectable.
- [ ] Reference-price stale state detectable.
- [ ] HyperSwap integration issue can be surfaced.
- [ ] User sees actionable contextual status.
- [ ] Dependency error does not falsely display successful transaction.

---

## 178.17 Production Configuration Readiness

- [ ] Production chain ID correct.
- [ ] Production RPC configured.
- [ ] Production WebSocket configured.
- [ ] Explorer links correct.
- [ ] Factory address correct.
- [ ] Registry address correct.
- [ ] FeeVault address correct.
- [ ] HolderRewardVault address correct.
- [ ] Stockback attestor/finalizer configuration correct.
- [ ] GraduationRouter address correct.
- [ ] Reference-price config correct.
- [ ] HyperSwap addresses correct.
- [ ] xStock addresses/decimals correct.
- [ ] Platform fee recipient correct.
- [ ] No test/mock address remains in production config.
- [ ] No developer private key included in application config.

---

## 178.18 Contract Verification / Deployment Readiness

- [ ] Deployment scripts reproducible.
- [ ] Final bytecode matches reviewed version.
- [ ] Contract source verified on explorer.
- [ ] Constructor/immutable arguments documented.
- [ ] CREATE2 init-code hash documented.
- [ ] Deployment registry created.
- [ ] Canonical contract addresses published to frontend/SDK.
- [ ] Deployment artifact backed up.

---

## 178.19 Monitoring Readiness

- [ ] RPC monitoring live.
- [ ] WebSocket monitoring live.
- [ ] Indexer lag monitoring live.
- [ ] Reference-price freshness monitoring live.
- [ ] Graduation failure alert live.
- [ ] Fee collection failure alert live.
- [ ] Stockback finalization freshness alert live.
- [ ] HolderRewardVault solvency alert live.
- [ ] Stockback attestor/quorum health alert live.
- [ ] API latency/error monitoring live.
- [ ] Frontend error monitoring live.
- [ ] Realtime reconnect monitoring available.
- [ ] Alert routing tested.

---

## 178.20 Documentation / Public Surface Readiness

- [ ] User trading basics documented.
- [ ] Creator launch flow documented.
- [ ] Graduation explained.
- [ ] Creator fee model explained.
- [ ] Stockback fee, TWAB, daily finalization, Claimable vs Estimated, and post-grad behavior explained.
- [ ] Official contract verification guidance published.
- [ ] Supported official xStock list visible.
- [ ] FAQ ready.
- [ ] Transaction troubleshooting ready.
- [ ] Developer ABI/SDK docs ready where public.
- [ ] Security/audit references published where appropriate.
- [ ] Roadmap populated.
- [ ] Initial changelog/update entry ready.

---

## 178.21 Legal / Disclosure Readiness

Exact legal requirements must be validated by specialist counsel where applicable.

Before launch, confirm required items such as:

- [ ] Terms of Service.
- [ ] Privacy Policy.
- [ ] Restricted-jurisdiction handling decision.
- [ ] Relevant frontend disclosures.
- [ ] Tokenized-stock/xStock-related wording reviewed.
- [ ] Stockback/reward/yield characterization reviewed.
- [ ] No misleading underlying-share/dividend ownership claim.
- [ ] No unverified investment/safety guarantee language.
- [ ] Creator-content responsibility wording addressed where needed.

If applicable legal review is unresolved and materially affects launch legality:

```text
NO-GO
```

---

# 179. Mandatory Final E2E Mainnet/Fork Rehearsal

Before GO decision, perform one full rehearsal using the production-equivalent configuration:

```text
Launch token
→ confirm creator gets zero allocation
→ multiple buys
→ sell
→ core-fee accrual
→ Stockback funding accrual
→ finalize a daily Stockback epoch
→ verify TWAB/cumulative distribution commitment
→ claim paired xStock Stockback
→ approach graduation
→ execute crossing order
→ graduation
→ HyperSwap pool created
→ LP lock verified
→ curve disabled
→ post-grad trade
→ creator fee collection/claim
→ verify post-grad Stockback source/disclosure
→ reload frontend
→ verify chart continuity
→ verify dashboard
→ verify bot routing
```

Document:

- transaction hashes;
- resulting addresses;
- balances;
- lifecycle states;
- fee balances;
- LP position;
- lock state;
- screenshots/logs where useful.

---

# 180. Final GO / NO-GO Decision

Launch can be marked **GO** only when:

```text
All P0 launch blockers = PASS
No unresolved Critical security issue
No unexplained accounting mismatch
No unverified production external dependency
Graduation + permanent LP path proven
Core trader flow works
Core creator flow works
Realtime/indexer works
Mobile critical path works
Accessibility critical path works
Monitoring is live
```

Otherwise:

```text
NO-GO
```

No marketing deadline, partner announcement, visual polish, or launch hype overrides a P0 failure.

---

# 181. Launch Readiness Sign-Off Template

```text
Release Version:
Masterplan Version:
Date:
Environment:
Contract Commit:
Frontend Commit:
Indexer Commit:
SDK Commit:

Smart Contracts: PASS / FAIL / BLOCKED
Economics: PASS / FAIL / BLOCKED
xStock Verification: PASS / FAIL / BLOCKED
HyperSwap Integration: PASS / FAIL / BLOCKED
Stockback: PASS / FAIL / BLOCKED
xStock Normalized Accounting: PASS / FAIL / BLOCKED
Security: PASS / FAIL / BLOCKED
Realtime / Indexer: PASS / FAIL / BLOCKED
Frontend Core: PASS / FAIL / BLOCKED
Creator Flow: PASS / FAIL / BLOCKED
Trader Flow: PASS / FAIL / BLOCKED
Mobile: PASS / FAIL / BLOCKED
Accessibility: PASS / FAIL / BLOCKED
Performance: PASS / FAIL / BLOCKED
Monitoring: PASS / FAIL / BLOCKED
Documentation: PASS / FAIL / BLOCKED
Legal/Disclosure: PASS / FAIL / BLOCKED

Known Accepted Risks:
-
-

Blocking Issues:
-
-

FINAL DECISION:
GO / NO-GO

Approved By:
```

---

**LAUNCH READINESS CHECKLIST APPROVED AS FINAL PRODUCTION GO / NO-GO GATE.**

---

# 182. UI/UX Implementation Contract — Detailed Build Specification

Bagian ini mengunci bagaimana UI/UX harus **terasa dan berperilaku saat diimplementasikan**, supaya coding agent tidak hanya memahami fitur, tetapi juga memahami quality bar dan interaction behavior.

Tujuan:

> Website harus terasa seperti **high-end quant terminal × luxury digital product × interactive spatial web experience**, tanpa menjadi noisy crypto casino atau generic SaaS dashboard.

---

# 183. Core Visual Hierarchy

Setiap screen harus memiliki hierarchy yang jelas:

```text
Primary action
Secondary context
Market information
Supporting metadata
Utility controls
Decorative/motion layer
```

Decorative layer tidak pernah boleh mengalahkan hierarchy functional.

Rules:

- primary CTA selalu jelas;
- important market metrics mudah discan;
- secondary metadata tidak berkompetisi dengan price/action;
- critical status seperti GRADUATING, delayed data, failed tx, high slippage harus terlihat jelas;
- visual richness tidak boleh mengurangi readability.

---

# 184. Spacing System

Gunakan spacing scale konsisten.

Recommended logical spacing tokens:

```text
4
8
12
16
20
24
32
40
48
64
80
96
```

Exact implementation dapat menyesuaikan design system, tetapi:

- jangan gunakan arbitrary spacing random antar screen;
- card padding konsisten;
- form spacing konsisten;
- section rhythm konsisten;
- dense terminal boleh lebih compact daripada homepage;
- mobile spacing harus deliberate, bukan sekadar mengecilkan desktop.

---

# 185. Typography System

Typography harus menciptakan dua mode:

## Experience Typography

Untuk homepage / roadmap / major storytelling:

- expressive;
- premium;
- large scale;
- strong hierarchy;
- spacious;
- cinematic when appropriate.

## Trading Typography

Untuk terminal / dashboard:

- compact;
- highly readable;
- tabular numerals;
- precise;
- dense but not cramped.

Required:

- tabular numerals untuk price, MC, volume, percentage;
- numeric columns align;
- no unreadably small gray text;
- helper text tetap readable;
- metric labels tidak terlalu dominating;
- address/ticker treatment konsisten.

---

# 186. Button Design System

Button adalah salah satu elemen yang paling sering terasa "murahan" jika implementation tidak disciplined.

Minimal button families:

```text
Primary
Secondary
Tertiary / Ghost
Destructive
Icon Button
Segmented Button
Transaction Button
Wallet Button
```

---

# 187. Primary Button

Dipakai untuk:

- Buy
- Sell
- Create Token
- Launch Token
- Confirm
- Claim Fees
- Connect Wallet jika primary context

Visual:

- strong contrast;
- premium surface;
- clear label;
- no excessive glow;
- subtle depth;
- crisp icon alignment where applicable.

Behavior states:

```text
Default
Hover
Pressed
Keyboard Focus
Loading
Disabled
Success
Error where contextual
```

Hover:

- slight depth/lift or material shift;
- controlled highlight;
- subtle magnetic/inertial response optional on desktop;
- never move enough to make cursor chase button.

Pressed:

- visibly compress;
- immediate feedback;
- no delayed click response.

Loading:

- label remains understandable;
- button width must not change;
- spinner/indicator aligned;
- prevent duplicate submission;
- retain context such as "Confirming..." rather than generic "Loading".

Disabled:

- clearly disabled;
- still readable;
- cursor/interaction correct;
- tooltip/helper may explain why if non-obvious.

---

# 188. Buy / Sell Buttons

Buy/Sell controls are high-priority trading actions.

Requirements:

- visually distinct;
- consistent semantic coloring;
- not solely color-dependent;
- clear active state;
- large enough for rapid interaction;
- sticky/mobile-compatible.

Examples:

```text
BUY
SELL
```

When selected:

- panel context changes clearly;
- selected side remains obvious;
- form does not jump in height unexpectedly.

Do not use aggressive casino-style pulse/glow.

---

# 189. Transaction Action Button States

Trading/launch/claim buttons must use state-specific copy.

Examples:

```text
Connect Wallet
Switch Network
Enter Amount
Review Buy
Confirm Buy
Waiting for Wallet
Submitting...
Pending
Confirmed
Retry
```

Avoid generic:

```text
Submit
Loading
Error
```

Action copy must tell user what is happening.

---

# 190. Icon Buttons

Examples:

- Copy Address
- Share
- Settings
- Expand Chart
- Collapse Panel
- Refresh Quote
- Close Drawer

Requirements:

- minimum hit area appropriate for touch;
- tooltip on desktop where icon meaning may be unclear;
- pressed/focus state;
- no microscopic icon-only targets;
- consistent icon stroke/weight.

---

# 191. Inputs

Input families:

```text
Text Input
Search Input
Amount Input
URL Input
Token/xStock Selector
Slippage Input
Metadata Textarea
```

States:

```text
Default
Hover
Focus
Filled
Error
Disabled
Read-only
Loading/Resolving
```

Rules:

- label remains visible;
- placeholder is example, not replacement for label;
- error message appears near relevant field;
- no layout jump when helper/error text appears;
- keyboard type optimized on mobile;
- pasted wallet/token address handled correctly.

---

# 192. Amount Input

Trading amount input must feel terminal-grade.

Show:

- entered amount;
- asset symbol;
- wallet balance;
- MAX;
- USD equivalent where useful;
- expected receive;
- quote freshness.

Interaction:

- large numeric entry;
- no unnecessary decimal restrictions;
- invalid precision handled clearly;
- MAX should account for required gas where relevant;
- user should never accidentally submit stale hidden value.

---

# 193. Search Input

Explore search supports:

- name;
- ticker;
- token contract address;
- creator address.

Behavior:

- fast;
- debounced;
- keyboard accessible;
- clear empty state;
- loading state;
- exact contract match prioritized;
- no command-palette behavior.

Explicit:

> Search is an Explore/product search field, NOT a global Ctrl+K command palette.

---

# 194. Dropdown / Select / xStock Selector

xStock selector should show:

- logo/symbol if available;
- canonical ticker;
- readable name;
- optional live reference value;
- official status.

Do not allow arbitrary contract entry into launch pair selection.

Dropdown behavior:

- searchable if list grows;
- keyboard navigable;
- clear selected state;
- mobile may use bottom sheet;
- no tiny hover-only interaction.

---

# 195. Cards

Card families:

```text
Token Card
Metric Card
Roadmap Card
Creator Launch Card
Transaction Card
Activity Card
Status Card
```

General:

- clear hierarchy;
- restrained borders;
- consistent radius;
- subtle depth;
- stable height where realtime updates occur;
- no random glassmorphism.

Token Card should prioritize:

```text
Logo
Name / Ticker
xStock Pair
Price / MC
Change
Volume
Graduation Progress
Status
```

Optional:

- sparkline;
- creator;
- age.

Card click target should feel intentional; nested buttons must remain individually usable.

---

# 196. Token Card Hover

Desktop hover may include:

- subtle elevation;
- highlight border;
- micro parallax;
- content emphasis;
- slight sparkline activation.

Avoid:

- card rotating excessively;
- unreadable perspective;
- large zoom;
- movement that causes layout shift.

Mobile has no hover dependency.

---

# 197. Tables

Used for:

- holdings;
- creator launches;
- transactions;
- holder data;
- market lists.

Requirements:

- numeric alignment;
- sticky header if long;
- clear sortable columns;
- sort direction indicator;
- row hover on desktop;
- row tap on mobile;
- horizontal strategy defined;
- no unusable micro-columns.

Mobile may switch from table to stacked compact rows/cards.

---

# 198. Status Badges

Status vocabulary should be consistent.

Examples:

```text
PRE-GRAD
GRADUATING
GRADUATED
LIVE
BUILDING
NEXT
EXPLORING
PENDING
CONFIRMED
FAILED
DELAYED
RECONNECTING
```

Badge hierarchy:

- important status visible;
- no excessive pill spam;
- consistent semantic styling;
- avoid color-only meaning.

---

# 199. Graduation Progress Component

Must show:

- percentage;
- visual progress;
- current status;
- endpoint context where useful.

Progress updates realtime without layout shift.

Milestone behavior:

```text
25%
50%
75%
90%
GRADUATING
GRADUATED
```

Visual emphasis may increase near endpoint, but:

- no casino flashing;
- no misleading urgency;
- no fake countdown.

---

# 200. Modal System

Use modal only when interruption is appropriate.

Examples:

- transaction review;
- destructive confirmation;
- important settings.

Requirements:

- clear title;
- clear primary/secondary actions;
- Escape works;
- focus trap;
- return focus on close;
- background scroll controlled;
- mobile may convert to bottom sheet.

Do not stack multiple modals.

---

# 201. Drawer / Bottom Sheet

Mobile trading and detail controls may use bottom sheets.

Requirements:

- swipe/close behavior predictable;
- drag handle if useful;
- safe-area aware;
- sticky CTA where needed;
- keyboard does not obscure amount input;
- content scroll independent where appropriate.

---

# 202. Tooltips

Use for:

- unfamiliar market terms;
- fee explanation;
- live/stale indicator;
- LP lock explanation;
- creator share.

Rules:

- short;
- useful;
- accessible;
- not required to understand core action;
- mobile has tap/focus alternative.

---

# 203. Toast / Notification System

Toast used for lightweight status.

Examples:

- address copied;
- settings saved;
- transaction submitted;
- claim confirmed.

Critical transaction failures should not rely only on ephemeral toast.

Requirements:

- grouped intelligently;
- no spam;
- readable duration;
- accessible announcement;
- action button where useful.

---

# 204. Transaction Review UX

Before buy/sell/launch/claim, show relevant context.

For trade:

```text
Pay
Receive
Price
Fee
Slippage
Price Impact
Venue
Quote Freshness
```

For launch:

```text
Token
Ticker
xStock Pair
Vanity Address
Launch Fee
Supply
Creator Allocation: 0%
```

Critical details should be visible without scrolling excessive distance.

---

# 205. Transaction Pending UX

Once submitted:

- transaction appears in Transaction Center;
- action panel shows pending;
- duplicate submission prevented;
- user may navigate away;
- pending state persists/reconciles;
- explorer link can be available;
- page reload does not lose transaction context.

---

# 206. Transaction Success UX

Success should feel premium but restrained.

Examples:

```text
Buy confirmed
Launch live
Fees claimed
Graduation complete
```

Can include:

- subtle motion;
- check animation;
- relevant next action.

Avoid giant celebration for every small trade.

Graduation may receive stronger visual moment because it is a major market event.

---

# 207. Transaction Error UX

Errors must answer:

1. What happened?
2. Why, if known?
3. What should user do next?

Examples:

```text
Price moved beyond your slippage tolerance.
Refresh the quote and retry.
```

```text
The market graduated while your quote was open.
Your trade has been updated to the HyperSwap route.
```

```text
Network connection was interrupted.
Your transaction may still be pending. Checking status...
```

Never expose raw RPC error as primary UX.

Raw detail may be expandable.

---

# 208. Loading States

Loading should preserve layout.

Use:

- stable skeleton;
- reserved metric width;
- contextual loading label;
- subtle shimmer only if performant.

Avoid:

- entire page spinner;
- disappearing layout;
- repeated content jumps;
- random skeleton dimensions.

---

# 209. Empty States

Examples:

## No Holdings

```text
No positions yet.
Explore live markets to make your first trade.
```

## No Launches

```text
You haven't launched a token yet.
Create your first xStock-paired market.
```

## No Activity

```text
No activity yet.
Trades will appear here in real time.
```

Empty states should guide next action without feeling promotional.

---

# 210. Realtime Data Update Behavior

Realtime changes must be visually understandable but stable.

Price update:

- value updates;
- optional subtle directional flash;
- no giant animation.

Trade row:

- smoothly enters;
- older rows shift predictably;
- no jarring jump.

Metrics:

- tabular numerals;
- fixed/reserved width;
- interpolation optional;
- no repeated layout shifts.

---

# 211. Data Freshness UI

Possible states:

```text
LIVE
SYNCING
DELAYED
RECONNECTING
STALE
```

Location:

- contextual near relevant data;
- not giant global warning unless system-wide issue.

Tooltip/detail can explain timestamp or source.

---

# 212. Navigation Behavior

Primary navigation should remain simple.

Recommended:

```text
Explore
Create
Roadmap
Updates
Account
```

Wallet/account control separate.

Requirements:

- current route clear;
- responsive collapse deliberate;
- mobile navigation accessible;
- no overpacked nav;
- no global command palette.

---

# 213. Homepage UI Contract

Homepage first impression:

- premium;
- alive;
- market-centric;
- not documentation-centric.

Priority:

```text
Brand / Positioning
Live market discovery
Trending / New / Near Graduation
Market pulse/activity
Create CTA
Supporting roadmap/stats
```

Homepage can use stronger motion/3D than terminal.

But:

- user can reach market immediately;
- animation never blocks Explore;
- no intro splash that must finish before interaction.

---

# 214. Explore UI Contract

Explore should feel fast and scannable.

Top:

- search;
- xStock filter;
- sort;
- important discovery tabs.

Content:

- token cards/list;
- realtime activity;
- market heat where relevant.

No watchlist.

Default sort must feel useful immediately.

---

# 215. Token Terminal UI Contract

Terminal priority:

```text
Token identity/status
Price/MC/market metrics
Chart
Buy/Sell
Graduation progress
Activity
Holder/context data
```

Trading Mode should be calmer than homepage.

Rules:

- chart dominates;
- trade panel always easy to find;
- price/status never obscured by visual effect;
- no cinematic scroll effects inside active trading core;
- high information density with disciplined spacing.

---

# 216. Desktop Terminal Suggested Layout

Example logical layout:

```text
┌─────────────────────────────────────────────────┐
│ Token Header / Metrics / Status                 │
├───────────────────────────────┬─────────────────┤
│                               │                 │
│           CHART               │    BUY / SELL   │
│                               │                 │
├───────────────────────────────┼─────────────────┤
│ Activity / Trades             │ Market Details  │
└───────────────────────────────┴─────────────────┘
```

Panels may be lightly resizable/collapsible.

Do not allow customization to destroy usability.

---

# 217. Mobile Terminal Suggested Layout

Priority:

```text
Token Header
Core Metrics
Chart
Sticky Buy / Sell
Graduation Progress
Activity
Additional Details
```

Trade opens in bottom sheet/full panel.

Mobile must not require horizontal scrolling for core trading.

---

# 218. Chart Control UX

Controls may include:

```text
1s
5s
1m
5m
15m
1h
4h
Volume
Price / MC toggle if useful
Expand
```

Requirements:

- selected timeframe obvious;
- touch friendly;
- no overcrowding;
- preferences persist;
- chart crosshair responsive;
- graduation marker visible but non-intrusive.

---

# 219. Create Token UI Contract

Create flow must feel simple despite complex backend.

Recommended progression:

```text
Token Identity
xStock Pair
Metadata / Socials
Vanity Address
Preview
Review
Launch
```

May be single page or guided multi-step depending implementation, but:

- user always knows where they are;
- no unnecessary form fields;
- no hidden fee;
- creator allocation clearly 0%;
- pair clearly official;
- preview is high quality.

---

# 220. Creator Preview UX

Preview should approximate actual public result, not generic wireframe.

Modes:

```text
Token Card Preview
Token Page Preview
```

Preview updates as creator edits:

- logo;
- name;
- ticker;
- xStock pair;
- social links;
- vanity address.

Preview should not falsely show market data that does not exist yet.

---

# 221. Creator Control Center UI Contract

Priority:

```text
Creator earnings
Claimable fees
Launches
Market status
Graduation progress
Volume/activity
Quick actions
```

Must feel like creator trading cockpit, not admin CMS.

Primary actions:

```text
Launch New
Open Terminal
Share
Claim Fees
```

No token admin powers exposed because none should exist.

---

# 222. Account Dashboard UI Contract

Top metrics may include:

```text
Portfolio Value
24h P&L
Creator Earnings
Claimable Fees
```

Sections:

```text
Holdings
Activity
My Launches
Earnings
```

Data density medium-high but organized.

---

# 223. Roadmap UI Contract

Roadmap should use:

```text
LIVE
BUILDING
NEXT
EXPLORING
```

Visual can be more cinematic/spatial.

Must not:

- fake ETA;
- fake completion percent;
- scroll hijack;
- obscure status text.

---

# 224. Motion Behavior by Surface

## Homepage
Motion intensity: HIGH but controlled.

## Explore
Motion intensity: MEDIUM.

## Token Terminal
Motion intensity: LOW–MEDIUM.

## Create
Motion intensity: MEDIUM.

## Creator Control Center
Motion intensity: LOW–MEDIUM.

## Roadmap
Motion intensity: MEDIUM–HIGH.

## Transaction Modal
Motion intensity: LOW.

Critical rule:

> The closer the user is to moving money, the calmer the motion becomes.

---

# 225. Hover / Cursor Interaction Rules

Desktop premium interactions may include:

- subtle magnetic buttons;
- depth shift;
- spotlight/light response;
- micro parallax;
- inertial movement.

Limits:

- never obscure text;
- never reduce hit accuracy;
- never add meaningful input latency;
- disabled under reduced-motion;
- disabled/simplified on lower capability devices.

---

# 226. Focus States

Keyboard focus must be intentionally designed.

Do not rely on browser default if it clashes visually, but replacement must be equally or more visible.

Focusable:

- buttons;
- links;
- inputs;
- tabs;
- rows where interactive;
- icon buttons;
- modal controls.

---

# 227. Mobile Touch Rules

Minimum target sizes should follow modern accessibility best practices.

Rules:

- no tiny icon action;
- no hover dependency;
- sticky CTA must not cover content;
- bottom-sheet drag area sufficient;
- safe-area respected;
- keyboard opening should not hide confirm CTA.

---

# 228. Copy Consistency Rules

Use consistent terminology.

Use:

```text
Launch
Buy
Sell
Graduate
Graduating
Graduated
Creator Fees
Claim
Official xStock
Market Cap
Volume
```

Avoid switching randomly between:

```text
Deploy / Mint / Create / Issue
```

unless technical context requires it.

User-facing copy should favor product terminology over engineering terminology.

---

# 229. Number Formatting

Examples:

```text
$2.1K
$53.4K
$1.24M
12.4%
0.002431 NVDAx
```

Rules:

- useful precision;
- no long unreadable decimals;
- full exact value available where appropriate via tooltip/details;
- token amounts adapt decimals intelligently;
- percentages consistent;
- addresses shortened in UI but full address copyable.

---

# 230. Address Display

Example:

```text
0x84A3…21fF
```

Requirements:

- copy button;
- full tooltip/details;
- explorer link;
- contract identity prominent enough to distinguish duplicate ticker/name;
- vanity suffix may be visually highlighted but never treated as authenticity proof.

---

# 231. Visual Trust Signals

Without turning product safety-first:

Show clearly:

- Official xStock;
- Contract Address;
- Current Venue;
- PRE-GRAD / GRADUATED;
- LP Permanently Locked where applicable;
- Fee;
- Creator Share;
- Slippage;
- Price Impact.

Use progressive disclosure.

---

# 232. High Price Impact UX

If price impact exceeds defined UI threshold:

- visually elevate warning;
- show expected receive clearly;
- require normal transaction confirmation flow;
- no deceptive hiding.

Exact threshold implementation-level.

Do not label normal volatile movement as security failure.

---

# 233. Slippage UX

Default slippage should be sensible.

User can edit.

Show:

- current setting;
- expected receive;
- minimum receive.

If trade fails due to slippage:

```text
Price moved beyond your slippage tolerance.
Refresh the quote and retry.
```

Do not silently increase user slippage.

---

# 234. Wallet UX

Wallet should not be required for browsing.

Wallet required when:

- launching;
- trading;
- claiming;
- wallet-specific dashboard actions.

Behavior:

- connect clear;
- switching wallet updates account state;
- disconnect cleans personal state safely;
- wallet state should not cause full-page visual jump.

---

# 235. Layout Stability Contract

No realtime element may unexpectedly resize major surrounding layout.

Use:

- fixed metric regions;
- stable card heights;
- reserved icon/status space;
- skeleton matching final dimensions;
- tabular numerals;
- predictable list insertion.

Zero-layout-shift quality bar applies especially to:

- terminal header;
- price;
- MC;
- activity tape;
- graduation progress;
- transaction status.

---

# 236. Component Motion Timing

Exact milliseconds may be tuned by design, but categories should remain consistent.

Conceptual:

```text
Micro feedback: fast
Panel transitions: medium
Page transitions: medium
Cinematic storytelling: slower
Market-critical feedback: immediate
```

Do not use different random easing/timing per component.

Motion tokens should be centralized.

---

# 237. Skeleton Design

Skeleton should reflect actual content hierarchy.

Examples:

Token Card skeleton:

```text
Logo
Name line
Metric line
Progress line
```

Terminal skeleton:

```text
Header metrics
Chart rectangle
Trade panel
Activity rows
```

No giant generic shimmering rectangle covering page.

---

# 238. Error Boundary UX

If one module fails:

- do not crash entire application where avoidable;
- localize error;
- provide retry;
- retain unaffected market functionality.

Example:

If holder analytics fails:

- chart/trading remain usable;
- holder panel shows recovery state.

---

# 239. Offline / Connection-Loss UX

If connectivity is lost:

```text
Connection interrupted
Reconnecting…
```

If user has pending transaction:

```text
Your transaction may still be processing on-chain.
We’ll reconcile it when connection returns.
```

Never falsely mark failure solely due to frontend disconnect.

---

# 240. Design System Tokenization

Implementation should centralize:

- spacing;
- typography;
- radius;
- border;
- shadows;
- surface layers;
- semantic colors;
- control heights;
- breakpoints;
- motion durations;
- easing;
- z-index layers.

No one-off values unless justified.

---

# 241. Z-Index / Layering Rules

Define explicit layering.

Example categories:

```text
Base
Sticky
Dropdown
Drawer
Modal
Toast
Critical Transaction Overlay
```

Avoid arbitrary `z-index: 999999`.

---

# 242. Responsive Behavior Contract

Responsive design may change composition, not only dimensions.

Allowed:

- table → compact cards;
- sidebar → bottom sheet;
- horizontal controls → segmented/scrollable controls;
- chart toolbar → condensed toolbar;
- multi-column → vertical stack.

Core action priority must remain intact.

---

# 243. Visual QA Checklist Per Screen

Every screen must be reviewed for:

- spacing consistency;
- alignment;
- typography;
- numeric alignment;
- responsive behavior;
- hover;
- pressed;
- focus;
- disabled;
- loading;
- empty;
- error;
- reconnect;
- long token name;
- duplicate ticker;
- long wallet address;
- extreme metric values;
- tiny metric values;
- mobile keyboard;
- slow network;
- reduced motion;
- dark surface contrast;
- layout shift.

---

# 244. Edge-Case UI Data Testing

Test UI with:

- token name 1 character;
- maximum allowed token name;
- duplicate ticker;
- very long creator label;
- zero volume;
- extremely high volume;
- tiny price;
- large MC;
- 0% graduation;
- 99.99% graduation;
- GRADUATING;
- GRADUATED;
- stale price;
- missing image;
- broken metadata image;
- no socials;
- many trades/sec.

Design must remain intact.

---

# 245. AI / Engineer UI Implementation Instruction

When an AI coding agent implements frontend:

1. Do not invent a generic dashboard theme.
2. Follow the design hierarchy and component behavior in this masterplan.
3. Build reusable primitives first.
4. Implement all component states, not only default state.
5. Test desktop and mobile during implementation.
6. Preserve stable layout under realtime updates.
7. Use real mocked edge-case data during visual QA.
8. Do not add watchlist.
9. Do not add global command palette.
10. Do not add casino-style flashing effects.
11. Do not require wallet connection for browsing.
12. Do not use animation that blocks critical interaction.
13. Do not substitute a generic chart embed if it fails the terminal quality bar.
14. Maintain accessibility while styling custom components.
15. Document deviations.

---

# 246. UI Definition of Done

A frontend feature is not complete until:

```text
Default state works
+ hover works
+ pressed works
+ keyboard focus works
+ loading works
+ disabled works
+ error works
+ empty works
+ mobile works
+ reduced motion works
+ realtime update is stable
+ accessibility works
+ performance is acceptable
```

---

# 247. Final Website Quality Bar

The finished website should feel:

```text
Fast
Precise
Alive
Premium
Spatial
Confident
Data-rich
Readable
Responsive
Intentional
```

It should NOT feel:

```text
Template
Generic SaaS
Casino
Noisy
Over-glowing
Cluttered
Slow
Tiny-text-heavy
Animation-first
Dashboard-admin-like
```

Final shorthand:

> **High-end quant terminal × luxury digital product × interactive 3D web experience.**

And the most important UI rule remains:

> **Every screen should answer the user’s next question before they need to ask it.**

---

**DETAILED UI/UX + COMPONENT + BUTTON INTERACTION CONTRACT APPROVED.**

---

# 248. What Still Happens During Implementation — Not a Product Gap

Bagian ini menjelaskan hal-hal yang memang sengaja baru diputuskan atau diverifikasi saat implementation.

Tujuannya supaya build team / AI coding agent tidak menganggap detail-detail ini sebagai kekurangan masterplan.

Masterplan sudah mengunci:

- product behavior;
- economics;
- creator incentives;
- lifecycle;
- security invariants;
- UX expectations;
- motion/visual quality bar;
- launch readiness criteria.

Implementation kemudian bertugas memilih cara terbaik untuk mewujudkan keputusan tersebut.

# 249. Implementation-Time Decisions

Beberapa keputusan berikut tidak perlu dikunci secara prematur di product masterplan.

## 249.1 Exact Frontend Stack

Build team dapat memilih stack modern yang paling cocok, misalnya framework, state-management approach, realtime client, chart rendering approach, dan build tooling.

Pemilihan stack harus berdasarkan:

- performance;
- maintainability;
- realtime capability;
- accessibility;
- mobile responsiveness;
- motion/3D compatibility;
- developer velocity;
- ecosystem maturity.

> Framework boleh berubah. Product experience tidak boleh berubah.

## 249.2 Exact Smart-Contract Libraries

Tim boleh memilih audited/common libraries dan internal math architecture.

Pemilihan library tidak boleh memperkenalkan:

- hidden mint;
- upgrade path yang tidak disetujui;
- fund-withdrawal privilege;
- unexpected transfer behavior.

## 249.3 Exact Fixed-Point Precision

Exact numeric scale seperti `1e18`, `1e27`, `Q64.96`, atau representation lain adalah implementation decision.

Tim harus memilih representation yang aman dari overflow, cukup presisi, gas-efficient, compatible dengan external integrations, dan mudah diuji.

Final rounding direction harus documented dan invariant-tested.

# 250. External Protocol Verification During Build

Sebelum production, tim harus memverifikasi keadaan terbaru dari:

- HyperSwap;
- HyperEVM;
- official xStock deployments;
- oracle/reference-price providers;
- RPC/WebSocket providers;
- explorers;
- relevant bridge/dependency infrastructure.

> Masterplan mengunci behavior yang dibutuhkan, bukan historical address.

# 251. HyperSwap Verification Checklist During Implementation

Tim harus menentukan dari deployment resmi saat build:

- current V3 factory;
- router;
- quoter;
- position manager;
- supported fee tiers;
- tick spacing;
- pool initialization behavior;
- liquidity position semantics;
- fee collection semantics;
- permanent-lock/delegation mechanism;
- protocol-specific edge cases.

Setelah diverifikasi:

- address masuk centralized config;
- source dicatat;
- integration test dibuat;
- fork test dijalankan;
- deployment registry diperbarui.

# 252. Official xStock Verification During Implementation

Sebelum sebuah xStock masuk supported production registry, verify:

- canonical token address;
- chain;
- decimals;
- symbol;
- official issuer/source;
- transfer behavior;
- restrictions;
- reference-price availability;
- liquidity/market availability where relevant.

Never trust token symbol alone.

# 253. Oracle / Reference-Price Provider Selection

Masterplan mengunci kebutuhan:

- launch-time reference snapshot;
- live USD-equivalent display;
- stale detection;
- no arbitrary manual price override.

Exact provider dipilih saat engineering validation.

Selection criteria:

- HyperEVM availability;
- freshness;
- reliability;
- trust assumptions;
- precision;
- cost;
- uptime;
- manipulation resistance;
- integration complexity.

# 254. Exact HyperSwap Fee Tier / Tick Decisions

Production team harus:

1. inspect official deployed fee tiers;
2. check compatibility with target xStock pair;
3. model initial LP;
4. validate final curve price mapping;
5. simulate tick rounding;
6. document resulting choice.

Jika integration detail mengubah product economics materially, escalate sebagai product decision.

# 255. Exact Gas Optimization

Priority:

```text
Correctness
> Security
> Readability
> Testability
> Gas Optimization
```

Do not remove validation, merge accounting buckets unsafely, or introduce unsafe assembly hanya untuk gas.

# 256. Exact Indexer Technology

Indexer technology fleksibel, tetapi wajib mendukung:

- reorg handling;
- deterministic event identity;
- realtime subscription;
- historical backfill;
- graduation continuity;
- derived metrics;
- rebuildability from canonical sources.

# 257. Exact Database / Cache Strategy

Backend dapat memilih storage architecture.

Important:

> Database state tidak menjadi authority untuk user funds atau lifecycle state.

Jika cache dan chain disagree, canonical on-chain/indexed state menang.

# 258. Exact Chart Library / Rendering Engine

Chart engine harus mendukung:

- realtime candles;
- multiple timeframes;
- crosshair;
- volume;
- resize;
- mobile gestures;
- graduation marker;
- custom styling;
- continuous history;
- high performance.

Jika generic widget tidak memenuhi quality bar, jangan dipaksakan.

# 259. Exact Motion / 3D Stack

Technology fleksibel: CSS, Web Animations, WebGL/WebGPU, Three.js-class rendering, timeline/spring engine, shader, canvas, atau kombinasi.

Yang wajib:

- smooth;
- accessible;
- responsive;
- reduced-motion support;
- graceful degradation;
- high visual quality.

# 260. Exact Design Tokens

Brand identity and visual-system direction are now **LOCKED** by the SENT Brand Identity chapter later in this masterplan.

Implementation may optically tune secondary values such as exact type sizes, border opacity, radius, shadow, blur, control height, and motion timing **only within the locked SENT token system and visual quality constraints**.

The implementation team may NOT independently replace:

- SENT as the product brand;
- Volt Lime as the signature brand color;
- the dark refined neutral foundation;
- the restrained accent-usage model;
- the typography hierarchy philosophy;
- the Experience Mode / Trading Mode visual hierarchy;
- the premium / luxury / quant-grade quality bar;
- the abstract symbol-first logo direction;
- the motion hierarchy;
- the requirement for visual consistency across every user and creator surface.

Locked art direction:

```text
SENT
Luxury
Quant-grade
Dark refined
Clean
Spatial
Interactive
Highly animated where appropriate
High contrast without glare
Premium
Expensive-feeling
Not casino
Not generic SaaS
Not neon-spam
Not visually noisy
```

# 261. Exact Animation Values

Exact duration/easing boleh dituning melalui QA.

Kategori tetap konsisten:

```text
Fast feedback
Medium UI transition
Slow cinematic scene
Immediate market-critical feedback
```

# 262. Exact Breakpoints

Exact pixel breakpoints fleksibel dan harus mengikuti composition needs, bukan sekadar device labels.

# 263. Exact Loading Performance Targets

Engineering menetapkan measurable budgets untuk JavaScript, fonts, images, 3D assets, initial route, realtime subscriptions, chart render, dan mobile behavior setelah architecture dipilih.

> Premium experience yang terasa lambat = failed implementation.

# 264. Exact Deployment Architecture

Hosting/CDN/backend/database/monitoring/RPC redundancy fleksibel selama reliable, secure, observable, reproducible, dan rollback-capable untuk off-chain components.

# 265. Exact CI/CD Implementation

Recommended gates:

```text
Lint
Type Check
Unit Tests
Contract Tests
Invariant/Fuzz
Build
E2E
Accessibility Checks
Performance Checks
Security Checks
Deploy Preview
Production Gate
```

Exact CI provider fleksibel.

# 266. Exact Testing Frameworks

Framework boleh berbeda, kategori test tidak:

```text
Unit
Integration
Invariant
Fuzz
Fork
E2E
Visual Regression
Responsive
Accessibility
Performance
Failure Recovery
```

# 267. Exact Wallet Integration

Wallet integration technology fleksibel, tetapi harus mendukung HyperEVM, connect/disconnect, account switching, chain switching, transaction submission/tracking, reconnect, dan mobile wallet support jika applicable.

Browsing tidak boleh membutuhkan wallet.

# 268. Exact Transaction Simulation Capability

Jika simulation tersedia dan reliable, gunakan untuk meningkatkan clarity.

Simulation tidak menggantikan slippage controls, contract checks, atau on-chain verification.

# 269. Exact Search Infrastructure

Search backend dapat berkembang, tetapi behavior tetap:

- name;
- ticker;
- contract;
- creator;
- xStock.

# 270. Exact Analytics Provider

Analytics tooling fleksibel dan tidak boleh menjadi critical trading dependency.

# 271. Exact Error Monitoring Stack

Monitoring stack fleksibel, tetapi wajib punya visibility terhadap:

- exceptions;
- RPC failures;
- API errors;
- realtime disconnect;
- performance;
- graduation-related operational failures;
- indexer issues.

# 272. Exact Legal Copy

Masterplan mendefinisikan topik legal yang harus ditangani.

Final ToS, privacy, restricted-jurisdiction wording, dan disclosure harus melalui qualified legal review jika diperlukan.

AI/engineer tidak boleh mengarang legal guarantee.

# 273. Exact Branding Name / Logo

Working assets boleh digunakan selama development.

Sebelum public release, brand name, logo, wordmark, favicon, social identity, dan canonical domain harus diganti ke approved production identity.

# 274. Product Decision vs Engineering Decision

## Product Decision

Jika perubahan mempengaruhi:

- user economics;
- creator economics;
- token supply;
- price model;
- graduation;
- fund custody;
- LP ownership;
- permissions;
- major public product behavior;
- major UX promise;

maka butuh explicit approval.

## Engineering Decision

Jika hanya mempengaruhi library, framework, code organization, provider, internal implementation, atau optimization sambil mempertahankan locked behavior, team boleh memilih dan document.

# 275. When an Agent Should Ask / Escalate

Escalate jika:

- dua masterplan requirement conflict;
- external protocol tidak mendukung required behavior;
- security invariant tampak impossible;
- implementation akan materially change economics;
- required feature menciptakan fund-risk;
- production dependency unavailable;
- legal restriction materially changes product behavior.

Jangan repeatedly ask approval untuk routine engineering choices.

# 276. Handling Ambiguity

Jika wording ambiguous:

1. inspect semua relevant sections;
2. prioritize locked decisions;
3. follow decision hierarchy;
4. pilih interpretation yang preserve invariants;
5. record interpretation di decision log.

# 277. Historical Decision Supersession Rule

Jika older concept conflict dengan newer locked decision:

> Latest explicit locked decision wins.

Obsolete concepts yang tidak boleh reappear:

- creator-funded launch liquidity;
- creator USDC deposit for liquidity;
- direct-to-DEX initial model;
- creator token premine;
- manual graduation;
- symbol-based authenticity.

# 278. Implementation TODOs Are Not Missing Product Requirements

TODO seperti:

```text
TODO verify HyperSwap address
TODO choose chart engine
TODO tune motion timing
TODO configure production RPC
```

bukan berarti product spec incomplete.

Tetapi setiap TODO harus tracked dan resolved sebelum relevant release gate.

# 279. Mock / Placeholder Rules

Mocks boleh untuk local development, visual prototyping, tests, dan staging yang jelas.

Mocks tidak boleh jadi hidden production fallback untuk:

- balances;
- market volume;
- graduation status;
- xStock authenticity;
- creator earnings;
- platform stats;
- reference price.

# 280. Production Configuration Freeze

Before release:

1. verified external addresses finalized;
2. production config reviewed;
3. mock/test config removed;
4. contract deployments recorded;
5. frontend config frozen;
6. SDK config matched;
7. indexer config matched;
8. monitoring config matched.

# 281. Final Implementation Philosophy

Coding team tidak seharusnya berpikir:

> “What product should we invent from this document?”

Mereka harus berpikir:

> “The product is already decided. Our job is to implement it correctly, securely, beautifully, and reliably.”

# 282. Final Handoff Interpretation

Saat masterplan dibagikan ke AI coding agent, Claude, engineer, designer, atau technical team, semua requirement harus dibaca dalam tiga bucket:

```text
LOCKED
Must be implemented exactly as specified.

VERIFY
External/current facts must be confirmed during implementation.

CHOOSE
Engineering may select the best technical solution while preserving LOCKED behavior.
```

---

**IMPLEMENTATION-TIME DECISION BOUNDARIES + VERIFY/CHOOSE RULES APPROVED.**

---

# 283. Stockback V1 — Paired xStock Holder Rewards

Stockback adalah flagship economic feature di mana holder TOKEN mendapatkan reward dalam **official paired xStock** dari aktivitas trading market tersebut.

Examples:

```text
TOKEN / NVDAx
→ hold TOKEN
→ earn NVDAx

TOKEN / SPYx
→ hold TOKEN
→ earn SPYx

TOKEN / QQQx
→ hold TOKEN
→ earn QQQx
```

Product shorthand:

> **Trade the meme. Hold the meme. Earn the stock.**

Important terminology:

- Stockback bukan legal dividend dari saham underlying.
- UI harus menyebut reward sebagai `Stockback`, `xStock Rewards`, atau wording equivalent yang akurat.
- Jangan menyebut holder TOKEN sebagai shareholder underlying company.
- Jangan klaim user menerima corporate dividend langsung dari Nvidia/ETF issuer hanya karena hold TOKEN.

---

# 284. Stockback Economic Principle

Stockback tidak boleh mengurangi locked creator economics.

Core trading fee tetap memiliki locked split:

```text
Core Trading Fee
→ 65% Creator
→ 35% Platform
```

Stockback harus memiliki dedicated economic source.

Current direction untuk simulation:

```text
Core Fee:
1.00%

Potential Stockback Layer:
Buy  = approximately 0.5%–1.0%
Sell = approximately 1.0%–2.0%
```

Exact Stockback fee **belum dikunci** sampai simulation selesai.

Hard rule:

> Creator locked 65% share dari core fee tidak boleh dikurangi untuk mendanai Stockback.

Also forbidden:

- curve collateral funding Stockback;
- LP principal funding Stockback;
- hidden inflation funding Stockback;
- arbitrary minting funding Stockback.

---

# 285. Stockback Reward Asset

Reward asset ditentukan secara deterministic oleh market pair.

```text
TOKEN / NVDAx
→ reward asset = official NVDAx

TOKEN / SPYx
→ reward asset = official SPYx
```

Creator tidak memilih arbitrary reward token.

Benefits:

- simple UX;
- deterministic;
- easier security review;
- no misleading reward token;
- direct connection between pair and holder reward.

Reward asset must pass official xStock registry validation.

---

# 286. Stockback V1 Distribution Model

Approved V1 distribution model:

```text
Trade occurs
↓
Stockback fee is generated
↓
Official paired xStock enters HolderRewardVault
↓
Holder exposure is measured continuously
↓
24-hour epoch completes
↓
Epoch reward allocation is finalized
↓
Reward becomes claimable
↓
User claims whenever they want
```

Core principle:

> Reward generation happens continuously with market activity, but settlement happens once per daily epoch.

---

# 287. Stockback Epoch Duration

Approved V1:

```text
1 Stockback Epoch = 24 hours
```

Recommended deterministic boundary:

```text
00:00 UTC
→
23:59:59 UTC
```

or an equivalent exact 24-hour deterministic schedule chosen during implementation.

Reason:

- simple to understand;
- simple to audit;
- scalable;
- avoids excessive settlement frequency;
- compatible with realtime estimated accrual UI.

Hourly settlement is not required for V1.

---

# 288. Time-Weighted Holder Accounting

Stockback V1 must reward **amount held × time held**, not only snapshot balance.

Conceptually:

```text
User Reward Weight
=
Integral of user TOKEN balance over epoch
```

Simplified:

```text
TOKEN balance × holding duration
```

Example:

```text
Alice:
1M TOKEN × 24h
= 24M token-hours

Bob:
2M TOKEN × 12h
= 24M token-hours
```

Their epoch weight is equivalent.

Reward allocation:

```text
User Reward
=
User Time-Weighted Balance
──────────────────────────
Total Eligible Time-Weighted Balance
×
Epoch Stockback Pool
```

Exact fixed-point implementation must be proven by simulation/tests.

---

# 289. No Snapshot Farming

A simple end-of-day snapshot is explicitly rejected.

Forbidden model:

```text
23:59 buy huge balance
00:00 snapshot
00:01 sell
→ receive full-day reward
```

With time-weighted accounting:

- late buyers receive only proportional exposure;
- early sellers stop accruing after sell;
- transfers divide exposure by time naturally;
- no special snapshot timing advantage.

---

# 290. No Staking Required

Stockback V1 is passive.

User flow:

```text
BUY TOKEN
↓
HOLD IN NORMAL WALLET
↓
EARN STOCKBACK
```

User does NOT need:

- approve staking contract;
- stake;
- lock;
- choose duration;
- unstake before selling.

TOKEN remains normally transferable.

Stockback is a holder reward system, not a staking product.

---

# 291. HolderRewardVault

Recommended dedicated contract/module:

`HolderRewardVault`

Responsibilities:

- custody Stockback reward xStock;
- track finalized epoch reward commitments;
- process claims;
- prevent double claims;
- maintain reward isolation from market collateral;
- expose claimable data/events.

HolderRewardVault must NOT:

- custody curve collateral;
- control trading;
- control graduation;
- own LP principal withdrawal authority;
- block market operations if claim fails.

---

# 292. Reward Engine Isolation

Stockback system must be economically and operationally isolated.

Hard invariant:

> Stockback failure must not brick trading, graduation, creator claims, or market lifecycle.

If reward distribution/indexing/finalization temporarily fails:

- market still trades;
- creator fee accounting continues;
- graduation remains functional;
- pending reward funds remain isolated;
- Stockback finalization can recover separately.

---

# 293. Estimated Accrued vs Claimable

UI must distinguish:

## Estimated Accrued

Current running epoch estimate.

Example:

```text
Estimated Today
0.04182 NVDAx
```

This may change before finalization.

## Claimable

Finalized past-epoch reward.

Example:

```text
Claimable
0.18321 NVDAx
```

Only finalized amount should be presented as guaranteed claimable under protocol rules.

---

# 294. Stockback Claim Model

Approved:

> **Pull-based claim.**

Do not automatically transfer reward to every holder each day.

User may claim whenever desired.

Examples:

```text
Day 1 +0.014 NVDAx
Day 2 +0.021 NVDAx
Day 3 +0.019 NVDAx
...
↓
Claimable balance accumulates
↓
User clicks Claim
```

Benefits:

- lower gas;
- scalable;
- fewer forced transfers;
- user chooses claim timing.

---

# 295. Claim Persistence

Selling TOKEN does not erase already-earned finalized reward.

Example:

```text
User earns 0.8 NVDAx
↓
User sells all TOKEN
↓
0.8 NVDAx remains claimable
```

After balance becomes zero:

- future time-weighted accrual stops;
- previously finalized reward remains owned/claimable.

No short reward expiry in V1 unless later required for a strongly justified reason.

---

# 296. Transfer Behavior

If TOKEN moves from Wallet A to Wallet B:

```text
Wallet A accrues until transfer time
Wallet B accrues after transfer time
```

No double counting.

No reward clawback solely because TOKEN is transferred.

---

# 297. Dust Handling

Rather than excluding small holders entirely, V1 should preferably use a **minimum claim amount**.

Example:

```text
Accrued:
0.00000003 NVDAx

Minimum claim:
0.0001 NVDAx
```

Reward continues accumulating until claim threshold is reached.

Exact minimum claim amount is implementation/config decision based on:

- xStock decimals;
- gas;
- economic usefulness.

---

# 298. Stockback Through Graduation

Stockback history and holder accounting must not reset at graduation.

If token graduates mid-epoch:

```text
00:00 → 13:22
Pre-grad Stockback generation

13:22
Graduation

13:22 → 24:00
Post-grad eligible Stockback generation
```

Both may contribute to the same logical daily epoch if implementation supports it cleanly.

User experience remains continuous.

---

# 299. Post-Grad Stockback

Post-graduation Stockback must be funded only by revenue explicitly eligible for Stockback.

Possible sources must be validated during implementation.

Never use:

- LP principal;
- locked liquidity reserves;
- creator's locked 65% core entitlement without product approval.

If post-grad venue limitations prevent equivalent Stockback fee capture:

- document the exact behavior;
- do not fake equivalent generation;
- preserve already-earned reward;
- escalate if product economics would materially change.

---

# 300. Stockback UX — Token Page

Recommended module:

```text
STOCKBACK

Reward Asset
NVDAx

Estimated Today
0.04182 NVDAx

Claimable
0.18321 NVDAx

Lifetime Earned
1.8241 NVDAx

[ Claim NVDAx ]
```

Additional market-level metrics:

```text
24h Stockback Generated
7d Stockback Generated
Lifetime Stockback Distributed
```

---

# 301. Stockback UX — Explore

Token cards may show:

```text
EARN NVDAx
```

or:

```text
24h Stockback
12.8 NVDAx
```

Potential discovery section:

## Top Stockback Markets

Possible sorting:

- 24h reward generated;
- 7d reward generated;
- reward velocity;
- volume;
- active holders.

Avoid presenting unstable projected APR as primary metric unless methodology is robust and clearly explained.

---

# 302. Stockback UX — Account Dashboard

Recommended aggregate view:

```text
STOCKBACK

Lifetime Earned
$1,842

NVDAx
0.8421

SPYx
1.274

QQQx
0.944
```

Actions:

```text
Claim
Claim All
```

Batch claim may be implemented if safe and gas-efficient.

---

# 303. Daily Stockback Finalization Moment

When an epoch finalizes, UI may show a restrained premium state:

```text
TODAY'S STOCKBACK FINALIZED

+0.0284 NVDAx

Total Claimable
0.2168 NVDAx
```

This should feel rewarding without casino-style animation.

---

# 304. Stockback Events / Data

Recommended event/data family:

```text
StockbackFunded
StockbackEpochFinalized
StockbackClaimed
```

Indexer should expose:

- current epoch;
- reward generated;
- estimated user accrual;
- finalized claimable;
- lifetime claimed;
- market lifetime distributed.

---

# 305. Stockback Bot / SDK Support

SDK/API should eventually expose conceptual methods such as:

```text
stockbackState(token)
stockbackEpoch(token)
stockbackClaimable(token, account)
stockbackHistory(token, account)
claimStockback(token)
```

Exact interface may be refined.

Bots should be able to distinguish:

- estimated;
- finalized;
- claimed.

---

# 306. Stockback Security Invariants

Hard invariants:

- creator locked share cannot be reduced silently;
- Stockback cannot use curve collateral;
- Stockback cannot use LP principal;
- Stockback reward asset must be official paired xStock;
- reward claims cannot exceed finalized entitlement;
- double claim impossible;
- transfer/sell cannot cause double-counted exposure;
- claim failure cannot brick trading;
- reward engine failure cannot brick graduation;
- claim cannot withdraw market collateral;
- epoch finalization cannot rewrite already-claimed history;
- admin cannot arbitrarily seize user finalized rewards;
- estimated rewards must never be represented as finalized claimable balance.

---

# 307. Stockback Testing Requirements

Required tests:

- one holder full epoch;
- multiple holders equal weight;
- different holding durations;
- buy near epoch end;
- sell near epoch start;
- multiple buy/sell cycles;
- wallet transfer;
- zero balance;
- dust holder;
- claim after selling;
- multiple unclaimed epochs;
- claim twice attempt;
- graduation mid-epoch;
- reward engine delayed;
- claim recipient failure where applicable;
- xStock decimal variations;
- high-volume reward accumulation;
- rounding conservation.

Invariant target:

```text
Finalized Epoch Rewards
=
Claimed
+
Unclaimed Finalized Entitlements
+
Documented Rounding Dust
```

No unexplained value leakage.

---

# 308. Stockback Anti-Manipulation Principle

V1 should not introduce arbitrary loyalty multipliers, whale multipliers, or creator-selected reward weights.

Initial weighting:

> time-weighted TOKEN balance only.

This keeps system:

- understandable;
- auditable;
- deterministic;
- resistant to snapshot gaming.

More advanced weighting can be considered only after real usage data.

---

# 309. Stockback Fee Simulation Required Before Lock

Exact Stockback fee must be simulation-driven.

At minimum test:

```text
Conservative
Buy +0.5%
Sell +0.5–1.0%

Balanced
Buy +1.0%
Sell +2.0%

Higher Reward
Buy +1.5%
Sell +2.5–3.0%
```

Evaluate:

- total user cost;
- reward generated;
- volume sensitivity;
- graduation velocity;
- arbitrage viability;
- creator revenue;
- platform revenue;
- holder reward significance;
- post-grad liquidity behavior.

Do not lock fee solely because another launchpad supports higher tax.

---

# 310. Stockback Product Positioning

Potential working messaging:

> **Hold launches. Earn their paired xStock.**

> **Trade the meme. Earn the stock.**

> **Every trade contributes to holders.**

Avoid:

- guaranteed yield;
- guaranteed APR;
- guaranteed dividend;
- ownership claims about underlying company shares.

---

# 311. Stockback Legal/Compliance Review

Because Stockback provides a valuable asset to holders based on holding behavior, specialist legal review is required before production.

Review should include:

- securities implications;
- rewards/yield characterization;
- tokenized-stock jurisdiction restrictions;
- marketing wording;
- disclosure;
- tax treatment considerations where applicable.

Engineering feasibility does not replace legal review.

---

# 312. Stockback V1 Locked Product Decisions

Approved:

- Stockback is a flagship holder-reward feature.
- Reward asset = official paired xStock.
- No staking required.
- Holder accounting = time-weighted.
- Epoch duration = 24 hours.
- Rewards generated from trading economics.
- Daily epoch finalization.
- Pull-based claim.
- Claimable reward accumulates until claimed.
- Selling does not erase previously earned reward.
- Graduation does not reset reward history.
- Creator locked 65% core share is not reduced.
- Reward engine isolated from trading solvency.
- Stockback contribution is locked at **+1% BUY / +2% SELL** for V1; economic simulation is a release-validation gate, not an implementation-time tuning permission.

---

**STOCKBACK V1 HOLDER REWARD MODEL + 1% BUY / 2% SELL CONTRIBUTION BASELINE LOCKED. ECONOMIC SIMULATION REMAINS A MANDATORY GO/NO-GO VALIDATION GATE.**

---

# 313. Stockback V1 — Complete Tax, Distribution, Claim & Website Specification

Bagian ini melengkapi Stockback dari level product concept menjadi **implementation-ready economic subsystem**.

Tujuan:

> Coding agent harus dapat memahami dengan jelas siapa membayar tax/fee, ke mana setiap bagian dana mengalir, siapa yang berhak menerima reward, kapan reward menjadi claimable, bagaimana website menampilkannya, dan apa yang terjadi pada setiap edge case.

---

# 314. V1 Fee / Tax Waterfall

## 314.1 Core Trading Fee

Locked existing economics:

```text
CORE TRADING FEE
1.00% of trade notional

0.65% of notional → Creator
0.35% of notional → Platform
```

Equivalent split of core fee:

```text
65% Creator
35% Platform
```

This split remains unchanged by Stockback.

## 314.2 Stockback Contribution

Recommended V1 implementation target:

```text
BUY Stockback Contribution
1.00% of trade notional

SELL Stockback Contribution
2.00% of trade notional
```

100% of Stockback Contribution funds holders.

Therefore target effective trading cost:

```text
BUY
1.00% Core Fee
1.00% Stockback
----------------
2.00% Total

SELL
1.00% Core Fee
2.00% Stockback
----------------
3.00% Total
```

Status:

> **1% BUY / 2% SELL Stockback is the locked V1 product baseline for implementation, simulation, testing, staging, and production candidate builds.**

Economic simulation must prove this configuration acceptable before GO. If it fails the approved criteria:

```text
BLOCKED
→ document evidence
→ escalate to product owner
→ create a new explicit product decision
```

The coding agent/engineer may not tune or replace these rates autonomously.

Creator share may never be reduced as an engineering workaround.

---

# 315. Exact Fee Destination Per Trade

For a market:

```text
TOKEN / NVDAx
```

## BUY Example

User spends:

```text
100 NVDAx
```

Target fee model:

```text
Core Trading Fee      1.00 NVDAx
  Creator             0.65 NVDAx
  Platform            0.35 NVDAx

Stockback             1.00 NVDAx
  HolderRewardVault   1.00 NVDAx
```

The remaining amount participates in trade execution according to curve math and documented fee convention.

## SELL Example

User sells TOKEN worth:

```text
100 NVDAx gross quote value
```

Target fee model:

```text
Core Trading Fee      1.00 NVDAx
  Creator             0.65 NVDAx
  Platform            0.35 NVDAx

Stockback             2.00 NVDAx
  HolderRewardVault   2.00 NVDAx
```

User receives net output after all applicable fees and slippage.

Exact fee-before-curve vs fee-after-quote arithmetic must be deterministic and documented.

The quote function and execution function must use the exact same convention.

---

# 316. Fee Transparency Requirement

Before every transaction the UI must show:

```text
Trade Amount
Core Fee
Stockback Contribution
Total Fees
Expected Receive
Minimum Receive
Slippage
Current Venue
```

Example BUY review:

```text
You Pay
100 NVDAx

Core Trading Fee
1.00 NVDAx

Stockback Contribution
1.00 NVDAx

Total Fees
2.00 NVDAx

Estimated Receive
42,184,120 TOKEN
```

Example SELL review:

```text
You Sell
42,184,120 TOKEN

Gross Quote Value
100 NVDAx

Core Trading Fee
1.00 NVDAx

Stockback Contribution
2.00 NVDAx

Estimated Receive
97 NVDAx
```

No hidden tax.

---

# 317. Stockback Contribution Naming

Primary user-facing terminology:

```text
Stockback Contribution
```

Alternative compact label:

```text
Stockback
```

Avoid presenting it only as:

```text
Tax
```

because the product value should be understandable.

Tooltip:

> A contribution from each trade that is distributed to eligible holders in this market's paired xStock.

Technical documentation may still refer to fee/tax mechanics where accurate.

---

# 318. Pre-Grad Stockback Funding Path

During PRE_GRAD:

```text
User Trade
    │
    ├── Core Fee
    │     ├── Creator Fee Bucket
    │     └── Platform Fee Bucket
    │
    └── Stockback Contribution
          │
          ▼
    HolderRewardVault
          │
          ▼
    Current Daily Epoch Pool
```

Stockback must be accounted separately from:

- curve collateral;
- creator fee;
- platform fee;
- LP migration principal.

Accounting buckets must never be inferred from raw contract balance alone.

---

# 319. Pre-Grad Accounting Buckets

For each market, accounting conceptually includes:

```text
curveCollateral
creatorFees
platformFees
stockbackPendingCurrentEpoch
stockbackFinalizedUnclaimed
```

If implementation centralizes rewards across markets, equivalent per-market accounting must still be provable.

Invariant:

```text
raw xStock balance
>=
curveCollateral
+ creatorFees
+ platformFees
+ stockback obligations
```

subject only to explicitly documented transfer timing.

---

# 320. Post-Grad Stockback Funding

Post-graduation design must preserve the same user-facing Stockback concept where technically possible.

Preferred model:

```text
TOKEN / xStock HyperSwap trading
↓
eligible protocol-controlled fee/revenue path
↓
Stockback allocation
↓
HolderRewardVault
```

The exact technical capture path depends on verified HyperSwap capabilities.

Priority:

1. preserve standard ERC-20 compatibility;
2. preserve permanent LP principal;
3. preserve creator economics;
4. avoid introducing fragile transfer-tax behavior unless explicitly approved;
5. maintain transparent Stockback generation.

If exact 1% BUY / 2% SELL Stockback cannot be enforced permissionlessly after graduation without changing token behavior:

```text
VERIFY / ESCALATE
```

Do not silently claim identical post-grad Stockback if the venue cannot produce it.

---

# 321. Post-Grad Product Behavior Requirement

The website must clearly distinguish the funding source if post-grad economics differ.

Example:

```text
Stockback
Active

Source
HyperSwap eligible fee revenue
```

or, if generation is temporarily lower:

```text
Stockback
Active at post-graduation rate
```

Never fake a pre-grad tax rate on post-grad trades that bypass the protocol.

Already-finalized rewards remain unaffected.

---

# 322. Eligible Holder Definition

Default V1 eligibility:

> Any wallet holding positive TOKEN balance contributes time-weighted balance, except explicitly excluded protocol/system addresses.

Eligible:

- normal EOAs;
- smart wallets;
- multisig wallets;
- contract wallets that legitimately hold TOKEN.

No identity/KYC requirement at reward-accounting layer unless required by future legal architecture.

---

# 323. Excluded Addresses

The following must not earn Stockback:

```text
zero address
dead/burn address
LaunchMarket
HolderRewardVault
FeeVault
GraduationRouter
HyperSwap pool / LP accounting addresses
protocol escrow addresses
other system addresses whose balances do not represent economic holders
```

Factory deployment must register or deterministically expose exclusions.

Reason:

> Pool liquidity and protocol custody must not compete with real holders for rewards.

---

# 324. LP / Pool Balance Exclusion

After graduation, TOKEN held inside the HyperSwap pool is not a holder reward participant.

Otherwise the LP itself could absorb a large percentage of Stockback.

Invariant:

```text
DEX_POOL_WEIGHT = 0
```

for Stockback holder distribution.

---

# 325. Creator Eligibility

Creator is eligible for Stockback **only for TOKEN they actually acquire under normal market rules**.

Creator receives:

```text
0% premine
```

If creator later buys TOKEN normally and holds it:

- their balance earns Stockback like any other holder;
- no multiplier;
- no special exclusion merely because they are creator.

---

# 326. Holder Weight Formula

For epoch `e`:

```text
userWeight[e]
=
Σ(balance × duration)
```

across every period in which user balance is constant.

Total eligible weight:

```text
totalWeight[e]
=
Σ userWeight[e]
```

Reward entitlement:

```text
userReward[e]
=
epochRewardPool[e]
× userWeight[e]
÷ totalWeight[e]
```

Use deterministic floor rounding.

Remainder handling must be explicit.

---

# 327. Rounding Dust

V1 recommended rule:

```text
epochDust
=
epochRewardPool
-
Σ finalized user rewards
```

Dust must never be assigned arbitrarily to creator/platform/admin.

Preferred options:

1. roll dust into next Stockback epoch for same market; or
2. accumulate until distributable.

Recommended V1:

> **Roll rounding dust into the next epoch of the same market.**

This keeps all Stockback funds economically dedicated to holders.

---

# 328. Zero-Eligible-Holder Epoch

If Stockback funds are generated but total eligible holder weight is zero:

```text
totalWeight = 0
```

then:

- do not divide by zero;
- do not send funds to creator/platform;
- carry the reward pool forward into the next epoch.

---

# 329. Epoch Identity

Each market has deterministic epoch identity.

Conceptual:

```text
epochId = floor(timestamp / 1 day)
```

Exact epoch origin must be fixed.

Recommended global boundary:

```text
00:00 UTC
```

All markets can share the same epoch boundaries.

This simplifies:

- indexing;
- user history;
- website display;
- analytics;
- auditability.

---

# 330. Current Epoch States

Stockback epoch lifecycle:

```text
OPEN
↓
READY_TO_FINALIZE
↓
FINALIZED
```

Optional failure/retry state:

```text
FINALIZATION_PENDING
```

The trading market must not pause while an epoch is pending finalization.

---

# 331. Finalization Authority

Locked V1 trust model:

> Deterministic off-chain TWAB computation + threshold-attested cumulative Merkle commitment + permissionless submission of a commitment carrying a valid attestor quorum.

Conceptual implementation:

```text
submitStockbackCommitment(
  market,
  sequence,
  cumulativeRoot,
  cumulativeTotal,
  datasetHash,
  quorumSignatures
)
```

Rules:

- arbitrary callers cannot create a valid root without quorum attestations;
- submitter receives no economic privilege;
- commitment is domain-separated by chain/vault/market/version;
- public dataset must reconstruct the root;
- activation delay applies before claims use the new root;
- trading/graduation do not depend on finalizer availability;
- stronger optimistic/zk verification may replace this model only after review.

---

# 332. Recommended Distribution Commitment Model

Because full on-chain iteration across every holder is unscalable, V1 uses a cumulative distribution architecture:

```text
On-chain Transfer + market events
↓
Indexer computes daily TWAB epoch
↓
Daily reward is added to each account's cumulative entitlement
↓
Cumulative distribution dataset built
↓
Threshold-attested cumulative Merkle root submitted
↓
Activation delay
↓
HolderRewardVault stores latest active root/sequence
↓
Users prove cumulative entitlement
↓
Claim = cumulative entitlement - already claimed
```

Critical:

- underlying inputs must be reconstructable;
- root generation must be deterministic;
- distribution file should be publicly auditable;
- claim proof cannot change entitlement.

---

# 333. Distribution Dataset

For each daily epoch, publish machine-readable audit data and a cumulative distribution dataset containing at minimum:

```text
market
token
rewardAsset
epochId / cumulativeSequence
startTime
endTime
epochReward
cumulativeRewardFunded
totalEligibleWeight
account
userWeight
epochRewardForAccount
cumulativeRewardForAccount
datasetHash
cumulativeMerkleRoot
```

The public dataset enables independent verification.

---

# 334. Finalization Delay

Recommended:

```text
Epoch Ends
↓
Short processing/finality window
↓
Epoch Finalized
```

Example target:

```text
00:00 UTC epoch ends
~minutes later finalized
```

Do not promise exact instant finalization if indexer/reorg safety requires a delay.

UI:

```text
Finalizing today's Stockback…
```

The delay should normally be short and operationally monitored.

---

# 335. Reorg Safety

Do not finalize using unstable chain data.

Finalization must wait for the protocol's documented safe confirmation/finality policy.

If a reorg changes trades/balances before finalization:

- recalculate TWAB;
- publish only canonical result.

After finalized commitment:

- reorg handling policy must prevent ambiguous double entitlements.

---

# 336. Claim Entitlement Model

For finalized epoch:

```text
claimable(account, epoch)
=
finalized entitlement
-
already claimed
```

Claims may be:

- per epoch;
- aggregated across epochs;
- batch.

UX should hide unnecessary complexity.

User-facing default:

```text
Claim All Available NVDAx
```

---

# 337. Claim Function Behavior

Conceptual:

```text
claimStockback(
  market,
  epochs,
  amounts,
  proofs
)
```

or an optimized equivalent.

Must:

1. verify entitlement;
2. mark claim consumed;
3. update accounting before external transfer;
4. transfer official reward xStock;
5. emit event.

Reentrancy-safe CEI required.

---

# 338. Claim All

Website should support:

```text
Claim All
```

where technically safe.

Potential modes:

### Per Market

```text
Claim all NVDAx from PEPEAI
```

### Per Reward Asset

```text
Claim all NVDAx
```

### Cross-Asset

```text
Claim All Stockback
```

Cross-asset batch is optional if gas/complexity becomes excessive.

---

# 339. Claim Gas UX

Before claim:

```text
Claimable
0.2184 NVDAx

Epochs
14

Estimated network fee
...

[ Claim NVDAx ]
```

If reward value is economically smaller than gas:

UI should not pressure user to claim.

Example:

```text
Your reward is still accumulating.
Claiming now may cost more than the reward value.
```

No forced expiration.

---

# 340. Claim Transaction States

Required UI states:

```text
CLAIM AVAILABLE
REVIEW CLAIM
WAITING FOR WALLET
SUBMITTED
PENDING
CONFIRMED
FAILED
RECONCILING
```

Button copy examples:

```text
Claim 0.2184 NVDAx
Waiting for Wallet…
Claim Submitted
Claim Confirmed
Retry Claim
```

---

# 341. Claim Success UX

Example:

```text
STOCKBACK CLAIMED

+0.2184 NVDAx

From
PEPEAI / NVDAx

[ View Transaction ]
[ Done ]
```

Use restrained premium animation.

No giant casino celebration.

---

# 342. Claim Failure UX

Examples:

### Proof / Epoch Sync

```text
Your latest Stockback data is still syncing.
Refresh in a moment and try again.
```

### Network

```text
Network connection was interrupted.
Your claim may still be pending. Checking status…
```

### Already Claimed

```text
This Stockback reward has already been claimed.
Your balance has been refreshed.
```

Raw revert may be shown under technical details, not as primary copy.

---

# 343. Claimable Website Surface — Token Page

Token terminal must include a dedicated Stockback panel.

Recommended collapsed summary:

```text
STOCKBACK
Earn NVDAx by holding TOKEN

Estimated Today     0.0418 NVDAx
Claimable           0.1832 NVDAx

[ Claim NVDAx ]
```

Expanded view:

```text
Reward Asset             NVDAx
Current Epoch            #184
Epoch Ends               07h 42m
Your Current Balance     4,821,442 TOKEN
Your Time-Weighted Share 1.84%
Estimated Today          0.04182 NVDAx
Claimable                0.18321 NVDAx
Lifetime Earned          1.82410 NVDAx
Lifetime Claimed         1.64089 NVDAx

Market 24h Stockback     18.42 NVDAx
Market 7d Stockback      104.81 NVDAx

[ Claim 0.18321 NVDAx ]
```

---

# 344. Estimated Today UX

`Estimated Today` is allowed to move in realtime.

It must be visually marked as:

```text
Estimated
```

Tooltip:

> Based on the current epoch's Stockback pool and your time-weighted holdings. Final amount is determined when the epoch is finalized.

Do not call it `Claimable` until finalized.

---

# 345. Epoch Countdown

Token page may show:

```text
Today's epoch ends in
07:42:18
```

This is informational only.

Do not imply user should buy just before the epoch ends.

Because weighting is time-based, late entry does not receive full-day weight.

---

# 346. Stockback History UI

Expanded Stockback view should include history:

| Date | Reward Asset | Earned | Status |
|---|---|---:|---|
| Sep 2 | NVDAx | 0.0284 | Claimable |
| Sep 1 | NVDAx | 0.0312 | Claimed |
| Aug 31 | NVDAx | 0.0198 | Claimed |

Status:

```text
ESTIMATED
FINALIZING
CLAIMABLE
CLAIMED
```

---

# 347. Account-Level Stockback Center

Account dashboard should have dedicated:

```text
Stockback
```

Top summary:

```text
Total Stockback Value
$1,842.18

Claimable Now
$241.62

Lifetime Earned
$2,913.04
```

Asset rows:

```text
NVDAx
Claimable 0.8421
Lifetime  2.1842

SPYx
Claimable 1.2740
Lifetime  4.0841

QQQx
Claimable 0.9440
Lifetime  1.4028
```

---

# 348. Account Stockback Filters

Useful filters:

```text
All
Claimable
Estimated
Claimed
```

Filter by reward asset:

```text
NVDAx
SPYx
QQQx
...
```

No unnecessary complexity.

---

# 349. Stockback Market Ranking

Explore may include:

```text
Top Stockback
```

Market-level metrics:

- 24h generated;
- 7d generated;
- lifetime distributed;
- current eligible holder count;
- Stockback / volume ratio.

Avoid ranking based on artificial annualized APR by default.

---

# 350. Stockback Token Card

Token card may show compactly:

```text
PEPEAI / NVDAx

MC       $84K
24h Vol  $921K

Stockback
18.4 NVDAx / 24h
```

or badge:

```text
EARN NVDAx
```

Do not overcrowd card.

---

# 351. Stockback Transaction Review

BUY review must show:

```text
Stockback Contribution
1.00 NVDAx

100% funds TOKEN holders
```

SELL review:

```text
Stockback Contribution
2.00 NVDAx

100% funds TOKEN holders
```

Tooltip:

> Stockback generated by this trade is added to the current daily reward pool for eligible TOKEN holders.

---

# 352. Does the Buyer Earn From Their Own Buy?

Important rule:

> A buyer begins accumulating time-weighted holder exposure **after the buy updates their TOKEN balance**.

The Stockback contribution generated by their buy goes into the current epoch pool.

Because distribution is based on full-epoch time-weighted balances:

- the buyer may earn a proportional fraction of the epoch pool afterward;
- they do not receive an immediate rebate equal to their own Stockback contribution.

This prevents Stockback from becoming a direct cashback loop.

---

# 353. Does the Seller Earn From Their Own Sell?

A seller's pre-sell balance accumulates weight until the sell execution timestamp/state transition.

After the sell:

- sold TOKEN stops earning;
- remaining TOKEN continues earning;
- Stockback generated by the sell enters the common epoch pool.

Thus:

> Sellers fund the reward pool while holders who remain continue accumulating exposure.

Already-earned time weight earlier in the epoch remains valid.

---

# 354. Full Exit Behavior

If a user exits completely mid-day:

```text
08:00–14:00
User held TOKEN
```

they retain their 6-hour time-weighted epoch exposure.

At finalization they may still receive part of that day's Stockback even though their ending balance is zero.

This is required for mathematically correct time-weighted distribution.

---

# 355. New Buyer Behavior

If a user buys near epoch end:

```text
23:59:00
Buy TOKEN
```

they receive only approximately one minute of holding exposure for that epoch.

No full-epoch snapshot benefit.

---

# 356. Wallet-to-Wallet Transfer

When TOKEN transfers A → B:

```text
A weight stops for transferred amount
B weight starts for transferred amount
```

at transfer execution time.

Reward asset itself is unaffected.

---

# 357. Contract Wallets

Contract wallets should be eligible unless explicitly classified as system/excluded addresses.

Do not automatically exclude all smart contracts, because:

- multisig;
- smart accounts;
- account abstraction wallets;

may represent legitimate users.

---

# 358. Blacklisted Reward Recipients

Protocol should not create arbitrary operator-controlled holder blacklists solely for Stockback.

Only deterministic system exclusions are allowed unless future legal requirements explicitly demand another architecture.

Any such future change is a product/legal decision.

---

# 359. Reward Funding Conservation Invariant

For each market:

```text
Total Stockback Collected
=
Current Open Epoch Pool
+ Finalized Unclaimed
+ Claimed
+ Rolled Dust
```

No unexplained destination.

If external transfers introduce token mechanics such as rebasing, accounting must explicitly handle them.

---

# 360. Rebasing / Corporate-Action Reward Asset Handling

Because some tokenized-stock implementations may adjust balances through corporate-action mechanics:

Implementation must verify how each official xStock behaves.

HolderRewardVault accounting must distinguish:

- nominal accounting entitlement;
- actual vault token balance;
- rebase/corporate-action effects.

Do not assume all xStocks are plain non-rebasing ERC-20s.

Production behavior must be tested against the actual canonical asset.

---

# 361. Vault Surplus / Deficit Rule

If actual reward-asset balance differs from recorded obligations due to rebase/corporate action:

The system must have a documented reconciliation rule.

Preferred principle:

> Economic benefit attributable to Stockback assets should remain with Stockback holders, not be silently swept to platform.

Exact per-asset accounting must be verified.

No admin may arbitrarily seize finalized user entitlements.

---

# 362. Unclaimed Rewards

Unclaimed finalized rewards remain reserved for users.

They cannot be:

- used as curve collateral;
- migrated as LP principal;
- counted as platform revenue;
- distributed to creator;
- reused for future users.

They remain a liability of HolderRewardVault until claimed or until a future explicitly approved long-duration expiry policy exists.

V1 default:

```text
NO EXPIRY
```

---

# 363. HolderRewardVault Solvency

At all times:

```text
vaultActualRewardAssets
>=
finalizedUnclaimedObligations
```

plus appropriate backing for any open-epoch funds already collected.

Claim execution must never depend on future trade volume.

---

# 364. Finalization Cannot Mint Entitlement Beyond Funding

For epoch:

```text
Σ userEntitlements
<=
fundedEpochReward
```

Any over-allocation must revert/reject finalization.

---

# 365. Root / Distribution Replacement

Once an epoch root/commitment is finalized and claims are enabled:

> It should not be arbitrarily replaceable.

If a correction mechanism is required for catastrophic data error:

- it must be tightly constrained;
- cannot reduce already-claimed entitlement;
- must be transparent;
- must be documented;
- should require stronger governance than normal finalization.

Preferred V1:

> Finalized root is immutable.

---

# 366. Finalization Liveness

If the normal finalizer is unavailable:

- another permissionless caller or authorized redundant service should be able to finalize using the same deterministic dataset/proof process;
- funds remain safe;
- trading continues.

No single keeper should be able to permanently halt rewards.

---

# 367. Distribution Service Transparency

Public status should expose:

```text
Current Epoch
Open / Finalizing / Finalized
Last Finalized Epoch
Last Finalization Time
Indexer Freshness
Reward Vault Balance
```

Where useful, advanced users can inspect distribution proof/data.

---

# 368. Stockback API

Recommended public endpoints / SDK concepts:

```text
getStockbackMarket(token)
getStockbackEpoch(token, epochId)
getStockbackAccount(token, account)
getStockbackClaimable(account)
getStockbackHistory(account)
getStockbackDistribution(token, epochId)
buildStockbackClaim(account)
claimStockback(...)
```

Realtime stream:

```text
stockback_funded
stockback_epoch_closed
stockback_finalizing
stockback_finalized
stockback_claimed
```

---

# 369. Stockback Website Realtime Behavior

During a live trade:

Market-level:

```text
24h Stockback Generated
```

can update immediately after confirmed trade/indexed event.

User-level:

```text
Estimated Today
```

may update based on live calculated TWAB estimate.

Claimable does not update until epoch finalization.

---

# 370. Stockback Loading States

Token page:

```text
Loading Stockback…
```

Use stable skeleton matching final panel dimensions.

Do not show:

```text
0 NVDAx
```

while data is unknown, because zero is valid financial data.

---

# 371. Stockback Stale State

If indexer/reward estimate is stale:

```text
Stockback data delayed
Last updated 2m ago
```

Claimable data should be resolved from canonical finalized commitments where possible.

Trading remains available unless unrelated critical dependency fails.

---

# 372. Stockback Empty State

If holder has never earned:

```text
No Stockback yet.

Hold TOKEN while the market trades to earn NVDAx from daily Stockback distributions.
```

CTA may be:

```text
View Market
```

Do not guarantee future rewards.

---

# 373. Stockback Zero-Volume Day

If no Stockback contribution is generated during an epoch:

```text
Today's Stockback
0 NVDAx

No Stockback was generated during this epoch.
```

No fake minimum reward.

---

# 374. Stockback Claim CTA Priority

On token terminal, Stockback should be visible but must not overpower Buy/Sell.

Priority:

```text
1. Trading
2. Market Status / Chart
3. Stockback
4. Secondary analytics
```

Account dashboard may give Stockback more prominence.

---

# 375. Mobile Stockback UX

Mobile token page:

```text
STOCKBACK
Estimated  0.0418 NVDAx
Claimable  0.1832 NVDAx

[ Claim ]
[ Details ]
```

Details opens bottom sheet:

- epoch;
- holding weight;
- history;
- market generated rewards;
- explanation.

Claim CTA must have adequate touch size.

---

# 376. Stockback Explanation Tooltip

Short version:

> Stockback distributes part of trading activity to eligible holders in the official xStock paired with this token. Rewards are based on how much TOKEN you hold and for how long during each daily epoch.

---

# 377. Tax / Fee FAQ

Website/docs must answer:

### Why is BUY fee 2%?

```text
1% core trading fee
+
1% Stockback contribution
```

### Why is SELL fee 3%?

```text
1% core trading fee
+
2% Stockback contribution
```

### Where does Stockback go?

100% of the Stockback contribution enters the holder reward pool.

### Does creator lose revenue?

No. Creator's locked share of the core fee remains unchanged.

### Do I need to stake?

No.

### When can I claim?

After daily epoch finalization.

### If I sell before midnight, do I lose today's reward?

No. Your time-weighted holding period still counts.

### If I buy just before midnight, do I get the whole day's reward?

No.

---

# 378. Stockback Economic Dashboard for Creators

Creator Control Center can show:

```text
Your Creator Fees
...

Holder Stockback Generated
24h    18.42 NVDAx
7d     104.81 NVDAx
Total  841.28 NVDAx
```

This demonstrates holder value without reducing creator income.

Share action:

```text
Share Stockback Stats
```

---

# 379. Stockback Share Card

Optional share asset:

```text
PEPEAI / NVDAx

24h Stockback Generated
18.42 NVDAx

Lifetime Distributed
841.28 NVDAx

Hold PEPEAI. Earn NVDAx.
```

Must use timestamp/current-data context.

---

# 380. Launch Form Stockback Disclosure

Creator preview/review should show:

```text
STOCKBACK
Enabled by Protocol

Reward Asset
NVDAx

Target Buy Contribution
1.00%

Target Sell Contribution
2.00%

Creator Core Fee Share
65% — unchanged
```

Creator cannot disable Stockback in V1 if Stockback is protocol-standard.

This preserves consistent market economics.

---

# 381. Creator Cannot Redirect Stockback

Creator cannot:

- change reward asset;
- redirect rewards to themselves;
- alter holder weights;
- withdraw reward vault;
- disable an active epoch;
- seize unclaimed reward.

Stockback is protocol-defined.

---

# 382. Platform Cannot Redirect Finalized Stockback

Platform/admin cannot:

- sweep finalized holder obligations;
- reclassify them as revenue;
- reduce entitlement after finalization;
- redirect reward asset.

Only narrowly defined recovery of unrelated accidental tokens may exist, and must never include reward assets backing obligations.

---

# 383. Accidental Token Recovery

If arbitrary unsupported tokens are sent to HolderRewardVault:

A recovery mechanism may exist only if:

- asset is not an official reward asset with obligations;
- recovery cannot reduce solvency;
- action is transparent/evented.

No recovery function may withdraw required xStock backing.

---

# 384. Stockback Launch Readiness Addendum

Production Stockback = NO-GO unless:

- [ ] BUY/SELL fee arithmetic simulation passes.
- [ ] Quote and execution fee parity passes.
- [ ] Creator 65% core share verified unchanged.
- [ ] Platform 35% core share verified unchanged.
- [ ] Stockback contribution routed correctly.
- [ ] Curve collateral fully isolated.
- [ ] LP principal fully isolated.
- [ ] Official reward asset verified.
- [ ] System/excluded addresses defined.
- [ ] DEX pool balance excluded.
- [ ] Creator normal-holder behavior verified.
- [ ] TWAB calculation verified.
- [ ] Epoch boundaries verified.
- [ ] Reorg/finality policy verified.
- [ ] Threshold attestor quorum/domain separation verified.
- [ ] Finalization commitment verified.
- [ ] Cumulative Merkle claim accounting verified.
- [ ] Public distribution dataset reproducible.
- [ ] Claim proofs verified.
- [ ] Double claim impossible.
- [ ] Claim after full exit works.
- [ ] Multiple-epoch claim works.
- [ ] Dust rollover works.
- [ ] Zero-holder carry-forward works.
- [ ] Vault solvency invariant passes.
- [ ] No-expiry liability accounting passes.
- [ ] xStock rebase/corporate-action behavior reviewed.
- [ ] Post-grad funding source verified.
- [ ] Website Estimated vs Claimable states correct.
- [ ] Claim UI full state machine tested.
- [ ] Mobile claim flow tested.
- [ ] Reconnect/reload claim reconciliation tested.
- [ ] Stockback API/indexer monitored.
- [ ] Legal wording reviewed before public production launch.

---

# 385. Stockback End-to-End Acceptance Scenario

Mandatory scenario:

```text
Market launches TOKEN / NVDAx

Alice buys
→ pays core fee
→ pays Stockback contribution
→ receives TOKEN
→ begins time-weighted accrual

Bob buys later
→ contributes Stockback
→ begins lower-duration accrual

Alice sells partially
→ SELL Stockback contribution enters pool
→ sold balance stops accruing
→ remaining balance continues

Charlie buys one minute before epoch end
→ receives only one minute of exposure

Epoch closes
→ canonical events finalized
→ TWAB distribution computed
→ commitment published
→ HolderRewardVault finalizes epoch

Website changes:
Estimated → Finalized / Claimable

Alice claims
→ receives official NVDAx
→ claim event emitted

Alice later sells all TOKEN
→ historical claimable remains valid

Next day:
new epoch starts
→ no reset of lifetime history

Token graduates mid-future epoch
→ history remains continuous
→ post-grad eligible Stockback source takes over

No creator revenue reduction
No platform core split reduction
No LP principal use
No curve collateral use
```

---

# 386. Stockback V1 Final Product Contract

Stockback V1 is defined as:

```text
Reward Asset:
Official paired xStock

Core Fee:
1%

Core Fee Split:
65% Creator
35% Platform

Target Stockback Contribution:
BUY  +1%
SELL +2%

Target Total User Fee:
BUY   2%
SELL  3%

Holder Eligibility:
Positive TOKEN balance
minus deterministic system exclusions

Weight:
Time-weighted TOKEN balance

Epoch:
24 hours

Finalization:
Daily after canonical-data/finality processing

Distribution:
Deterministic entitlement commitment

Claim:
Pull-based

Staking:
None

Reward Expiry:
None in V1

Pool/LP Eligibility:
Excluded

Creator Special Weight:
None

Creator Core Revenue Reduction:
None

Curve Collateral Funding:
Forbidden

LP Principal Funding:
Forbidden

Claim Failure Effect on Trading:
None

Graduation Effect on Historical Rewards:
None
```

Production fee percentages remain subject to the explicit economic-simulation gate, but this target model is the canonical V1 implementation baseline unless product approval changes it.

---

**STOCKBACK V1 COMPLETE ECONOMICS + DISTRIBUTION + CLAIM + WEBSITE SPEC APPROVED.**

---

# 387. Stockback Per-Market Rate Immutability

For each market, Stockback fee configuration must be snapshotted at launch.

Example V1 target snapshot:

```text
stockbackBuyBps  = 100
stockbackSellBps = 200
```

Once market is launched:

> **Existing market Stockback rates are immutable.**

Platform governance may change protocol defaults for **new launches only**.

Forbidden:

- silently increasing existing market BUY Stockback;
- silently increasing existing market SELL Stockback;
- reducing holder rate on an existing market;
- changing rates based on creator request;
- changing rates based on temporary platform revenue needs.

If a future protocol upgrade requires different economics, it applies only under an explicit versioned product decision.

---

# 388. Stockback Version Snapshot

Each launch should record a Stockback economics/version identifier.

Example:

```text
stockbackVersion = 1
```

Associated immutable launch snapshot should be reconstructable:

```text
rewardAsset
buyContributionBps
sellContributionBps
epochDuration
distributionModelVersion
excludedAddressPolicyVersion
```

Benefits:

- deterministic bot integration;
- auditable historical economics;
- frontend can render exact market rules;
- new protocol versions do not rewrite old markets.

---

# 389. Canonical PRE_GRAD Stockback Rule

PRE_GRAD is the protocol-enforced Stockback environment.

Canonical target V1:

```text
Core Fee
1%

Stockback
BUY  +1%
SELL +2%
```

Because LaunchMarket controls execution, Stockback routing is enforceable at contract level.

Requirements:

- quote functions include all fees;
- execution matches quote;
- Stockback contribution enters HolderRewardVault;
- fee cannot be bypassed through official pre-grad execution path.

---

# 390. Canonical POST_GRAD Stockback Rule

Post-graduation trading occurs on HyperSwap.

Because TOKEN remains a standard no-tax ERC-20, Stockback cannot be assumed to remain enforceable at the exact PRE_GRAD BUY/SELL rate for direct external HyperSwap swaps.

Therefore:

```text
POST_GRAD STOCKBACK
=
eligible protocol-controlled post-grad revenue
```

until a verified venue-native mechanism exists.

Priority order:

1. Verify whether HyperSwap supports a safe venue-native mechanism/hook/custom fee path compatible with the product.
2. If available and security-reviewed, maintain a defined Stockback schedule.
3. If unavailable, fund Stockback only from protocol-controlled eligible LP/fee revenue.
4. Never use LP principal.
5. Never reduce creator's locked entitlement without explicit product approval.
6. Never add transfer-tax behavior to LaunchToken silently.
7. Never advertise a fee rate the protocol cannot enforce.

---

# 391. No Silent Transfer-Tax Upgrade

LaunchToken V1 remains:

```text
standard immutable ERC-20
no transfer tax
```

Stockback does not authorize engineering to convert LaunchToken into a taxed transfer token without explicit product approval.

If future research concludes a transfer-tax model is the best way to preserve post-grad Stockback:

- security review required;
- DEX compatibility review required;
- bot/integration impact review required;
- economics simulation required;
- UX disclosure required;
- masterplan version change required.

---

# 392. Stockback Source-of-Truth Hierarchy

Canonical hierarchy:

```text
Trade fee funding
→ on-chain LaunchMarket / post-grad eligible fee source

Vault balance / obligations
→ HolderRewardVault

Finalized epoch entitlement
→ immutable finalized distribution commitment

Claim consumed state
→ HolderRewardVault on-chain claim state

Estimated current-epoch reward
→ indexer/TWAB derived estimate only
```

Rule:

> Estimated UI data can be rebuilt. Finalized entitlement and claim state must remain independently verifiable.

---

# 393. Stockback Global P0 Requirement

Because Stockback is a flagship economic promise, the following are P0 launch blockers:

```text
fee routing correctness
HolderRewardVault solvency
official reward-asset verification
TWAB correctness
excluded-address correctness
DEX pool exclusion
epoch finalization
distribution reproducibility
claim proof correctness
double-claim prevention
no-expiry liability accounting
website Estimated vs Claimable correctness
post-grad Stockback disclosure
monitoring
```

A build where trading works but Stockback is materially incorrect is **NO-GO** for a release marketed with Stockback.

---

# 394. Updated Global Accounting Invariant

For each market / reward asset, economic obligations must satisfy:

```text
raw held xStock assets
>=
curveCollateral
+ creatorFees
+ platformFees
+ stockbackOpenEpoch
+ stockbackFinalizedUnclaimed
```

subject only to explicitly documented asset custody separation across contracts.

LP principal is separately accounted in the post-grad venue and must never be treated as available protocol balance.

---

# 395. Updated Economic Summary — V1 Target

Canonical V1 target summary:

```text
PRE-GRAD BUY
Core Fee              1%
Stockback             1%
Target Total          2%

PRE-GRAD SELL
Core Fee              1%
Stockback             2%
Target Total          3%

CORE FEE SPLIT
Creator               65%
Platform              35%

STOCKBACK SPLIT
Eligible Holders      100%

REWARD ASSET
Official paired xStock

STOCKBACK SETTLEMENT
24h time-weighted epoch

CLAIM
Pull-based, no staking

EXISTING MARKET RATE
Immutable after launch

POST-GRAD
Uses only verified/enforceable eligible revenue source;
must not pretend PRE_GRAD rate remains enforceable if it does not.
```

Production Stockback percentages still require economic-simulation sign-off before mainnet, but this is the canonical V1 implementation target.

---

**STOCKBACK GLOBAL INTEGRATION + ECONOMICS SYNCHRONIZATION APPROVED.**

---

# 396. Brutal Audit Remediation — Canonical Technical Corrections

This section records corrections discovered during a whole-document adversarial review. These rules supersede any older wording that conflicts with them.

Priority:

```text
FUND SAFETY
→ ACCOUNTING CORRECTNESS
→ IMMUTABLE PRODUCT ECONOMICS
→ CANONICAL EXTERNAL INTEGRATION
→ RELIABLE CLAIM/GRADUATION
→ UX QUALITY
```

If an earlier example conflicts with Sections 396+, **Sections 396+ win** unless a later explicit product decision says otherwise.

---

# 397. Canonical Venue vs Unofficial Third-Party Markets

LaunchToken remains a freely transferable vanilla ERC-20.

Therefore it is technically impossible to guarantee that no third party can create an external pool before or after graduation.

The correct invariant is:

> **Exactly one protocol-canonical execution venue per lifecycle state.**

```text
PRE_GRAD
Canonical = LaunchMarket

GRADUATED
Canonical = stored HyperSwap pool
```

Rules:

- unofficial pools do not affect curve state;
- unofficial pools do not affect graduation progress;
- unofficial pools are not canonical chart/accounting sources;
- unofficial trades may bypass creator/core/Stockback economics because the protocol does not control them;
- UI/SDK must never present an unofficial pool as the canonical market;
- protocol must not add transfer restrictions merely to make this global invariant artificially true.

This replaces any literal interpretation of “only one market can exist globally.”

---

# 398. Canonical HyperEVM xStock Representation

On HyperEVM, the protocol must pair against the **canonical HyperEVM representation corresponding to the official xStock**, which may be a wrapped xStock rather than the same token representation used on another chain/HyperCore.

Registry identity must include at minimum:

```text
quoteAssetAddress
underlyingXStockId
displaySymbol
quoteAssetDecimals
representationType
multiplier/share model
price/multiplier source
tradingHalted source
corporateAction status source
HyperCore mapping if relevant
```

UI may display ecosystem-friendly labels such as `NVDAx`, while transaction review must expose the actual canonical HyperEVM contract address/representation.

Never assume the entire global xStocks catalog is deployed and safe on HyperEVM.

---

# 399. XStockAssetAdapter — Normalized Quote Accounting

Add a logical component:

`XStockAssetAdapter`

Purpose:

> Convert between transferable wrapper-token units and a stable normalized accounting/share unit so multiplier/rebase/corporate-action changes cannot silently corrupt curve collateral, fees, or Stockback liabilities.

Conceptual interface:

```text
toNormalizedShares(assetAmount)
toAssetAmount(normalizedShares)
currentMultiplier()
assetPriceUSD()
isTradingHalted()
hasPendingDiscontinuity()
```

Exact interface depends on verified xStock contracts/APIs.

Hard rule:

> Raw user-visible `balanceOf()` units must not be assumed to be a permanently stable accounting unit for a multiplier/rebasing xStock representation.

An xStock cannot enter the production registry until normalized accounting behavior is proven for that exact HyperEVM representation.

---

# 400. Normalized Economic Buckets

Where supported quote assets use multiplier/share semantics, protocol economic liabilities should be tracked in normalized quote shares or another proven invariant unit.

Logical buckets:

```text
curveCollateralShares
creatorFeeShares
platformFeeShares
stockbackOpenEpochShares
stockbackFinalizedUnclaimedShares
```

At transfer time:

```text
normalized shares
→ XStockAssetAdapter
→ current transferable asset amount
```

This applies to:

- curve buy/sell accounting;
- creator/platform fees;
- Stockback epoch funding;
- Stockback claims;
- graduation reserves.

If a supported asset is demonstrably non-rebasing/non-multiplier in its HyperEVM wrapper, adapter conversion may be 1:1 but the interface remains explicit.

---

# 401. Corporate Action / Multiplier Safety Gate

For every supported quote asset, the integration must consume authoritative health signals where available.

States:

```text
HEALTHY
PENDING_DISCONTINUITY
TRADING_HALTED
DATA_STALE
UNSUPPORTED
```

Rules:

- block NEW launches when asset health is unsafe;
- do not start a launch with an unresolved upcoming multiplier discontinuity;
- for an existing market, fail closed on canonical trading if the quote asset itself is officially halted or safe conversion cannot be determined;
- never seize user funds;
- reward/fee liabilities remain reserved;
- UI shows exact affected dependency/status;
- resumption requires canonical health data, not arbitrary admin price input.

Live USD-price staleness alone is different from quote-asset safety and does not automatically halt deterministic curve trading.

---

# 402. Oracle Role Split — Launch Anchor vs Live Display

Two concepts must not be conflated.

## Launch Anchor

Required once when creating a market:

```text
valid xStock effective USD value
→ derive P0
→ snapshot immutable launch anchor
```

If invalid/stale, the launch is blocked.

## Live USD Display

After launch:

- displays current USD-equivalent TOKEN price/MC;
- may show stale/delayed state;
- does not determine canonical curve price;
- does not determine graduation progress;
- does not halt buy/sell/graduation merely because the display feed is stale.

Canonical graduation remains a function of immutable launch anchor + on-chain curve state.

---

# 403. Reference MC vs Live USD MC — UX Contract

The website must distinguish:

```text
Reference Graduation Progress
```

from:

```text
Live USD-Equivalent Market Cap
```

Because the paired xStock can move after launch, the live USD-equivalent MC at the deterministic graduation endpoint may differ from exactly $50,000.

UI must never imply that the live USD number itself triggers graduation.

Recommended tooltip:

> Graduation follows the market's fixed launch-time reference curve. Live USD market cap moves with the paired xStock and is shown for current valuation context.

---

# 404. Stockback Root Trust Model — V1 Locked Architecture

The previous phrase “permissionless Merkle finalization” is insufficient by itself because an arbitrary caller cannot be allowed to submit an arbitrary reward root.

V1 uses:

> **Deterministic off-chain TWAB computation + threshold-attested cumulative Merkle commitment + permissionless on-chain submission of valid attestations.**

Flow:

```text
Canonical chain events
↓
Independent/redundant indexer computation
↓
Deterministic cumulative distribution dataset
↓
Dataset hash + Merkle root
↓
Threshold attestors sign commitment
↓
Anyone may submit valid quorum signatures
↓
HolderRewardVault verifies quorum/domain
↓
Activation delay
↓
Root becomes ACTIVE
↓
Users claim
```

The transaction submitter receives no economic privilege.

---

# 405. Stockback Attestation Domain

Signed commitment must be domain-separated and bind at minimum:

```text
chainId
HolderRewardVault address
market address
token address
reward asset
distribution version
epoch/cumulative sequence
total cumulative entitlement
Merkle root
dataset hash
```

This prevents:

- cross-chain replay;
- cross-market replay;
- vault replay;
- old-version replay;
- reward-asset substitution.

Attestor keys must not custody Stockback funds.

---

# 406. Stockback Attestor Security

Recommended production shape:

```text
threshold quorum
+ independently deployed indexer instances
+ public distribution dataset
+ activation delay
+ monitoring
```

Exact threshold (e.g. 2-of-3 / 3-of-5) is infrastructure selection, but:

- one hot backend key must not unilaterally control a root;
- root submission and fund custody must use separate authority;
- signer compromise cannot withdraw arbitrary vault funds;
- claims can be paused independently if a bad root is detected before activation;
- trading/graduation remain unaffected.

If stronger optimistic/zk verification is later introduced, it may replace the attestation model only after security review.

---

# 407. Cumulative Merkle Distribution — Scalability Rule

Daily epochs remain the user-facing reward period, but V1 should not require permanent on-chain storage of every account entitlement for every historical day.

Recommended on-chain model:

```text
latestCumulativeRoot[market]
latestSequence[market]
claimedCumulative[market][account]
```

Each new daily dataset contains **cumulative entitlement to date**.

Claim:

```text
claimable
=
latest proven cumulative entitlement
-
already claimed cumulative amount
```

Benefits:

- no short reward expiry;
- old unclaimed reward remains claimable through latest proof;
- bounded root storage per market/version;
- daily history remains available off-chain/publicly auditable;
- batch claim remains feasible.

Historical roots/datasets should remain archived for audit even if only latest active cumulative root is necessary for normal claims.

---

# 408. Stockback Merkle Leaf

Recommended conceptual leaf:

```text
keccak256(
  chainId,
  vault,
  market,
  account,
  rewardAsset,
  distributionVersion,
  cumulativeNormalizedRewardShares
)
```

Exact encoding must be standardized and published.

Do not use ambiguous packed encoding where collisions could arise.

---

# 409. Stockback Canonical Input Data

TWAB computation must consume all canonical `Transfer` events from LaunchToken, not only LaunchMarket buy/sell events.

This is required because TOKEN is freely transferable.

Pipeline must correctly process:

- mint/genesis reserve setup;
- buys;
- sells;
- wallet-to-wallet transfers;
- pool/system transfers;
- graduation transfers;
- excluded-address transitions;
- reorg rollback/replay.

System/DEX exclusions must be deterministic and versioned.

---

# 410. Sell Fee Funding Clarification

The rule “Stockback cannot use curve collateral” means:

> The protocol cannot subsidize Stockback by raiding collateral beyond a user's own trade economics.

For a SELL:

```text
curve computes gross xStock liability
↓
curveCollateral decreases by gross liability
↓
gross proceeds are partitioned into:
  seller net output
  core trading fee
  Stockback contribution
```

Thus SELL fees are economically paid from the seller's gross proceeds even if the xStock physically originates from LaunchMarket custody.

This is not an unauthorized collateral subsidy.

Accounting must atomically reclassify the fee portions out of `curveCollateral` into their destination liabilities.

---

# 411. Graduation-Crossing Order — Exact Fee Segmentation

A crossing BUY must not charge PRE_GRAD fees on notional that is actually executed post-graduation unless explicitly disclosed as a router fee.

Canonical V1 sequence:

```text
Gross user input
↓
Determine gross amount required for final PRE_GRAD curve segment
↓
PRE_GRAD segment:
  core fee 1%
  Stockback BUY contribution target
  curve net input
↓
Reach exact endpoint
↓
Graduate atomically
↓
Remaining user input
↓
POST_GRAD HyperSwap execution
  native HyperSwap fee
  only verified/enforceable post-grad Stockback policy
↓
Aggregate TOKEN output
↓
Enforce one user-wide minTokensOut
```

If the post-grad leg or graduation fails and the path is atomic, the entire user action reverts.

UI must show a blended route/fee breakdown for a crossing order.

---

# 412. CREATE2 Vanity Front-Run Protection

Vanity address prediction must be bound to the intended creator/launch intent so a mempool observer cannot steal a predicted vanity deployment or creator registration by copying a public salt.

Recommended rule:

```text
effectiveSalt
=
keccak256(
  creator,
  userSalt,
  launchVersion,
  pairIdentity,
  launchIntentHash
)
```

or an equivalent creator-bound construction.

Factory must verify:

- caller/creator authorization;
- predicted address;
- salt/config binding;
- replay protection.

A front-runner using the observed transaction must not be able to become creator of the same predicted launch.

---

# 413. HyperSwap Delegated Fee-Right Custody

HyperSwap's delegated liquidity mechanism may represent fee collection rights with a transferable NFT while keeping LP principal permanently locked.

Launchpad requirement:

> The protocol's delegated fee-right NFT must not become an admin-transferable asset that can be sold/stolen away from creator/platform/Stockback accounting.

Recommended custody:

```text
Delegated fee-right NFT
→ immutable/non-arbitrary FeeVault custody
```

FeeVault must not expose a generic `execute()` / arbitrary ERC721 transfer path capable of transferring the canonical delegated fee-right NFT.

Any future fee-vault migration requires explicit, narrow, auditable migration logic and product/security approval.

---

# 414. HyperSwap External Pause Risk

The external delegated-position vault may have its own emergency pause/admin controls.

If external fee collection is paused:

- LP principal remains treated as locked according to the verified primitive;
- canonical post-grad trading can continue if HyperSwap pool itself remains healthy;
- creator/platform/Stockback fee collection may be delayed;
- UI must show fee-collection dependency degradation;
- accrued rights must not be treated as lost merely because collection is temporarily unavailable.

Monitor this external dependency separately.

---

# 415. HyperSwap V3 Range — V1 Safety Rule

Because graduation LP principal is intended to remain permanently locked and normal repositioning cannot be assumed, a narrow concentrated range can become permanently inactive.

V1 default:

> **Use the widest/full-range HyperSwap V3 position that is technically supported and includes the initial graduation price, unless a verified lock primitive supports safe range management without exposing principal withdrawal authority.**

Any alternative range strategy must prove:

- initial price lies inside range;
- no privileged principal withdrawal;
- long-term liquidity cannot be trivially stranded;
- exact migration amounts are compatible;
- fee-right management does not imply principal control.

Range selection is therefore not a casual frontend/engineering tuning parameter.

---

# 416. Exact V3 Graduation Geometry

The analytical curve endpoint formula remains the economic reference model.

However HyperSwap V3 minting uses tick/range-specific liquidity math, not a generic constant-product reserve deposit.

Before production:

1. choose verified V1 tick/range policy;
2. simulate exact V3 amount0/amount1 requirements at final marginal price;
3. prove remaining TOKEN + curveCollateral can be consumed within documented dust tolerance;
4. prove initial spot price continuity;
5. define deterministic handling of unavoidable mint dust.

Forbidden:

- silently sending meaningful leftover migration assets to creator/platform;
- changing qG/economics merely to satisfy a coding shortcut;
- pretending V2 reserve-ratio math is exact V3 mint math.

If exact V3 geometry requires a material economic change, escalate as product decision before implementation.

---

# 417. Graduation Dust Destination

Unavoidable tiny V3 mint/rounding leftovers must have a deterministic holder-neutral destination.

Preferred order:

1. add to permanently locked liquidity if the venue permits;
2. otherwise retain in a dedicated non-withdrawable graduation-dust account attributable to the market;
3. never credit creator/platform as windfall.

Dust threshold must be simulation-tested and bounded.

---

# 418. Post-Grad LP Fee Asset Semantics

HyperSwap V3 LP fees may accrue in both pool assets:

```text
TOKEN
+
paired xStock
```

Masterplan must not assume all post-grad fee revenue arrives in xStock.

Canonical creator rule:

> Creator's 65% entitlement applies to creator-eligible LP fee revenue in the asset(s) actually collected, unless a separately approved conversion policy exists.

Do not auto-market-sell TOKEN fees into xStock merely to simplify accounting; that creates protocol-induced sell pressure.

Frontend may show an aggregated USD estimate, but claim assets must be explicit.

---

# 419. Post-Grad Stockback Funding Boundary

Stockback reward asset remains the paired xStock.

Therefore post-grad Stockback may use only:

- paired-xStock-denominated protocol-controlled fee revenue; or
- another explicitly approved mechanism that acquires paired xStock transparently.

TOKEN-side LP fees must not be automatically sold to fund Stockback without explicit product approval.

Creator's 65% entitlement remains untouched.

**One product-economic parameter still requires explicit lock before mainnet:** what fraction of the platform's post-grad paired-xStock LP-fee share is redirected to Stockback.

Recommended starting candidate for simulation/product approval:

```text
Creator: 65% of creator-eligible LP fees in-kind

From platform's 35% share of paired-xStock LP fees:
  50% of platform share -> Stockback
  50% of platform share -> Platform

TOKEN-denominated platform fee share:
  remains Platform unless a future conversion policy is approved
```

This recommendation is **NOT LOCKED** until product approval.

---

# 420. Current HyperEVM xStock Availability Rule

The production registry must be allowlist-based per verified HyperEVM deployment.

Do not infer availability from the global xStocks product catalog.

At any given release, only quote assets that pass all of the following may be enabled:

```text
canonical HyperEVM representation verified
transfer behavior verified
multiplier/share behavior verified
price/multiplier source verified
trading-halt source verified
HyperSwap compatibility verified
normalized accounting tests passed
legal/operator availability reviewed
```

New xStocks can be added for new launches after passing the same gate.

---

# 421. Agent Canonical Quick-Start Contract

Every coding agent/team must read this section before implementation.

## LOCKED

Do not change without explicit product approval:

- HyperEVM target;
- official/canonical HyperEVM xStock representation only;
- 1B fixed TOKEN supply;
- creator allocation 0%;
- platform allocation 0%;
- no creator liquidity deposit;
- $2K launch-time reference MC;
- $50K/25x reference graduation endpoint;
- two-way PRE_GRAD curve trading;
- 1% core fee;
- 65/35 creator/platform core-fee split;
- Stockback architecture / official paired-xStock reward;
- no staking for Stockback;
- 24h time-weighted reward epochs;
- production Stockback rate immutable per market once launched;
- creator share not reduced by Stockback;
- auto graduation;
- same TOKEN address;
- permanent LP principal;
- HyperSwap canonical post-grad venue;
- LaunchToken vanilla/no transfer tax unless future explicit redesign;
- CREATE2 vanity with creator-bound anti-front-run protection;
- bot-first/realtime integration;
- premium/quant-grade/responsive/accessibility/performance UI quality.

## VERIFY BEFORE PRODUCTION

- exact canonical HyperEVM xStock addresses;
- wrapper/multiplier/share semantics;
- xStock health/corporate-action interfaces;
- HyperSwap addresses/fee tiers/ticks;
- delegated-position lock behavior;
- exact V3 mint geometry;
- production reference-price/multiplier sources;
- legal/operator restrictions.

## CHOOSE

Engineering may select:

- framework/libraries;
- storage/code organization;
- exact fixed-point representation;
- indexer/database infrastructure;
- chart/motion stack;
- CI/CD/monitoring vendors;

only if locked behavior/invariants remain intact.

## DO NOT GUESS

If an external capability required by a LOCKED rule does not exist, mark BLOCKED and escalate. Never silently approximate product economics or custody behavior.

---

# 422. Requirements Traceability Matrix — Core Wiring

| Requirement | Canonical Contract / State | Service / Indexer | Primary UI | Mandatory Proof/Test | Release Gate |
|---|---|---|---|---|---|
| Token authenticity | Factory registry/events | token index | token header/search | fake-symbol/duplicate tests | P0 |
| Fixed 1B supply | LaunchToken | supply index | token info | mint invariant | P0 |
| Official xStock pair | XStockRegistry + AssetAdapter | asset registry sync | launch selector/token header | canonical-address + adapter tests | P0 |
| Curve pricing | LaunchMarket | quote/cache | trade panel/chart | simulation + fuzz | P0 |
| Core fee 65/35 | LaunchMarket/FeeVault | fee index | review/creator dashboard | accounting invariant | P0 |
| Stockback funding | LaunchMarket/HolderRewardVault | Stockback index | review/Stockback panel | conservation invariant | P0 |
| TWAB rewards | finalized cumulative commitment | Transfer/TWAB engine | Estimated/History | replay/reorg vectors | P0 |
| Stockback claim | HolderRewardVault | proof API | Claim flow | proof/double-claim tests | P0 |
| Graduation | LaunchMarket/GraduationRouter | lifecycle index | progress/state | exact endpoint E2E | P0 |
| LP permanent lock | HyperSwap + delegated lock primitive | lock monitor | post-grad trust details | fork/integration proof | P0 |
| Canonical post-grad pool | stored pool metadata | HyperSwap index | venue/chart | route test | P0 |
| Creator post-grad fees | FeeVault + delegated fee rights | fee collector/index | creator earnings | dual-asset fee tests | P0 |
| Chart continuity | canonical trade events | candle engine | terminal | pre/post stitching | P0 |
| Vanity address | Factory CREATE2 | grinder service | launch preview | creator-bound frontrun test | P0 |
| Dependency health | adapters/config | monitoring | status surfaces | halt/stale drills | P0 |
| Premium UI | N/A | N/A | all public surfaces | design/perf/accessibility QA | release |

No requirement is considered implemented if its contract/state exists but its service/UI/test/release wiring is missing where applicable.

---

# 423. Event / Consumer Wiring Baseline

Final ABI may refine fields, but event families must support downstream consumers.

```text
TokenLaunched
→ indexer, Explore, creator page, SDK

Trade
→ chart, volume, tape, curve state, analytics, bot feed

Graduating
→ terminal state, tx recovery, monitoring

Graduated
→ canonical pool routing, chart marker, SDK, creator dashboard

FeesAccrued / FeesClaimed
→ creator/platform accounting UI

StockbackFunded
→ market Stockback metrics

StockbackCommitmentSubmitted
→ finalization monitor

StockbackRootActivated
→ Claimable UI/proof API

StockbackClaimed
→ account history/vault accounting

QuoteAssetHealthChanged (or derived equivalent)
→ launch gating, market status, operator alerts
```

Event schemas must include enough indexed identity fields to avoid expensive ambiguous reconstruction.

---

# 424. Global E2E Acceptance — Fully Wired Scenario

A release is not accepted until one production-equivalent scenario proves the whole product chain:

```text
verify canonical wrapped xStock + adapter
→ create token with creator-bound vanity salt
→ creator receives 0 TOKEN
→ BUY: core fee + Stockback separated
→ TRANSFER token wallet-to-wallet
→ TWAB index reflects transfer
→ SELL: gross liability partition correct
→ daily cumulative Stockback root attested/submitted/activated
→ holder claims paired xStock
→ creator claims core fee
→ approach exact graduation
→ crossing BUY fee segmentation correct
→ migrate exact reserves using verified V3 geometry
→ LP delegated/permanently locked
→ delegated fee-right safely custodied
→ LaunchMarket canonical trading disabled
→ canonical HyperSwap pool active
→ post-grad LP fees collected in actual fee assets
→ creator receives correct in-kind entitlement
→ post-grad Stockback source/disclosure matches approved policy
→ chart remains continuous
→ SDK switches canonical route
→ frontend reload/reconnect preserves tx/claim state
→ dependency health/monitoring green
```

Record transaction hashes, state snapshots, roots/dataset hashes, balances, fee assets, LP/delegated IDs, and UI evidence.

---

# 425. Brutal Audit Remaining Product Decision

After this remediation, the major remaining unresolved item is not an engineering ambiguity but a **product-economic choice**:

```text
POST_GRAD_STOCKBACK_PLATFORM_SHARE
```

Question:

> What percentage of the platform's paired-xStock-denominated post-grad LP fee share should fund Stockback?

Recommended candidate:

```text
50% of platform paired-xStock LP-fee share -> Stockback
50% -> Platform
```

Creator's 65% remains untouched.

This parameter must be explicitly approved before the masterplan is labeled `NO PRODUCT DECISIONS REMAINING`.

---

**BRUTAL AUDIT REMEDIATION APPLIED. V9 IS ENGINEERING/AGENT-READY SUBJECT TO THE SINGLE EXPLICIT POST-GRAD STOCKBACK PRODUCT-ECONOMICS LOCK ABOVE AND NORMAL EXTERNAL VERIFY GATES.**

---

# 396. Post-Grad Stockback Platform Allocation — FINAL LOCK

Approved product decision:

> **50% of the platform's paired-xStock-denominated post-grad eligible fee share is allocated to Stockback. The remaining 50% stays with the platform.**

Creator economics remain unchanged.

Canonical post-grad creator/platform baseline:

```text
Creator-eligible LP fee revenue
→ 65% Creator
→ 35% Platform-side economic share
```

For the portion of that platform-side share that is received in the official paired xStock:

```text
Platform paired-xStock share
→ 50% Stockback
→ 50% Platform
```

Equivalent conceptual split of creator-eligible LP fee revenue when the fee asset is the official paired xStock:

```text
Creator                         65.00%
Stockback                      17.50%
Platform retained              17.50%
```

This 17.50% / 17.50% is derived from splitting the platform's 35% share in half.

Important:

- This applies only to eligible post-grad fee revenue actually received in the paired official xStock.
- It does not create a claim on LP principal.
- It does not reduce creator's 65% entitlement.
- It does not imply 17.5% of all raw HyperSwap swap fees; it applies only to the launchpad's creator-eligible fee revenue after venue/protocol economics.
- It does not authorize artificial conversion of TOKEN-side fees into xStock.

---

# 397. TOKEN-Side Post-Grad Fee Rule — FINAL LOCK

If a HyperSwap V3 position produces eligible fee revenue in TOKEN:

```text
TOKEN-side platform fee revenue
→ Platform
```

V1 does NOT automatically:

```text
sell TOKEN
→ buy paired xStock
→ fund Stockback
```

Reason:

- avoids protocol-induced sell pressure;
- avoids hidden market impact;
- avoids routing/slippage complexity;
- avoids MEV exposure from automatic conversion;
- keeps Stockback funding transparent and native to paired-xStock revenue.

A future version may introduce explicit conversion mechanics only through a new product decision, economic simulation, security review, and clear UX disclosure.

---

# 398. Post-Grad Stockback Funding Formula — FINAL

For each post-grad collection cycle:

```text
pairedXStockCreatorEligibleRevenue = X

creatorShare = X × 65%
platformGrossShare = X × 35%

stockbackShare = platformGrossShare × 50%
platformNetShare = platformGrossShare × 50%
```

Therefore:

```text
creatorShare     = X × 65.00%
stockbackShare   = X × 17.50%
platformNetShare = X × 17.50%
```

For TOKEN-denominated eligible fee revenue:

```text
creator receives creator entitlement in TOKEN
platform receives platform entitlement in TOKEN

No automatic TOKEN → xStock conversion for Stockback in V1.
```

Exact fee-collection cadence remains an engineering decision.

---

# 399. Post-Grad Stockback Routing

Canonical routing:

```text
HyperSwap V3 Position
        ↓
Eligible Fee Revenue
        ↓
Fee Rights / Collection
        ↓
Asset-separated accounting
        │
        ├── TOKEN-side fees
        │      ├── Creator entitlement
        │      └── Platform entitlement
        │
        └── Paired xStock-side fees
               ├── Creator 65%
               └── Platform-side 35%
                       ├── 50% Stockback
                       └── 50% Platform
```

Stockback portion must be transferred/accounted into HolderRewardVault before it can be considered available for holder distribution.

---

# 400. Post-Grad Stockback Accounting Buckets

Post-grad fee accounting must distinguish:

```text
creatorTokenFees
creatorPairedXStockFees

platformTokenFees
platformPairedXStockFees

postGradStockbackPending
postGradStockbackFinalizedUnclaimed
```

Do not collapse TOKEN and xStock fee revenue into one nominal number for accounting purposes.

USD-equivalent display may be derived for UI only.

---

# 401. Post-Grad Stockback Website Disclosure

Token page after graduation should clearly explain:

```text
STOCKBACK
Active

Funding Source
Paired-xStock portion of post-grad eligible LP fee revenue

Creator Share
Unchanged

Stockback Allocation
50% of platform's paired-xStock share
```

Do not imply:

```text
+1% BUY / +2% SELL
```

still applies to all direct HyperSwap trades unless a verified venue-native mechanism actually enforces it.

The UI must distinguish:

```text
PRE-GRAD STOCKBACK
Protocol-enforced contribution rate

POST-GRAD STOCKBACK
Eligible LP-fee-funded reward rate
```

---

# 402. Post-Grad Creator Economics — FINAL

Creator remains entitled to:

> **65% of creator-eligible post-grad fee revenue, in-kind by asset.**

Examples:

If collection returns:

```text
10 NVDAx
2,000,000 TOKEN
```

creator receives entitlement corresponding to:

```text
6.5 NVDAx
1,300,000 TOKEN
```

subject to exact eligible fee-revenue accounting.

Platform-side entitlement:

```text
3.5 NVDAx
700,000 TOKEN
```

Then:

```text
NVDAx platform-side 3.5
→ 1.75 NVDAx Stockback
→ 1.75 NVDAx Platform

TOKEN platform-side 700,000
→ 700,000 TOKEN Platform
```

No creator dilution.

---

# 403. Stockback Post-Grad Solvency Invariant

For paired-xStock post-grad revenue:

```text
pairedXStockCollected
=
creatorPairedXStockFees
+
platformPairedXStockFees
+
postGradStockbackPending
+
documented rounding/dust
```

After platform-side split:

```text
platformPairedXStockGross
=
platformPairedXStockNet
+
stockbackAllocation
```

No unexplained value leakage.

---

# 404. Post-Grad Stockback Distribution Integration

Post-grad Stockback funding enters the same holder distribution system as pre-grad Stockback.

Conceptually:

```text
PRE-GRAD Stockback contributions
+
POST-GRAD paired-xStock platform allocation
        ↓
HolderRewardVault
        ↓
Daily 24h Stockback epoch
        ↓
Time-weighted eligible TOKEN holders
        ↓
Finalized cumulative entitlement
        ↓
Claim
```

The epoch system does not reset at graduation.

Funding source metadata should record whether reward came from:

```text
PRE_GRAD_CONTRIBUTION
POST_GRAD_LP_FEE
```

for auditability and analytics.

---

# 405. Post-Grad Stockback Events / Indexer Requirements

Indexer/API should be able to expose:

```text
postGradFeeCollected
creatorPostGradFeeAccrued
platformPostGradFeeAccrued
postGradStockbackFunded
```

UI/analytics should be able to distinguish:

- pre-grad Stockback generated;
- post-grad Stockback generated;
- total lifetime Stockback.

---

# 406. Post-Grad Stockback Mandatory Tests

Required:

- paired-xStock fee collection split 65/35;
- platform paired-xStock share split 50/50;
- creator share unchanged;
- TOKEN-side fees do not fund Stockback;
- no automatic TOKEN sell;
- HolderRewardVault receives exact xStock Stockback amount;
- claim obligations remain solvent;
- mixed TOKEN/xStock fee collection;
- zero paired-xStock fee collection;
- repeated collection cycles;
- rounding/dust conservation;
- fee-right collection delay;
- delegated-position pause/degraded dependency;
- direct HyperSwap trades do not falsely display PRE_GRAD Stockback rates;
- graduation mid-epoch keeps reward history continuous.

---

# 407. Final Locked Stockback Economics Summary

## PRE-GRAD

```text
Core Trading Fee
1.00%

Creator
65% of core fee

Platform
35% of core fee

Stockback Contribution Target
BUY  +1.00%
SELL +2.00%

Stockback Contribution Destination
100% eligible holders
```

Target effective:

```text
BUY  2%
SELL 3%
```

Production rates still require the existing simulation gate before mainnet.

## POST-GRAD

```text
Creator
65% of creator-eligible LP fee revenue

Platform-side
35% of creator-eligible LP fee revenue
```

For paired-xStock-denominated platform-side revenue:

```text
50% → Stockback
50% → Platform
```

For TOKEN-denominated platform-side revenue:

```text
100% → Platform
0%   → automatic Stockback conversion
```

Creator remains undiluted.

---

# 408. FINAL PRODUCT-DECISION STATUS

As of this masterplan version:

> **NO KNOWN PRODUCT-LEVEL ECONOMIC OR BEHAVIORAL DECISIONS REMAIN OPEN FOR V1.**

Remaining work belongs to:

```text
VERIFY
External/current facts that must be confirmed.

CHOOSE
Engineering decisions that preserve locked behavior.

IMPLEMENT
Build the approved system.

TEST
Prove correctness and safety.

AUDIT
Validate invariants and attack resistance.

RELEASE
Only after all P0 / GO-NO-GO gates pass.
```

If implementation discovers a real incompatibility between a locked V1 behavior and verified external protocol capabilities:

```text
STOP
→ document evidence
→ classify impact
→ escalate as explicit product decision
```

The implementation team must not silently reinterpret product behavior.

---

# 409. Final Handoff Instruction to Coding Agents

The implementation team or coding agent should interpret this document as follows:

1. Read the entire masterplan before changing architecture.
2. Treat the latest explicit decision as authoritative over superseded historical wording.
3. Apply the `LOCKED / VERIFY / CHOOSE` classification.
4. Do not invent external protocol addresses or capabilities.
5. Do not simplify away Stockback, creator economics, permanent LP, or graduation invariants.
6. Do not introduce hidden transfer taxes.
7. Do not reduce creator economics to fund Stockback.
8. Do not use LP principal or curve collateral for rewards.
9. Do not treat estimated Stockback as claimable.
10. Do not trust an unauthenticated off-chain distribution root.
11. Do not assume raw xStock token units are economically stable without verified multiplier/normalization behavior.
12. Do not allow visual implementation quality to degrade below the documented UI/UX bar.
13. All P0 requirements, invariant suites, external verification, and final E2E rehearsal must pass before production.
14. Any unavoidable deviation must be documented and explicitly approved before implementation proceeds.

Implementation convenience never overrides locked product behavior.

---

**FINAL PRODUCT DECISION LOCK: APPROVED.**

---

# 410. Reference Production Technology Stack — DEFAULT IMPLEMENTATION BASELINE

The product requirements are already locked. This section adds an **opinionated default production stack** so a coding agent or engineering team can begin implementation without wasting time reopening routine technology-selection debates.

Classification:

```text
DEFAULT
Use this stack unless a documented engineering reason justifies replacement.

LOCKED
Product behavior, economics, security invariants, and UX requirements remain unchanged.

VERIFY
Exact package versions and external compatibility must be confirmed at implementation time.
```

Rule:

> Technology may be replaced only when the replacement clearly preserves or improves reliability, security, realtime behavior, performance, accessibility, maintainability, and the documented premium experience.

Do not change technology merely because another library is fashionable.

---

# 411. Repository / Monorepo Baseline

Recommended:

```text
pnpm
+
Turborepo-class monorepo orchestration
+
TypeScript strict mode
```

Logical repository:

```text
/
├── apps/
│   └── web/                    # Next.js frontend
│
├── contracts/
│   ├── src/                    # Solidity
│   ├── test/                   # Foundry tests
│   ├── script/                 # deployments
│   └── invariants/
│
├── services/
│   ├── indexer/                # HyperEVM / HyperSwap event ingestion
│   ├── api/                    # public/internal HTTP API
│   ├── realtime/               # websocket fanout
│   ├── stockback/              # TWAB + distribution computation
│   ├── finalizer/              # attested epoch commitment submission
│   └── worker/                 # async jobs/backfill/OG/etc.
│
├── packages/
│   ├── sdk/                    # public TypeScript SDK
│   ├── contracts/              # generated ABI/types
│   ├── config/                 # chain + addresses
│   ├── database/               # schema/query layer
│   ├── realtime/               # shared event schemas
│   ├── ui/                     # design system primitives
│   ├── chart/                  # chart adapters
│   ├── stockback/              # shared reward math/types
│   ├── types/
│   └── utils/
│
├── infra/
│   ├── docker/
│   ├── migrations/
│   ├── monitoring/
│   └── deployment/
│
├── tests/
│   ├── e2e/
│   ├── integration/
│   └── load/
│
└── docs/
```

Avoid duplicated ABI, address, fee, and event definitions across services.

---

# 412. Frontend Framework — DEFAULT

Recommended default:

```text
Next.js App Router
React
TypeScript
```

Why:

- strong server rendering / initial rendering options;
- mature React ecosystem;
- strong routing and deep linking;
- compatible with client-side realtime trading surfaces;
- compatible with React Three Fiber;
- suitable for SEO/public discovery pages;
- supports splitting cinematic and transaction-critical surfaces.

Architecture principle:

```text
SERVER / STATIC
→ discovery shell
→ token metadata
→ SEO/public pages
→ initial market snapshot where useful

CLIENT / REALTIME
→ chart
→ trade panel
→ activity tape
→ Stockback estimates
→ transaction center
→ wallet
→ live terminal state
```

Do not attempt to server-render every rapidly changing market tick.

---

# 413. Frontend Data / State Management — DEFAULT

Recommended:

```text
TanStack Query
→ remote/API server-state caching

wagmi
→ wallet / blockchain React state

viem
→ low-level typed EVM RPC/contracts

small dedicated local UI store
→ Zustand-class approach or equivalent
```

Local UI state may include:

- panel layout;
- selected timeframe;
- slippage preference;
- animation capability level;
- temporary trade-form state;
- transaction-center UI state.

Do NOT duplicate canonical market/accounting state into a mutable global frontend store when it can be derived from chain/API.

Realtime events should update or invalidate the relevant query/cache state deliberately rather than causing uncontrolled full-app rerenders.

---

# 414. Wallet / Web3 Frontend — DEFAULT

Recommended:

```text
viem
+
wagmi
+
custom premium wallet UI
```

Do not allow a generic wallet-kit visual style to dominate the product.

Wallet infrastructure must support:

- EIP-1193-compatible injected wallets;
- EIP-6963 multi-provider discovery;
- WalletConnect-compatible connectivity where verified;
- chain detection;
- chain switching;
- transaction simulation where feasible;
- typed contract calls;
- replacement/reorg reconciliation;
- reconnect;
- account changes;
- mobile deep-link / QR flow;
- EOA and standard smart-wallet / multisig transaction flows where compatible.

The UI may use connector libraries underneath while presenting a bespoke product experience.

V1 does **not** custody keys and does **not** require an embedded/social/email wallet. Full policy is defined in Sections 454–493.

---

# 415. Frontend Styling / Design System — DEFAULT

Recommended:

```text
CSS custom properties / design tokens
+
Tailwind-class utility layer where useful
+
bespoke component primitives
```

Do NOT build the product visually by assembling default component-library styles.

Shared UI package should own:

```text
typography
spacing
surfaces
borders
radius
elevation
motion tokens
z-index
focus states
button states
form states
financial-number formatting
status semantics
responsive composition primitives
```

A headless accessibility primitive library may be used for complex controls, but visual styling must remain bespoke.

---

# 416. Motion / Premium Interaction Stack — DEFAULT

Recommended layered approach:

```text
CSS / Web Animations
→ simple state transitions and cheap micro-interactions

GSAP-class timeline/scrubbing engine
→ high-end orchestrated motion / scroll storytelling

Three.js
+
React Three Fiber
→ bespoke 3D / spatial scenes

WebGL / shaders
→ signature data-reactive visuals where justified
```

Do not run expensive 3D/render loops merely because the library exists.

Rule:

> Homepage / Experience Mode may be visually ambitious. Trading Mode must remain calm, precise, and performant.

Use GPU-heavy systems only where they add meaningful visual value.

---

# 417. Chart Stack — DEFAULT

Recommended V1 baseline:

```text
TradingView Lightweight Charts
+
custom data adapter
+
custom premium visual treatment
```

Reasons:

- financial-chart focused;
- realtime series update capability;
- candlestick/volume support;
- lightweight compared with a full embedded terminal;
- customizable enough to serve as a strong V1 foundation.

Requirements:

- satisfy required public attribution/license terms;
- wrap the library behind internal `packages/chart`;
- never let vendor-specific data shape leak throughout product code;
- preserve ability to replace renderer later.

If Lightweight Charts cannot meet required 1s/5s behavior, overlays, interactions, performance, or design quality:

```text
CHOOSE
→ extend with custom Canvas/WebGL layers
or
→ replace rendering engine
```

The chart UX requirements remain locked.

---

# 418. Backend Runtime / API — DEFAULT

Recommended:

```text
Node.js current supported LTS/stable line
+
TypeScript
+
Fastify-class HTTP server
```

Separate backend from the Next.js frontend deployment for critical/realtime services.

Backend API responsibilities:

- Explore/search queries;
- token/creator aggregate data;
- chart-history reads;
- Stockback estimated/finalized data;
- public distribution metadata;
- platform statistics;
- metadata;
- share-card data;
- health/freshness endpoints.

Backend API must NOT:

- become authority for balances;
- become authority for graduation;
- create arbitrary reward entitlement;
- sign user trades;
- custody user private keys.

---

# 419. Realtime Gateway — DEFAULT

Use a dedicated long-running realtime service.

Recommended:

```text
WebSocket
+
typed event envelopes
+
Redis-backed fanout/cache where appropriate
```

Client subscriptions may include:

```text
market:<token>
pair:<xStock>
account:<wallet>
platform
stockback:<token>
```

Typical realtime events:

```text
trade
market_state
candle_update
graduation_progress
graduating
graduated
stockback_funded
stockback_estimate
stockback_finalized
claim_confirmed
dependency_status
```

All events require:

- stable schema/version;
- unique event identity;
- canonical block/log reference where applicable;
- timestamp;
- freshness metadata.

WebSocket is delivery infrastructure, not source of truth.

---

# 420. Chain Indexer — DEFAULT

Recommended V1:

```text
custom TypeScript indexer
+
viem
+
PostgreSQL
```

A mature EVM indexing framework may be used if its HyperEVM compatibility, reorg behavior, backfill semantics, and operational reliability are verified.

Why default to an owned indexing layer:

- custom lifecycle semantics;
- HyperSwap stitching;
- xStock normalization;
- Stockback/TWAB requirements;
- precise reorg policy;
- deterministic event provenance;
- easier control over canonical vs derived data.

Indexer must ingest at minimum:

```text
Factory
LaunchMarket
FeeVault
HolderRewardVault
GraduationRouter
HyperSwap V3
delegated fee-right system
canonical xStock adapter events where relevant
```

---

# 421. Indexer Processing Architecture

Recommended stages:

```text
RPC / WebSocket
↓
Raw block/log ingestion
↓
Canonical event normalization
↓
Reorg-safe persistence
↓
Domain processors
├── markets
├── trades
├── candles
├── holders
├── creator economics
├── graduation
├── HyperSwap
└── Stockback
↓
Derived views
↓
API / Realtime
```

Keep raw canonical event records long enough to reproduce derived state.

Never make an unreconstructable materialized table the only copy of market history.

---

# 422. Primary Database — DEFAULT

Yes, this product should use a database.

Recommended:

```text
PostgreSQL
```

PostgreSQL stores **indexed/derived application state**, not canonical user-fund authority.

Use it for:

- tokens;
- markets;
- creators;
- canonical indexed events;
- trades;
- candles;
- holder checkpoints;
- balances derived for discovery;
- graduation history;
- creator fee analytics;
- platform stats;
- Stockback TWAB inputs;
- Stockback epoch metadata;
- distribution commitments;
- claim-index views;
- search;
- metadata references;
- transaction history;
- monitoring-support data.

Why PostgreSQL:

- relational integrity;
- transactions;
- mature indexing;
- good operational ecosystem;
- strong fit for chain-event + product data;
- easier auditing than schemaless storage for critical derived accounting.

Do NOT use MongoDB as the primary system-of-record for V1 without a documented technical reason.

---

# 423. PostgreSQL Authority Boundary

Critical rule:

```text
CHAIN / CONTRACT
= canonical financial authority

POSTGRESQL
= indexed / query / analytics projection
```

If database disagrees with canonical chain state:

```text
mark stale / rebuild / reconcile
```

Do not mutate on-chain conclusions to match the database.

The database must be rebuildable from canonical chain data plus explicitly versioned off-chain metadata inputs.

---

# 424. Database Query Layer — DEFAULT

Recommended:

```text
Drizzle / Kysely-class typed SQL layer
```

Preference:

- SQL remains visible;
- migrations explicit;
- no opaque ORM behavior in financial queries;
- query plans inspectable;
- bigint/numeric handling explicit.

Financial/token quantities must never pass through JavaScript floating point.

Use:

```text
BigInt
integer fixed-point
PostgreSQL NUMERIC where justified
```

with explicit serialization.

---

# 425. Cache / Ephemeral State — DEFAULT

Recommended:

```text
Redis
```

Use Redis for:

- hot Explore queries;
- rate limiting;
- ephemeral market snapshots;
- websocket fanout coordination;
- short-lived quote/display caches;
- distributed locks only where safe;
- job coordination where appropriate.

Redis must NOT be the sole storage for:

- finalized Stockback entitlement;
- canonical indexed history;
- creator fee accounting;
- graduation state.

If Redis is flushed, the platform should recover from PostgreSQL/chain rather than lose financial history.

---

# 426. Pub/Sub vs Durable Queue

Redis Pub/Sub may be used for low-latency disposable fanout.

For work that must survive worker restart, use a durable mechanism:

```text
Redis Streams
or
another durable queue
```

Examples requiring durability:

- historical backfill;
- Stockback epoch computation;
- OG image jobs;
- finalizer tasks;
- retryable notification jobs;
- data reconciliation.

Do not use lossy Pub/Sub as the only delivery mechanism for financial processing.

---

# 427. Object Storage — DEFAULT

Use S3-compatible object storage for:

- creator/token images;
- optimized media variants;
- Stockback public distribution datasets;
- Merkle dataset artifacts;
- social/OG assets;
- immutable audit/export artifacts where appropriate.

Examples of acceptable infrastructure classes:

```text
S3
R2
compatible managed object storage
```

Store content hash/version metadata in PostgreSQL where required.

---

# 428. Search — V1 DEFAULT

Do not introduce Elasticsearch/OpenSearch on day one unless scale requires it.

V1:

```text
PostgreSQL indexes
+
trigram/full-text/address lookup
```

Support:

- exact contract address;
- creator address;
- name;
- ticker;
- pair;
- normalized metadata fields.

If search scale/quality outgrows PostgreSQL, search engine adoption becomes a CHOOSE decision.

---

# 429. Time-Series / Analytics Strategy

V1 default:

```text
PostgreSQL
```

for candles and product analytics at expected initial scale.

Design tables for:

- partitioning;
- appropriate composite indexes;
- bounded retention for high-cardinality ephemeral data;
- pre-aggregated candle windows where useful.

Do NOT introduce ClickHouse before measured need.

Scale-up option:

```text
ClickHouse-class analytics store
```

for high-volume historical analytics while PostgreSQL remains operational product database.

---

# 430. Stockback Data Architecture

Recommended:

```text
canonical chain events
↓
PostgreSQL balance checkpoints
↓
TWAB computation worker
↓
deterministic epoch dataset
↓
independent verifier(s)
↓
threshold-attested cumulative Merkle root
↓
HolderRewardVault
↓
claim
```

Storage:

```text
PostgreSQL
→ checkpoints, epoch state, computation metadata

Object Storage
→ public deterministic distribution dataset

On-chain
→ approved commitment/root + claimed state
```

No single mutable database row may create user entitlement by itself.

---

# 431. Background Workers

Separate async workers from API request lifecycle.

Worker classes:

```text
chain backfill
candle aggregation
holder checkpoint reconciliation
Stockback TWAB
Merkle dataset generation
attestation verification
share image generation
metadata processing
analytics rollups
health reconciliation
```

Workers require:

- idempotency;
- retry policy;
- dead-letter/error visibility;
- metrics;
- structured logs;
- deterministic job identifiers where applicable.

---

# 432. API Protocol Strategy

Default:

```text
REST/JSON
+
WebSocket for realtime
```

Do not add GraphQL merely for architecture fashion.

REST endpoints should be versionable and typed.

Conceptual:

```text
GET /v1/tokens
GET /v1/tokens/:address
GET /v1/tokens/:address/trades
GET /v1/tokens/:address/candles
GET /v1/tokens/:address/stockback
GET /v1/accounts/:address
GET /v1/accounts/:address/stockback
GET /v1/creators/:address
GET /v1/platform/stats
GET /v1/health
```

Exact paths are implementation-level.

---

# 433. Shared Type Contract

Generate/share types for:

- ABIs;
- chain addresses;
- API DTOs;
- WebSocket events;
- lifecycle enums;
- Stockback states;
- fee models;
- transaction states.

Prefer schema validation at service boundaries.

Never trust browser-provided numeric/token values without parsing and validation.

---

# 434. Deployment Topology — DEFAULT

Recommended logical production topology:

```text
CDN / Edge
    ↓
Next.js Web
    ↓
API Gateway / Load Balancer
    ├── API replicas
    └── WebSocket replicas
            ↓
        Redis

HyperEVM RPC / WS
    ↓
Indexer
    ↓
PostgreSQL
    ↓
Processors / Workers
    ↓
API + Realtime

Object Storage
→ media + distribution artifacts
```

Keep long-running indexer/WebSocket/worker workloads separate from serverless-only request functions where persistent connections/background processing would be fragile.

---

# 435. Hosting Provider Rule

Do NOT lock the product to one cloud vendor.

Acceptable architecture may use:

```text
frontend/CDN platform
+
managed PostgreSQL
+
managed Redis
+
container/runtime platform
+
object storage
```

Provider choice is CHOOSE.

Selection criteria:

- region/latency;
- WebSocket support;
- long-running worker support;
- managed backup;
- observability;
- autoscaling;
- cost;
- incident response;
- vendor portability.

---

# 436. Database Backups / Recovery

Even though the database is rebuildable from chain, production still requires:

- automated PostgreSQL backups;
- point-in-time recovery where supported;
- migration rollback strategy;
- restore rehearsal;
- object-storage versioning for important artifacts;
- Redis treated as disposable unless durable queue semantics require persistence.

Reason:

> Rebuilding years of indexed history during an incident is technically possible but operationally unacceptable if avoidable.

---

# 437. Observability Stack — DEFAULT REQUIREMENT

Exact vendor is flexible.

Must have:

```text
structured logs
metrics
distributed traces where useful
frontend error reporting
backend error reporting
performance telemetry
synthetic health checks
alerts
```

Correlate using:

```text
requestId
chainId
blockNumber
txHash
logIndex
tokenAddress
marketAddress
epochId
account where safe/appropriate
```

No secrets/private keys in logs.

---

# 438. CI/CD — DEFAULT

Recommended pipeline:

```text
lint
↓
typecheck
↓
unit tests
↓
contract tests
↓
fuzz/invariant tests
↓
integration tests
↓
frontend tests
↓
build
↓
security/static checks
↓
preview/staging
↓
E2E
↓
manual production gate
```

Production smart-contract deployment is never an automatic consequence of merging frontend code.

---

# 439. Frontend Test Stack — DEFAULT CAPABILITY

Use:

```text
unit/component tests
+
Playwright-class browser E2E
+
visual regression
+
accessibility checks
+
performance regression checks
```

Mandatory critical scenarios:

- wallet absent;
- wallet connect;
- wrong chain;
- quote;
- buy;
- sell;
- graduation while page open;
- reconnect;
- reload pending transaction;
- Stockback estimate;
- Stockback finalization;
- Stockback claim;
- mobile;
- reduced motion;
- degraded RPC/indexer.

---

# 440. Load / Realtime Testing

Before production, simulate:

```text
high concurrent terminal viewers
burst of trades
multiple simultaneous token launches
many websocket subscriptions
rapid activity-tape updates
graduation event
mass reconnect after provider outage
Stockback epoch finalization
```

Measure:

- event latency;
- dropped messages;
- API p95/p99;
- websocket fanout delay;
- database query latency;
- chart update smoothness;
- browser CPU/memory;
- mobile thermal behavior.

---

# 441. Recommended Technology Summary

```text
LANGUAGE
TypeScript across frontend/backend/indexer/SDK
Solidity for contracts

MONOREPO
pnpm + Turborepo-class orchestration

FRONTEND
Next.js App Router
React
TanStack Query
wagmi
viem
bespoke design system

MOTION
CSS/WAAPI
GSAP-class orchestration
Three.js + React Three Fiber
custom shaders only where useful

CHART
TradingView Lightweight Charts baseline
custom adapter/overlays

BACKEND API
Node.js + Fastify-class server

REALTIME
WebSocket service
Redis coordination/fanout

INDEXER
Owned TypeScript/viem reorg-safe indexer
(or verified mature indexing framework)

PRIMARY DATABASE
PostgreSQL

CACHE
Redis

DURABLE ASYNC JOBS
Redis Streams or equivalent durable queue

OBJECT STORAGE
S3-compatible

SEARCH V1
PostgreSQL full-text/trigram/address indexes

ANALYTICS V1
PostgreSQL
ClickHouse-class store only when measured scale requires it

WEB E2E
Playwright-class testing

CONTRACT TESTING
Foundry + fuzz + invariants + fork/integration

DEPLOYMENT
containerized long-running backend services
managed Postgres/Redis/object storage
CDN/edge frontend delivery
```

---

# 442. Technology Version Policy

Do not hardcode stale package versions in the product bible.

At implementation kickoff:

1. select current stable / supported release;
2. verify compatibility across React/Next/R3F/wagmi/viem/etc.;
3. pin exact versions in lockfile;
4. record them in implementation manifest;
5. avoid uncontrolled major upgrades during audit/release freeze.

Current public documentation at the time of this masterplan confirms modern support for the selected technology classes, but implementation must re-verify exact versions.

---

# 443. Reference Stack Deviation Rule

An agent may replace a DEFAULT technology only if it records:

```text
Technology being replaced:
Replacement:
Reason:
Performance impact:
Security impact:
Realtime impact:
UX/motion impact:
Migration cost:
Tests required:
```

No approval is needed for a routine equivalent replacement if all LOCKED requirements are preserved.

Explicit product/security escalation is required if the replacement:

- weakens realtime quality;
- weakens Stockback verifiability;
- changes economics;
- weakens chain-source-of-truth architecture;
- degrades premium frontend capabilities;
- introduces material custody/security risk.

---

# 444. Final Stack Principle

> **Use boring, proven infrastructure for financial correctness and bespoke technology only where it creates visible product advantage.**

Therefore:

```text
PostgreSQL / Redis / typed APIs / deterministic indexer
→ boring, reliable foundation

Realtime terminal / chart / animation / spatial visualization
→ highly refined bespoke product layer
```

The backend should be operationally boring.

The website should feel extraordinary.

Both must be fast, correct, observable, and maintainable.

---

**REFERENCE PRODUCTION STACK ADDED AS DEFAULT IMPLEMENTATION BASELINE.**

---

# 445. Final Pre-Handoff Brutal Audit — RESULT

This masterplan has been re-audited as if received by:

- lead smart-contract engineer;
- protocol architect;
- backend/indexer engineer;
- realtime infrastructure engineer;
- frontend lead;
- motion/3D lead;
- security reviewer;
- professional coding agent.

Audit objective:

> Determine whether an implementation team can build V1 without needing to infer product intent, silently invent economics, or guess critical architecture.

Result:

```text
PRODUCT INTENT                PASS
CORE ECONOMICS                PASS
FEE / STOCKBACK WIRING       PASS
CURVE / COLLATERAL MODEL     PASS WITH REQUIRED SIMULATION PROOF
GRADUATION ARCHITECTURE      PASS WITH EXTERNAL HYPERSWAP VERIFICATION
PERMANENT LP INVARIANTS      PASS WITH INTEGRATION PROOF
xSTOCK NORMALIZATION         PASS WITH PER-ASSET VERIFY GATE
STOCKBACK DISTRIBUTION       PASS WITH ATTESTOR / MERKLE IMPLEMENTATION PROOF
CREATOR ECONOMICS            PASS
POST-GRAD ECONOMICS          PASS
SOURCE-OF-TRUTH BOUNDARIES   PASS
INDEXER / REALTIME WIRING    PASS
DATABASE / CACHE BOUNDARY    PASS
BOT / SDK HANDOFF            PASS
WEBSITE UX SCOPE             PASS
MOTION / 3D QUALITY BAR      PASS
RESPONSIVE / ACCESSIBILITY   PASS
TEST / RELEASE GATES         PASS
REFERENCE FULL STACK         PASS
```

No known V1 product behavior is intentionally left for an engineer to invent.

External facts and exact implementation mechanisms marked VERIFY/CHOOSE remain legitimate engineering work, not missing product decisions.

---

# 446. Audit Finding — No Silent Fee Tuning

The final audit identified and removed legacy wording that could be misread as allowing engineering to tune Stockback rates.

Canonical rule:

```text
Core Fee
BUY  1%
SELL 1%

Stockback
BUY  1%
SELL 2%

Effective V1 target
BUY  2%
SELL 3%
```

These are **LOCKED product parameters**.

Economic simulation remains mandatory because real market-quality effects must be proven before mainnet.

Simulation outcome:

```text
PASS
→ continue toward production

FAIL
→ BLOCKED
→ evidence + product escalation
```

Never:

```text
FAIL
→ coding agent picks a different fee
```

---

# 447. Audit Finding — Architecture Is Readable Linearly

Critical components now appear both in detailed sections and the main architecture path:

```text
LaunchToken
XStockRegistry
XStockAssetAdapter
LaunchMarket
FeeVault
HolderRewardVault
Stockback accounting/distribution
GraduationRouter
ReferencePriceAdapter
HyperSwap integration
```

The reader no longer needs to infer that normalized xStock accounting is an appendix-only concern.

---

# 448. Audit Finding — Event Wiring Is P0-Complete

Core event/state signals cover:

```text
launch
trade
fee accrual/claim
graduation
Stockback funding
Stockback commitment
Stockback root activation
Stockback claim
```

Consumers are explicitly wired through the Requirements Traceability Matrix and Event / Consumer Wiring Baseline.

No financial feature is considered complete merely because a contract function exists.

---

# 449. Audit Finding — Full-Stack Responsibility Boundary

Canonical architecture boundary:

```text
ON-CHAIN
financial authority
lifecycle authority
finalized Stockback claim authority
LP / graduation authority

INDEXER
canonical event reconstruction
reorg handling
derived market state
holder checkpoints

POSTGRESQL
rebuildable indexed/query projection
candles/search/analytics/TWAB inputs

REDIS
ephemeral cache
realtime coordination
durable queue only when using durable semantics

OBJECT STORAGE
public distribution datasets
media / generated artifacts

API
typed read/query layer

WEBSOCKET
low-latency delivery

FRONTEND
representation + transaction orchestration
never financial authority
```

This boundary is mandatory even if individual technology products are replaced.

---

# 450. Audit Finding — Premium Website Is a Release Requirement

The frontend is not considered finished because it renders correct data.

Release requires all of the following simultaneously:

```text
correct
realtime
smooth
responsive
accessible
visually premium
motion-refined
interactive
stable under load
clear under failure
transaction-safe
```

A technically correct but generic/template-quality website fails product acceptance.

A visually impressive but unreliable or misleading website also fails product acceptance.

---

# 451. Audit Finding — “Zero Bugs” Interpretation

No engineering process can truthfully guarantee literal permanent zero defects.

The product requirement is therefore operationalized as:

```text
no known Critical issue
no unresolved High issue without explicit accepted risk
no known fund-loss path
no known accounting mismatch
no known double-claim path
no known broken graduation path
no known LP-unlock path
no known misleading financial UI state
critical E2E flows passing
regression suites passing
observability live
release gates passing
```

Avoidable sloppy defects are treated as release-quality failures.

---

# 452. Final Engineer Handoff Verdict

A professional engineer or coding agent receiving this version should be able to answer without product-owner clarification:

- What is being built?
- What are the locked economics?
- How does a launch work?
- How does pre-grad buy/sell work?
- How are fees separated?
- How does Stockback work?
- Who is eligible?
- How are rewards finalized and claimed?
- What happens at graduation?
- How does post-grad creator revenue work?
- How does post-grad Stockback work?
- Which assets are canonical?
- How is xStock normalization handled?
- Which state is authoritative?
- Which database/cache layers are permitted?
- What frontend/backend/indexer stack should be used by default?
- What realtime architecture is expected?
- What visual quality is required?
- What tests must pass?
- What external dependencies must be verified?
- What must block release?
- What may never be changed silently?

If a future implementer cannot answer one of these from the document, that is treated as a documentation defect and should be corrected rather than guessed.

---

# 453. FINAL PRE-HANDOFF STATUS

```text
PRODUCT DECISIONS
LOCKED

REFERENCE FULL STACK
DEFINED

EXTERNAL INTEGRATIONS
VERIFY BEFORE PRODUCTION

IMPLEMENTATION DETAILS
CHOOSE WITHIN DOCUMENTED BOUNDARIES

SECURITY / ECONOMIC PROOFS
MANDATORY

PREMIUM REALTIME UX
MANDATORY

MAINNET
NO-GO UNTIL ALL P0 GATES PASS
```

> **This document is ready for professional engineering handoff as the V1 product bible and implementation execution contract.**

---

---

# 454. Wallet, Identity & Transaction-Signing Architecture — V1

This subsystem is a **P0 product and security surface**.

Wallet behavior is not a decorative connect button. It affects:

- trading;
- creator launch;
- creator fee claims;
- Stockback claims;
- transaction safety;
- session identity;
- mobile usability;
- pending transaction recovery;
- smart-wallet compatibility;
- phishing/signature risk.

Canonical V1 philosophy:

> **Browse freely. Connect only when value is about to move. Keep keys with the user. Make every signature understandable. Never lose transaction context.**

---

# 455. V1 Wallet Custody Model — LOCKED

V1 is:

```text
NON-CUSTODIAL
EXTERNAL-WALLET FIRST
```

The platform must NOT:

- generate private keys for users;
- store seed phrases;
- store private keys;
- decrypt/sign with user keys;
- maintain internal exchange-style user balances;
- require assets to be deposited into an omnibus user account;
- silently create an embedded wallet.

User assets remain controlled by the connected wallet except when deliberately transferred into protocol contracts under documented rules.

---

# 456. Embedded / Social / Email Wallet Policy — LOCKED V1

V1 does **not** require:

- email wallet;
- Google/social login wallet;
- platform-custodied embedded wallet;
- MPC wallet operated by the platform;
- passkey smart wallet created automatically.

Reason:

- target V1 audience is crypto-native/degen/pro users;
- reduces custody/security/recovery complexity;
- avoids introducing account-recovery architecture before it is necessary;
- preserves clear self-custody mental model.

A future embedded-wallet option is a **new product decision**, not an implementation convenience.

---

# 457. Primary Wallet Standards — DEFAULT

Frontend wallet layer should support:

```text
EIP-1193
→ standard Ethereum provider interface

EIP-6963
→ multiple injected wallet discovery

WalletConnect-compatible connector
→ mobile / cross-device wallets
```

Current ecosystem support must be verified at implementation time.

Do not rely solely on:

```text
window.ethereum
```

when EIP-6963 discovery is available.

Reason:

> Multiple installed wallet extensions must not fight over a single injected provider.

---

# 458. Wallet Support Philosophy

Do not hardcode product compatibility to only one wallet brand.

First-class expected categories:

```text
Detected injected wallets
→ Rabby-class
→ MetaMask-class
→ Coinbase / other compliant injected wallets

Cross-device
→ WalletConnect-compatible wallets

Advanced
→ hardware wallets through their normal wallet/provider integration
→ Safe/multisig/contract wallets where standard calls are compatible
```

Wallet brand availability is VERIFY/current ecosystem data.

The product UI should display detected providers dynamically where safe.

---

# 459. Canonical Signing Wallet

At any moment the frontend has exactly:

```text
0 or 1 active signing account context
```

One connected provider may expose multiple accounts, but the application treats the currently selected account as the active signing identity.

All transaction previews must be bound to:

```text
chainId
account
market
intent
quote/version
```

If account or chain changes before signing:

> **invalidate the stale review and require re-review.**

---

# 460. Browse Without Wallet — LOCKED

Wallet is not required to:

- open homepage;
- Explore markets;
- search;
- open token terminal;
- inspect chart;
- view trades;
- inspect creator;
- inspect Stockback market stats;
- inspect roadmap/updates;
- inspect public creator/profile data;
- inspect public contract addresses.

Wallet is required only for actions such as:

```text
BUY
SELL
CREATE
CLAIM CREATOR FEES
CLAIM STOCKBACK
EDIT ADDRESS-OWNED PROFILE METADATA
```

This minimizes unnecessary connection friction.

---

# 461. Connect Wallet Trigger Rules

If disconnected user clicks a value-moving action:

```text
BUY
SELL
CREATE
CLAIM
```

open the Wallet Connection Sheet.

Do NOT navigate them away from the market unnecessarily.

After successful connection:

- preserve original action intent;
- validate network/account;
- return user to the exact flow they initiated;
- do not auto-submit.

Example:

```text
Disconnected
↓
click BUY
↓
Connect Wallet
↓
connect
↓
network check
↓
return to BUY review
```

---

# 462. Premium Wallet Connection Sheet

Visual target:

```text
CONNECT WALLET

Detected
[ Wallet A ]
[ Wallet B ]

Other wallets
[ WalletConnect ]

Network
HyperEVM

Security note
You remain in control of your wallet.

[ Cancel ]
```

Requirements:

- bespoke visual treatment;
- no generic third-party modal dominating branding;
- keyboard accessible;
- mobile responsive;
- clear provider identity;
- no fake wallet logos;
- no misleading “recommended” ranking based on sponsorship;
- clear QR/deep-link state;
- clear retry/cancel state.

---

# 463. Wallet Provider Identity Safety

EIP-6963 provider metadata is useful for discovery but must not be blindly trusted as cryptographic brand proof.

Frontend must:

- treat provider metadata as display/discovery input;
- avoid unsafe HTML/SVG execution from provider-supplied metadata;
- sanitize/handle provider icons safely;
- avoid wallet-specific feature detection based only on self-reported display metadata;
- gracefully handle duplicate/invalid provider announcements.

A malicious page provider must not gain arbitrary DOM/script execution via wallet metadata.

---

# 464. HyperEVM Network Policy

Expected V1 production network:

```text
HyperEVM mainnet
```

Current official Hyperliquid documentation identifies:

```text
Mainnet chain ID: 999
Native gas token: HYPE
```

These current values remain `VERIFY` at implementation/deployment freeze.

Network configuration must be centralized.

Do not scatter chain IDs or RPC URLs through frontend code.

---

# 465. Wrong Network UX

If wallet is connected to another chain:

```text
Connected Wallet
0x...

Wrong Network
Ethereum / Base / etc.

[ Switch to HyperEVM ]
```

Primary transaction button becomes:

```text
Switch Network
```

not:

```text
Buy
```

until correct chain is active.

Do not submit a HyperEVM transaction on the wrong chain.

---

# 466. Add / Switch Chain Behavior

Preferred flow:

1. request wallet to switch to verified HyperEVM chain;
2. if chain is missing and wallet supports adding chain, offer verified chain metadata;
3. re-read chain ID after wallet response;
4. proceed only after actual provider state confirms expected chain.

Do not trust successful UI promise alone.

If user rejects:

```text
Network switch cancelled.
Switch to HyperEVM to continue.
```

Keep the market page usable for browsing.

---

# 467. RPC vs Wallet Network Separation

The application may use its own read RPC providers while the connected wallet uses another provider endpoint.

Rules:

- connected wallet chain ID must match intended execution chain;
- app read RPC must independently report expected chain;
- transaction receipt must be reconciled against canonical HyperEVM state;
- a wallet RPC outage must not corrupt indexed canonical data;
- an app RPC outage must not cause false transaction success.

Do not assume wallet provider RPC and application indexer/RPC are identical.

---

# 468. HYPE Gas Requirement

HyperEVM transaction gas is paid in native HYPE.

Before a transaction flow, frontend should read:

```text
native HYPE balance
```

If clearly insufficient:

```text
Not enough HYPE for gas.
```

Provide contextual guidance without pretending to know exact future gas cost.

UI may show:

```text
HYPE balance
estimated gas
estimated remaining HYPE
```

where estimate is available.

---

# 469. Gas Funding Guidance

V1 may provide informational links/instructions for obtaining or transferring HYPE.

Do not:

- custody HYPE on behalf of the user;
- silently bridge assets;
- send assets to system addresses automatically;
- promise bridge availability.

Any HyperCore ↔ HyperEVM or third-party bridge flow must use verified current instructions.

---

# 470. Wallet Address = Primary Identity

Primary product identity:

```text
wallet address
```

Address owns/represents:

- launched markets;
- creator fee entitlement;
- TOKEN holdings;
- Stockback claim entitlement;
- transaction activity;
- optional creator profile metadata authorization.

Display names/avatars/social metadata are presentation layers, not financial identity.

---

# 471. Optional SIWE Session — V1

The product may use **Sign-In with Ethereum (SIWE / ERC-4361)** for off-chain authenticated features.

Use cases:

- edit creator profile metadata;
- save server-side preferences;
- manage authenticated media metadata;
- rate-limit privileged metadata writes;
- optional cross-device preference/account session.

SIWE must NOT be required merely to:

- read markets;
- connect wallet;
- submit normal on-chain trades;
- claim directly from contracts when backend auth is unnecessary.

---

# 472. SIWE Security Requirements

SIWE implementation must verify at minimum:

```text
domain
URI/origin
address
chain ID
nonce
issued-at
expiration where used
signature
```

Nonce must be:

- unpredictable;
- single-use;
- server-validated;
- invalidated after successful login or expiry.

Session must be bound to the signing address.

Prevent:

- replay;
- domain confusion;
- stale session reuse after account change;
- accepting malformed SIWE payloads.

---

# 473. Smart Wallet / Contract Account Authentication

Do not assume every user account is an EOA.

Where SIWE/signature verification supports contract accounts:

- support ERC-1271-compatible verification where practical;
- resolve verification on the appropriate chain;
- handle wallets that require contract-based signature validation.

A valid smart wallet must not be excluded merely because `ecrecover` fails.

---

# 474. Session Cookie / Web Session Rules

If SIWE creates a web session:

- use secure transport;
- secure cookie flags;
- HTTP-only where appropriate;
- SameSite policy chosen deliberately;
- CSRF protection for authenticated state-changing HTTP endpoints;
- short/appropriate session lifetime;
- server-side revocation/expiration semantics;
- address + session binding.

Never place a private key or wallet signing secret in browser/server session storage.

---

# 475. Account Change Handling

If provider emits account change:

```text
oldAccount → newAccount
```

Immediately:

1. cancel/invalidate unsigned transaction review;
2. clear account-specific cached private/session data;
3. re-key account subscriptions;
4. reload balances/allowances/claims;
5. invalidate SIWE session if address no longer matches;
6. preserve non-sensitive public UI preferences.

Never submit an intent reviewed for Account A using Account B.

---

# 476. Disconnect Behavior

Disconnect means:

- stop using wallet as active signing source;
- clear active connector context where possible;
- clear address-authenticated session state;
- unsubscribe private/address-specific realtime state;
- retain public page state.

Do not delete already known transaction hashes.

Pending confirmed/submitted transactions continue reconciliation even after disconnect.

---

# 477. Pending Transaction Persistence

Once a transaction hash exists:

```text
txHash
chainId
account
intentType
market
submittedAt
expected state
```

must be persisted locally and/or in safe transaction-center state.

After:

- page refresh;
- browser reopen where supported;
- wallet disconnect;
- account switch;
- temporary RPC outage;

the app should still reconcile the transaction from chain/indexer.

---

# 478. Never Silently Resubmit

On reload/reconnect:

```text
PENDING TRANSACTION FOUND
↓
check chain
↓
check receipt/state
```

Never:

```text
PENDING TRANSACTION FOUND
↓
automatically send again
```

A failed/reverted transaction requires a new explicit user action.

---

# 479. Transaction Intent State Machine

Canonical frontend state family:

```text
IDLE
NEEDS_WALLET
NEEDS_NETWORK
NEEDS_ALLOWANCE
READY_FOR_REVIEW
WAITING_FOR_SIGNATURE
SUBMITTED
PENDING
CONFIRMED
REVERTED
REPLACED
DROPPED_OR_UNKNOWN
RECONCILING
```

UI copy may simplify these states, but internal logic must distinguish them.

---

# 480. Signature Request Taxonomy

The product must visually distinguish:

```text
CONNECT
AUTHENTICATION SIGNATURE
TOKEN APPROVAL
TRADE TRANSACTION
LAUNCH TRANSACTION
CLAIM TRANSACTION
```

Do not present every wallet request as generic:

```text
Confirm
```

User should understand why their wallet is opening.

---

# 481. Human-Readable Signature Review

Before requesting a signature/transaction, show relevant plain-language intent.

Example approval:

```text
APPROVE NVDAx

Spender
LaunchMarket

Amount
12.50 NVDAx

Purpose
Allow this market to use NVDAx for your buy.
```

Example buy:

```text
BUY TOKEN

Pay
12.50 NVDAx

Core Fee
0.125 NVDAx

Stockback
0.125 NVDAx

Expected Receive
...

Minimum Receive
...

Market
TOKEN / NVDAx
```

---

# 482. ERC-20 Allowance Policy — LOCKED

Default V1 approval behavior:

> **Approve only the amount required for the intended action, or the smallest safely reusable amount explicitly chosen by the user.**

V1 must NOT silently default to unlimited allowance.

If an optional larger/unlimited allowance convenience mode is ever offered:

- explicit user opt-in;
- clear spender;
- clear risk copy;
- revocation guidance;
- never pre-selected deceptively.

---

# 483. Allowance Flow

For BUY when paired xStock allowance is insufficient:

```text
Review Buy
↓
Step 1 — Approve xStock
↓
approval confirmed
↓
re-read allowance
↓
Step 2 — Buy
```

If allowance is already sufficient:

```text
Review Buy
↓
Buy
```

Do not assume an approval succeeded merely because wallet submitted it.

---

# 484. Permit / Signature-Based Approval

Permit-style flows may reduce transactions only if the actual canonical xStock safely supports the required permit standard and semantics.

Classification:

```text
VERIFY PER ASSET
```

Do not assume:

- EIP-2612;
- Permit2 compatibility;
- arbitrary signature approval support.

Fallback must always remain normal ERC-20 approval where supported.

---

# 485. SELL Approval Behavior

If LaunchMarket/router requires TOKEN allowance for sell:

- exact/sufficient allowance logic applies;
- user sees spender and amount;
- approval is separate from sell intent unless a verified atomic mechanism exists.

Because LaunchToken is standard ERC-20, approval semantics must stay predictable.

---

# 486. Wallet Transaction Simulation

Before sending where practical:

```text
simulate
estimate gas
validate current state
```

Simulation failure should produce actionable copy.

However:

> Successful simulation is not a guarantee of successful inclusion.

State can change before execution.

Do not display simulation as final confirmation.

---

# 487. Quote Freshness Before Signature

A trade review is not timeless.

Before signature submission:

- check quote expiry/deadline;
- verify current chain/account;
- verify lifecycle state;
- verify allowance;
- verify market has not graduated unexpectedly;
- refresh stale data where required.

If material values changed:

```text
Market changed.
Review updated quote before continuing.
```

Do not silently sign materially different economics.

---

# 488. Account Changes During Wallet Prompt

If user opens wallet approval/signature prompt and changes account/network inside wallet:

- treat request result carefully;
- re-check returned account and chain;
- reject/restart app flow if intent binding is no longer valid;
- never assume pre-prompt context remains valid.

---

# 489. Replacement / Speed-Up / Cancel Transactions

Wallets may replace a pending transaction using the same nonce.

Transaction Center must detect:

```text
original tx
→ replaced by new tx
```

UI should link state:

```text
Transaction replaced
```

and reconcile the replacement hash.

Do not permanently display old tx as pending after replacement is known.

---

# 490. Dropped / Unknown Transaction

If submitted tx cannot be found temporarily:

```text
Checking transaction status…
```

Use bounded retry and reconciliation.

Do not immediately call it failed.

Eventually classify:

```text
DROPPED_OR_UNKNOWN
```

with a safe retry flow that checks nonce/on-chain state before encouraging resubmission.

---

# 491. Multisig / Safe Wallet Behavior

A smart-wallet/multisig transaction may be:

```text
proposed
but not yet executed on-chain
```

Do not label a proposal/signature as protocol-confirmed trade.

Where connector exposes enough information:

```text
Waiting for additional wallet approvals
```

Only canonical on-chain execution changes market state.

---

# 492. Hardware Wallet Behavior

Hardware wallets may sign more slowly.

UX requirements:

- no aggressive timeout;
- show `Waiting for wallet/device`;
- preserve transaction review;
- allow cancel in app where safe;
- no repeated signing prompts;
- no assumption that delayed response means failure.

Hardware wallets can be supported through their normal compatible connector/provider rather than bespoke key handling.

---

# 493. Mobile Wallet Flow

Mobile browser + native wallet flow must handle:

```text
connect
→ wallet app opens
→ user approves/rejects
→ return to dapp
```

and transaction signing:

```text
review in dapp
→ open wallet
→ sign/reject
→ return
→ reconcile
```

Support both:

- installed-wallet deep link where available;
- WalletConnect QR / cross-device connection where appropriate.

The application must remain usable if automatic return fails.

---

# 494. WalletConnect Session UX

Required states:

```text
Creating connection…
QR ready
Open wallet
Waiting for approval…
Connected
Rejected
Expired
Reconnect
```

If QR/session expires:

```text
Connection expired.
Generate a new connection.
```

Do not keep a dead QR indefinitely.

---

# 495. WalletConnect Metadata Safety

Connection/session metadata must use:

- correct production domain;
- correct app name;
- verified icon/assets;
- correct redirect metadata;
- unique environment separation where needed.

Do not reuse confusing development/staging metadata in production.

Mobile redirect behavior must be tested across supported wallet classes.

---

# 496. Multi-Tab Wallet Synchronization

Different tabs may observe:

- same provider;
- different page state;
- account changes;
- disconnect;
- pending tx.

Use browser coordination where appropriate to synchronize:

```text
active account context
disconnect
known pending tx hashes
transaction resolution
```

Never assume one tab owns the wallet exclusively.

---

# 497. Wallet Session vs Financial Authority

Important distinction:

```text
Connected Wallet
= ability to request signatures

SIWE Session
= optional authenticated web session

Blockchain
= financial authority
```

A valid SIWE session does NOT authorize the server to trade or claim funds.

A disconnected wallet does NOT erase on-chain ownership.

---

# 498. Creator Wallet Flow

Creator flow:

```text
Connect wallet
↓
correct network
↓
optional SIWE only if metadata write requires auth
↓
fill launch form
↓
vanity computation
↓
review immutable launch parameters
↓
check HYPE gas
↓
launch signature
↓
submitted
↓
confirmed
↓
creator dashboard indexed
```

Creator address shown in preview must match active signing account.

If account changes:

> invalidate launch review and vanity intent where creator-bound salt depends on address.

---

# 499. Creator Claim Flow

Creator fee claim:

```text
Connected account
↓
read canonical accrued fees
↓
review assets / amounts
↓
claim transaction
↓
pending
↓
confirmed
↓
reconcile FeeVault + indexer
```

If claim transaction fails:

- accrued entitlement remains;
- trading remains unaffected;
- UI does not zero claimable optimistically without reconciliation.

---

# 500. Stockback Claim Wallet Flow

Stockback claim:

```text
Connected account
↓
fetch active cumulative root
↓
build/verify proof
↓
show claimable asset + amount
↓
claim transaction
↓
pending
↓
confirmed
↓
update on-chain claimed amount
```

Account must match proof beneficiary unless contract explicitly supports recipient delegation.

Do not automatically redirect claims to a different wallet.

---

# 501. Account Dashboard Wallet State

When connected:

```text
ACCOUNT

0x84…21AF
HyperEVM ✓

Portfolio
Creator Earnings
Stockback
Activity
```

Wallet menu:

```text
Copy Address
View Explorer
Switch Wallet / Account
Network
Disconnect
```

If disconnected, public historical address pages may still be viewed by address.

---

# 502. Header Wallet UX

Disconnected:

```text
[ Connect Wallet ]
```

Connected:

```text
● HyperEVM
0x84…21AF ▾
```

Optional compact portfolio summary may be shown only if it does not create layout instability.

Do not expose full address unnecessarily on small screens.

---

# 503. Wallet Error Matrix

Must handle at minimum:

| Condition | Primary UX |
|---|---|
| No injected wallet | Offer WalletConnect / guidance |
| Wallet locked | Ask user to unlock wallet |
| Connect rejected | Connection cancelled |
| Connection expired | Generate new connection |
| Wrong chain | Switch to HyperEVM |
| Chain add rejected | Explain manual network requirement |
| Account changed | Rebuild account context |
| Wallet disconnected | Preserve public page + pending tx reconciliation |
| Signature rejected | Action cancelled; no false error |
| Approval reverted | Approval failed; funds unchanged |
| Tx reverted | Explain known reason + technical details |
| Insufficient HYPE | Need HYPE for gas |
| Insufficient xStock | Show available balance |
| Stale quote | Re-review updated quote |
| Market graduated during review | Switch/rebuild route |
| RPC unavailable | Reconnecting / provider degraded |
| Multisig pending | Waiting for wallet approvals |
| Replacement tx | Track replacement |
| Unknown tx status | Reconcile before retry |

---

# 504. User Rejection Is Not a System Error

User rejecting:

- connection;
- signature;
- network switch;
- transaction;

is a normal cancellation state.

Do not show scary red:

```text
ERROR
```

Use:

```text
Transaction cancelled.
No funds were moved.
```

where accurate.

---

# 505. Wallet Security — No Blind Signing

The application must never intentionally ask users to sign:

- opaque arbitrary messages without explanation;
- unlimited approval without explicit disclosure;
- unrelated contract calls;
- transactions whose target address differs from displayed canonical target;
- SIWE message for another domain;
- stale intent after account/network change.

All signing requests must have a documented purpose.

---

# 506. Wallet Security — Canonical Contract Targets

Frontend transaction builder must obtain contract addresses from centralized verified config.

Before production:

- Factory address verified;
- FeeVault verified;
- HolderRewardVault verified;
- LaunchMarket registry/path verified;
- Graduation/router config verified;
- chain ID verified.

No user-entered arbitrary spender address in normal V1 trading flow.

---

# 507. Wallet Security — Phishing / Domain Binding

SIWE and WalletConnect metadata must bind to the real production origin/domain.

Protect against:

- signing from lookalike domain;
- replayed SIWE nonce;
- stale staging domain;
- incorrect redirect URI;
- misleading wallet branding.

Public documentation should tell users:

> The protocol will never ask for a seed phrase or private key.

---

# 508. Wallet Security — Address Formatting

Display:

```text
checksum-formatted address where applicable
```

When copying:

- copy full exact address;
- do not copy truncated form;
- provide explicit feedback.

For canonical contract addresses, offer explorer link.

---

# 509. Wallet Security — Approval Visibility

Account/settings may expose a simple link:

```text
Review token approvals
```

where a trusted current explorer/revocation surface is available.

The launchpad does not need to become a full approval-management product in V1.

But users must never be misled about active allowances.

---

# 510. Wallet Privacy

Do not connect wallet automatically on page load merely to fingerprint visitors.

Browsing works disconnected.

Provider discovery may occur locally, but:

- do not send unnecessary installed-wallet inventory to backend;
- do not collect more account/provider metadata than required;
- document analytics boundaries.

EIP-6963 wallet discovery should not become a wallet-fingerprinting analytics mechanism.

---

# 511. Wallet Data Stored Locally

Safe local persistence may include:

```text
last connector type
UI preferences
known pending tx hashes
selected timeframe
slippage preference
transaction-center metadata
```

Do not store:

- seed phrase;
- private key;
- raw signing secret;
- recovery phrase;
- wallet password.

Sensitive session tokens follow secure session-storage/cookie policy rather than arbitrary localStorage.

---

# 512. Wallet Realtime Subscription Wiring

On wallet connect/account change:

```text
account
↓
subscribe / query
├── balances
├── allowances
├── creator fees
├── Stockback
├── activity
└── pending tx
```

On disconnect:

- remove account-private subscriptions;
- retain public market subscriptions;
- continue tx-hash reconciliation for known submitted transactions.

---

# 513. Allowance / Balance Freshness

Balance and allowance are transaction-critical.

Before sending:

- re-read or sufficiently refresh canonical data;
- do not trust a stale cached balance indefinitely;
- invalidate after confirmed approval/trade/claim;
- reconcile after reorg.

UI may optimistically animate, but financial state becomes canonical only after confirmation/reconciliation.

---

# 514. Wallet + Graduation Race Condition

Scenario:

```text
User reviews BUY in PRE_GRAD
↓
another trade graduates market
↓
user attempts sign/send
```

Required:

- pre-send simulation/state check catches lifecycle change where possible;
- stale pre-grad route is rejected;
- frontend refreshes into post-grad route;
- user sees updated economics;
- user must explicitly review new trade.

Never silently transform a pre-grad signed intent into materially different post-grad trade economics.

---

# 515. Wallet + Stockback Epoch Race

Claim UI must account for root activation changing while claim screen is open.

Before submission:

- verify active root/sequence;
- rebuild proof if stale;
- update claimable if necessary.

Never submit proof known to target an obsolete incompatible root.

---

# 516. Wallet + Creator Vanity Race

Because vanity salt is creator-bound:

```text
creator account changes
→ vanity preview invalid
```

Frontend must:

- stop launch submission;
- recompute/revalidate vanity address;
- show new predicted address;
- require review again.

---

# 517. Wallet Capability Detection

Do not assume every wallet supports:

- programmatic chain add;
- all signing methods;
- WalletConnect redirects;
- EIP-1271 directly from browser provider;
- custom transaction simulation UX.

Feature-detect capabilities and provide fallback.

Core EVM transaction flow must remain standards-based.

---

# 518. Account Abstraction Policy

V1 does not require ERC-4337/account-abstraction infrastructure.

Smart accounts that already expose normal compatible wallet/provider behavior may be supported.

Do NOT introduce:

- mandatory bundler;
- mandatory paymaster;
- gas sponsorship dependency;
- session keys;

without explicit product/security review.

---

# 519. Gas Sponsorship Policy

V1 default:

```text
USER PAYS HYPE GAS
```

No protocol gas sponsorship is required.

Future gas sponsorship/paymaster systems are a new security/economic design because they create:

- abuse risk;
- relayer dependency;
- fee economics;
- authorization complexity.

---

# 520. Transaction Deadline Policy

Trade transactions include a deadline.

Frontend should:

- choose a sensible default;
- expose advanced setting if useful;
- clearly invalidate stale unsigned review;
- never submit after known expiry.

Exact default duration is CHOOSE after UX/market testing.

---

# 521. Nonce Handling

Do not manually implement fragile nonce management unless necessary.

Normal user transaction nonce is primarily wallet/provider responsibility.

Application transaction center must still understand:

- pending nonce;
- replacement;
- cancel;
- duplicate intent risk.

Do not submit multiple identical transactions because UI did not receive immediate confirmation.

---

# 522. Double-Click / Duplicate Submission Protection

Primary submit button:

```text
Confirm Buy
```

after invocation becomes:

```text
Waiting for Wallet…
```

and must not emit multiple requests from rapid taps.

After tx hash:

```text
Pending
```

Button remains non-resubmittable unless failure/retry state is safely established.

---

# 523. Wallet UX Performance

Wallet modal and transaction review must load instantly enough to feel native.

Do not block Connect Wallet on:

- 3D scene;
- chart library;
- non-critical analytics;
- roadmap content.

Wallet/transaction critical path should live in a lightweight frontend bundle boundary.

---

# 524. Wallet UX Accessibility

Wallet connection and signing UI must support:

- keyboard navigation;
- visible focus;
- screen-reader labels;
- non-color-only status;
- modal focus trapping/restoration;
- escape/cancel where safe;
- touch targets;
- reduced motion.

QR codes require textual connection status and alternative wallet-open controls where available.

---

# 525. Wallet Motion Rules

Wallet interactions should feel premium but restrained.

Allowed:

- short modal transition;
- subtle provider-card response;
- network-state morph;
- confirmed-state transition.

Avoid:

- long cinematic animation before transaction;
- distracting particle effects during signature;
- motion that hides address/amount/spender;
- confetti for routine approval.

Money-moving UI prioritizes precision.

---

# 526. Wallet Mobile Layout

Mobile connection sheet:

```text
Connect Wallet

Detected wallets
[ Wallet A ]
[ Wallet B ]

Other wallets
[ WalletConnect ]

[ Cancel ]
```

Transaction review uses bottom sheet/full-height sheet as necessary.

Critical values remain visible without horizontal scrolling.

---

# 527. Wallet Desktop Layout

Desktop may use centered modal/drawer with:

- detected wallets;
- recent connector where appropriate;
- WalletConnect;
- network status;
- compact security copy.

Do not create a giant onboarding wizard for experienced users.

---

# 528. Wallet First-Use Education

Minimal contextual education:

```text
You keep control of your wallet.
The app never asks for your seed phrase.
HYPE is required for HyperEVM gas.
```

Do not force a long tutorial.

Advanced help can live in tooltip/docs.

---

# 529. Wallet Transaction Center

Transaction Center should show:

```text
Intent
Asset / Market
Account
Network
Submitted time
Tx hash
Current status
Replacement hash if any
```

Financial details depend on intent:

```text
BUY
SELL
APPROVE
LAUNCH
CREATOR CLAIM
STOCKBACK CLAIM
```

---

# 530. Wallet Transaction Center Persistence

Persistence key must separate at least:

```text
chainId
account
txHash
```

A transaction from Account A must not appear as if initiated by Account B.

Cross-account history can still be shown with explicit account label.

---

# 531. Wallet Public API / SDK Boundary

Public SDK should not require frontend wallet UI.

SDK exposes transaction-building or direct contract methods.

Conceptual:

```text
getRequiredApproval(...)
buildBuy(...)
buildSell(...)
buildLaunch(...)
buildCreatorClaim(...)
buildStockbackClaim(...)
```

Bots can use their own signer.

Frontend wallet layer is a consumer of protocol/SDK logic, not a mandatory dependency.

---

# 532. Wallet Testing Matrix — Required

Test across representative categories:

```text
injected wallet A
injected wallet B
multiple injected wallets installed
WalletConnect desktop QR
WalletConnect mobile
mobile browser → native wallet
smart wallet
multisig flow where supported
hardware-wallet-compatible connector
```

Do not claim support for an untested wallet merely because it is EVM-branded.

---

# 533. Wallet Functional Test Cases

At minimum:

- connect;
- reject connect;
- disconnect;
- reconnect;
- page reload;
- switch account;
- switch chain;
- reject chain switch;
- add missing chain;
- low HYPE gas;
- insufficient xStock;
- approval needed;
- approval already sufficient;
- approval rejection;
- trade rejection;
- trade success;
- trade revert;
- tx replacement;
- stale quote;
- graduation race;
- claim after disconnect/reconnect;
- wallet change while modal open;
- multi-tab account change;
- WalletConnect expiry;
- mobile return failure.

---

# 534. Wallet Security Test Cases

Required:

- SIWE nonce replay rejection;
- SIWE wrong domain rejection;
- SIWE wrong chain rejection;
- SIWE expired request rejection;
- EOA signature verification;
- ERC-1271 smart-account verification where supported;
- malformed provider metadata;
- malicious wallet icon payload handling;
- stale account transaction prevention;
- stale chain transaction prevention;
- duplicate submission prevention;
- unlimited allowance not default;
- canonical spender verification;
- no private key/seed storage.

---

# 535. Wallet E2E Release Scenario

Mandatory:

```text
open site disconnected
↓
browse market
↓
click BUY
↓
connect wallet
↓
switch to HyperEVM
↓
detect low/valid gas
↓
approve exact xStock amount
↓
review buy
↓
sign
↓
tx hash persisted
↓
disconnect wallet while pending
↓
app continues reconciliation
↓
reconnect / refresh
↓
confirmed state recovered
↓
account dashboard updates
↓
Stockback estimated state updates
↓
claim finalized Stockback
↓
switch account
↓
old account state disappears from active context
↓
creator launch from second account
↓
creator-bound vanity preview verified
```

This must pass on desktop and mobile representative flows.

---

# 536. Wallet Monitoring / Telemetry

Monitor aggregate operational metrics:

```text
connect success rate
connect rejection rate
chain-switch failure rate
WalletConnect expiry/failure rate
signature rejection rate
tx submission error rate
receipt latency
reconciliation latency
replacement detection
RPC-related wallet failures
```

Privacy rule:

> Do not turn wallet telemetry into unnecessary behavioral fingerprinting.

---

# 537. Wallet Release Gates — P0

NO-GO if:

- wallet can submit to wrong chain;
- stale account can sign another account's reviewed intent;
- duplicate transaction submission is reproducible;
- approvals are misleading;
- unlimited approval is silently defaulted;
- pending tx is lost across refresh;
- transaction success can be shown before canonical confirmation;
- wallet disconnect bricks reconciliation;
- SIWE replay/domain validation is broken;
- smart-wallet users are falsely treated as EOAs where contract verification is required;
- WalletConnect/mobile critical path is materially broken for declared-supported wallets;
- seed/private-key collection exists anywhere in product;
- canonical spender/contract addresses can be silently replaced by frontend input.

---

# 538. Wallet Source-of-Truth Map

| Domain | Authority |
|---|---|
| Active browser connector | wallet provider / frontend connector state |
| Active account | wallet provider |
| Active execution chain | wallet provider chain ID + app verification |
| Balance | chain |
| Allowance | chain |
| Creator ownership | canonical contracts |
| Stockback entitlement | HolderRewardVault active commitment + claim state |
| Pending tx hash | wallet submission result + local transaction center |
| Confirmed tx | canonical chain receipt/state |
| SIWE session | server-auth session bound to wallet address |
| Profile metadata | authenticated metadata service |
| Private key | user wallet only; never platform |

---

# 539. Wallet Integration With Reference Stack

Default implementation:

```text
Next.js / React
↓
wagmi connector layer
↓
viem typed chain interaction

EIP-6963
→ injected wallet discovery

WalletConnect-compatible connector
→ mobile/cross-device

TanStack Query
→ balances/allowances/claims/read state

local transaction store
→ pending tx / UI state

WebSocket + indexer
→ canonical transaction/market reconciliation

optional SIWE API
→ profile/session auth
```

Do not duplicate signing logic inside API/backend.

---

# 540. Wallet Backend Endpoints — Conceptual

Only if SIWE/profile sessions are implemented:

```text
GET  /v1/auth/nonce
POST /v1/auth/verify
POST /v1/auth/logout
GET  /v1/session
```

Potential profile endpoints:

```text
GET  /v1/creators/:address/profile
PUT  /v1/creators/:address/profile
```

Authenticated write must prove address/session ownership.

Backend never exposes:

```text
POST /trade-for-user
POST /sign-for-user
```

unless a future explicitly approved delegated-signing architecture exists.

---

# 541. Wallet Dependency Degradation

If WalletConnect infrastructure is unavailable:

- injected wallets still work;
- public browsing still works;
- show WalletConnect-specific degraded status.

If injected-wallet discovery fails:

- safe fallback may be offered;
- do not break WalletConnect.

If app read RPC is degraded:

- wallet may still be connected;
- transactions should be blocked or carefully gated if safe review/simulation cannot be performed.

---

# 542. HyperEVM Official RPC Limitation Awareness

Current official HyperEVM documentation notes that its official JSON-RPC endpoint does not provide WebSocket JSON-RPC support, while other RPC implementations may.

Therefore:

- wallet connectivity cannot be architected around official RPC WebSocket availability;
- dedicated realtime/indexer infrastructure remains required;
- HTTP RPC + external verified realtime providers/indexer may be combined;
- implementation must VERIFY current provider capabilities before production.

This reinforces the separation:

```text
Wallet provider
≠
Realtime market data system
```

---

# 543. Wallet / HyperCore Boundary

The launchpad V1 executes financial protocol actions on HyperEVM.

HyperCore balances are not automatically interchangeable with HyperEVM wallet balances.

If user has HYPE/xStock on another Hyperliquid layer/state:

- clearly explain required transfer path;
- do not display it as immediately spendable HyperEVM wallet balance;
- do not silently initiate cross-layer transfer.

Balance labels must name the execution environment.

---

# 544. Wallet Token Visibility

Wallet extensions may not automatically display newly launched TOKEN or wrapped xStock assets.

Website should always show balances from canonical chain/indexer regardless of wallet token-list UI.

Optional:

```text
Add token to wallet
```

only if standard wallet method is supported.

Do not treat missing wallet-extension token display as zero balance.

---

# 545. Wallet Chain / Contract Verification UX

Advanced trust details may expose:

```text
Network
HyperEVM

Chain ID
verified config

Token Contract
0x...

Market Contract
0x...

Paired xStock
0x...
Official ✓
```

Explorer links must use verified production explorer configuration.

---

# 546. Wallet Copy Standards

Preferred copy:

```text
Connect Wallet
Switch to HyperEVM
Approve NVDAx
Review Buy
Waiting for Wallet…
Transaction Submitted
Confirming on HyperEVM…
Transaction Confirmed
Transaction Reverted
Connection Cancelled
```

Avoid:

```text
Sign random message
Authorize
Execute
Success!
```

without context.

---

# 547. Wallet Visual Quality Bar

Wallet subsystem must match the rest of the premium product.

It cannot look like an unstyled SDK modal pasted into the site.

Quality requirements:

- bespoke spacing;
- typography consistent with terminal;
- precise wallet/provider icons;
- subtle motion;
- immediate responsiveness;
- stable modal dimensions;
- clean QR state;
- crisp transaction detail hierarchy;
- financial values visually dominant over decoration.

---

# 548. Wallet Final Product Decisions — LOCKED

V1 wallet decisions:

```text
Custody
Non-custodial

Embedded/social wallet
Not required / not auto-created

Primary identity
Wallet address

Injected discovery
EIP-6963 preferred

Wallet provider interface
EIP-1193

Cross-device/mobile
WalletConnect-compatible

Web3 client
viem + wagmi default

Authentication
Optional SIWE for off-chain session/profile

EOA-only assumption
Forbidden

Smart wallet / multisig
Supported where compatible

Default token approval
Exact/sufficient amount, not silent unlimited

Gas
User pays HYPE

Gas sponsorship
Not required V1

Automatic transaction submission
Forbidden

Pending tx persistence
Mandatory

Account/chain change re-review
Mandatory

Browse without wallet
Mandatory

Wallet UI
Bespoke premium

Private key / seed handling
Never platform
```

---

# 549. Wallet Handoff Rule

A coding agent must not decide independently to:

- add embedded custody wallet;
- add social-login wallet creation;
- default to unlimited allowance;
- introduce gas sponsorship/paymaster;
- make SIWE mandatory for trading;
- auto-connect/fingerprint wallets;
- auto-submit transactions;
- treat backend session as financial authority;
- exclude smart wallets solely because they are contracts.

Any such change requires explicit product/security review.

---

# 550. Updated Requirements Traceability — Wallet

| Requirement | Canonical State | Frontend / Service | Test | Gate |
|---|---|---|---|---|
| Browse disconnected | public data | Next.js/API | disconnected E2E | P0 UX |
| Provider discovery | browser wallet providers | wagmi/EIP-6963 | multi-wallet test | P0 |
| WalletConnect | session protocol | connector layer | desktop/mobile test | P0 declared support |
| Correct network | provider chain ID | wallet state | wrong-chain test | P0 |
| Balance | chain | viem/query | reconciliation | P0 |
| Allowance | chain | viem/query | approval matrix | P0 |
| Exact approval default | user tx | review UI | allowance security test | P0 |
| Pending tx persistence | tx hash + chain | transaction center | reload/disconnect | P0 |
| Confirmation | chain/indexer | realtime reconciliation | reorg/replacement | P0 |
| SIWE auth | signed SIWE session | API | replay/domain tests | P0 if enabled |
| Smart wallet auth | ERC-1271 where needed | auth verifier | contract-signature test | P0 if enabled |
| Creator launch binding | active account + Factory | creator flow | account-change race | P0 |
| Stockback claim | active wallet + Vault | claim flow | proof/account race | P0 |
| Premium wallet UX | UI | web | visual/accessibility QA | release |

---

# 551. Updated Full E2E Wiring With Wallet

Canonical release rehearsal now begins before protocol action:

```text
BROWSE DISCONNECTED
↓
CONNECT EXTERNAL WALLET
↓
VERIFY ACTIVE ACCOUNT
↓
VERIFY HYPEREVM
↓
VERIFY HYPE GAS
↓
VERIFY CANONICAL xSTOCK BALANCE
↓
APPROVE REQUIRED AMOUNT
↓
BUY
↓
PERSIST TX HASH
↓
INDEX / RECONCILE
↓
STOCKBACK ACCRUES
↓
SELL / CREATE / CLAIM FLOWS
↓
GRADUATION
↓
POST-GRAD HYPERSWAP
↓
CREATOR FEE CLAIM
↓
STOCKBACK CLAIM
↓
ACCOUNT SWITCH / RELOAD / MOBILE RECOVERY TESTS
```

Wallet behavior is now part of the same P0 release path as economics and contracts.

---

# 552. Wallet External Verification Checklist

At implementation freeze, verify current:

- HyperEVM mainnet/testnet chain IDs;
- verified RPC endpoints;
- explorer URLs;
- wallet chain-switch/add-chain metadata;
- WalletConnect/relevant connector compatibility;
- wagmi/viem current supported versions;
- EIP-6963 connector behavior;
- supported mobile wallets;
- canonical xStock approval/permit behavior;
- smart-wallet/ERC-1271 compatibility assumptions;
- relevant browser/mobile deep-link constraints.

Do not freeze ecosystem-specific facts from historical documentation without re-check.

---

# 553. Wallet Final Acceptance Statement

Wallet subsystem is considered implementation-ready only when:

```text
connection
+ identity
+ network
+ gas
+ approvals
+ signing
+ transaction persistence
+ reconciliation
+ mobile
+ smart wallets
+ authentication
+ security
+ visual UX
+ error recovery
```

are all wired to the rest of the product.

> **Wallet UX is a financial safety surface and a premium product surface at the same time.**

---

---

# 554. Platform Wallet / Treasury / Key-Management Architecture — V1

This section defines **platform-owned / platform-operated accounts**, not end-user wallets.

It answers:

- how many logical platform accounts exist;
- what each account is for;
- what each account may hold;
- what each account may control;
- how founder profit is separated from platform treasury;
- how protocol deployment authority is handled;
- how automation keys are isolated;
- how emergency authority is constrained;
- how Stockback attestation keys are separated from custody;
- how keys/signers should be stored and operated.

Core principle:

> **Separate control, money, deployment, automation, emergency powers, founder profit, and Stockback attestation. No single key should become a protocol-wide skeleton key.**

---

# 555. Canonical V1 Platform Account Inventory — LOCKED

V1 uses **6 logical platform/operator accounts** plus **5 independent Stockback attestor signer keys**.

```text
1. Governance Safe
2. Treasury Safe
3. Founder Profit Safe
4. Protocol Deployer Wallet
5. Operations / Relayer Wallet
6. Guardian Safe

PLUS

7A–7E. Five Stockback Attestor Keys
```

Logical count:

```text
6 platform/operator accounts
+
5 attestor signer keys
```

Important:

> A multisig account has multiple underlying signer wallets. Therefore the physical/private-key inventory is larger than six even though the protocol has six logical operator accounts.

---

# 556. Platform Account Mental Model

```text
Governance Safe
= protocol control

Treasury Safe
= platform/company money

Founder Profit Safe
= profit already distributed to founder

Protocol Deployer Wallet
= deploy protocol infrastructure

Operations / Relayer Wallet
= low-value automation / gas

Guardian Safe
= narrow emergency brake

Stockback Attestors
= validate reward commitments, never custody funds

LaunchpadFactory
= permissionless token deployment mechanism

Creator Wallet
= creator identity
```

These roles must not be conflated.

---

# 557. Account 1 — Governance Safe

Reference implementation:

```text
Safe smart account
3-of-5 threshold
```

Purpose:

- control approved protocol administration;
- manage xStock registry for **new launches**;
- enable/disable supported quote assets according to policy;
- update platform fee recipient when explicitly allowed;
- manage approved roles;
- manage narrow configuration changes;
- perform governance actions required by verified integrations;
- execute timelocked administration where timelock is used.

Governance Safe is **not** the normal platform treasury.

---

# 558. Governance Safe — Allowed Powers

Only powers already permitted by the product/security model may be assigned.

Examples:

```text
XStockRegistry
→ add canonical supported xStock

XStockRegistry
→ disable asset for new launches

FeeVault
→ set approved platform fee recipient if contract supports governance path

HolderRewardVault / Stockback config
→ manage attestor set/version through approved governance flow

Protocol config
→ narrowly approved operational configuration
```

Governance must not gain powers merely because multisig security exists.

Multisig protects authorized powers; it does not justify adding dangerous powers.

---

# 559. Governance Safe — Forbidden Powers

Governance Safe must not be able to arbitrarily:

- mint launch TOKEN;
- seize user TOKEN;
- seize user xStock;
- withdraw curve collateral;
- withdraw permanently locked LP principal;
- confiscate finalized Stockback obligations;
- take creator-accrued fees;
- change existing launch supply;
- rewrite existing market curve economics;
- manually graduate/ungraduate arbitrary markets;
- change creator identity;
- rewrite historical Stockback claims.

If a contract exposes any such path, that is an architecture/security defect.

---

# 560. Governance Safe Threshold — LOCKED BASELINE

Baseline:

```text
5 owners
3 signatures required
```

Reason:

- one lost/compromised signer does not break governance;
- two compromised signers still cannot act;
- avoids 1-of-N / 2-of-3 concentration for protocol control;
- practical enough for V1 operations.

Exact human/key identities are operational secrets and do not belong in public source code.

---

# 561. Governance Signer Storage

Preferred human signer setup:

```text
Signer A → dedicated hardware wallet
Signer B → dedicated hardware wallet
Signer C → dedicated hardware wallet
Signer D → geographically separated backup signer
Signer E → independent/recovery signer
```

Rules:

- no seed phrases in cloud notes;
- no seed phrases in password manager plaintext;
- no screenshots/photos of seed phrases;
- no browser hot wallet as the only quorum path;
- each signer device has independent recovery material;
- recovery material stored physically separated;
- signer devices are not used for daily degen trading.

---

# 562. Governance Timelock Policy

Where contract architecture supports it without breaking emergency requirements:

```text
routine high-impact governance
→ multisig approval
→ timelock
→ execution
```

Good candidates:

- changing platform fee recipient;
- changing attestor configuration;
- adding/changing privileged roles;
- changing critical external protocol configuration.

Emergency pause-only actions may use a different narrow Guardian path.

Exact delay is `CHOOSE` after threat modeling and operational testing.

---

# 563. Account 2 — Treasury Safe

Reference implementation:

```text
Safe smart account
3-of-5 threshold
```

Purpose:

> **Custody platform-owned revenue and operating capital after it has become platform entitlement.**

Treasury Safe is the canonical production **platform fee recipient / revenue destination** unless a narrow intermediate FeeVault accounting step is required.

---

# 564. Treasury Revenue Sources

Treasury may legitimately receive:

### Pre-grad

```text
Core Trading Fee
1%

Creator
65%

Platform
35%
  ↓
FeeVault accounting
  ↓
Treasury Safe
```

Stockback contribution is excluded.

### Post-grad paired-xStock fee revenue

For creator-eligible LP fee revenue:

```text
Creator
65%

Platform-side
35%
    ├── 50% → Stockback
    └── 50% → Treasury
```

Equivalent paired-xStock allocation:

```text
65.0% Creator
17.5% Stockback
17.5% Platform Treasury
```

### Post-grad TOKEN-side fee revenue

```text
Creator
65%

Platform
35%
  ↓
Treasury Safe
```

No automatic TOKEN sale is required.

---

# 565. Treasury May Hold

Treasury may hold legitimate platform-owned assets such as:

- HYPE;
- NVDAx;
- SPYx;
- QQQx;
- other supported xStock revenue;
- TOKEN-side platform fee revenue;
- stable assets received through explicit treasury operations;
- other lawful platform-owned operating assets.

Treasury must never label user liabilities as platform assets.

---

# 566. Treasury Must NOT Hold as Platform Property

The following are **not platform treasury assets**:

- curve collateral;
- creator-accrued fee entitlement;
- Stockback open-epoch funds;
- Stockback finalized-unclaimed funds;
- user assets;
- LP principal;
- protocol escrow belonging to market migration;
- claimable rewards owed to users.

Accounting/UI/monitoring must distinguish these buckets.

---

# 567. Treasury Spending

Treasury may fund legitimate platform costs, for example:

- RPC infrastructure;
- backend hosting;
- audits;
- legal/compliance work;
- design/engineering vendors;
- bug bounties;
- monitoring/security tooling;
- operational HYPE gas funding;
- approved team/company expenses;
- founder profit distribution.

Treasury spending should use deliberate multisig proposals.

---

# 568. Treasury Safe Threshold — LOCKED BASELINE

Baseline:

```text
5 owners
3 signatures required
```

Treasury owner set should **not be 100% identical** to Governance Safe if operationally feasible.

Example conceptual separation:

```text
Governance
A B C D E

Treasury
A B F G H
```

Partial overlap is acceptable.

Complete overlap is discouraged because the same compromise set would control both protocol and money.

---

# 569. Account 3 — Founder Profit Safe

Purpose:

> **Receive profit that has been deliberately distributed from the platform Treasury to the founder.**

Reference implementation:

```text
Safe smart account
2-of-3 threshold
```

This is the founder's **profit custody account**, not the protocol treasury.

---

# 570. Founder Profit Is Not Raw Protocol Revenue

Canonical accounting distinction:

```text
Protocol Revenue
≠
Treasury Assets
≠
Founder Distributed Profit
```

Protocol revenue first becomes platform-owned Treasury assets.

Only after an explicit distribution decision does value become Founder Profit.

---

# 571. Founder Profit Distribution Flow — LOCKED

```text
Protocol Fees / Platform Revenue
↓
FeeVault / accounting
↓
Treasury Safe
↓
Operating reserve / obligations / runway
↓
Explicit founder distribution proposal
↓
Treasury multisig approval
↓
Founder Profit Safe
```

V1 does **not** automatically route every trade fee directly to a founder wallet.

---

# 572. Why Founder Profit Is Separate

Separating Founder Profit from Treasury provides:

- clean accounting;
- clearer company/platform runway;
- auditable founder withdrawals;
- less hot-wallet exposure;
- easier future team/investor/company structure;
- smaller blast radius;
- no confusion between personal assets and protocol liabilities.

---

# 573. Founder Profit Safe Permissions

Founder Profit Safe may:

- receive approved distributions;
- hold founder-owned assets;
- transfer/sell/bridge founder-owned assets at founder discretion.

Founder Profit Safe must NOT automatically receive:

- governance authority;
- registry authority;
- HolderRewardVault withdrawal authority;
- FeeVault creator-fund authority;
- curve collateral authority;
- LP-principal authority.

Economic ownership does not equal protocol admin authority.

---

# 574. Founder Profit Threshold — LOCKED BASELINE

Baseline:

```text
3 owners
2 signatures required
```

Example:

```text
Founder hardware key A
Founder hardware key B
Founder recovery key C
```

This protects meaningful founder profit from one lost/compromised signer.

A small spending wallet may be funded separately from Founder Profit Safe if desired, but is not a canonical protocol account.

---

# 575. Founder Distribution Frequency

V1 does not require automatic daily/weekly distribution.

Recommended:

```text
manual / deliberate periodic distribution
```

Frequency is an operational/business decision.

Examples:

- monthly;
- quarterly;
- when Treasury exceeds an approved reserve target.

Do not embed founder withdrawal frequency into smart-contract economics unless explicitly required.

---

# 576. Founder Distribution Policy

Before distribution, Treasury operators should consider:

```text
platform obligations
operational runway
tax/accounting reserve
audit/security reserve
infrastructure spend
legal/compliance reserve
known liabilities
```

The masterplan does not prescribe tax/legal treatment.

Professional accounting/legal advice remains external to protocol logic.

---

# 577. Account 4 — Protocol Deployer Wallet

Purpose:

> **Deploy protocol infrastructure contracts.**

It does **not** deploy each creator token directly as creator identity.

Reference implementation:

```text
dedicated hardware-backed EOA
```

Use cases:

- deploy LaunchpadFactory;
- deploy XStockRegistry;
- deploy FeeVault;
- deploy HolderRewardVault;
- deploy GraduationRouter;
- deploy ReferencePriceAdapter;
- deploy approved supporting contracts.

---

# 578. Deployer Wallet vs Creator Launch — CRITICAL LOCK

Creator token launch flow:

```text
Creator Wallet
↓
calls LaunchpadFactory
↓
LaunchpadFactory
↓ CREATE2
LaunchToken + LaunchMarket
```

Therefore:

```text
Platform Deployer Wallet
≠ creator

LaunchpadFactory
= technical contract deployer for launch assets

Creator Wallet
= canonical creator identity
```

This must be explicit in:

- Factory storage;
- events;
- indexer;
- API;
- UI;
- SDK.

---

# 579. Creator Identity Storage — LOCKED

Conceptually:

```text
creatorOf[token] = creatorWallet
creatorOf[market] = creatorWallet
```

or equivalent registry mapping.

`TokenLaunched` must include enough identity information to reconstruct:

- creator wallet;
- token address;
- market address;
- xStock pair;
- launch version.

Explorer-level `contract creator` metadata does not replace product-level creator identity.

---

# 580. Deployer Handoff

After initial deployment:

```text
Deployer EOA
↓
deploy
↓
verify
↓
configure
↓
transfer approved governance authority
↓
Governance Safe
```

The Deployer must not remain a hidden permanent super-admin.

---

# 581. Deployer Balance Policy

Deployer should hold:

```text
deployment HYPE
+
small deployment buffer
```

Do not leave Treasury-size assets on the Deployer.

After deployment campaign:

- reduce balance;
- archive operational access;
- keep key available only if future explicitly approved deployment requires it.

---

# 582. Deployment Stack — DEFAULT

Recommended:

```text
Foundry
+
hardware-wallet signing / externally signed transactions
+
deterministic deployment scripts
+
verified config registry
```

Deployment scripts must:

- validate chain ID;
- validate expected deployer;
- print predicted addresses;
- refuse unknown production config;
- record deployment transaction hashes;
- record constructor args;
- verify ownership/role handoff;
- export machine-readable deployment manifest.

No production deployment private key in `.env` on a developer laptop.

---

# 583. Account 5 — Operations / Relayer Wallet

Purpose:

> **Perform automated low-privilege transactions that need gas but must not control platform money or governance.**

Reference implementation:

```text
dedicated automated signing key
+
managed KMS/HSM-class key custody
```

This is the only intentionally hot/online platform signing role in normal operations.

---

# 584. Ops / Relayer Allowed Actions

Potential allowed actions:

- submit already quorum-signed Stockback commitments;
- call permissionless finalization/retry functions;
- perform narrowly authorized fee-collection maintenance if required;
- execute health/reconciliation transactions that carry no ownership privilege;
- pay gas for approved automation.

Each action must be independently safe if the relayer becomes malicious.

---

# 585. Ops / Relayer Forbidden Powers

Relayer must not:

- withdraw Treasury;
- change governance config;
- change xStock registry;
- change creator;
- mint TOKEN;
- withdraw curve collateral;
- withdraw LP principal;
- create arbitrary Stockback root without attestor quorum;
- change platform fee recipient;
- seize finalized reward funds.

---

# 586. Ops Wallet Funding Policy

Ops wallet holds only:

```text
small HYPE gas budget
```

Treasury periodically tops it up within an operational cap.

If compromised:

> Financial blast radius should be approximately the small HYPE balance plus any harmless/spamable permissionless calls.

---

# 587. Ops Key Stack — DEFAULT

Preferred:

```text
cloud KMS / HSM-backed ECDSA key
or
equivalent managed secure signer
```

Requirements:

- private key non-exportable where provider supports it;
- signing restricted to designated service identity;
- audit logs;
- rotation procedure;
- spending/gas monitoring;
- no plaintext private key in CI/CD;
- no key in container image;
- no key committed to repository.

Provider is `CHOOSE`.

---

# 588. Account 6 — Guardian Safe

Purpose:

> **Narrow emergency brake, never a money-moving super-admin.**

Reference implementation:

```text
Safe smart account
2-of-3 threshold
```

Guardian exists only if the final contracts expose narrowly scoped emergency functions.

---

# 589. Guardian Allowed Powers

Potential examples:

```text
pause Stockback claims before a suspicious root activates
pause a narrowly scoped unsafe integration action
disable a compromised operational role
```

Exact powers must be explicitly enumerated.

No generic `execute(anyTarget, anyCalldata)` capability should turn Guardian into hidden governance.

---

# 590. Guardian Forbidden Powers

Guardian may not:

- transfer Treasury;
- redirect platform revenue;
- withdraw HolderRewardVault funds;
- withdraw FeeVault liabilities;
- withdraw curve collateral;
- unlock LP;
- change token supply;
- rewrite market economics;
- set arbitrary Stockback root;
- change creator;
- permanently seize user funds.

Guardian is a brake.

Governance is the steering wheel.

---

# 591. Guardian Unpause / Recovery

Preferred pattern:

```text
Guardian
→ pause narrow subsystem

Governance Safe
→ investigate
→ approve recovery/unpause
```

Avoid allowing the same single emergency actor to both pause and arbitrarily rewrite recovery state.

---

# 592. Stockback Attestor Set — LOCKED BASELINE

V1:

```text
5 independent attestor keys
3-of-5 quorum
```

Attestors sign deterministic cumulative Stockback commitments.

They do not submit arbitrary unsigned roots.

---

# 593. Attestor Responsibilities

Each attestor independently verifies:

- canonical chain range;
- block/finality boundary;
- holder Transfer history;
- exclusions;
- TWAB computation;
- reward funding;
- cumulative entitlements;
- dataset hash;
- cumulative Merkle root;
- sequence/version;
- domain separation.

Only after verification should the attestor sign.

---

# 594. Attestors Do Not Custody Funds

Hard rule:

```text
ATTES­TOR KEY
≠ Treasury key
≠ HolderRewardVault withdrawal key
≠ Governance key
```

Attestor compromise must not directly transfer user/platform funds.

---

# 595. Attestor Key Infrastructure — DEFAULT

Recommended shape:

```text
Attestor A → independent KMS/HSM key
Attestor B → independent KMS/HSM key
Attestor C → independent KMS/HSM key
Attestor D → independent KMS/HSM key
Attestor E → independent KMS/HSM key
```

Prefer:

- separate service identities;
- separate deployment credentials;
- separate failure domains where practical;
- independent recomputation before signing.

Do not run all five attestors as five environment variables in one server.

---

# 596. Attestor Quorum Security

```text
1 compromised
→ cannot authorize root

2 compromised
→ cannot authorize root

3 compromised
→ quorum compromise
```

Therefore monitoring must treat:

- unexpected signer participation;
- signer outage;
- duplicate signing;
- inconsistent root candidates;

as security signals.

---

# 597. Root Submission Separation

Flow:

```text
Indexer / TWAB computation
↓
deterministic dataset
↓
independent attestors
↓
3-of-5 signatures
↓
Ops / Relayer submits commitment
↓
HolderRewardVault verifies
↓
activation delay
↓
ACTIVE root
```

Thus:

```text
Relayer alone
cannot invent root

Attestors alone
cannot withdraw vault

Treasury
cannot rewrite entitlement

Guardian
can only perform narrow emergency action
```

---

# 598. Safe as Reference Multisig Stack

As of the current public ecosystem state, HyperEVM is represented by Safe as part of its Safe Standard ecosystem and Safe publishes HyperEVM support material.

Reference V1 implementation:

```text
Governance Safe
Treasury Safe
Founder Profit Safe
Guardian Safe
```

Before production, `VERIFY`:

- canonical Safe smart-account contracts on HyperEVM;
- Safe version;
- Safe Wallet support;
- Transaction Service support;
- Event Service support;
- contract addresses;
- module compatibility;
- signing UX;
- recovery behavior.

Never copy Safe addresses from another chain.

---

# 599. Safe Module Policy

V1 baseline:

> **No optional Safe module is enabled merely for convenience.**

Modules such as:

- allowance modules;
- transaction guards;
- recovery modules;
- 4337 modules;
- custom modules;

must undergo separate security review before enabling.

A multisig with unnecessary modules can reintroduce bypass paths.

---

# 600. Safe Owner Policy

Owners/signers should be:

- dedicated;
- documented internally;
- independently recoverable;
- hardware-backed for human authority;
- not shared as one seed across multiple owner addresses.

Do not derive every governance/treasury signer from one seed phrase.

That defeats apparent multisig diversity.

---

# 601. Signer-Set Separation — LOCKED PRINCIPLE

Recommended conceptual topology:

```text
Governance owners
A B C D E

Treasury owners
A B F G H

Founder Profit owners
A I J

Guardian owners
B C K
```

This is illustrative.

Actual identities remain private operations data.

Hard principle:

> Governance, Treasury, Founder Profit, and Guardian must not all share an identical quorum.

---

# 602. Signer Independence

A "3-of-5" setup where all five keys are:

- on one laptop;
- in one password manager;
- in one cloud account;
- controlled by one exposed seed;

is not meaningful operational separation.

Security assessment considers failure domains, not only address count.

---

# 603. Human Hardware Wallet Policy

For Governance/Treasury/Founder/Guardian human signers:

Preferred:

```text
hardware wallet
+
offline seed backup
+
dedicated signing workflow
```

Use supported hardware products chosen at implementation/operations time.

Do not hardcode one hardware-wallet vendor into protocol code.

---

# 604. Production Signing Workstation

High-impact multisig signing should ideally use:

- dedicated clean workstation/browser profile;
- verified production domain;
- transaction simulation/decoding;
- address-book verification;
- hardware wallet confirmation;
- independent review of target + calldata.

Avoid signing treasury/governance proposals from daily browsing environments.

---

# 605. Transaction Proposal Review

Before Governance/Treasury execution, reviewer must be able to inspect:

```text
chain
Safe address
target contract
function selector
decoded call
asset
amount
recipient
nonce
proposal creator
signers
```

Unknown/undecodable calls require escalation, not blind signing.

---

# 606. Address Book / Registry

Maintain a machine-readable and human-readable production address registry for:

- Governance Safe;
- Treasury Safe;
- Founder Profit Safe;
- Guardian Safe;
- Deployer;
- Ops Relayer;
- attestors;
- Factory;
- FeeVault;
- HolderRewardVault;
- GraduationRouter;
- xStock registry;
- verified external protocol contracts.

Changes require review.

---

# 607. Platform Fee Recipient — LOCKED

Production default:

```text
platformFeeRecipient
=
Treasury Safe
```

Not:

- founder daily hot wallet;
- Deployer wallet;
- Ops wallet;
- Guardian wallet;
- arbitrary backend-generated address.

Founder receives profit through Treasury distribution.

---

# 608. Founder Profit Distribution — No Hidden Bypass

There must not be a hidden protocol path:

```text
FeeVault
→ Founder wallet
```

that bypasses Treasury accounting while UI/docs claim Treasury is the platform recipient.

If founder distribution occurs:

```text
Treasury transaction
→ Founder Profit Safe
```

must be visible/auditable on-chain.

---

# 609. Platform Money Flow — Canonical

```text
PRE-GRAD CORE FEE
User Trade
↓
LaunchMarket
↓
Creator entitlement 65%
Platform entitlement 35%
↓
FeeVault
├── Creator → creator wallet
└── Platform → Treasury Safe


PRE-GRAD STOCKBACK
User Trade
↓
HolderRewardVault
↓
eligible holders


POST-GRAD LP FEES
HyperSwap locked LP
↓
Fee-right collection
↓
Creator eligible revenue
├── Creator 65%
└── Platform-side 35%
      ├── paired xStock:
      │     50% Stockback
      │     50% Treasury
      └── TOKEN:
            100% platform share → Treasury


TREASURY
↓
operations / reserves / approved expenses
↓
explicit founder distribution
↓
Founder Profit Safe
```

---

# 610. Platform Account Authority Matrix

| Account | Hold Large Funds | Governance | Deploy Core | Automated | Emergency Pause | Sign Stockback Root |
|---|---:|---:|---:|---:|---:|---:|
| Governance Safe | Prefer no | Yes, narrow | No | No | Via governance only | No |
| Treasury Safe | Yes | No protocol control | No | No | No | No |
| Founder Profit Safe | Founder funds only | No | No | No | No | No |
| Deployer EOA | No | Temporary setup only | Yes | No | No | No |
| Ops Relayer | No, gas only | No | No | Yes | No | No |
| Guardian Safe | No | Pause-only | No | No | Yes, narrow | No |
| Attestor Key | No | No | No | Signer service | No | Yes |

No row should quietly accumulate unrelated capabilities.

---

# 611. Platform Account Fund Matrix

| Asset / Liability | Canonical Custody |
|---|---|
| Platform revenue | Treasury Safe after FeeVault accounting |
| Founder distributed profit | Founder Profit Safe |
| Creator accrued fee | FeeVault liability until claimed |
| Curve collateral | LaunchMarket |
| Open Stockback | HolderRewardVault |
| Finalized-unclaimed Stockback | HolderRewardVault |
| LP principal | permanently locked HyperSwap position |
| Deployment HYPE | Deployer, minimal |
| Automation HYPE | Ops Relayer, minimal |
| Governance funds | minimal gas only if required |
| Guardian funds | minimal gas only if required |

---

# 612. No Shared Hot Private Key

Forbidden architecture:

```text
DEPLOYER_PRIVATE_KEY
=
TREASURY_PRIVATE_KEY
=
RELAYER_PRIVATE_KEY
=
ATTESTOR_PRIVATE_KEY
```

Even if technically easier.

Each role uses independent credentials.

---

# 613. Secret Storage — Human vs Machine Keys

Human high-authority keys:

```text
hardware wallets
offline recovery
manual signing
```

Machine automation keys:

```text
KMS/HSM-class secure signer
service identity
non-exportable key where possible
audited signing calls
```

Never use an automated cloud key as the sole path to Treasury/Governance quorum.

---

# 614. CI/CD Key Policy

CI/CD must not contain:

- Governance signer seed;
- Treasury signer seed;
- Founder Profit seed;
- Guardian seed;
- human hardware-wallet private key.

Deployment automation may prepare unsigned transactions.

High-authority signing remains explicit.

Ops/attestor machine-signing access must use narrow workload identity and secret policy.

---

# 615. Key Rotation

Document rotation procedures for:

- Safe owners;
- relayer key;
- attestor key;
- compromised signer;
- lost hardware wallet;
- employee/vendor departure.

Rotation must preserve quorum safety.

Do not remove an owner before verifying remaining quorum/recovery.

---

# 616. Lost Governance Signer

If one signer is lost:

```text
remaining 4 owners
threshold 3
→ governance remains usable
```

Governance proposal should replace lost owner after verification.

Never expose recovery seed publicly to accelerate replacement.

---

# 617. Compromised Signer

If a signer is suspected compromised:

1. freeze signer usage;
2. notify other quorum members;
3. inspect pending Safe transactions;
4. replace compromised owner using remaining quorum;
5. rotate associated operational credentials;
6. review historical signatures;
7. increase monitoring.

One compromised signer should not independently move Governance/Treasury.

---

# 618. Compromised Ops Relayer

Expected response:

```text
disable/revoke relayer role if any
rotate key
stop top-ups
deploy replacement signer
resume automation
```

Protocol funds should remain safe because relayer has no custody authority.

---

# 619. Compromised Attestor

Expected:

```text
1 compromised attestor
→ quorum remains safe
→ remove/replace through governance
```

If multiple attestors show suspicious behavior:

- pause Stockback root activation/claims through narrow safety mechanism where available;
- trading/graduation remain independent;
- regenerate/verify dataset;
- rotate attestor set.

---

# 620. Compromised Treasury Signer Set

Treasury compromise affects platform-owned money, not:

- user balances;
- curve collateral;
- Stockback liabilities;
- LP principal;
- creator accrued entitlement.

This is why Treasury authority is separated from protocol custody.

---

# 621. Compromised Governance Signer Set

Governance compromise is critical but must still be bounded by contract-level forbidden powers.

Even valid Governance signatures should not be capable of:

- unlocking LP principal;
- minting LaunchToken;
- stealing curve collateral;
- rewriting immutable creator allocations.

Security comes from both:

```text
multisig access control
+
contract capability minimization
```

---

# 622. Compromised Founder Profit Safe

Worst intended consequence:

```text
founder-owned distributed assets may be at risk
```

It must NOT imply:

- Treasury compromise;
- Governance compromise;
- protocol fund compromise;
- user fund compromise.

This separation is intentional.

---

# 623. Treasury Withdrawal Controls

Treasury Safe uses manual threshold approval.

Optional future controls may include:

- spending limits;
- guards;
- timelocks.

But they are not enabled automatically.

Any module/guard that can alter Safe execution semantics requires review.

---

# 624. Treasury Asset Conversion

Treasury may choose to manage its own platform-owned assets.

However V1 protocol economics do not automatically:

- sell TOKEN fees;
- swap xStock revenue;
- rebalance Treasury;
- route founder distributions.

Treasury management is separate from protocol trading mechanics.

---

# 625. Founder Profit Conversion

Once assets are distributed to Founder Profit Safe, they are outside protocol accounting.

Founder may manage them independently.

The platform UI must not count spent founder assets as Treasury reserves.

---

# 626. Treasury Accounting Service

Backend should maintain an **observational** treasury ledger derived from chain.

Recommended tables/views:

```text
platform_revenue_accrual
platform_revenue_claim
treasury_inflow
treasury_outflow
treasury_asset_balance
founder_distribution
ops_wallet_topup
safe_transaction
```

Database is not authority.

On-chain balances/transactions remain canonical.

---

# 627. Treasury Dashboard — Internal

Internal/operator dashboard may show:

```text
Treasury NAV
Asset breakdown
Platform fee accrual
Unclaimed platform fees
Founder distributions
Operating spend
Ops wallet HYPE
Safe pending transactions
Signer availability
Attestor health
```

Do not expose sensitive signer metadata publicly.

---

# 628. Founder Profit Dashboard — Internal

Founder view may show:

```text
Lifetime platform revenue
Treasury balance
Distributable / distributed profit
Founder Profit Safe balance
Distribution history
Asset composition
```

Exact accounting/tax classification is external business/accounting logic.

---

# 629. Public Transparency — Optional

Public trust page may expose:

- Governance Safe address;
- Treasury Safe address;
- protocol contract addresses;
- LP lock proof;
- platform fee policy;
- current attestor set addresses if security model requires public verification.

Do not publish:

- seed backups;
- signer physical locations;
- internal recovery details;
- KMS identifiers;
- personal information of signers.

---

# 630. Platform Wallet Stack — Reference Implementation

```text
GOVERNANCE
Safe smart account 3-of-5
hardware-backed human owners

TREASURY
Safe smart account 3-of-5
hardware-backed human owners

FOUNDER PROFIT
Safe smart account 2-of-3
founder hardware-backed owners

DEPLOYER
dedicated hardware-backed EOA
Foundry deployment scripts

OPS / RELAYER
dedicated KMS/HSM-backed EOA
small HYPE only

GUARDIAN
Safe smart account 2-of-3
pause-only authority

STOCKBACK ATTESTORS
5 independent KMS/HSM-backed ECDSA keys
3-of-5 commitment quorum
```

Safe-specific deployment/service details remain `VERIFY` at production freeze.

---

# 631. Key-Management Infrastructure Stack

Reference technology classes:

```text
Human keys
→ hardware wallets

Multisig
→ Safe on verified HyperEVM deployment

Machine keys
→ managed KMS/HSM-class signer

Deployment
→ Foundry scripts

Configuration
→ versioned deployment registry

Monitoring
→ on-chain event monitors + alerting

Secrets
→ managed secret system for non-key credentials
```

Do not use ordinary `.env` plaintext for high-authority private keys.

---

# 632. Safe Transaction Monitoring

Monitor:

- new proposals;
- owner changes;
- threshold changes;
- module enable/disable;
- guard changes;
- executed transactions;
- failed transactions;
- Treasury outflows;
- unknown targets.

Alert immediately on unexpected owner/module/threshold changes.

---

# 633. Treasury Monitoring

Alerts:

```text
large outflow
unknown recipient
unexpected asset approval
unexpected contract interaction
balance drop
new allowance
Treasury Safe owner change
```

Threshold values are operational `CHOOSE`.

---

# 634. Deployer Monitoring

Monitor:

- balance;
- nonce;
- deployments;
- unexpected outgoing transaction;
- role ownership after deployment.

After authority handoff, automated test must prove Deployer is no longer privileged where that is intended.

---

# 635. Ops Wallet Monitoring

Monitor:

- HYPE balance;
- unusual transaction frequency;
- unexpected target;
- failed automation;
- unauthorized method selector;
- top-up frequency.

Auto-top-up must have a conservative cap if implemented.

---

# 636. Attestor Monitoring

Monitor:

- candidate root per signer;
- signature latency;
- disagreement;
- offline signer;
- signature on unknown sequence;
- signature on unexpected domain;
- quorum health.

No root activation should be considered healthy if attestors disagree on deterministic inputs.

---

# 637. Founder Distribution Monitoring

Each Founder Profit distribution records:

```text
Treasury transaction hash
asset
amount
recipient Founder Profit Safe
timestamp
proposal / accounting reference
```

This produces an auditable founder-profit history.

---

# 638. Platform Account Naming Convention

Use clear labels in deployment/config tooling:

```text
GOVERNANCE_SAFE
TREASURY_SAFE
FOUNDER_PROFIT_SAFE
PROTOCOL_DEPLOYER
OPS_RELAYER
GUARDIAN_SAFE
STOCKBACK_ATTESTOR_A
STOCKBACK_ATTESTOR_B
STOCKBACK_ATTESTOR_C
STOCKBACK_ATTESTOR_D
STOCKBACK_ATTESTOR_E
```

Never use ambiguous production labels like:

```text
wallet1
admin2
mainWallet
owner
```

---

# 639. Platform Account Configuration Registry

Central config must record public addresses, not private keys:

```text
governanceSafe
treasurySafe
founderProfitSafe
protocolDeployer
opsRelayer
guardianSafe
stockbackAttestors[]
stockbackThreshold
```

Environment-specific:

```text
local
fork
staging
production
```

Production addresses require deployment sign-off.

---

# 640. Contract Role Wiring — Required

Deployment scripts/tests must prove:

```text
LaunchpadFactory
→ correct governance

XStockRegistry
→ correct governance

FeeVault platform recipient
→ Treasury Safe

HolderRewardVault
→ correct Stockback verifier/governance boundaries

Stockback attestor set
→ exact production signers

Guardian role
→ Guardian Safe only where defined

Deployer
→ no unintended permanent ownership
```

---

# 641. Creator Launch Identity Test — P0

Mandatory E2E test:

```text
Creator Alice
calls Factory
↓
Factory deploys TOKEN
↓
token creator in product state = Alice

Creator Bob
calls Factory
↓
Factory deploys TOKEN
↓
token creator in product state = Bob
```

Platform Deployer address must not appear as either creator.

Factory address may appear as low-level deployer.

---

# 642. Creator Fee Routing Test — P0

For every launch:

```text
creator fee entitlement
→ creator wallet recorded at launch
```

Not:

```text
platform deployer
Treasury
Factory caller backend
```

unless explicitly economically entitled by locked rules.

---

# 643. Treasury Routing Test — P0

Pre-grad platform fee:

```text
platform entitlement
↓
FeeVault
↓
Treasury Safe
```

Post-grad paired-xStock:

```text
platform-side xStock fee
↓
50% Stockback
50% Treasury
```

TOKEN-side platform fee:

```text
100% platform share
↓
Treasury
```

No route to Founder Profit Safe bypasses Treasury.

---

# 644. Founder Profit Test — P0 Operational

Founder distribution simulation:

```text
Treasury
↓ multisig-approved transfer
Founder Profit Safe
```

Assertions:

- Treasury balance decreases correctly;
- Founder Profit balance increases;
- protocol state unchanged;
- creator liabilities unchanged;
- Stockback liabilities unchanged;
- curve collateral unchanged;
- LP principal unchanged.

---

# 645. Blast-Radius Acceptance Tests

Security rehearsal should model:

```text
Deployer compromised
Ops compromised
1 attestor compromised
2 attestors compromised
Founder Profit compromised
1 Governance signer compromised
1 Treasury signer compromised
Guardian signer compromised
```

Expected:

> No single compromised individual/online key can seize protocol-wide funds or rewrite product economics.

---

# 646. Operational Runbook — Required Before Mainnet

Create internal runbooks for:

- Safe proposal creation;
- Safe signing;
- Treasury payment;
- Founder distribution;
- Deployer deployment;
- role handoff;
- Ops key rotation;
- attestor replacement;
- Guardian pause;
- governance unpause;
- signer loss;
- signer compromise;
- Safe owner replacement;
- emergency address verification.

No mainnet deployment without rehearsing critical runbooks.

---

# 647. Founder Profit Is a Locked Product/Business Requirement

The platform is designed to generate legitimate platform revenue.

The founder may receive distributed profit from that revenue.

Canonical statement:

> **Founder profit is intentionally supported, but it is paid from platform-owned Treasury assets after protocol obligations and accounting separation — never from user collateral, creator entitlement, Stockback obligations, or LP principal.**

This ensures the platform can economically benefit its creator without weakening protocol solvency or user rights.

---

# 648. Platform Revenue vs Creator Revenue

Never confuse:

```text
Creator revenue
= creator's locked economic entitlement

Platform revenue
= platform's locked economic entitlement

Founder profit
= platform revenue that Treasury later distributes to founder
```

Founder profit does not reduce creator's 65% entitlement.

---

# 649. Platform Wallet Architecture — Final Lock

Canonical V1:

```text
GOVERNANCE SAFE
3-of-5
protocol control

TREASURY SAFE
3-of-5
platform-owned revenue / operating capital

FOUNDER PROFIT SAFE
2-of-3
founder-distributed profit

PROTOCOL DEPLOYER
hardware EOA
core protocol deployment only

OPS RELAYER
KMS/HSM-backed low-balance EOA
automation only

GUARDIAN SAFE
2-of-3
narrow emergency pause only

STOCKBACK ATTESTORS
5 independent keys
3-of-5 quorum
reward verification only
```

And:

```text
CREATOR WALLET
→ calls LaunchpadFactory

LAUNCHPAD FACTORY
→ deploys LaunchToken / LaunchMarket

CREATOR WALLET
→ remains canonical creator identity
```

---

# 650. Updated Platform-Wallet Requirements Traceability

| Requirement | Canonical Account/State | Implementation | Mandatory Proof | Gate |
|---|---|---|---|---|
| Protocol governance | Governance Safe 3/5 | Safe + contracts | role matrix | P0 |
| Platform revenue custody | Treasury Safe 3/5 | FeeVault routing | accounting test | P0 |
| Founder profit | Founder Profit Safe 2/3 | Treasury distribution | no-bypass test | P0 |
| Core deployment | Deployer hardware EOA | Foundry | authority handoff | P0 |
| Automation | Ops Relayer | KMS/HSM signer | privilege test | P0 |
| Emergency brake | Guardian Safe 2/3 | narrow role | pause/no-withdraw test | P0 if present |
| Stockback root trust | 5 attestors / 3 signatures | verifier + KMS/HSM | quorum/replay tests | P0 |
| Creator identity | creator wallet + Factory | registry/event | creator attribution test | P0 |
| Platform fee recipient | Treasury Safe | config/FeeVault | recipient test | P0 |
| Key separation | role-specific credentials | ops/security | compromise rehearsal | P0 |

---

# 651. Updated Professional Handoff Status

The engineering team must now treat **platform/operator wallet architecture** as separate from the **user wallet integration architecture**.

Two different systems:

```text
USER WALLET SYSTEM
→ how traders/creators connect and sign

PLATFORM WALLET SYSTEM
→ how protocol control, Treasury, founder profit, deployment, automation, emergency authority, and attestation are secured
```

Both are P0.

---

---

# 652. Production Infrastructure & Access Security — V1

The product can have correct smart contracts and still be compromised through:

- domain/DNS;
- source-control account;
- CI/CD;
- frontend hosting;
- cloud credentials;
- database administration;
- RPC credentials;
- object-storage access;
- internal operator tools;
- dependency supply chain.

Therefore infrastructure security is a **P0 security boundary**, not secondary DevOps work.

Core principle:

> **No compromise of one SaaS account, one laptop, one CI secret, or one production service should silently become control over protocol funds or user transaction intent.**

---

# 653. Production Trust Domains

Treat these as separate trust domains:

```text
1. Blockchain / contracts
2. Platform multisig / hardware signers
3. Source control
4. CI/CD
5. Cloud/runtime infrastructure
6. DNS/CDN/domain
7. Databases / caches / object storage
8. RPC / indexing providers
9. Internal operator console
10. Monitoring / alerting
11. Third-party frontend dependencies/scripts
```

Compromise of one domain must not automatically grant all others.

---

# 654. Reference Production Infrastructure Stack

Recommended baseline:

```text
SOURCE CONTROL
GitHub organization

CI/CD
GitHub Actions

CLOUD AUTH FROM CI
OIDC short-lived credentials
not long-lived cloud access keys

INFRASTRUCTURE AS CODE
OpenTofu / Terraform-class IaC

CONTAINERS
Docker

FRONTEND DELIVERY
managed Next.js/CDN platform or equivalent

BACKEND / INDEXER / REALTIME
long-running container runtime

DNS / CDN / WAF
Cloudflare-class edge provider

DATABASE
managed PostgreSQL

CACHE / QUEUE
managed Redis

OBJECT STORAGE
S3-compatible

MACHINE SIGNING
KMS/HSM-class signer

OBSERVABILITY
OpenTelemetry-compatible telemetry
+ error monitoring
+ metrics/logs/alerts
```

Individual vendors remain `DEFAULT / CHOOSE`.

Security properties are mandatory.

---

# 655. GitHub Organization — LOCKED OPERATING MODEL

Production repository should live under an organization, not a personal developer account.

Required:

- organization-level ownership;
- minimum two organization owners;
- phishing-resistant MFA/security keys for privileged members;
- no shared GitHub account;
- role-based repository access;
- offboarding procedure;
- audit-log review;
- protected production repository/settings.

Personal forks must not have access to production secrets.

---

# 656. GitHub Privilege Separation

Suggested roles:

```text
Org Owner
→ very small set

Repository Admin
→ limited engineering leads

Maintainer / Write
→ normal engineering permissions

Read
→ reviewers / auditors where appropriate
```

Do not make every developer Organization Owner.

Production deployment permission is separate from code-write permission.

---

# 657. Protected Main Branch

Production source branch must use rulesets/branch protection.

Require:

- pull request;
- successful CI;
- required reviews;
- no unresolved review conversations;
- restricted force-push;
- restricted branch deletion;
- signed commits where operationally chosen;
- CODEOWNERS review for critical paths.

Critical paths may include:

```text
contracts/**
services/stockback/**
services/finalizer/**
packages/config/**
packages/contracts/**
infra/**
.github/workflows/**
```

---

# 658. CODEOWNERS / Sensitive Paths

At minimum, changes affecting:

- contracts;
- economic constants;
- production addresses;
- Stockback logic;
- deployment scripts;
- CI/CD workflows;
- wallet transaction builders;
- cloud/IaC;
- Safe/attestor configuration;

require review by an explicitly responsible security/protocol owner.

A frontend visual reviewer alone cannot approve protocol-sensitive code.

---

# 659. GitHub Actions Cloud Authentication — LOCKED DEFAULT

CI/CD should use:

```text
GitHub Actions
↓
OIDC identity
↓
short-lived cloud credential
```

Avoid:

```text
AWS_ACCESS_KEY_ID permanent secret
GCP service-account JSON key
Azure long-lived client secret
```

when the selected cloud supports OIDC/federated identity.

Trust policy must restrict:

- organization/repository identity;
- production environment;
- approved branch/tag/workflow;
- expected audience.

---

# 660. Protected Deployment Environments

Define at least:

```text
development
staging
production
```

Production environment should require:

- protected branch/tag;
- explicit reviewer approval;
- environment-specific credentials;
- deployment concurrency control;
- audit trail.

A pull-request job must not automatically acquire production deployment authority.

---

# 661. No Smart-Contract Production Key in CI

CI/CD must not hold:

- Governance Safe signer key;
- Treasury Safe signer key;
- Founder Profit Safe signer key;
- Guardian Safe signer key;
- human Deployer hardware-wallet seed.

Smart-contract mainnet deployment requires an explicit deployment ceremony.

CI may:

- compile;
- test;
- generate calldata;
- simulate;
- generate deployment artifacts;
- verify deterministic expectations.

---

# 662. Infrastructure as Code

Production infrastructure should be defined in version-controlled IaC where practical.

Recommended:

```text
OpenTofu / Terraform-class
```

IaC may manage:

- networks/firewalls;
- container services;
- databases;
- Redis;
- object storage;
- IAM/service accounts;
- monitoring resources;
- DNS records where safe;
- secrets references.

Do not embed secret values directly in IaC source.

---

# 663. Infrastructure Change Review

Infrastructure changes require:

```text
plan
↓
review
↓
approved apply
```

Production destructive changes must not occur from an unreviewed local command.

IaC state itself is sensitive infrastructure metadata and requires protected storage/access.

---

# 664. Domain Registrar Security

The production domain is a financial security surface.

Required:

- registrar account separated from ordinary personal browsing account;
- phishing-resistant MFA/hardware security keys where supported;
- strong unique recovery controls;
- domain/transfer lock;
- registry lock where available/appropriate;
- renewal auto-pay + independent expiry monitoring;
- restricted registrar administrators;
- recovery email/account protected separately.

A compromised social-media account must not be able to recover the registrar.

---

# 665. DNS Security

Production DNS requires:

- DNSSEC where supported;
- minimal DNS administrators;
- audit logging;
- change notifications;
- no stale verification records;
- no abandoned subdomain pointing to deprovisioned SaaS;
- explicit ownership of API/web/status domains.

Monitor for unauthorized:

```text
A / AAAA
CNAME
NS
MX
TXT
CAA
```

changes.

---

# 666. Domain Separation

Recommended conceptual domains:

```text
app.example
→ public app

api.example
→ API

ws.example
→ realtime

status.example
→ public status

internal.example / separate access hostname
→ operator console, if used
```

Exact names are branding/implementation decisions.

Do not expose internal management endpoints under guessable public routes without strong access control.

---

# 667. TLS Policy

Production:

- HTTPS only;
- HSTS after domain behavior is validated;
- secure cookies;
- modern TLS configuration;
- certificate renewal monitoring;
- no mixed content;
- no production HTTP fallback.

Private/admin surfaces also require TLS.

---

# 668. CDN / WAF

Use an edge/CDN/WAF layer capable of:

- TLS termination;
- DDoS mitigation;
- request filtering;
- rate limiting;
- bot/risk controls where appropriate;
- origin protection;
- caching public assets.

Do not rely on WAF as the sole API authentication mechanism.

---

# 669. Origin Protection

Backend origins should not be unnecessarily reachable around the CDN/load balancer.

Where feasible:

- network/firewall restrictions;
- authenticated origin requests;
- private networking;
- service-to-service identities.

Prevent direct bypass of rate limits/security headers through exposed origin IPs.

---

# 670. Cloud Account / Project Separation

At minimum logically separate:

```text
staging
production
```

Prefer separate cloud projects/accounts where practical.

Production IAM must not be inherited casually from developer sandbox permissions.

Staging compromise should not automatically expose production.

---

# 671. Production Human Access

Production human access uses:

- individual identities;
- phishing-resistant MFA;
- least privilege;
- no shared root/admin login;
- auditable access;
- time-bounded elevated access where supported.

Daily development credentials should not automatically have production-admin rights.

---

# 672. Break-Glass Cloud Access

If cloud platform requires a break-glass/root account:

- hardware/security-key protected;
- no daily use;
- offline recovery;
- alerts on login/use;
- access documented internally.

Break-glass cloud account must not contain protocol multisig private keys.

---

# 673. Service Identities

Every service should use a distinct workload/service identity where practical:

```text
web
api
realtime
indexer
stockback-worker
attestor
finalizer
ops
monitoring
```

Do not use one omnipotent cloud service account for every process.

---

# 674. Database Access Security

PostgreSQL production rules:

- not publicly exposed unless unavoidable and protected;
- TLS;
- unique service credentials;
- least-privilege database roles;
- separate migration/admin role;
- read-only analytics role;
- audited manual admin access;
- automated backups/PITR as previously required.

Application service must not run as database superuser.

---

# 675. PostgreSQL Role Baseline

Conceptual:

```text
db_owner / migration
→ schema changes only

api_rw
→ required application reads/writes

indexer_rw
→ event/index writes

stockback_rw
→ TWAB/distribution tables

analytics_ro
→ read only

operator_ro
→ read only by default
```

Exact grants are `CHOOSE`.

Financial authority remains on-chain regardless of database permissions.

---

# 676. Redis Access Security

Redis must:

- require authenticated/private access;
- avoid public internet exposure;
- separate namespaces/environments;
- enforce TLS where available;
- treat cache as disposable;
- persist durable streams only according to chosen queue semantics.

No high-authority private key stored in Redis.

---

# 677. Object Storage Security

Object storage buckets should distinguish:

```text
public media
public Stockback distribution datasets
private internal artifacts
```

Do not make all buckets public.

Distribution datasets intended for public verification should be immutable/versioned where practical.

Uploads require:

- content-type validation;
- size limits;
- safe generated object names;
- malware/content checks where appropriate.

---

# 678. RPC Credential Security

RPC provider API keys:

- scoped per environment/service;
- server-side where possible;
- rotated;
- monitored;
- not embedded in public bundles if provider treats them as secrets.

If browser RPC key must be public, treat it as public and enforce provider-side domain/rate restrictions.

Never confuse RPC API key secrecy with blockchain transaction authorization.

---

# 679. Secrets Management

Use managed secret storage for:

- DB credentials;
- private API keys;
- webhook secrets;
- RPC credentials;
- session-signing secrets;
- non-exportable machine-signing references.

Do not use:

- committed `.env`;
- Slack messages;
- shared docs;
- source-code constants;
- Docker image layers.

---

# 680. Secret Rotation

Every production secret category needs:

- owner;
- creation date;
- rotation method;
- emergency revoke procedure;
- dependency mapping.

Rotation should be testable without redeploying the entire protocol.

---

# 681. Observability Access

Monitoring dashboards can expose sensitive operational data.

Protect:

- logs;
- traces;
- error reports;
- DB query details;
- wallet/account identifiers.

Do not include:

- private keys;
- seed phrases;
- auth tokens;
- full sensitive request bodies;
- SIWE cookies;
- KMS secret material.

---

# 682. Production Access Matrix — REQUIRED ARTIFACT

Before mainnet, engineering must deliver a table:

```text
SYSTEM
ROLE
READ
WRITE
DEPLOY
ADMIN
SECRET ACCESS
APPROVER
```

covering at least:

- GitHub;
- DNS/registrar;
- CDN/WAF;
- cloud;
- frontend hosting;
- backend;
- PostgreSQL;
- Redis;
- object storage;
- RPC provider;
- monitoring;
- KMS/HSM;
- Safe accounts;
- CI/CD.

Unknown/shared access is a release blocker.

---

# 683. Exact Smart-Contract Role Matrix — P0

A final ABI-level permission matrix must be generated from implemented contracts.

Conceptual baseline:

| Component | Permission | Authorized Role |
|---|---|---|
| LaunchToken | post-genesis mint | Nobody |
| LaunchToken | blacklist/tax admin | Nobody |
| XStockRegistry | add asset | Governance |
| XStockRegistry | disable for new launches | Governance |
| LaunchMarket | withdraw curve collateral | Nobody |
| LaunchMarket | manual graduation | Nobody |
| FeeVault | creator claim | Entitled creator |
| FeeVault | platform distribution | Treasury-recipient logic |
| HolderRewardVault | claim | Proven beneficiary |
| HolderRewardVault | commitment activation | Valid quorum / protocol verifier |
| HolderRewardVault | emergency claim pause | Guardian if implemented |
| GraduationRouter | arbitrary principal withdrawal | Nobody |
| LP lock | principal withdrawal | Nobody |
| Stockback attestor config | change set | Governance |
| Platform fee recipient | change | Governance / timelock |

Exact function names come from final ABI.

---

# 684. Role Matrix Rule

For every privileged function, document:

```text
contract
function selector
role
why power exists
can move funds?
can change economics?
timelock?
pause-only?
revocable?
event emitted?
test proving boundary
```

Any privileged function missing from the matrix is a P0 audit finding.

---

# 685. No Generic Arbitrary-Execution Admin

Avoid protocol contracts exposing:

```text
execute(address target, bytes calldata data)
```

to Governance/Guardian unless absolutely required and explicitly reviewed.

Generic execution creates hidden powers that invalidate the role matrix.

---

# 686. Operator Console — V1

Create a separate internal operator surface:

```text
apps/ops
```

or equivalent logically separated application.

Purpose:

> operational visibility and safe proposal preparation — not a secret super-admin website.

---

# 687. Operator Console Access

Recommended:

```text
identity-aware access proxy / SSO
+
hardware-key MFA
+
explicit operator allowlist
```

Do not authenticate operator console solely with a reusable static password.

Production operator console should not be indexed publicly.

---

# 688. Operator Console Default Mode

Default:

```text
READ ONLY
```

The console may display:

- contract addresses;
- lifecycle health;
- RPC status;
- indexer lag;
- xStock health;
- HyperSwap dependency health;
- Treasury balances;
- platform fee accrual;
- Safe proposals;
- Ops HYPE;
- attestor quorum;
- Stockback finalization status;
- alerts.

---

# 689. Operator Console High-Risk Actions

For Governance/Treasury actions, console should prefer:

```text
prepare / decode transaction
↓
create Safe proposal
↓
human Safe signing
```

Not:

```text
operator web session
↓
directly execute Treasury transfer
```

The operator console must not store multisig owner private keys.

---

# 690. Operator Console Allowed Operational Actions

Potential low-risk actions:

- trigger safe indexer backfill;
- retry non-financial job;
- request health recomputation;
- submit already-quorum-signed commitment through Ops Relayer;
- generate Safe proposal;
- rotate non-sensitive cache;
- inspect deployment manifest.

Each action requires authorization and audit log.

---

# 691. Operator Console Forbidden Actions

Console itself must not unilaterally:

- mint TOKEN;
- move Treasury;
- unlock LP;
- seize curve collateral;
- rewrite creator;
- generate fake Stockback entitlement;
- replace attestor quorum;
- change platform fee recipient;
- change DNS;
- expose private keys.

---

# 692. Operator Audit Log

Record:

```text
operator identity
timestamp
action
environment
target
parameters/hash
result
related tx/job/proposal ID
```

Audit logs must not contain secrets.

---

# 693. Infrastructure Status Dashboard

Internal dashboard should show:

```text
WEB
API
REALTIME
INDEXER
POSTGRES
REDIS
OBJECT STORAGE
RPC
HYPERSWAP
XSTOCK HEALTH
STOCKBACK FINALIZER
ATTESTOR QUORUM
OPS WALLET GAS
SAFE PROPOSALS
```

Use explicit:

```text
HEALTHY
DEGRADED
STALE
FAILED
BLOCKED
```

---

# 694. Frontend Transaction Integrity — P0

The user-visible transaction review must correspond to the actual calldata that will be submitted.

Hard invariant:

```text
UI REVIEW
=
CANONICAL TRANSACTION INTENT
=
SDK BUILDER
=
ENCODED CALLDATA
```

No independent duplicated fee/amount logic in UI.

---

# 695. Canonical TransactionIntent Model

Create a shared typed object in a package such as:

```text
packages/tx-intent
```

Conceptual:

```text
TransactionIntent
{
  intentVersion
  chainId
  account
  intentType
  target
  market
  token
  quoteAsset
  spender
  inputAmount
  minOutput
  deadline
  feeBreakdown
  lifecycleState
  quoteBlock
}
```

Exact schema may differ.

The UI review should be derived from this object.

---

# 696. Transaction Builder Ownership

Canonical transaction encoding belongs in:

```text
packages/sdk
or
packages/tx-intent
```

Not duplicated separately in:

- trade button;
- mobile sheet;
- creator page;
- bot example.

Every client uses the same validated builder semantics.

---

# 697. Pre-Sign Calldata Verification

Immediately before wallet request:

1. verify active account;
2. verify chain;
3. verify canonical contract target;
4. verify spender;
5. verify asset addresses;
6. verify encoded amounts;
7. verify deadline;
8. verify lifecycle state/freshness;
9. decode generated calldata back into expected intent where practical;
10. require re-review if material values changed.

Fail closed on mismatch.

---

# 698. No Hidden Transaction Mutation

After user presses:

```text
Confirm Buy
```

application may refresh state only according to documented rules.

It must not silently change:

- target;
- asset;
- input amount;
- minimum output;
- spender;
- fee model;
- route;
- chain.

A material change requires another review.

---

# 699. Frontend Contract Address Integrity

Production addresses come from:

```text
signed/reviewed deployment manifest
+
versioned config package
```

No API response may silently replace:

- Factory;
- FeeVault;
- HolderRewardVault;
- market registry;
- Treasury;
- HyperSwap integration addresses;

with arbitrary runtime values without validation.

---

# 700. Config Artifact Integrity

Production config should have:

```text
environment
chainId
deployment version
contract addresses
source/verification reference
generated timestamp
content hash
```

Frontend/backend/indexer consume the same release config.

A mismatched config version should produce a visible deployment/health failure.

---

# 701. Frontend Supply-Chain Security

Required:

- committed lockfile;
- reproducible/frozen dependency install in CI;
- dependency review;
- vulnerability scanning;
- automated update PRs rather than surprise upgrades;
- package integrity verification;
- no arbitrary install scripts where avoidable;
- audit major dependency changes;
- minimal dependencies in transaction-critical paths.

---

# 702. Dependency Pinning Policy

Production builds use exact lockfile resolution.

Do not run:

```text
npm install latest
```

during production deployment.

Major framework/wallet/web3/chart updates require:

- compatibility testing;
- regression testing;
- transaction-signing test;
- performance test where relevant.

---

# 703. Software Bill of Materials

Generate an SBOM or equivalent dependency inventory for production releases.

Acceptable formats/classes:

```text
CycloneDX
SPDX
```

Store with release artifacts.

This improves:

- vulnerability response;
- dependency ownership;
- incident triage.

---

# 704. Dependency Security Automation

Use:

```text
Dependabot / Renovate-class update automation
+
dependency vulnerability scanning
+
OpenSSF Scorecard-class repository checks where useful
```

Automated alerts do not auto-merge risky production dependency upgrades.

---

# 705. Third-Party Browser Scripts

Minimize third-party JavaScript on financial pages.

Every third-party script can become transaction-surface supply-chain risk.

Prefer:

- self-hosted assets;
- server-side analytics where practical;
- no arbitrary marketing tag manager on trading critical path;
- explicit allowlist.

---

# 706. Content Security Policy

Production should deploy a restrictive CSP compatible with required app behavior.

Goals:

- restrict script origins;
- restrict frame embedding;
- restrict connect origins;
- reduce XSS impact;
- control worker/object/media origins.

Avoid broad:

```text
script-src *
```

or unnecessary `unsafe-eval`.

Exact CSP must be tested with wallet connectors and required WebSocket/RPC endpoints.

---

# 707. Other Browser Security Headers

Evaluate/use:

- HSTS;
- `frame-ancestors`;
- `X-Content-Type-Options`;
- Referrer-Policy;
- Permissions-Policy;
- cross-origin isolation headers where required by chosen features.

Headers must not break wallet/mobile functionality.

---

# 708. Clickjacking Protection

Trading/launch/claim surfaces must not be embedded invisibly in hostile sites.

Use CSP `frame-ancestors` or equivalent.

Any intentional embedding requires separate security review.

---

# 709. Metadata Sanitization

Creator-provided:

- token name;
- ticker;
- description;
- website;
- social links;
- image;

are untrusted.

Requirements:

- HTML escaping;
- URL scheme allowlist;
- image validation;
- no scriptable SVG execution unless sanitized/converted safely;
- link safety;
- no metadata-generated raw HTML.

---

# 710. Frontend Secrets Rule

Assume any value shipped to browser is public.

Never embed:

- database credentials;
- private RPC secret intended to be confidential;
- SIWE server secret;
- cloud credentials;
- KMS credentials;
- attestor keys;
- relayer key.

Only explicitly public environment variables go into client build.

---

# 711. Build Artifact Provenance

Each production web/backend build should be traceable to:

```text
git commit
release tag/version
CI workflow run
dependency lockfile
deployment environment
config version
artifact/container digest
```

This allows operators to prove what code is live.

---

# 712. Production Image Policy

Backend/indexer containers:

- build in CI;
- immutable image digest;
- vulnerability scan;
- no mutable `latest` deployment reference for production;
- minimal base image;
- no source secrets baked in.

Deploy by digest where platform supports it.

---

# 713. Release Signing / Attestation

Where tooling supports it, sign/attest release artifacts or container provenance.

This is a recommended security enhancement, not a reason to block V1 if chosen infrastructure lacks a mature mechanism.

The critical requirement is reproducible traceability.

---

# 714. Production Deployment Ceremony — Smart Contracts

Mainnet contract deployment is a controlled ceremony.

Phase 1 — Freeze:

```text
code freeze
audit commit identified
dependency lock
compiler version locked
deployment config frozen
external addresses reverified
```

---

# 715. Deployment Ceremony — Preflight

Verify:

- chain ID;
- RPC;
- Deployer address;
- Deployer HYPE;
- Governance Safe;
- Treasury Safe;
- Guardian Safe;
- Safe owner sets/thresholds;
- attestor addresses;
- xStock canonical addresses;
- HyperSwap addresses;
- reference feed;
- CREATE2 expectations;
- source hashes;
- no mock/test addresses.

Two-person review required for production manifest.

---

# 716. Deployment Ceremony — Simulation

Before broadcast:

```text
fork / production-equivalent simulation
↓
deployment
↓
configuration
↓
role handoff
↓
critical E2E
```

Expected addresses and role state recorded.

Material difference blocks broadcast.

---

# 717. Deployment Ceremony — Broadcast

Protocol Deployer:

1. confirms hardware wallet address;
2. verifies chain on device/tooling;
3. broadcasts deterministic deployment transactions;
4. records tx hashes;
5. waits required confirmations;
6. verifies deployed bytecode/state.

No simultaneous unrelated transactions from Deployer.

---

# 718. Deployment Ceremony — Source Verification

For each core contract:

- verify source/bytecode on supported explorer;
- verify compiler version;
- verify constructor args;
- verify implementation vs proxy assumptions;
- verify code hash where tooling allows.

A contract that cannot be reconciled with audited source is NO-GO.

---

# 719. Deployment Ceremony — Role Wiring

After deployment:

```text
Factory governance → Governance Safe
Registry governance → Governance Safe
platform fee recipient → Treasury Safe
Stockback attestors → exact approved 5
threshold → 3
Guardian role → Guardian Safe where implemented
Ops role → only narrow role if required
```

Then verify role state on-chain.

---

# 720. Deployment Ceremony — Deployer Revocation

Explicitly test that Deployer does **not** retain unintended:

- ownership;
- admin;
- minter;
- vault withdrawal;
- registry authority;
- pause authority;
- upgrade authority.

If a permanent Deployer capability is intentionally required, it must be documented and audited.

Default expectation: none.

---

# 721. Deployment Ceremony — Production Config Release

Generate canonical release manifest.

Frontend, backend, indexer, SDK use exactly the approved addresses.

Manifest is reviewed before public app deployment.

Do not type production contract addresses manually into multiple repositories.

---

# 722. Deployment Ceremony — Smoke / E2E

Before broad announcement:

- read contracts;
- quote;
- test controlled launch path where appropriate;
- test buy/sell on approved production validation market if product policy permits;
- verify fees;
- verify Treasury routing;
- verify Stockback funding;
- verify realtime indexing;
- verify UI contract addresses;
- verify creator attribution;
- verify explorer links;
- verify monitoring.

No test should endanger real user funds.

---

# 723. Deployment Ceremony — Launch Gate

Mainnet public launch requires explicit sign-off for:

```text
SMART CONTRACT
SECURITY
ECONOMICS
FRONTEND
BACKEND
INDEXER
WALLET
INFRASTRUCTURE
MONITORING
LEGAL/COMPLIANCE
```

A green frontend alone cannot launch.

---

# 724. Web / Backend Deployment Model

Application deployments are independent from smart-contract deployment.

Frontend/backend may be rolled back to a known-good artifact.

Contracts follow their immutable/approved governance model.

Never couple:

```text
merge frontend PR
→ automatically deploy protocol contracts
```

---

# 725. Frontend Emergency Rollback

Maintain ability to quickly restore a previously verified frontend artifact.

Rollback does not change:

- on-chain balances;
- contracts;
- creator rights;
- Stockback entitlement.

After rollback, verify config compatibility with live contracts.

---

# 726. Internal Operator Console — Technical Stack

Recommended:

```text
Next.js / React
shared TypeScript packages
read APIs
Safe proposal integration
identity-aware proxy / SSO
```

Use same design-system foundations where useful, but internal UI prioritizes clarity over cinematic presentation.

Deploy separately from public app if it improves isolation.

---

# 727. Operator Console Network Isolation

Where practical:

- identity-aware proxy;
- VPN/private access;
- IP restrictions as defense-in-depth;
- no public search indexing;
- separate production hostname.

Do not assume obscurity equals access control.

---

# 728. Operator Console Transaction Policy

Operator console may build/preview governance transactions.

It must display:

```text
Safe
chain
target
function
decoded parameters
value
expected state change
risk classification
```

High-impact action ends in:

```text
Create Safe Proposal
```

not unilateral execution.

---

# 729. Internal Treasury / Founder Accounting Model

Create derived accounting domains:

```text
GROSS PLATFORM REVENUE
↓
less protocol/user liabilities that never belonged to platform
↓
REALIZED PLATFORM ENTITLEMENT
↓
TREASURY ASSETS
↓
operating spend / reserve allocation
↓
FOUNDER DISTRIBUTION
```

Never calculate founder profit from raw contract balances.

---

# 730. Revenue Recognition Categories

Internal reporting should distinguish:

```text
PRE_GRAD_PLATFORM_CORE_FEES
POST_GRAD_PAIRED_XSTOCK_PLATFORM_SHARE
POST_GRAD_TOKEN_PLATFORM_SHARE
LAUNCH_FEES
OTHER_APPROVED_PLATFORM_REVENUE
```

Keep Stockback and creator revenue separate.

---

# 731. Liability Categories

Explicitly track:

```text
CREATOR_FEES_PAYABLE
STOCKBACK_OPEN
STOCKBACK_FINALIZED_UNCLAIMED
CURVE_COLLATERAL
MIGRATION_ESCROW
OTHER USER/PROTOCOL LIABILITIES
```

These are not founder profit.

---

# 732. Treasury Asset Categories

Treasury reporting:

```text
HYPE
xStocks by asset
TOKEN fee assets by token
stable assets if any
other approved assets
```

Show:

- native quantity;
- valuation source;
- valuation timestamp;
- total estimated USD value.

Valuation is informational; chain balances remain canonical.

---

# 733. Founder Profit Metrics

Internal dashboard should expose:

```text
Lifetime Platform Revenue
Realized Treasury Inflow
Operating Spend
Current Treasury NAV
Founder Distributions
Lifetime Founder Distributed Profit
Founder Profit Safe Balance
```

Do not label unrealized or user-liability funds as founder earnings.

---

# 734. Distributable Profit — V1

V1 does not hardcode an automatic percentage.

Conceptual:

```text
Treasury free assets
-
known operational reserve
-
approved obligations
-
business/accounting reserves
=
potentially distributable amount
```

Founder distribution remains deliberate multisig action.

---

# 735. Treasury Reconciliation

At defined intervals:

```text
FeeVault platform entitlement
+ Treasury inflows
- Treasury outflows
= reconciled Treasury movement
```

Investigate mismatches.

Database-derived reporting must reconcile to chain balances/transactions.

---

# 736. Founder Distribution Reconciliation

Every founder distribution:

```text
Treasury outflow
=
Founder Profit Safe inflow
```

subject only to normal gas mechanics where native assets are involved.

Record tx hash and accounting classification.

---

# 737. Revenue Dashboard Freshness

Every internal financial metric shows:

```text
source
last indexed block
last updated timestamp
valuation timestamp where applicable
```

Never present stale Treasury NAV as realtime without disclosure.

---

# 738. Security Events / Alert Severity

Suggested operational levels:

```text
SEV-0
credible fund-loss / malicious governance / private-key compromise

SEV-1
critical protocol/deployment/security degradation

SEV-2
major trading/indexing/claim degradation

SEV-3
non-critical service degradation
```

Exact incident process is operational `CHOOSE`.

This is not a separate business-continuity program; it is release/production security operations.

---

# 739. SEV-0 Examples

Examples:

- Treasury Safe unexpected transaction;
- Governance Safe unexpected owner/module change;
- suspected multisig quorum compromise;
- malicious frontend transaction target;
- DNS hijack;
- production deployer compromise while still privileged;
- attestor quorum signing conflicting malicious root;
- confirmed fund-loss vulnerability.

Immediate security escalation required.

---

# 740. Frontend Integrity Monitoring

Monitor production app for unexpected changes in:

- JS bundle hashes/artifact version;
- deployment commit;
- production config;
- contract address manifest;
- CSP;
- DNS;
- CDN origin.

Deployment system should know which release is currently live.

---

# 741. Synthetic Transaction Safety Checks

Run automated read-only/simulation checks against production:

- Factory address;
- Registry;
- FeeVault;
- HolderRewardVault;
- Treasury recipient;
- supported xStock list;
- expected chain;
- API/indexer agreement;
- quote path simulation where safe.

Alert on config divergence.

---

# 742. Production Configuration Drift

Infrastructure/config drift should be detected.

Examples:

- DNS changed outside IaC/review;
- cloud IAM role expanded;
- database made public;
- Safe threshold changed;
- attestor set changed;
- frontend contract manifest changed.

Known emergency changes must be reconciled back into canonical config afterward.

---

# 743. Release Artifact Checklist

Each release stores:

```text
version
git commit
build artifact/container digest
SBOM
dependency lock hash
production config hash
deployment timestamp
CI run
approver
```

Smart-contract releases additionally store:

```text
compiler
bytecode hash
deployment tx hashes
verified source links
role-state snapshot
```

---

# 744. Security / Operations Release Gates — P0

NO-GO if:

- production domain lacks secure administrative controls;
- unknown person/account has production admin access;
- CI uses unrestricted long-lived cloud credentials without justification;
- production DB is exposed with weak access;
- high-authority key exists in source/CI;
- main branch can deploy to production without required controls;
- contract role matrix is incomplete;
- Deployer retains undocumented power;
- public frontend can receive arbitrary contract target from untrusted backend;
- transaction review and calldata can diverge;
- dependency lock is not deterministic;
- operator console can directly bypass multisig;
- Treasury/creator/Stockback liabilities are mixed in reporting;
- monitoring cannot detect Governance/Treasury changes.

---

# 745. Infrastructure Compromise Acceptance Tests

Tabletop/technical rehearsal:

```text
GitHub developer account compromised
CI workflow PR compromised
frontend hosting token compromised
DNS admin compromised
DB credential compromised
Redis credential compromised
RPC API key leaked
operator-console account compromised
Ops Relayer compromised
```

For each:

- identify maximum blast radius;
- revoke access;
- rotate credential;
- prove no multisig/private-key cascade;
- verify user-fund authority remains bounded.

---

# 746. Production Access Offboarding

When a contributor/operator leaves:

- revoke GitHub access;
- revoke cloud IAM;
- revoke operator console;
- rotate shared credentials if any existed;
- rotate workload credentials where needed;
- replace Safe owner if applicable;
- replace attestor if applicable;
- review recent activity.

Do not rely on “they promised not to use it”.

---

# 747. Vendor Account Ownership

Critical SaaS/vendor accounts must be owned by platform-controlled organizational identities, not a contractor's personal email.

Examples:

- domain registrar;
- DNS/CDN;
- GitHub org;
- frontend hosting;
- cloud provider;
- database provider;
- Redis provider;
- RPC provider;
- monitoring;
- WalletConnect project/dashboard;
- object storage.

Recovery channels must remain under platform control.

---

# 748. Billing Continuity for Critical Infrastructure

Critical vendor subscriptions require:

- valid billing method;
- billing alert;
- renewal/expiry monitoring;
- secondary administrator where appropriate.

Do not allow production to fail because a contractor's card expired.

---

# 749. No Single SaaS Admin as Protocol Root

Even if one person controls:

```text
GitHub
Cloud
DNS
```

they still must not be able to:

- sign Treasury transaction;
- sign Governance quorum alone;
- withdraw curve collateral;
- mint launch tokens;
- unlock LP;
- forge Stockback quorum alone.

On-chain capability minimization remains final defense.

---

# 750. Updated Repository Layout — Operations

Expanded logical structure:

```text
/
├── apps/
│   ├── web/
│   └── ops/
│
├── contracts/
├── services/
├── packages/
│   ├── sdk/
│   ├── tx-intent/
│   ├── config/
│   ├── database/
│   ├── realtime/
│   └── ui/
│
├── infra/
│   ├── opentofu-or-terraform/
│   ├── docker/
│   ├── monitoring/
│   ├── policies/
│   └── deployment/
│
├── .github/
│   ├── workflows/
│   └── CODEOWNERS
│
├── tests/
└── docs/
    ├── runbooks/
    ├── deployments/
    ├── access-matrix/
    └── security/
```

---

# 751. Updated Build-Team Deliverables

In addition to prior deliverables, require:

27. **Production access matrix**
28. **Contract role/permission matrix**
29. **Infrastructure-as-code repository/config**
30. **Production deployment ceremony/runbook**
31. **Operator console**
32. **TransactionIntent / calldata-integrity specification**
33. **Frontend dependency/SBOM report**
34. **DNS/domain security checklist**
35. **Treasury reconciliation/reporting specification**
36. **Founder-profit distribution/reporting specification**
37. **Production artifact/config manifest**
38. **Infrastructure compromise rehearsal report**

---

# 752. Exact Role / Infrastructure Handoff Rule

Coding agents may choose equivalent vendors/tools.

They may not remove:

- production identity separation;
- least privilege;
- protected deployments;
- OIDC/short-lived credential principle where supported;
- domain hardening;
- deterministic config;
- transaction-intent integrity;
- multisig separation;
- operator-console non-custodial behavior;
- Treasury/liability accounting separation;
- production deployment ceremony.

Any weaker replacement requires security review.

---

# 753. Current External Verification Notes

At the time of this masterplan update:

- GitHub documents OIDC for Actions as a mechanism for obtaining short-lived cloud credentials rather than storing long-lived provider credentials;
- GitHub environments support deployment protection rules / reviewer gates / branch restrictions;
- modern managed DNS providers support DNSSEC, but exact registrar/DNS security features vary;
- exact account/vendor implementation must be reverified at production freeze.

These facts are implementation references, not permission to hardcode provider-specific assumptions.

---

# 754. Final Infrastructure Principle

> **Smart-contract security protects the protocol only if the website, deployment pipeline, keys, domain, and operator tooling cannot trick users into interacting with something else.**

Therefore V1 requires both:

```text
ON-CHAIN CORRECTNESS
+
OFF-CHAIN DELIVERY INTEGRITY
```

Neither is optional.

---

# 755. Final Operational Architecture Summary

```text
PUBLIC USERS
↓
DNS / CDN / WAF
↓
NEXT.JS WEB
↓
API / REALTIME
↓
INDEXER / POSTGRES / REDIS

SOURCE
GitHub Org
↓
protected PR
↓
CI
↓
OIDC short-lived deployment credentials
↓
staging / production

HIGH-AUTHORITY MONEY / CONTROL
never in CI
↓
Safe + hardware signers

AUTOMATION
KMS/HSM
↓
narrow Ops / Attestor roles

INTERNAL OPERATIONS
apps/ops
↓
SSO / identity-aware access
↓
read-first
↓
Safe proposal preparation

TRANSACTION SAFETY
UI Review
↓
TransactionIntent
↓
SDK builder
↓
validated calldata
↓
user wallet

PLATFORM MONEY
FeeVault
↓
Treasury
↓
operating spend / reserve
↓
explicit Founder Profit distribution
```

---

# 756. Final New-Subsystem Acceptance

The following areas are now explicit P0 architecture rather than implementation guesses:

```text
Production access security
Domain / DNS security
Source-control security
CI/CD credential security
Infrastructure-as-code
Database/cache/storage access
Operator console
Exact contract permission mapping
Transaction review ↔ calldata integrity
Frontend dependency supply chain
Deployment ceremony
Treasury reporting
Founder-profit reporting
Production artifact provenance
Security monitoring / compromise rehearsal
```

---

---

# 757. SENT Brand Identity System — V1 LOCKED

The launchpad product brand is:

```text
SENT
```

SENT is the canonical product-facing brand name for V1.

The brand must feel:

> **premium, luxurious, precise, interactive, alive, expensive, contemporary, and enjoyable to use — without becoming loud, gaudy, casino-like, or visually exhausting.**

Brand quality is a P0 product requirement, not post-launch decoration.

---

# 758. SENT Brand Core

SENT represents a permissionless market being created when:

```text
TOKEN
+
canonical xStock
↓
pair / convergence
↓
price discovery
↓
market
```

Brand personality:

```text
Precise
Confident
Fast
Cultured
Modern
Market-native
Slightly irreverent
Restrained
Premium
Alive
```

SENT must not sound or look like:

- a generic AI startup;
- generic enterprise SaaS;
- a crypto casino;
- a meme-only product;
- a cheap neon trading dashboard;
- a gold-on-black "luxury" cliché.

---

# 759. SENT Signature Color — LOCKED

Canonical SENT signature color:

```text
SENT Volt Lime
HEX: #C6F600
RGB: 198, 246, 0
```

This is the primary recognizable brand accent.

It is NOT the default background color.

It is NOT the default body-text color.

It is NOT intended to cover large portions of the trading UI.

Core rule:

> **Volt Lime identifies SENT through precision and repetition, not through visual saturation.**

---

# 760. Volt Lime Usage Philosophy

Volt Lime is intentionally bright.

Therefore the design must use it as a controlled high-value signal.

Correct:

```text
dark neutral surface
+
small precise Volt Lime accent
=
recognizable SENT identity
```

Incorrect:

```text
Volt Lime background everywhere
+
Volt Lime glowing cards
+
Volt Lime charts
+
Volt Lime buttons everywhere
=
visual fatigue / cheap crypto aesthetic
```

The color must feel rare enough that every appearance matters.

---

# 761. Brand Color Ratio — LOCKED PRINCIPLE

Normal product surfaces should target approximately:

```text
80–90% dark / neutral foundation
8–15% text / structural contrast
2–5% SENT Volt Lime accent
```

This is a composition guideline, not a literal pixel-count requirement.

Experience Mode may temporarily use slightly more accent in a cinematic focal moment.

Trading Mode should generally use less.

---

# 762. Volt Lime Maximum-Intensity Rule

Full-strength:

```text
#C6F600
```

is reserved for:

- brand symbol;
- selected/high-value CTA emphasis;
- active brand state;
- signature motion trace;
- small current-state indicators;
- carefully chosen highlight moments;
- branded focus moments.

Large surfaces should use:

- darker derived lime;
- reduced opacity;
- neutral surface;
- tinted glow only when spatially justified.

Do not render long body copy in full-strength Volt Lime.

---

# 763. SENT Lime Scale

Canonical base:

```text
500 = #C6F600
```

Implementation must derive a controlled tonal scale around it.

Recommended semantic structure:

```text
50   near-white lime tint
100  very pale lime
200  pale lime
300  soft bright lime
400  bright lime
500  #C6F600 canonical SENT
600  deeper active lime
700  dark olive-lime
800  very dark lime
900  near-black lime tint
```

Exact derivative hex values are `TUNE` during visual QA.

The 500 anchor may not change without explicit product approval.

---

# 764. Dark Neutral Foundation

SENT is primarily dark.

Recommended starting tokens:

```text
SENT Night
#0D0F10

SENT Obsidian
#090A09

SENT Surface 1
#121416

SENT Surface 2
#171A1C

SENT Border
low-opacity neutral white

SENT Primary Text
near-white

SENT Secondary Text
cool/warm neutral gray
```

Exact neutral values may be optically tuned.

The foundation must remain:

```text
dark
refined
low-glare
high-legibility
not crushed-black everywhere
```

---

# 765. No Pure-Black Monotony

Do not make every layer:

```text
#000000
```

Depth should come from subtle neutral differences.

Example:

```text
page
→ Night

panel
→ Surface 1

elevated control
→ Surface 2

popover
→ slightly elevated neutral
```

This creates expensive-feeling layering without heavy shadows.

---

# 766. Semantic Colors Are Separate From Brand Color

Volt Lime is a brand color.

It must NOT automatically mean:

```text
BUY
profit
success
up
healthy
```

Financial semantics require separate tokens.

Conceptual:

```text
positive
→ muted emerald

negative
→ muted red/coral

warning
→ restrained amber

info
→ controlled cool blue

stale/degraded
→ neutral/amber system
```

This prevents brand identity from corrupting financial meaning.

---

# 767. Buy / Sell Color Rule

Do not force:

```text
BUY = SENT Volt Lime
```

simply because Volt Lime resembles green.

Buy/sell states must remain distinguishable according to the canonical semantic trading palette.

Volt Lime may appear in surrounding brand details, never in a way that creates ambiguity between:

```text
brand
vs
profit/loss
vs
transaction action
```

---

# 768. Accessibility / Glare Rule

Volt Lime must pass usability review on each surface.

Because the color is high-luminance:

- avoid large pure-lime text blocks;
- avoid prolonged full-screen lime exposure;
- avoid high-intensity bloom around small text;
- avoid neon glow behind financial data;
- test dark-mode eye comfort;
- test OLED display behavior;
- test low-brightness and high-brightness environments;
- test common color-vision conditions for semantic distinctions.

Brand recognition must never depend solely on color.

---

# 769. Brand Symbol Direction — LOCKED

SENT uses a **symbol-first abstract identity**.

The primary logo is NOT a text wordmark.

The symbol must:

- be abstract;
- remain meaningful;
- remain simple;
- be recognizable at favicon/PFP size;
- avoid realistic 3D dependence;
- work flat in one color;
- work monochrome;
- work reversed;
- work embossed/etched;
- work as a motion primitive.

The approved visual direction is:

> **two distinct geometric forms representing TOKEN and xStock moving into a paired market relationship, with directional tension / convergence and a subtle incidental S-like flow — without being a literal letter S.**

---

# 770. Logo Must Not Copy Hyperliquid

Hyperliquid may be used only as a reference for the qualities:

```text
simple
abstract
flat
recognizable
meaningful
protocol-grade
```

SENT must not reproduce:

- Hyperliquid silhouette;
- its two-lobe geometry;
- its proportions;
- its negative-space structure;
- its exact color identity.

SENT must remain independently recognizable.

---

# 771. Logo Meaning

Canonical conceptual interpretation:

```text
upper / first form
→ canonical xStock / reference market

lower / second form
→ launched TOKEN

relationship / tension between forms
→ pairing + price discovery

combined movement
→ new canonical market

subtle overall directional rhythm
→ SENT / execution / movement
```

This meaning may inform storytelling.

The mark should still be beautiful without explanation.

---

# 772. Logo Geometry Status

The **logo direction is LOCKED**.

Exact production vector geometry remains `FINALIZE` through dedicated optical design refinement.

Refinement may adjust:

- angles;
- curvature;
- corner radius;
- thickness;
- negative-space gap;
- asymmetry;
- optical center;
- small-size compensation.

Refinement may NOT turn the symbol into:

- a literal lettermark;
- a realistic metallic emblem;
- a Hyperliquid clone;
- a generic lightning bolt;
- a generic chain/link;
- a rocket;
- a coin.

---

# 773. Logo Color

Default dark-surface brand mark:

```text
SENT Volt Lime
#C6F600
```

Required variants:

```text
Volt Lime on dark
Near-black on light
White monochrome on dark
Near-black monochrome on light
```

The symbol must remain legible without gradients/glow.

---

# 774. Logo Effects

Default logo rendering:

```text
flat
clean
sharp
```

Do not make the canonical logo dependent on:

- metallic texture;
- bevel;
- 3D extrusion;
- glossy orb;
- heavy glow;
- drop shadow.

Experience Mode may render artistic/spatial interpretations of the symbol.

Those are **brand expressions**, not replacement master logos.

---

# 775. Logo Clear Space

Production brand kit must define a clear-space unit derived from the mark geometry.

No:

- text;
- card edge;
- icon;
- ticker;
- photo;
- visual noise;

may invade the minimum clear space.

Exact unit is finalized with the production vector.

---

# 776. Logo Minimum Size

Production QA must prove recognition at:

```text
16px
24px
32px
48px
```

Especially:

- favicon;
- X profile/avatar crop;
- navigation;
- wallet/app icon;
- mobile UI.

If internal detail disappears at 16–24px, geometry must be simplified optically.

---

# 777. SENT Name Usage

Canonical brand:

```text
SENT
```

The symbol and product name are separate assets.

Correct:

```text
[symbol]

SENT
```

or:

```text
[symbol] SENT
```

when textual recognition is needed.

The brand must not require a wordmark permanently attached to the symbol.

---

# 778. Domain Status

A domain such as:

```text
sent.market
```

may be a strong brand-domain candidate.

Exact production domain remains subject to:

- ownership;
- conflict;
- trademark/legal review;
- operational control;
- final product approval.

Domain selection does not alter the canonical product name SENT.

---

# 779. Typography Philosophy — LOCKED

Typography is a primary luxury signal.

SENT uses three functional classes at most:

```text
DISPLAY
→ premium contemporary grotesk / editorial-grotesk character

UI
→ highly readable neutral grotesk

DATA
→ tabular-numeric / mono-capable financial typography
```

Avoid mixing many font families.

---

# 780. Font Selection Status

Exact licensed/open-source font family is `FINALIZE`.

Selection must satisfy:

- excellent rendering;
- strong lowercase and uppercase;
- high-quality numerals;
- tabular numerals for data;
- broad weight support;
- web performance;
- commercial licensing;
- accessibility.

The final choice must preserve the SENT visual character.

---

# 781. Type Hierarchy

Canonical conceptual scale:

```text
Display XL
→ hero / campaign only

Display L
→ narrative section

H1
→ page identity

H2
→ major section

H3
→ panel / feature group

Body L
→ editorial support

Body
→ standard reading

UI
→ controls/navigation

Label
→ metadata

Market Micro
→ dense terminal data
```

Exact responsive sizes are tokenized and QA-tuned.

---

# 782. Font Weight Discipline

SENT should not look heavy/bold everywhere.

Preferred:

```text
display
→ regular / medium

heading
→ medium

body
→ regular

UI emphasis
→ medium / semibold

market price
→ medium

micro labels
→ medium
```

Heavy bold weights are exceptional.

Restraint supports premium perception.

---

# 783. Letter Spacing

Use intentional tracking.

Typical direction:

```text
large display
→ slightly tight

body
→ natural

micro uppercase labels
→ wider tracking

brand name SENT
→ intentional spaced treatment where text is shown
```

Do not independently invent tracking per screen.

---

# 784. Financial Numerals

All rapidly updating financial figures must support:

```text
tabular numerals
lining numerals
stable width
```

Realtime updates must not cause horizontal visual jumping.

This applies to:

- prices;
- MC;
- volume;
- balances;
- percentages;
- Stockback;
- graduation metrics.

---

# 785. Layout Language — LOCKED

SENT has one design system with two expression modes.

### Experience Mode

```text
cinematic
spatial
interactive
high-motion
editorial
generous negative space
memorable
```

### Trading Mode

```text
precise
calm
dense
fast
stable
readable
low-distraction
```

The modes must visibly belong to the same brand.

---

# 786. SENT Experience Mode

Experience Mode may use:

- advanced spatial composition;
- interactive WebGL;
- procedural visual fields;
- subtle particle systems;
- data-reactive geometry;
- high-end scroll choreography;
- abstract transformations of the SENT symbol;
- Volt Lime trace accents;
- depth/parallax;
- cinematic typography.

But every effect must feel controlled and expensive.

---

# 787. Experience Mode Motion Rule

Highly animated does NOT mean constantly moving everything.

The premium model is:

```text
one strong focal movement
+
many quiet/supporting elements
```

Not:

```text
every card floats
every icon pulses
every word animates
every background glows
```

Visual hierarchy must remain obvious.

---

# 788. SENT Trading Mode

Trading Mode retains SENT identity through:

- typography;
- spacing;
- tiny Volt Lime cues;
- neutral surfaces;
- branded focus states;
- signature symbol;
- precise motion.

It must NOT carry over full cinematic effects into:

- Buy/Sell;
- transaction review;
- wallet signatures;
- slippage;
- claim;
- active chart interaction.

---

# 789. Money-Proximity Motion Law — LOCKED

Canonical rule:

> **The closer a user gets to moving money, the calmer the motion becomes.**

Conceptual:

```text
Homepage hero
→ highest expressive motion

Explore
→ moderate

Market discovery
→ moderate/subtle

Terminal
→ controlled

Trade panel
→ low

Transaction review
→ minimal

Wallet signing
→ near-static
```

This rule applies to users and creators.

---

# 790. Motion Quality

Motion must be:

```text
intentional
smooth
high frame rate
physically coherent
responsive
interruptible
accessible
```

Avoid:

- arbitrary bouncing;
- cheap spring overload;
- confetti;
- endless shimmer;
- glowing pulse spam;
- scroll hijacking;
- animations blocking input.

---

# 791. Signature Motion Primitive — The SENT Trace

SENT may use a recurring motion motif:

```text
origin
→ directional trace
→ alignment / pairing
→ settle
```

The Trace can appear in:

- launch progression;
- page transition;
- market creation;
- loading;
- graduation;
- branded ambient visuals.

Volt Lime should appear as a restrained directional signal.

---

# 792. SENT Logo Motion

Conceptual logo motion:

```text
two forms separated
↓
controlled approach
↓
alignment / tension
↓
canonical SENT symbol
```

Duration should be short enough to feel decisive.

Do not play a long logo animation before every route.

---

# 793. Surface System

Primary SENT materials:

```text
Night
Graphite
Obsidian
soft neutral elevation
```

Spatial marketing surfaces may incorporate:

```text
controlled glass
subtle refraction
faint atmospheric light
Volt Lime reflected accent
```

Trading surfaces should remain predominantly solid and stable.

---

# 794. No Glassmorphism Everywhere

Glass is an accent material.

Do not make:

- trade panel;
- every card;
- tables;
- chart controls;
- transaction review;

transparent just because the homepage uses depth effects.

Readability wins near financial actions.

---

# 795. Borders

Borders should be:

```text
thin
low-contrast
structural
```

Avoid bright outlines around every container.

Use:

- surface contrast;
- spacing;
- typography;

before adding borders.

---

# 796. Shadows / Glow

Default shadows:

```text
soft
low-opacity
functional
```

Volt Lime glow is special-purpose only.

Rules:

- never glow body text;
- never glow dense numerical tables;
- never put strong glow behind chart labels;
- never use glow to compensate for weak hierarchy.

---

# 797. Radius Language

SENT should not look like a generic bubble SaaS product.

Use restrained radii.

Conceptual:

```text
micro control
→ small

button/input
→ small-medium

card
→ medium

large spatial feature
→ medium-large only when justified
```

Pills are reserved for semantic chips/statuses, not every navigation element.

---

# 798. Spacing System

Use a consistent tokenized spacing rhythm.

Recommended foundation:

```text
4px micro grid
8px primary rhythm
```

Scale:

```text
4
8
12
16
24
32
48
64
96
128
```

Exact values may be extended through design tokens.

Experience Mode uses more negative space.

Trading Mode uses controlled density.

---

# 799. Grid System

Marketing/Experience surfaces:

```text
12-column editorial grid
wide responsive gutters
intentional asymmetry
```

Trading surfaces:

```text
functional responsive grid
chart-priority layout
stable trade-panel positioning
disciplined alignment
```

Do not center every element.

---

# 800. Component Consistency — P0

Canonical shared components must own SENT presentation for:

- Button;
- Input;
- Select;
- Tabs;
- Modal;
- Drawer;
- Tooltip;
- Toast;
- StatusBadge;
- MarketCard;
- ChartPanel;
- TradePanel;
- TransactionReview;
- Portfolio rows;
- Stockback panels;
- Creator controls.

Individual pages must not independently invent styling.

---

# 801. Design Token Namespace

Reference:

```text
--sent-color-volt
--sent-color-night
--sent-color-surface-1
--sent-color-surface-2
--sent-color-text-primary
--sent-color-text-secondary

--sent-semantic-positive
--sent-semantic-negative
--sent-semantic-warning
--sent-semantic-info

--sent-font-display
--sent-font-ui
--sent-font-data

--sent-space-*
--sent-radius-*
--sent-border-*
--sent-shadow-*
--sent-motion-*
--sent-ease-*
--sent-layout-*
--sent-chart-*
```

No arbitrary visual values in product-critical components unless documented.

---

# 802. Primary CTA Usage

Volt Lime primary CTA is allowed where a single dominant action needs strong brand emphasis.

Examples:

```text
Launch
Continue
Create Market
```

But if a surface contains many actions, only the primary one may use the strongest treatment.

A screen full of lime buttons is forbidden.

---

# 803. Trading CTA Exception

BUY/SELL may use semantic transaction colors rather than Volt Lime.

The brand remains visible through surrounding system.

Do not sacrifice trading comprehension for brand uniformity.

---

# 804. Focus / Selection States

Volt Lime is excellent for:

- keyboard focus ring;
- selected tab indicator;
- active navigation underline;
- current filter;
- branded cursor/trace moments.

Use thin/small treatment.

This creates recognition without visual glare.

---

# 805. Chart Brand Treatment

Charts remain financially semantic.

SENT identity comes from:

- Night background;
- refined grid;
- typography;
- crosshair;
- controls;
- selected states;
- annotations;
- graduation marker treatment.

Do not recolor all positive candles Volt Lime.

---

# 806. Chart Grid

Grid lines:

```text
very subtle
low-contrast
non-dominant
```

The chart data should dominate.

No glowing grid.

No cyberpunk matrix styling.

---

# 807. Realtime Data Motion

Realtime numerical changes may use:

```text
brief semantic change indication
+
smooth numeric stability
```

No prolonged flashing.

No whole-card green/red pulse.

No Volt Lime flash for normal positive price movements.

---

# 808. Homepage Brand Experience

The SENT homepage should immediately communicate:

```text
high-value
technically advanced
market-native
interactive
unusual
trustworthy enough to trade
```

It should not resemble:

- template landing page;
- generic Web3 landing page;
- meme casino;
- enterprise software homepage.

---

# 809. Homepage Volt Lime Usage

Recommended:

- hero symbol;
- one directional trace;
- current/interactive focal point;
- selected CTA;
- tiny label details.

Large background remains dark.

This creates:

```text
dark space
+
rare high-energy lime
=
SENT
```

---

# 810. Creator Experience Branding

Creators must receive the same premium quality as traders.

Creator surfaces include:

- launch builder;
- launch preview;
- creator dashboard;
- revenue analytics;
- fee claims;
- market lifecycle.

Do not downgrade creator tooling into generic admin forms.

---

# 811. Launch Builder Visual Hierarchy

Launch flow should feel deliberate:

```text
identity
↓
pair selection
↓
parameters
↓
preview
↓
transaction review
↓
launch
```

Use motion to guide progression.

As transaction signing approaches, motion reduces according to the money-proximity rule.

---

# 812. User / Trader Experience Branding

Trader surfaces prioritize:

- speed;
- clarity;
- chart;
- price;
- position/state;
- transaction safety.

Branding remains present but never obstructs data.

Premium trading UI means:

> **less unnecessary decoration, better hierarchy.**

---

# 813. Stockback Branding

Stockback belongs inside SENT visual language.

Do not create a separate neon sub-brand.

Reward accumulation may use:

- restrained Volt Lime trace;
- neutral quantitative UI;
- subtle accumulation motion.

No confetti.

No cashback-casino treatment.

---

# 814. Graduation Moment

Graduation can be a signature SENT moment.

Allowed:

- brief spatial transition;
- converging forms;
- SENT Trace completion;
- restrained Volt Lime focal motion.

Must still show:

- actual state;
- canonical venue;
- transaction/finalization status.

Animation may never obscure a failed/incomplete graduation.

---

# 815. Loading States

Loading animation should derive from SENT geometry/Trace where appropriate.

Avoid generic spinner dependency as the only brand loading treatment.

However:

- loading must remain lightweight;
- no unnecessary 3D blocking;
- skeletons remain appropriate for data surfaces.

---

# 816. Empty States

Empty states are:

```text
minimal
editorial
useful
```

No generic cartoon illustrations.

Use:

- precise text;
- subtle geometry;
- optional restrained SENT trace.

---

# 817. Error States

Error copy is calm and specific.

Avoid:

```text
Oops!
Something broke 😭
```

Prefer:

```text
Price context is stale.
Canonical on-chain market state is still available.
```

Brand luxury includes error quality.

---

# 818. Brand Voice — LOCKED

SENT writing is:

```text
short
confident
calm
market-native
precise
slightly playful when safe
```

Avoid:

- corporate filler;
- exaggerated hype;
- forced Web3 slang;
- excessive exclamation marks;
- emoji-heavy UI;
- constant "send it" jokes.

---

# 819. Brand Wordplay

`SENT` allows subtle language around:

```text
send
sent
execution
market creation
```

Use sparingly.

One good line is stronger than turning every CTA into a pun.

---

# 820. Capitalization

Canonical:

```text
SENT
```

for brand representation.

Normal interface labels:

```text
Explore
Launch
Portfolio
Stockback
```

Micro metadata may use uppercase with controlled tracking:

```text
MARKET CAP
VOLUME
PAIR
```

Do not uppercase every interface string.

---

# 821. Iconography

Use one canonical icon system.

Desired:

```text
geometric
clean
consistent stroke
minimal
technical
```

If using a library as a base, normalize:

- stroke width;
- corner behavior;
- sizes;
- optical alignment.

Do not mix random icon families.

---

# 822. Illustration / Imagery

Avoid:

- rockets;
- moons;
- bulls;
- coins flying;
- Wall Street stock photos;
- cyberpunk traders;
- generic blockchain cubes;
- AI-generated sci-fi filler.

Preferred:

- abstract market geometry;
- data-derived visuals;
- SENT symbol transformations;
- spatial fields;
- procedural forms;
- high-quality information visualization.

---

# 823. 3D Art Direction

3D should feel like:

```text
digital sculpture
market structure
instrument
precision object
```

Not:

```text
shiny crypto coin
game item
metal logo mockup everywhere
```

Use 3D primarily in Experience Mode.

---

# 824. Visual Density Rule

SENT must deliberately manage visual density.

```text
Marketing
→ spacious

Explore
→ moderate

Terminal
→ dense but disciplined

Transaction review
→ sparse and focused
```

Do not apply one density everywhere.

---

# 825. Premium Quality Through Restraint

"Premium" does NOT mean:

- more gradients;
- more glow;
- more blur;
- more animation;
- more borders;
- more 3D.

It means:

```text
better proportions
better timing
better typography
better spacing
better hierarchy
better materials
better responsiveness
better detail
```

This interpretation is LOCKED.

---

# 826. Cross-Surface Consistency

These must feel unmistakably part of SENT:

- homepage;
- Explore;
- search;
- launch flow;
- launch preview;
- token terminal;
- transaction review;
- wallet flow;
- portfolio;
- Stockback;
- creator dashboard;
- roadmap;
- status/dependency states;
- mobile;
- internal operator console where branding is appropriate;
- social assets.

No isolated screen may become its own design language.

---

# 827. Operator Console Visual Exception

Internal operator console does not require cinematic luxury.

It must still use:

- SENT typography;
- neutral palette;
- semantic tokens;
- component system;
- logo;

but prioritize:

```text
clarity
density
operations
safety
```

over marketing animation.

---

# 828. X / Social Profile Identity

SENT social avatar should use:

```text
abstract SENT symbol
+
dark neutral background
+
Volt Lime mark
```

No required text.

Must remain recognizable inside a circular crop.

The social profile mark should be derived from the exact production vector, not a separate illustration.

---

# 829. Social Asset System

Create reusable templates for:

- X profile;
- X header;
- launch announcements;
- milestone announcements;
- market screenshots;
- educational diagrams;
- partnership graphics;
- protocol-status notices.

Templates must preserve:

- spacing;
- typography;
- dark foundation;
- restrained Volt Lime usage.

---

# 830. Light-Surface Behavior

SENT is dark-first but must work on light surfaces.

Canonical light expression:

```text
light neutral background
+
near-black SENT symbol
```

Do not force Volt Lime mark onto white if contrast/readability becomes poor.

Brand identity is the system, not one color combination.

---

# 831. Reduced Motion

Reduced-motion users retain:

- composition;
- hierarchy;
- branding;
- static spatial imagery.

Disable/reduce:

- parallax;
- camera movement;
- large transforms;
- continuous ambient motion.

Brand quality may not depend on motion availability.

---

# 832. Low-Capability Device Mode

If GPU/mobile capability is insufficient:

```text
3D → static/pre-rendered equivalent
complex shader → simpler layer
heavy particle field → lightweight graphic
```

Typography, spacing, Volt Lime identity, and interaction quality remain.

Graceful degradation must still look intentional.

---

# 833. Performance Is Part of Luxury

A visually beautiful interface that:

- stutters;
- blocks scrolling;
- delays transaction review;
- overheats mobile;
- shifts layout;

fails the premium requirement.

Brand quality includes technical smoothness.

---

# 834. Brand QA — Mandatory

Every major screen receives visual QA for:

- typography;
- spacing;
- alignment;
- color;
- Volt Lime saturation;
- hierarchy;
- contrast;
- state coverage;
- hover/focus;
- animation;
- responsive behavior;
- dark-mode glare;
- chart consistency;
- loading;
- errors;
- empty states.

---

# 835. Volt Lime Glare QA

Specific required review:

- dark room;
- normal office brightness;
- high monitor brightness;
- OLED phone;
- LCD desktop;
- mobile outdoor/high brightness where practical.

If full-strength Volt Lime causes glare:

- reduce area;
- reduce duration;
- reduce bloom;
- move to darker derivative;

rather than changing the canonical signature hue.

---

# 836. Screenshot Consistency Test

Take screenshots of:

```text
homepage
Explore
launch
terminal
transaction review
portfolio
Stockback
creator dashboard
mobile
```

Place them side-by-side.

Pass condition:

> A reviewer should immediately perceive one coherent product family without needing to see the logo.

---

# 837. Visual Regression

Use automated screenshot/visual regression for shared critical components and primary routes.

Detect accidental changes to:

- typography;
- spacing;
- color tokens;
- logo;
- chart treatment;
- buttons;
- transaction review.

Visual drift is a real regression.

---

# 838. No Arbitrary Brand Overrides

Forbidden implementation patterns:

```text
style={{ color: "#random" }}
random Tailwind arbitrary lime values
one-off page gradients
one-off radius values
one-off shadow systems
random font family
random easing
```

Exceptions require documented design reason.

---

# 839. SENT Brand Token Source of Truth

The shared UI/design package is canonical for:

```text
color
typography
spacing
radius
border
surface
shadow
motion
chart
semantic state
logo assets
```

Website, creator tools, and account surfaces import from the same system.

---

# 840. Brand Change Governance

The following require explicit product-owner approval:

- product name;
- signature color anchor;
- primary logo concept;
- typography category;
- core visual mode philosophy;
- fundamental motion language;
- major brand voice shift.

An engineer/agent may not replace them based on personal preference.

---

# 841. Branding Requirements Traceability

| Requirement | Canonical Source | Implementation | Proof | Gate |
|---|---|---|---|---|
| Product name SENT | Brand config | app metadata/UI | cross-route audit | P0 |
| Volt Lime #C6F600 | design tokens | shared UI package | token test + screenshots | P0 |
| Restrained accent usage | design system | components/routes | glare/visual QA | P0 |
| Abstract symbol-first mark | brand assets | nav/social/favicon | size/crop test | P0 |
| Dark refined foundation | design tokens | all public UI | screenshot matrix | P0 |
| Experience Mode | motion/spatial system | discovery surfaces | visual/perf QA | P0 |
| Trading Mode calmness | terminal components | financial surfaces | transaction QA | P0 |
| Money-proximity motion law | motion tokens | flows | E2E visual review | P0 |
| Cross-surface consistency | shared components | all routes | screenshot consistency | P0 |
| Creator premium parity | launch/creator UI | creator routes | creator E2E | P0 |
| Accessibility / reduced motion | CSS/motion/runtime | all routes | accessibility QA | P0 |
| Visual regression | CI | critical screens | regression suite | P0 |

---

# 842. SENT Brand Hard Rules — LOCKED

Implementation may not:

- replace Volt Lime with another primary signature color;
- saturate the entire UI with Volt Lime;
- make the canonical logo a realistic 3D emblem;
- turn the symbol into a Hyperliquid copy;
- use casino/neon-spam aesthetics;
- allow each page to invent its own style;
- downgrade creator surfaces visually;
- sacrifice readability for animation;
- sacrifice performance for 3D;
- use flashy animation inside critical signing/review states;
- use semantic financial colors inconsistently;
- replace premium typography with default browser styling;
- treat branding as homepage-only.

---

# 843. Final SENT Brand Statement

Canonical V1 identity:

```text
BRAND
SENT

SIGNATURE COLOR
Volt Lime
#C6F600

FOUNDATION
Dark refined neutrals

LOGO
Abstract symbol-first paired-market mark
flat / simple / protocol-grade

VISUAL CHARACTER
Premium
Luxury
Quant-grade
Interactive
Spatial
Highly polished
Controlled energy

EXPERIENCE MODE
Cinematic / expressive / animated

TRADING MODE
Calm / precise / data-dense

MOTION LAW
Closer to money = calmer motion

ACCENT LAW
Volt Lime is rare, precise, recognizable
not loud, pervasive, or glaring
```

SENT must feel expensive because the entire system is coherent — not because the interface is overloaded.

---

---

# 844. SENT Design System v1 — Production Canonical

This section turns the SENT brand direction into an implementation-grade design system.

It is intended to remove visual guesswork from:

- coding agents;
- frontend engineers;
- motion engineers;
- designers;
- chart implementers;
- creator-tool surfaces;
- social/brand asset production.

Core rule:

> **A SENT screen should be identifiable as SENT even when the logo is hidden.**

---

# 845. Design-System Authority

Canonical ownership:

```text
packages/ui
+
packages/design-tokens
+
packages/brand
```

These packages own:

- colors;
- typography;
- spacing;
- radii;
- borders;
- shadows;
- motion;
- focus states;
- chart styling;
- icon rules;
- brand assets.

Application routes may compose these primitives.

They may not independently redefine the visual language.

---

# 846. Canonical SENT Color Tokens — LOCKED

## Brand

```text
sent.volt.50    #F7FFD6
sent.volt.100   #F0FFAD
sent.volt.200   #E5FF70
sent.volt.300   #D9FF33
sent.volt.400   #CEFF0A
sent.volt.500   #C6F600   ← canonical SENT signature
sent.volt.600   #A3CC00
sent.volt.700   #7FA300
sent.volt.800   #5C7800
sent.volt.900   #344600
sent.volt.950   #1B2600
```

Only `sent.volt.500` is the identity anchor.

Derived shades may be optically adjusted only if the 500 anchor remains unchanged and the scale remains perceptually coherent.

---

# 847. Canonical Dark-Neutral Tokens

```text
sent.neutral.0      #FFFFFF
sent.neutral.50     #F5F7F3
sent.neutral.100    #E7EAE4
sent.neutral.200    #C9CEC6
sent.neutral.300    #A5ADA2
sent.neutral.400    #818A7E
sent.neutral.500    #636C61
sent.neutral.600    #4B5349
sent.neutral.700    #353C34
sent.neutral.800    #242A24
sent.neutral.850    #1B211C
sent.neutral.900    #151A16
sent.neutral.925    #111512
sent.neutral.950    #0D100E
sent.neutral.975    #090B0A
sent.neutral.1000   #050605
```

Dark UI must use layered neutrals rather than a single black value.

---

# 848. Canonical Surface Tokens

```text
background.canvas       #090B0A
background.deep         #050605

surface.base            #0D100E
surface.raised          #111512
surface.panel           #151A16
surface.elevated        #1B211C
surface.interactive     #202620

text.primary            #F5F7F3
text.secondary          #A5ADA2
text.tertiary           #70796E
text.disabled           #4B5349

border.subtle           rgba(245,247,243,0.07)
border.default          rgba(245,247,243,0.11)
border.strong           rgba(245,247,243,0.18)
```

No component should invent another near-black unless justified by an approved visual effect.

---

# 849. Canonical Semantic Color Tokens

Brand and trading semantics are separate.

```text
semantic.positive       #3CCB8C
semantic.positiveSoft   #246E51

semantic.negative       #F06B6B
semantic.negativeSoft   #7E3B3B

semantic.warning        #E8B84A
semantic.warningSoft    #715A2D

semantic.info           #6EA8FF
semantic.infoSoft       #355781

semantic.neutral        #A5ADA2
```

These may receive minor contrast tuning in accessibility QA.

The semantic meaning itself may not be reassigned.

---

# 850. Color Usage Hierarchy

Default visual hierarchy:

```text
Canvas / background
→ dark neutral

Primary content
→ near-white

Secondary information
→ neutral gray

Brand identity / active focus
→ Volt Lime

Financial movement
→ semantic positive / negative

Warnings / stale / degraded
→ warning / neutral state
```

Do not use Volt Lime merely because a component needs “some color”.

---

# 851. Volt Lime Exposure Budget

Normal Trading Mode:

```text
target visible Volt Lime area
~1–3%
```

Experience Mode:

```text
target visible Volt Lime area
~2–6%
```

A cinematic focal frame may exceed this temporarily.

Persistent large lime surfaces are forbidden on core financial screens.

---

# 852. Volt Lime Text Rules

Allowed:

- tiny active labels;
- short accent labels;
- brief CTA text on dark when accessibility passes;
- status/brand microcopy;
- selected-state detail.

Avoid:

- paragraph text;
- tables full of lime values;
- long legal/help text;
- entire metric panels;
- every heading.

Volt Lime should pull the eye deliberately.

---

# 853. Typography Stack — V1 CANONICAL

V1 production stack:

```text
DISPLAY
Instrument Sans

UI / BODY
Geist Sans

DATA / MONO
Geist Mono
```

Fallback:

```css
font-family:
  "Instrument Sans",
  "Geist",
  Inter,
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Data fallback:

```css
font-family:
  "Geist Mono",
  "SFMono-Regular",
  Consolas,
  "Liberation Mono",
  monospace;
```

If licensing/distribution changes before production, replacement requires product visual approval and must preserve the same character.

---

# 854. Typography Usage

## Instrument Sans

Use for:

- hero display;
- campaign headings;
- major editorial headlines;
- selected section titles.

## Geist Sans

Use for:

- navigation;
- buttons;
- forms;
- body text;
- cards;
- transaction review;
- creator tools;
- terminal UI.

## Geist Mono

Use selectively for:

- contract addresses;
- transaction hashes;
- block numbers;
- technical identifiers;
- compact market data where mono treatment improves scanning.

Main prices do NOT need to be monospace if Geist Sans tabular numerals provide better visual quality.

---

# 855. Type Scale — Desktop

Canonical desktop token baseline:

```text
display-2xl  96px / 0.94 / -0.055em / 500
display-xl   80px / 0.96 / -0.050em / 500
display-lg   64px / 0.98 / -0.045em / 500
display-md   52px / 1.00 / -0.040em / 500

h1           44px / 1.06 / -0.035em / 550
h2           36px / 1.10 / -0.030em / 550
h3           28px / 1.14 / -0.020em / 550
h4           22px / 1.20 / -0.015em / 550

body-lg      18px / 1.55 / -0.010em / 400
body         16px / 1.50 / -0.008em / 400
body-sm      14px / 1.45 / 0       / 400

ui           14px / 1.30 / -0.005em / 500
ui-sm        13px / 1.25 / 0         / 500
label        12px / 1.20 / +0.080em  / 550
micro        11px / 1.20 / +0.060em  / 550
```

Uppercase is primarily for `label` / `micro`, not paragraph content.

---

# 856. Responsive Type Scale

Large display text uses fluid sizing.

Reference:

```css
font-size: clamp(min, preferred-vw, max);
```

Examples:

```text
Hero display
mobile ~48–56px
tablet ~64–72px
desktop 80–96px

H1
mobile ~34–38px
desktop ~44px

Body
mobile and desktop ~16px
```

Never shrink body text to compensate for dense layouts.

---

# 857. Financial Number Typography

Main market price:

```text
32–48px desktop depending surface
28–36px mobile
font weight 500–550
tabular numerals
tight tracking
```

Secondary market metrics:

```text
13–16px
tabular numerals
```

Rules:

- stable width;
- no layout jumps;
- decimals may use subtly lower text contrast;
- sign and percentage remain semantically clear;
- no over-animation.

---

# 858. SENT Word Presentation

When text brand name appears:

```text
S E N T
```

may use intentionally expanded optical tracking.

This is a text presentation treatment, not the canonical primary logo.

The abstract symbol remains the primary identity asset.

---

# 859. Spacing Tokens — LOCKED BASELINE

```text
space.0   0
space.1   4px
space.2   8px
space.3   12px
space.4   16px
space.5   20px
space.6   24px
space.8   32px
space.10  40px
space.12  48px
space.16  64px
space.20  80px
space.24  96px
space.32  128px
space.40  160px
```

Prefer token values over arbitrary pixel spacing.

---

# 860. Content Width Tokens

```text
content.reading      720px
content.standard     1120px
content.wide         1280px
content.max          1440px
content.cinematic    1680px
```

Marketing surfaces may escape the content container for controlled full-bleed spatial scenes.

Text itself should remain readable.

---

# 861. Page Gutters

Reference:

```text
mobile      16px
large mobile 20px
tablet      32px
desktop     48px
wide        64px
```

Use fluid/clamped gutter logic where appropriate.

No content should visually touch viewport edges accidentally.

---

# 862. Radius Tokens

```text
radius.none   0
radius.xs     4px
radius.sm     6px
radius.md     8px
radius.lg     12px
radius.xl     16px
radius.2xl    20px
radius.pill   999px
```

Typical:

```text
button/input          radius.md
terminal panel        radius.lg
market card           radius.lg
modal/drawer          radius.xl
status chip           radius.pill
```

Avoid `20px+` bubbly cards throughout the interface.

---

# 863. Control Heights

```text
control.sm        32px
control.md        40px
control.lg        48px
control.xl        56px
```

Touch-critical mobile actions should generally be at least 44px effective target height.

Dense terminal micro-controls may use 32px only where accessibility remains acceptable.

---

# 864. Border System

Default:

```text
1px
```

Use tokenized opacity.

Active Volt border:

```text
rgba(198,246,0,0.45)
```

Focus state can use stronger Volt Lime but must not create a neon halo across the interface.

---

# 865. Shadow System

Use sparingly.

Reference:

```text
shadow.none

shadow.sm
0 4px 16px rgba(0,0,0,0.20)

shadow.md
0 12px 36px rgba(0,0,0,0.26)

shadow.lg
0 24px 64px rgba(0,0,0,0.32)
```

Dark-surface hierarchy should primarily come from surface tone and border, not shadow.

---

# 866. Volt Glow Token

Brand glow is allowed as a special Experience Mode tool:

```text
0 0 32px rgba(198,246,0,0.16)
```

Stronger artistic glow may exist in isolated hero scenes.

Persistent Trading Mode components should normally use no brand glow.

---

# 867. Button System

Canonical button variants:

```text
brand-primary
neutral-primary
secondary
ghost
danger
semantic-buy
semantic-sell
```

No page-specific button style families.

---

# 868. Brand Primary Button

Default:

```text
background  sent.volt.500
foreground  sent.neutral.1000
border      none
radius      md
height      48px standard CTA
weight      600
```

Hover:

```text
background sent.volt.400
```

Pressed:

```text
background sent.volt.600
transform  subtle 1px/scale response maximum
```

Disabled:

- neutralized;
- clearly noninteractive;
- no bright lime.

---

# 869. Neutral Primary Button

Use on Trading Mode when a bright Volt CTA would dominate financial semantics.

Default:

```text
background  text.primary
foreground  background.deep
```

or a high-contrast neutral variant.

This allows SENT to remain branded without every important action being lime.

---

# 870. Buy / Sell Buttons

BUY and SELL are semantic controls.

Use:

```text
buy
→ positive family

sell
→ negative family
```

Volt Lime must not replace these meanings.

Hover/pressed states remain within each semantic family.

---

# 871. Secondary Button

```text
background  transparent / subtle surface
border      border.default
text        text.primary
```

Hover:

```text
surface.raised/elevated
border.strong
```

Do not add lime unless the button is selected/active.

---

# 872. Ghost Button

Used for low-priority actions.

```text
background transparent
text       secondary/primary
```

Hover uses subtle neutral elevation.

Ghost actions should not compete with the page's primary task.

---

# 873. Input System

Inputs:

```text
height      40–48px
surface     surface.base / raised
border      border.default
text        text.primary
placeholder text.tertiary
radius      md
```

Focus:

```text
border rgba(198,246,0,0.55)
outer focus ring rgba(198,246,0,0.12)
```

Invalid:

```text
semantic.negative
```

Do not use Volt Lime to indicate valid financial values.

---

# 874. Search Input

Search must feel integrated into SENT rather than browser-default.

Features:

- immediate focus clarity;
- optional shortcut hint;
- clear button;
- result loading state;
- keyboard navigation;
- strong accessibility.

No global Ctrl+K command palette is introduced.

---

# 875. Select / Dropdown

Dropdowns inherit:

- surface.elevated;
- subtle border;
- restrained shadow;
- 8px radius;
- clear selected state.

Selected row may use:

```text
low-opacity Volt background
+
small Volt indicator
```

not full lime fill.

---

# 876. Tabs

Tabs should primarily use typography and a small indicator.

Active:

```text
text.primary
+
2px or thinner Volt Lime indicator
```

Inactive:

```text
text.secondary
```

Avoid large pill-tab groups unless the interaction specifically benefits.

---

# 877. Cards

Standard cards:

```text
surface.panel
border.subtle
radius.lg
```

Cards must not all look elevated/floating.

Prefer structural hierarchy.

Hoverable Explore cards may use:

- slight surface lift;
- subtle border increase;
- restrained directional motion;
- tiny Volt detail.

No strong glow.

---

# 878. Market Card

Canonical hierarchy:

```text
TOKEN identity
paired xStock
price / MC
change
volume / activity
graduation progress
Stockback cue
status
```

The TOKEN and canonical pair should remain legible without relying on logo imagery.

Volt Lime may identify:

- active/featured state;
- graduation trace;
- small Stockback accent.

---

# 879. Trade Panel

Trade panel is a low-distraction financial surface.

Must emphasize:

- Buy/Sell mode;
- input asset;
- input amount;
- expected output;
- core fee;
- Stockback;
- slippage;
- allowance state;
- balance;
- CTA;
- transaction review.

Avoid decorative 3D.

Avoid large brand glow.

---

# 880. Transaction Review

Transaction Review is one of the calmest surfaces.

Visual rules:

```text
strong text hierarchy
high spacing clarity
minimal motion
no ambient animation
no decorative 3D
no flashing
```

Show:

- action;
- assets;
- amount;
- minimum output;
- fees;
- spender;
- target;
- chain;
- critical warnings.

Volt Lime may appear only in small brand/focus details.

---

# 881. Modal System

Modal:

```text
surface.elevated
border.default
radius.xl
shadow.md
```

Use backdrop dimming, not excessive blur.

Critical financial modal content should remain fully legible on low-end devices.

---

# 882. Drawer / Mobile Sheet

Mobile transaction and wallet flows use bottom sheets/drawers where appropriate.

Requirements:

- clear drag affordance only if draggable;
- stable layout;
- safe-area padding;
- thumb-friendly controls;
- no motion that delays CTA access.

---

# 883. Toast System

Toasts:

- compact;
- non-blocking;
- semantically colored;
- readable;
- dismissible where appropriate.

Transaction toast links to transaction detail/explorer when safe.

Do not use Volt Lime for every success toast.

---

# 884. Status Badge

Status badge colors derive from semantics.

Examples:

```text
LIVE
→ neutral/positive treatment

GRADUATING
→ informational/brand transition

GRADUATED
→ stable neutral/Volt micro-accent

STALE
→ warning

HALTED
→ negative/warning

CANONICAL
→ subtle Volt identification
```

Avoid visually loud filled pills for every status.

---

# 885. Progress / Graduation

Graduation progress may use a dark track and restrained Volt Lime progress fill.

The bar must remain readable without glow.

Near-graduation emphasis may slightly increase intensity/motion, but must not resemble a casino jackpot meter.

---

# 886. Stockback UI

Stockback identity:

```text
same SENT system
+
small Volt Trace / reward cue
```

Not a separate bright-green subsystem.

Claimable amounts use primary financial typography.

Estimated vs finalized states must be visually distinct through labels/state, not color alone.

---

# 887. Portfolio Tables

Tables:

- dense but breathable;
- strong column alignment;
- tabular numerals;
- subtle row separators;
- no card-per-row layout on desktop unless needed;
- sticky headers where useful.

Hover uses neutral elevation.

Volt Lime reserved for selection/focus.

---

# 888. Data Table Row Height

Reference:

```text
compact      40px
standard     48px
comfortable  56px
```

User-selected density may use these sanctioned values.

---

# 889. Chart Canvas

Canonical chart background:

```text
transparent over terminal panel
or
surface.base
```

Grid:

```text
rgba(245,247,243,0.045)
```

Axis text:

```text
text.tertiary / secondary
```

Crosshair:

```text
neutral high-contrast
```

Selected annotation may use Volt Lime.

---

# 890. Candlestick / Price Colors

Candles:

```text
up    semantic.positive
down  semantic.negative
```

Use muted professional values.

Do not use Volt Lime for all up candles.

---

# 891. Chart Interaction Motion

Crosshair, tooltip, zoom, pan and realtime candles must prioritize low latency.

No eased cinematic motion for basic chart manipulation.

Chart should feel instrument-like.

---

# 892. Logo Placement Rules

Navbar:

```text
symbol only
or
symbol + SENT text when recognition context requires
```

Social avatar:

```text
symbol only
```

Favicon:

```text
symbol only
```

Footer/legal:

```text
symbol + SENT text allowed
```

Do not repeat the logo excessively within one viewport.

---

# 893. Logo Safe Area — Interim

Until exact vector optical geometry is finalized:

```text
minimum clear space
= 0.5x mark height
```

Production vector refinement may establish a more precise construction unit.

---

# 894. Motion Timing Tokens

```text
motion.instant   80ms
motion.fast      140ms
motion.ui        200ms
motion.normal    280ms
motion.slow      420ms
motion.scene     700ms
motion.ambient   8s–20s
```

Do not use `ambient` on transaction-critical elements.

---

# 895. Easing Tokens

Reference canonical curves:

```text
ease.standard
cubic-bezier(0.22, 1, 0.36, 1)

ease.enter
cubic-bezier(0.16, 1, 0.30, 1)

ease.exit
cubic-bezier(0.70, 0, 0.84, 0)

ease.snap
cubic-bezier(0.20, 0.80, 0.20, 1)
```

Spring physics may be used selectively in Experience Mode.

No uncontrolled spring/bounce in financial controls.

---

# 896. Hover Motion

Desktop hover:

```text
translateY maximum ~1–2px
small border/surface response
optional directional trace
```

Avoid scaling large cards significantly.

No hover behavior may cause layout shift.

---

# 897. Press Motion

Buttons/controls may use:

```text
scale 0.985–0.995
```

or a 1px physical press treatment.

Keep subtle.

Touch feedback must feel immediate.

---

# 898. Page Transition

Normal app route transition:

```text
~180–300ms
```

Use:

- opacity;
- small directional translation;
- preserved layout;
- skeleton/data continuity.

No long cinematic transition between routine terminal routes.

---

# 899. Experience Mode Scene Transition

Marketing/storytelling transitions may use:

```text
400–900ms
```

and spatial camera/object choreography.

Navigation must remain interruptible.

---

# 900. Realtime Price Update Motion

When value changes:

1. number updates immediately;
2. optional 120–250ms subtle semantic tint;
3. returns to default.

No repeated glow.

No number-slot animation that delays comprehension.

---

# 901. Loading Motion

Preferred hierarchy:

```text
known layout
→ skeleton

tiny async action
→ inline spinner / trace

brand transition
→ SENT Trace

heavy Experience scene
→ progressive loading
```

Do not show full-screen branded loading unnecessarily.

---

# 902. SENT Trace Token

Visual concept:

```text
1–2px line
Volt Lime or low-opacity derived Volt
directional
smooth
short-lived
```

The Trace may connect:

- paired assets;
- launch steps;
- graduation;
- scene transitions.

It is not a decorative line drawn everywhere.

---

# 903. Reduced Motion Token Behavior

When `prefers-reduced-motion`:

```text
scene translation
→ fade/static

parallax
→ disabled

ambient particles
→ disabled/reduced

logo choreography
→ short dissolve

transaction state
→ unchanged clarity
```

No information can exist only in motion.

---

# 904. Responsive Breakpoint Philosophy

Use content-driven responsive behavior rather than designing only around device names.

Reference breakpoints:

```text
sm   640px
md   768px
lg   1024px
xl   1280px
2xl  1536px
```

These are implementation primitives, not layout guarantees.

---

# 905. Terminal Responsive Priority

When width decreases, preserve in order:

```text
1. price / identity / state
2. chart
3. trade action
4. transaction safety information
5. graduation / Stockback state
6. secondary analytics
```

Secondary panels may collapse into tabs/sheets.

Core trade information may not disappear.

---

# 906. Creator Responsive Priority

Preserve:

```text
launch progress
inputs
pair identity
preview
fee/economic disclosure
transaction review
```

Cinematic preview may simplify on small screens.

---

# 907. Focus Ring

Keyboard focus is mandatory.

Default:

```text
2px rgba(198,246,0,0.72)
+
2px offset against dark surface
```

Tune for accessibility.

Do not remove outlines without an equivalent accessible focus state.

---

# 908. Selection Highlight

Text selection may use a low-opacity Volt Lime background with dark text if contrast passes.

This is a subtle browser-level brand opportunity.

---

# 909. Scrollbar Treatment

Custom scrollbars are optional.

If styled:

- subtle neutral track;
- neutral thumb;
- Volt Lime only on intentional hover/active if not distracting.

Do not make scrollbars bright brand elements.

---

# 910. Cursor / Pointer Effects

Experience Mode may use a subtle custom pointer/trace response.

Trading Mode must use normal predictable pointer behavior.

Do not replace the system cursor on financial controls in a way that harms usability.

---

# 911. Icon Size Tokens

```text
icon.xs  12px
icon.sm  16px
icon.md  20px
icon.lg  24px
icon.xl  32px
```

Stroke width should remain visually consistent across sizes.

---

# 912. Icon Color

Default:

```text
text.secondary
```

Active:

```text
text.primary
or
Volt Lime when representing brand selection
```

Semantic icons use semantic color.

Do not color every icon Volt Lime.

---

# 913. Illustration Color Discipline

Abstract visuals may contain:

- neutrals;
- Volt Lime;
- controlled spectral/reflection tints.

Do not introduce a new dominant brand hue per campaign.

Campaign variation must still visibly belong to SENT.

---

# 914. 3D SENT Material Palette

Experience Mode 3D can use:

```text
obsidian
smoked glass
dark graphite
matte ceramic
black chrome
subtle reflective metal
Volt Lime emissive accents
```

Avoid:

- gold-heavy luxury cliché;
- rainbow chrome;
- plastic toy material;
- generic sci-fi blue holograms.

---

# 915. 3D Volt Emission

Volt Lime emissive surfaces should:

- occupy small area;
- bloom subtly;
- illuminate nearby material locally;
- never wash the entire viewport green.

The physical metaphor is:

> **energy contained inside precision hardware.**

---

# 916. Visual Noise Budget

Each viewport should have:

```text
1 primary focal point
1–3 secondary focal points
rest supportive
```

If everything asks for attention, the screen fails SENT quality.

---

# 917. Homepage Hero Composition

Hero should typically contain:

- SENT symbol/identity;
- one major statement;
- one primary CTA;
- optional secondary CTA;
- one signature spatial/data visual.

Avoid six competing cards above the fold.

---

# 918. Explore Composition

Explore is energetic but structured.

Use:

- clear ranking/group labels;
- sophisticated card rhythm;
- restrained motion;
- live data;
- filtering/search clarity.

No infinite neon tile wall.

---

# 919. Creator Dashboard Composition

Creator dashboard should look like a professional revenue/product surface.

Top hierarchy:

```text
market identity
lifecycle
creator earnings
claimable
volume
Stockback context
performance
```

Avoid gamified “creator level” aesthetics.

---

# 920. Copy Length Discipline

Premium interface text is concise.

Buttons:

```text
1–3 words
```

Labels:

```text
short noun phrase
```

Error/support detail can be longer when precision is required.

Do not shorten safety information merely for visual minimalism.

---

# 921. Component State Coverage — P0

Every interactive component needs explicit:

```text
default
hover
focus
active
disabled
loading
error
success where applicable
```

Financial components additionally:

```text
stale
reconnecting
pending
confirmed
reverted
expired
```

No browser-default state leakage on production critical surfaces.

---

# 922. Skeleton System

Skeletons use neutral tones.

Do not use bright Volt shimmer.

If shimmer is used:

- very low contrast;
- slow;
- disabled/reduced for reduced-motion.

Stable dimensions prevent layout shift.

---

# 923. Accessibility Contrast

All critical text/control combinations must meet the agreed accessibility standard.

Volt Lime on dark generally provides strong visibility, but its glare must still be tested.

Light-gray microcopy may not be made too faint purely for aesthetics.

---

# 924. Design-System Storybook / Catalog

Build a component catalog or equivalent isolated preview environment.

Must include:

- all component variants;
- all states;
- light/dark exception if applicable;
- mobile widths;
- reduced-motion view;
- error/stale/pending states;
- financial examples.

This becomes a visual QA surface for agents and humans.

---

# 925. Design Token Implementation

Recommended:

```text
CSS custom properties
+
TypeScript token exports
+
Tailwind-class mappings where useful
```

Example:

```css
:root {
  --sent-volt-500: #c6f600;
  --sent-bg-canvas: #090b0a;
  --sent-surface-base: #0d100e;
  --sent-text-primary: #f5f7f3;
}
```

Financial and brand logic should reference semantic token names, not raw hex values.

---

# 926. No Hex Leakage Rule

Raw color literals should be limited to:

- token definition files;
- specialized visual/shader code with documented reason.

Normal components should use:

```text
var(--sent-...)
```

or typed token abstraction.

This prevents brand drift.

---

# 927. Design-System Linting

Where practical, add lint/static rules against:

- unknown raw hex values;
- arbitrary font family;
- arbitrary z-index;
- arbitrary animation duration;
- arbitrary radius;
- direct unreviewed inline styles.

Not every exception must be impossible, but exceptions should be visible in review.

---

# 928. Z-Index Scale

Canonical conceptual scale:

```text
base          0
raised        10
sticky        20
dropdown      40
overlay       60
modal         80
toast         100
critical      120
```

Do not use random:

```text
z-index: 999999
```

---

# 929. Chart / Modal Layer Coordination

Chart tooltips/crosshairs must not visually overlay transaction-confirmation modals.

Global z-index tokens coordinate:

- chart overlays;
- nav;
- wallet dialogs;
- sheets;
- transaction review;
- toasts.

---

# 930. Interaction Latency Quality Bar

Visual response to direct user interaction should generally begin within:

```text
~100ms
```

unless blocked by browser/wallet behavior.

Async actions must show immediate pending state.

“Luxury” cannot mean slow.

---

# 931. Animation Frame-Rate Quality Bar

Target:

```text
60fps-class smoothness on supported devices
```

Gracefully reduce effects rather than maintaining a heavy scene that visibly stutters.

Measure:

- long tasks;
- frame drops;
- GPU pressure;
- mobile thermal behavior.

---

# 932. Design-System Performance Budget

Design effects must not materially damage:

- LCP;
- INP;
- CLS;
- terminal interaction;
- chart responsiveness;
- wallet flow.

Heavy Experience assets load progressively.

Critical trade UI loads independently of decorative 3D where feasible.

---

# 933. Asset Optimization

Brand assets:

```text
SVG for canonical logo
AVIF/WebP for raster imagery
compressed GLB/GLTF for 3D
optimized texture formats where supported
```

Do not ship multi-megabyte PNG backgrounds casually.

---

# 934. Social PFP Production Rule

Final X PFP:

```text
1:1
dark canvas
canonical flat SENT symbol
Volt Lime #C6F600
large optical mark
safe circular crop
no text
no unnecessary glow
```

A subtle glow may be added only if the flat mark remains dominant and clear after X compression.

---

# 935. X Header Direction

X header should use:

- large negative space;
- dark SENT canvas;
- spatial pair/convergence motif;
- restrained Volt Trace;
- optional short SENT line;
- no dense product feature list.

PFP and header must work together without duplicating the exact same composition.

---

# 936. OG / Link Preview

OpenGraph card should immediately communicate:

```text
SENT symbol
market/token context
short page-specific title
dark refined visual system
small Volt accent
```

Dynamic token-market OG cards may show:

- token;
- paired xStock;
- current lifecycle;
- key metric.

Do not overload OG card with terminal data.

---

# 937. Favicon

Use production vector symbol.

Required sizes/export:

```text
16
32
48
64
180
192
512
```

Provide:

- SVG favicon where supported;
- ICO fallback;
- PNG application icons.

Small-size optical variant may be allowed if it preserves identity.

---

# 938. Logo Asset Package — REQUIRED

Final brand package must include:

```text
sent-symbol.svg
sent-symbol-mono.svg
sent-symbol-dark.svg
sent-symbol-light.svg

sent-lockup-horizontal.svg
sent-lockup-stacked.svg

favicon.svg
favicon.ico

sent-pfp-x.png
sent-app-192.png
sent-app-512.png

safe-area specification
construction grid
usage guide
```

Exact vector assets are created only after final geometry refinement.

---

# 939. Brand Asset Source of Truth

Canonical editable source should be stored in the project-controlled design/brand source location.

Generated PNGs or AI mockups are **references**, not canonical vector masters.

Production code must consume exported approved assets.

---

# 940. AI-Generated Brand Mockup Rule

AI-generated visuals may help explore:

- mood;
- application;
- materials;
- motion concepts.

They must not silently become production vector assets.

Logo production geometry must be rebuilt/verified as clean deterministic vector paths.

---

# 941. Visual Approval Gate

Before accepting a major public route:

1. compare against SENT system;
2. compare adjacent routes side-by-side;
3. test normal and edge states;
4. test mobile;
5. test motion;
6. test reduced motion;
7. test performance;
8. inspect Volt Lime exposure;
9. inspect typography;
10. inspect transaction clarity where relevant.

A beautiful isolated screenshot is not enough.

---

# 942. Design Drift Review

At every milestone:

```text
new screens
↓
screenshot matrix
↓
compare tokens/components/motion
↓
identify drift
↓
fix before next milestone
```

Do not postpone visual consistency cleanup to the end.

---

# 943. Creator / Trader Parity Test

Place:

```text
Explore
Terminal
Launch Builder
Creator Dashboard
Portfolio
Stockback
```

side-by-side.

All must pass:

```text
same typography family
same surfaces
same spacing logic
same icon grammar
same brand accent logic
same quality level
```

---

# 944. SENT Quality Heuristic

When choosing between two valid designs, prefer the one that is:

```text
clearer
more intentional
less visually noisy
more responsive
more precise
more memorable
```

Not simply the one with more effects.

---

# 945. Design-System Hard Rejections

Reject a UI implementation if it has:

- generic shadcn/default-library visual appearance without SENT treatment;
- random neon gradients;
- full-screen Volt Lime usage without exceptional justification;
- large glowing lime financial tables;
- overly rounded SaaS cards;
- random fonts;
- inconsistent spacing;
- mixed icon libraries;
- excessive glass;
- heavy shadows everywhere;
- chart default styling;
- flashy transaction review;
- 3D that hurts performance;
- creator UI visibly lower quality than trader UI;
- mobile layout that looks like a squeezed desktop;
- inaccessible contrast;
- motion without reduced-motion handling.

---

# 946. Design-System Release Checklist

P0 visual release checklist:

```text
[ ] production logo vector finalized
[ ] favicon legible at 16/32px
[ ] X/avatar crop passes
[ ] Volt Lime #C6F600 exact token exists
[ ] no unapproved primary brand hue
[ ] dark neutral scale implemented
[ ] semantic palette implemented
[ ] fonts load correctly
[ ] tabular numerals enabled
[ ] component catalog complete
[ ] all critical states complete
[ ] chart visually customized
[ ] mobile layouts pass
[ ] reduced motion passes
[ ] glare review passes
[ ] accessibility passes
[ ] screenshot consistency passes
[ ] visual regression enabled
[ ] performance budget passes
```

---

# 947. SENT Design-System Implementation Order

Recommended:

```text
1. tokens
2. fonts
3. production logo assets
4. primitives
5. forms
6. navigation
7. market cards
8. terminal primitives
9. chart styling
10. transaction review
11. launch/creator components
12. Stockback components
13. Experience Mode motion
14. social/OG templates
15. visual regression
```

Do not start by building bespoke page-level effects before primitives are stable.

---

# 948. Updated Repository Structure — Brand/UI

Reference:

```text
packages/
├── brand/
│   ├── assets/
│   ├── logo/
│   ├── social/
│   └── brand.ts
│
├── design-tokens/
│   ├── colors.ts
│   ├── typography.ts
│   ├── spacing.ts
│   ├── motion.ts
│   ├── css-vars.css
│   └── tailwind-map.ts
│
└── ui/
    ├── primitives/
    ├── market/
    ├── trading/
    ├── creator/
    ├── stockback/
    └── motion/
```

---

# 949. Updated Requirements Traceability — Design System

| Requirement | Canonical Source | Implementation | Test / Proof | Gate |
|---|---|---|---|---|
| Volt Lime identity | token 500 #C6F600 | design-tokens | token snapshot | P0 |
| Dark neutral system | neutral/surface scale | CSS tokens | screenshot suite | P0 |
| Typography consistency | Instrument/Geist stack | font loader/tokens | route audit | P0 |
| Stable financial numbers | tabular numerals | data typography | realtime visual test | P0 |
| Component consistency | shared UI | packages/ui | catalog + visual diff | P0 |
| Calm financial flow | motion hierarchy | transaction components | E2E review | P0 |
| Semantic color separation | semantic tokens | trading UI | buy/sell/state audit | P0 |
| Premium creator parity | same components/tokens | creator UI | screenshot matrix | P0 |
| Mobile quality | responsive tokens | all routes | device E2E | P0 |
| Reduced motion | media query/runtime | motion system | accessibility test | P0 |
| Performance | animation/assets | frontend | Web Vitals/profile | P0 |
| Asset consistency | approved vector pack | packages/brand | asset checksum/review | P0 |

---

# 950. SENT Design System — Final Lock

Canonical V1 implementation baseline:

```text
BRAND
SENT

PRIMARY SYMBOL
abstract paired-market mark
final vector refinement pending

SIGNATURE COLOR
#C6F600

DISPLAY
Instrument Sans

UI
Geist Sans

DATA
Geist Mono / tabular numerals

FOUNDATION
dark layered neutral system

BRAND ACCENT
rare / precise / low-area Volt Lime

FINANCIAL SEMANTICS
separate positive / negative / warning / info colors

COMPONENT LANGUAGE
restrained radii
thin borders
minimal shadows
precise spacing

MOTION
highly polished
interactive
Experience Mode expressive
Trading Mode controlled

CORE PRINCIPLE
premium through coherence and restraint
```

---

---

# 951. Final Product-Surface Architecture Freeze — V1

This section freezes the primary public product compositions before implementation.

Covered:

```text
Homepage / Explore
Token Trading Terminal
Creator Launch Flow
Creator Launch Preview
Core Product Copy System
Social / Launch Brand Kit
Implementation Milestone Sequence
```

This section does not change previously locked economics, contracts, permissions, Stockback, or wallet behavior.

It converts those requirements into final executable product-surface architecture.

---

# 952. Homepage Purpose — LOCKED

The SENT homepage has three jobs:

```text
1. establish SENT identity immediately;
2. prove markets are alive right now;
3. move users into market discovery or creation with minimal friction.
```

The homepage is NOT:

- a long corporate manifesto;
- a documentation page;
- a wallet-connect gate;
- a generic token catalog;
- a static hero followed by repetitive marketing sections.

Users must be able to browse before connecting a wallet.

---

# 953. Homepage Information Architecture — LOCKED

Canonical desktop sequence:

```text
01  Navigation
02  Hero / Live Market Statement
03  Live Market Pulse
04  Trending Markets
05  Market Heat / xStock Ecosystems
06  Near Graduation
07  New Launches
08  Recently Graduated
09  Top Volume / Gainers
10  Stockback Explanation / Live Reward Context
11  Creator / Launch CTA
12  Protocol Trust / How It Works
13  Roadmap / Live Product Status
14  Footer
```

Personalized blocks may be inserted contextually after wallet/account data exists, but must not destroy the global discovery foundation.

---

# 954. Homepage Navigation — LOCKED

Desktop:

```text
[SENT symbol]

Explore
Launch
Stockback
Roadmap

                        Connect
```

After connection:

```text
[SENT symbol]

Explore
Launch
Stockback
Roadmap

                  [Account / address]
```

Rules:

- no global command palette;
- no watchlist navigation;
- no oversized pill navbar;
- navbar remains visually quiet;
- current route has restrained Volt Lime state;
- navigation remains usable over cinematic hero surfaces.

---

# 955. Homepage Hero — LOCKED STRUCTURE

Hero contains:

```text
SENT identity / abstract symbol
short market thesis
primary CTA
secondary CTA
signature spatial/data-reactive visual
live market proof
```

Primary CTA:

```text
Explore Markets
```

Secondary:

```text
Launch
```

Wallet connection is not the hero CTA.

---

# 956. Homepage Hero Copy — DEFAULT

Recommended launch baseline:

```text
Headline:
Markets, sent differently.

Support:
Launch permissionless markets against real xStock pairs.
Trade from curve to graduation without changing the token.
```

Alternative marketing copy may be refined before public launch.

It must preserve:

```text
short
confident
market-native
non-corporate
non-casino
```

Do not use unsupported claims such as:

```text
risk-free
guaranteed
the safest
best returns
```

---

# 957. Hero Visual — LOCKED DIRECTION

Hero visual should derive from:

```text
SENT paired-market symbol
+
TOKEN / xStock convergence
+
market trace
+
live data
```

Preferred:

- bespoke Three.js / React Three Fiber scene;
- dark material system;
- contained Volt Lime emission;
- subtle interaction with pointer/scroll;
- live market signals where technically safe;
- progressive fallback.

Avoid:

- spinning crypto coins;
- generic globe;
- particles with no meaning;
- huge 3D logo rotating continuously;
- decorative animation that looks disconnected from product.

---

# 958. Hero Motion Sequence

Suggested first-load choreography:

```text
0ms
canvas / typography stable

120–500ms
paired forms appear / align

300–900ms
SENT Trace establishes market direction

500–1100ms
headline/support resolves

700–1300ms
live market context appears
```

User interaction must be available before the cinematic sequence fully completes.

Repeat visits should not be forced through a long intro.

---

# 959. Live Market Pulse — LOCKED

Immediately after/within hero context, show proof the protocol is alive.

Examples:

```text
markets live
24h canonical volume
graduations
Stockback distributed / claimable context
latest trade
latest launch
```

Only use real derived data.

No fake ticker values for visual effect.

---

# 960. Market Pulse Visual Behavior

Market Pulse may update in realtime.

Rules:

- subtle transitions;
- stable numerical width;
- no whole-section flashing;
- no ticker moving so quickly it becomes unreadable;
- user can inspect/click a market;
- fallback visibly indicates stale/disconnected state.

---

# 961. Trending Section

Trending is the first substantial discovery grid.

Card priority:

```text
token identity
paired xStock
canonical status
price / reference MC
change
volume
graduation
Stockback cue
age
```

Trending algorithm must be documented and deterministic enough to explain internally.

Do not visually imply paid placement unless paid placement actually exists and is labeled.

---

# 962. Market Heat Placement

Market Heat receives one premium full-width or near-full-width visual moment.

Purpose:

```text
show which xStock ecosystems are active
```

Possible signals:

- volume;
- active markets;
- velocity;
- near-grad count;
- buy/sell pressure;
- top mover.

Visual must remain interpretable.

No rainbow heatmap noise.

---

# 963. Near Graduation Section

Near Graduation is strategically important.

Each card should strongly show:

```text
current reference MC
graduation threshold
percentage complete
paired xStock
recent velocity
```

Use Volt Lime progression sparingly.

No jackpot/gambling animation.

---

# 964. New Launches

New Launches emphasizes:

```text
freshness
creator
pair
time since launch
initial activity
```

Do not over-rank extremely new markets purely because they are new.

---

# 965. Recently Graduated

Each item should communicate:

```text
GRADUATED
HyperSwap canonical venue
graduation time
continuous chart availability
post-grad activity
```

This is also proof that SENT markets have lifecycle continuity.

---

# 966. Top Volume / Top Gainers

These can use compact table/list presentation rather than another full card grid.

Purpose:

```text
fast scanning
```

Avoid visual repetition.

---

# 967. Stockback Homepage Section

Stockback explanation should answer quickly:

```text
What is it?
What asset do I earn?
Why does holding time matter?
When does it become claimable?
```

Recommended framing:

```text
Hold. Accrue. Claim xStock.
```

This line is `DEFAULT`, not an immutable slogan.

Clearly distinguish:

```text
Estimated
vs
Finalized / Claimable
```

---

# 968. Creator CTA Section

Creator CTA should communicate the economic model directly:

```text
Launch against an official xStock.
No creator liquidity.
0% creator token allocation.
Earn creator trading fees.
```

CTA:

```text
Launch a Market
```

Avoid hiding creator economics behind generic “Start building” copy.

---

# 969. Trust / How-It-Works Section

Compact lifecycle visualization:

```text
Launch
↓
Trade on SENT curve
↓
Stockback accrues
↓
Reach graduation
↓
HyperSwap
↓
LP principal remains locked
```

Use concise disclosure.

Link to deeper docs/details.

---

# 970. Homepage Footer

Footer includes:

- SENT symbol/name;
- product links;
- docs;
- contract/address registry;
- terms/privacy where applicable;
- status;
- social links;
- risk/disclosure links where required.

Do not overload with SEO keyword blocks.

---

# 971. Homepage Mobile Order — LOCKED

Mobile sequence remains:

```text
Nav
Hero
Live Market Pulse
Trending
Near Graduation
Market Heat simplified
New
Graduated
Stockback
Creator CTA
Trust
Footer
```

Market Heat may degrade from 3D/spatial to a performant 2D interactive visualization.

---

# 972. Homepage Performance Boundary

Core content must be usable if hero 3D fails or is disabled.

Priority:

```text
HTML/content
market data
navigation
cards
CTA
```

before advanced scene quality.

3D cannot block homepage discovery.

---

# 973. Trading Terminal Purpose — LOCKED

The terminal is the canonical product surface for a market.

Its jobs:

```text
understand
analyze
trade
verify
track lifecycle
track Stockback
```

The terminal must feel like a serious instrument.

---

# 974. Desktop Terminal Final Layout — LOCKED

Canonical wide desktop composition:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Market Header / Identity / Canonical Pair / Status / Core Metrics   │
├───────────────────────────────────────────────┬──────────────────────┤
│                                               │                      │
│                 CHART                         │     TRADE PANEL      │
│                                               │                      │
│                                               │                      │
├───────────────────────────────────────────────┼──────────────────────┤
│ Market Tabs / Activity / Trades / Holders     │ Lifecycle / Rewards  │
│                                               │ Market Details       │
└───────────────────────────────────────────────┴──────────────────────┘
```

Default primary column target:

```text
~68–74%
```

Trade-side column:

```text
~26–32%
```

Exact pixels adapt to viewport.

---

# 975. Terminal Header

Left cluster:

```text
token logo
ticker / name
official paired xStock
canonical verification
contract copy
creator
```

Center/right metrics:

```text
price
reference MC / live context
24h change
volume
holders
lifecycle state
```

Do not place every secondary statistic in the header.

---

# 976. Canonical Pair Presentation

The pair should be visually unmistakable:

```text
TOKEN / NVDAx
```

or equivalent canonical representation.

The official xStock identity must be clearly distinguished from token metadata.

Duplicate token ticker/name never overrides pair authenticity.

---

# 977. Terminal Chart — LOCKED

Chart owns the largest visual area.

Required top controls:

```text
1s
5s
1m
5m
15m
1h
4h
```

plus:

```text
Price / MC view where supported
Volume toggle
Expand
```

Do not show controls that are not implemented correctly.

---

# 978. Chart Lifecycle Continuity

Chart renders one continuous history across:

```text
PRE_GRAD
→ GRADUATING
→ GRADUATED
```

Graduation gets a non-obtrusive marker.

Venue change never resets the visible historical story.

---

# 979. Chart Venue Context

Visible but restrained state:

```text
SENT Curve
```

pre-grad.

After graduation:

```text
HyperSwap
```

with canonical venue address/detail accessible.

Unofficial pools do not become canonical chart authority.

---

# 980. Trade Panel Layout

Canonical order:

```text
Buy / Sell tabs
asset/amount input
balance
quick amount controls
quote / expected receive
price impact
core fee
Stockback contribution
slippage
allowance state if needed
primary CTA
route / venue context
```

No financial disclosure should appear only after pressing the final CTA.

---

# 981. Buy/Sell Default

Default mode may be:

```text
Buy
```

when opening a market with no prior user context.

Do not persist a surprising stale Sell mode across unrelated markets.

---

# 982. Quick Amount Controls

Allowed:

```text
25%
50%
75%
Max
```

for sell/balance-based interactions where semantics are correct.

For buy, optionally provide denomination-aware shortcuts.

Never let `Max` strand gas if the input asset is native gas asset.

---

# 983. Trade Review Boundary

Pressing Buy/Sell CTA does not immediately ask wallet to sign.

Flow:

```text
Trade form
↓
canonical quote
↓
Transaction Review
↓
Confirm
↓
wallet signing
```

Material quote changes force/recommend re-review according to locked transaction-intent rules.

---

# 984. Terminal Lower Tabs

Recommended:

```text
Activity
Trades
Holders
Stockback
About
```

Depending on width, lifecycle information may remain in right-side panels.

No redundant tabs for data already visible clearly above.

---

# 985. Recent Trades / Tape

Columns:

```text
time
side
price
amount TOKEN
amount xStock
wallet abbreviated
tx link
```

Realtime insertion should not jump scroll unexpectedly if user is inspecting historical rows.

---

# 986. Holder View

Holder table:

```text
wallet
balance
share
estimated Stockback where applicable
```

System/pool excluded-state rules must be represented correctly.

Do not suggest Estimated Stockback is finalized claimable reward.

---

# 987. Lifecycle Panel

Pre-grad:

```text
progress
current reference MC
graduation endpoint
remaining progress
status
```

Graduating:

```text
GRADUATING
migration/finalization status
no ambiguous trade CTA
```

Graduated:

```text
GRADUATED
canonical HyperSwap pool
LP-lock trust detail
graduation timestamp
```

---

# 988. Stockback Terminal Panel

Show:

```text
Estimated today
Finalized Claimable
Lifetime claimed
paired reward asset
epoch countdown/context
```

CTA:

```text
Claim
```

only for finalized entitlement.

Estimated amount must never share identical styling with Claimable.

---

# 989. Terminal Market Details

Include:

```text
token contract
creator
Factory verification
launch time
paired xStock contract
market contract
canonical venue
graduation data
social links
```

Copy controls must copy exact addresses.

---

# 990. Terminal Resizing

Desktop may allow limited:

```text
chart expansion
lower-panel collapse
trade-side collapse only when no transaction is active
```

Do not become a full workspace-builder.

Store only safe layout preference.

---

# 991. Terminal Mobile Layout — LOCKED

Canonical:

```text
Market Header
Core Price / Metrics
Chart
Lifecycle / Graduation strip
Stockback summary
Activity tabs
Sticky Buy / Sell
```

Tap Buy/Sell:

```text
bottom sheet / full-height trade panel
↓
review
↓
wallet
```

No horizontal scroll for primary financial content.

---

# 992. Mobile Chart Height

Chart should receive meaningful vertical space.

Reference initial viewport:

```text
~300–420px
```

depending on screen height.

Avoid tiny decorative chart cards.

---

# 993. Mobile Sticky Trading Bar

Bottom bar:

```text
[ Buy ] [ Sell ]
```

Must account for:

- safe area;
- wallet/browser chrome;
- keyboard;
- sheets.

Do not cover chart controls or alerts.

---

# 994. Creator Launch Flow Purpose — LOCKED

Creator flow should make a complex protocol feel simple while exposing every economically important fact.

Creator never supplies liquidity.

Creator receives no premine/allocation.

Creator identity is creator wallet.

---

# 995. Launch Flow Final Steps — LOCKED

Canonical guided sequence:

```text
STEP 1  Token
STEP 2  Pair
STEP 3  Identity / Social
STEP 4  Vanity
STEP 5  Preview
STEP 6  Review
STEP 7  Sign & Launch
STEP 8  Live
```

The UI may visually combine Steps 1–4 on sufficiently large screens if clarity remains.

The conceptual sequence may not be reordered in a way that hides pair/economics.

---

# 996. Step 1 — Token

Inputs:

```text
Token Name
Ticker
Logo
Description optional/limited
```

Show:

```text
Fixed supply: 1,000,000,000
Creator allocation: 0%
Platform allocation: 0%
```

These facts should not be buried.

---

# 997. Step 2 — Pair

Creator selects from canonical registry.

Presentation:

```text
NVDAx
SPYx
QQQx
...
```

Each choice shows:

- official/canonical indicator;
- basic asset identity;
- health/availability;
- any launch restriction state.

Unsupported arbitrary ERC20 input is not exposed.

---

# 998. Step 3 — Identity / Social

Optional metadata:

```text
website
X
Telegram/community if supported
```

Validate/sanitize URLs.

No arbitrary HTML.

Creator wallet identity shown separately from socials.

---

# 999. Step 4 — Vanity

Creator can:

- generate/search vanity salt;
- see predicted token address;
- understand address is creator-bound;
- regenerate safely;
- proceed without confusion.

The product should explain briefly:

```text
Your launch address is generated through SENT Factory.
The creator remains your connected wallet.
```

---

# 1000. Vanity UX Performance

Vanity generation must:

- avoid freezing UI;
- show progress/state;
- stop/cancel safely;
- respect device capability;
- offer reasonable defaults.

Do not chase vanity complexity that blocks launch.

---

# 1001. Step 5 — Preview

Preview has two modes:

```text
Explore Card
Market Page
```

Show only data knowable before launch.

Allowed:

- identity;
- pair;
- creator;
- predicted address;
- fixed economics;
- visual presentation.

Do not invent:

- volume;
- holders;
- price change;
- Stockback accrued.

---

# 1002. Preview Experience

Preview is an Experience Mode highlight.

It may use:

- responsive transitions;
- live field updates;
- SENT brand scene;
- polished card morphing.

As user approaches Review, animation intensity decreases.

---

# 1003. Step 6 — Review

Review is financial/legal clarity surface.

Show:

```text
creator wallet
token name/ticker
predicted address
official xStock pair
fixed supply
creator allocation 0%
platform allocation 0%
starting reference MC target
graduation reference MC target
creator fee entitlement
launch fee
estimated network gas
Stockback economics
Factory address
```

No cinematic motion.

---

# 1004. Creator Fee Copy

Recommended concise wording:

```text
Creator fees
You receive 65% of the creator-eligible core trading fee revenue according to SENT protocol rules.
```

Post-grad explanation must reflect actual eligible fee flow and assets.

Do not imply guaranteed income.

---

# 1005. Step 7 — Sign & Launch

Flow:

```text
review frozen
↓
wallet request
↓
pending
↓
confirmed
↓
indexing/realtime reconciliation
↓
Live
```

If wallet rejects:

- return to review;
- preserve form;
- do not lose vanity selection.

---

# 1006. Launch Success

Success screen:

```text
SENT symbol / restrained completion motion
Token live
contract address
paired xStock
Open Market
Share
```

No confetti.

No fake celebration price movement.

---

# 1007. Step 8 — Live

Primary CTA:

```text
Open Market
```

Secondary:

```text
Share
Launch Another
Creator Dashboard
```

New market should appear through the same realtime/indexing path as other users see.

No creator-only optimistic fake state.

---

# 1008. Launch Flow Recovery

Persist draft safely where appropriate.

Recover:

- token metadata;
- socials;
- selected pair;
- vanity intent;
- preview config.

Never persist wallet signature or sensitive key material.

After account/chain change:

- invalidate review;
- rebind creator-dependent vanity prediction;
- require fresh review.

---

# 1009. Launch Flow Mobile

Mobile uses one major step at a time.

Keep:

```text
step progress
Back
Continue
```

sticky only when it does not obscure form.

Preview can open as dedicated full-screen state.

Review must remain fully readable before wallet signing.

---

# 1010. Product Copy System — V1

Copy exists in four layers:

```text
Brand
Navigation
Financial / transactional
System / error
```

Each has different tolerance for personality.

---

# 1011. Brand Copy

Allowed:

```text
short
confident
memorable
slightly provocative
```

Examples:

```text
Markets, sent differently.
Launch against something real.
From launch to market.
```

These examples are `DEFAULT`, not immutable slogans.

---

# 1012. Navigation Copy

Navigation should be literal.

Use:

```text
Explore
Launch
Stockback
Portfolio
Roadmap
```

Avoid clever labels that make users decode navigation.

---

# 1013. Transactional Copy

Transactional copy is maximally clear.

Use:

```text
Buy
Sell
Review transaction
Confirm
Approve NVDAx
Claim
```

Do not use branded slang for irreversible actions.

Never rename `Sell` to something like `Send it`.

---

# 1014. System Copy

System copy states:

```text
what happened
what remains safe/available
what user can do next
```

Example:

```text
Quote expired

Market state changed before signing.
Review the updated amounts before continuing.
```

Not:

```text
Oops, looks like the market moved!
```

---

# 1015. Status Vocabulary — LOCKED

Canonical lifecycle:

```text
PRE-GRAD
GRADUATING
GRADUATED
```

Canonical dependency/health terms preserve existing masterplan enums.

Do not invent synonymous lifecycle labels in different screens.

---

# 1016. Stockback Vocabulary — LOCKED

Use:

```text
Estimated
Finalized
Claimable
Claimed
Epoch
Stockback
```

Do not call Estimated:

```text
Earned
Guaranteed
Available
```

until finalized semantics make that true.

---

# 1017. Wallet Copy

Clear action taxonomy:

```text
Connect wallet
Switch network
Approve [asset]
Review transaction
Sign message
Submit transaction
```

Do not blur message signatures and transactions.

---

# 1018. Creator Copy

Creator-facing copy emphasizes:

```text
no supplied liquidity
0% token allocation
creator fee entitlement
official xStock pair
creator wallet identity
```

Do not overpromise:

```text
passive income
guaranteed fees
instant success
```

---

# 1019. Copy QA

Every critical copy string reviewed for:

- accuracy;
- consistency;
- economic meaning;
- transaction meaning;
- legal-sensitive claims;
- tone;
- localization-readiness if added later.

Financial copy correctness outranks cleverness.

---

# 1020. Social Brand Kit — Required

Before public launch prepare:

```text
X PFP
X header
OpenGraph base template
market OG template
launch announcement
graduation announcement
Stockback educational card
maintenance/status template
partnership template
```

All derive from canonical vector logo and SENT design tokens.

---

# 1021. X PFP — LOCKED DIRECTION

```text
1:1
dark near-black background
large flat SENT symbol
Volt Lime #C6F600
no text
safe circular crop
```

Minimal.

No realistic 3D.

No gradient dependency.

---

# 1022. X Header — DEFAULT COMPOSITION

Recommended:

```text
large negative space
paired-market geometry / Trace
small SENT identity
optional:
Markets, sent differently.
```

Do not turn header into a feature checklist.

---

# 1023. Social Announcement Template

Hierarchy:

```text
event
market identity
paired xStock
one core metric/state
SENT symbol
```

Examples:

```text
NEW MARKET
GRADUATED
STOCKBACK FINALIZED
```

Use Volt Lime as structural accent, not full background.

---

# 1024. Market Share Card

Dynamic share card may include:

```text
TOKEN / xStock
price / reference MC
change
graduation %
canonical status
sent.market
```

Never display stale values without timestamp/state if generated dynamically.

---

# 1025. Graduation Social Card

Should communicate:

```text
TOKEN / xStock
GRADUATED
HyperSwap
timestamp
```

Potential subtle SENT Trace completion.

No confetti/jackpot design.

---

# 1026. Social Visual Consistency

Social assets may be more expressive than Trading Mode.

They must still preserve:

```text
dark base
Volt Lime restraint
same typography
same geometry
same logo
```

No campaign-specific redesign of SENT identity.

---

# 1027. Final Implementation Milestone Sequence — LOCKED DEPENDENCY ORDER

The previous build dependency order remains valid and is refined into execution milestones:

```text
M0  Masterplan comprehension / requirements map
M1  External verification + production assumptions
M2  Executable economics / Stockback / V3 simulation
M3  Core contract primitives
M4  LaunchMarket / Factory / graduation contracts
M5  Contract invariants / fuzz / integration
M6  HyperSwap + xStock fork/integration proof
M7  Indexer / normalized event model / reorg logic
M8  Stockback TWAB / attestors / proof service
M9  SDK / TransactionIntent / bot interfaces
M10 API / WebSocket / realtime state
M11 SENT tokens / brand assets / UI primitives
M12 Homepage / Explore
M13 Trading Terminal / trade flow
M14 Creator Launch / Preview / Control Center
M15 Account / Portfolio / Stockback claim UX
M16 Operator Console
M17 Experience Mode motion / 3D / premium polish
M18 Full E2E / mobile / accessibility / performance
M19 Infrastructure / production security rehearsal
M20 External security audit / remediation
M21 Mainnet deployment ceremony
M22 Controlled public launch / monitoring
```

Dependency order may not be inverted merely to produce attractive screenshots earlier.

---

# 1028. Milestone 0 — Agent Comprehension

Before major production code:

Agent delivers:

```text
masterplan version
subsystem map
LOCKED list
VERIFY list
CHOOSE list
requirements traceability
blocking contradictions
repo plan
milestone plan
```

No silent reinterpretation.

---

# 1029. Milestone 1 — External Verification

Must complete/track:

- HyperEVM chain config;
- xStock canonical assets;
- decimals/multiplier behavior;
- halt/corporate action semantics;
- HyperSwap contracts/capabilities;
- V3 geometry;
- delegated LP lock;
- Safe production support/addresses;
- RPC/WebSocket;
- reference feeds;
- explorer.

Unverified external assumptions remain visibly tracked.

---

# 1030. Milestone 2 — Economic Proof

Executable simulation must prove:

- curve;
- buy/sell;
- fee separation;
- Stockback;
- TWAB conservation;
- xStock normalization;
- graduation;
- exact V3 geometry;
- dust;
- crossing trades;
- solvency.

Do not proceed to final LaunchMarket implementation with unexplained economics.

---

# 1031. Milestones 3–6 — Protocol Core

Order remains:

```text
LaunchToken
Registry / Adapter
FeeVault
HolderRewardVault
Stockback primitives
Curve
LaunchMarket
Factory
GraduationRouter
ReferencePriceAdapter
```

Then:

```text
unit
fuzz
invariant
fork
adversarial
```

before treating contract behavior as stable.

---

# 1032. Milestones 7–10 — Data / Integration Core

Build:

```text
indexer
Postgres projection
Redis realtime
TWAB engine
attestation pipeline
proof API
SDK
TransactionIntent
API
WebSocket
```

Frontend financial state should consume these canonical interfaces rather than inventing logic.

---

# 1033. Milestone 11 — SENT Foundation

Before route polish:

```text
final logo vector
design tokens
fonts
icons
component catalog
shared primitives
motion tokens
chart tokens
responsive primitives
```

No page-specific design experimentation may bypass this foundation.

---

# 1034. Milestone 12 — Homepage / Explore

Definition of Done:

- canonical section order;
- realtime market data;
- search/filter;
- xStock discovery;
- Market Heat;
- no-wallet browsing;
- mobile;
- stale/reconnect states;
- SENT visual identity;
- performance fallback.

Advanced 3D can still be refined later in M17.

---

# 1035. Milestone 13 — Terminal

Definition of Done:

- chart continuity;
- canonical venue;
- Buy/Sell;
- TransactionIntent;
- review;
- wallet;
- fees;
- Stockback;
- lifecycle;
- activity;
- mobile;
- realtime reconnect.

Visual polish cannot hide transaction correctness failures.

---

# 1036. Milestone 14 — Creator

Definition of Done:

- full guided launch;
- canonical pair registry;
- vanity;
- preview;
- economics review;
- creator identity;
- signing;
- live reconciliation;
- Control Center;
- creator fee claim.

---

# 1037. Milestone 15 — Account / Rewards

Definition of Done:

- portfolio;
- transaction history;
- creator earnings;
- Stockback Estimated/Finalized/Claimable;
- proof retrieval;
- claim;
- reconnect/reload.

---

# 1038. Milestone 16 — Operator Console

Read-first operational console:

- protocol health;
- indexer;
- Treasury;
- Safe proposals;
- attestors;
- relayer;
- dependencies;
- alerts.

No multisig bypass.

---

# 1039. Milestone 17 — Premium Motion / Spatial Pass

Only after core product surfaces work.

Implement/refine:

- hero scene;
- Market Heat;
- SENT Trace;
- logo choreography;
- graduation moment;
- creator preview motion;
- ambient spatial layers.

Do not change financial behavior during polish.

---

# 1040. Milestone 18 — Full Quality Pass

Required:

```text
Playwright E2E
visual regression
accessibility
reduced motion
responsive
cross-browser
wallet matrix
mobile
hardware wallet
performance
realtime reconnect
RPC failover
error states
```

No known critical UX state left unstyled.

---

# 1041. Milestone 19 — Production Security

Rehearse:

- GitHub compromise;
- CI compromise;
- DNS;
- cloud;
- DB;
- relayer;
- attestor;
- signer loss;
- frontend config drift.

Complete production access matrix.

---

# 1042. Milestone 20 — Independent Security Review

External review scope includes:

- contracts;
- economic invariants;
- graduation;
- LP lock;
- Stockback;
- admin roles;
- transaction builder;
- key architecture where appropriate.

Findings remediated and retested.

---

# 1043. Milestone 21 — Mainnet Ceremony

Use previously locked deployment ceremony.

No production deploy based solely on:

```text
works locally
```

Need verified manifest, roles, addresses, source, configuration, monitoring.

---

# 1044. Milestone 22 — Controlled Launch

Recommended:

```text
limited announcement
↓
observe
↓
validate live invariants
↓
broader launch
```

Exact go-to-market sequence is a business `CHOOSE`.

Protocol correctness requirements remain unchanged.

---

# 1045. Build Agent Progress Format

At the end of each milestone, agent should report:

```text
COMPLETED
TESTS
VERIFY RESOLVED
VERIFY OPEN
DEVIATIONS
RISKS
NEXT MILESTONE
```

No “done” claim without proof/tests appropriate to that milestone.

---

# 1046. No Parallel Chaos Rule

Parallel agents may work concurrently only when subsystem boundaries are explicit.

Examples:

```text
contract tests
frontend primitives
indexer infrastructure
```

may parallelize after interfaces are agreed.

Do not let separate agents independently implement:

```text
fee math
TransactionIntent
creator identity
Stockback entitlement
```

in incompatible ways.

---

# 1047. Interface Freeze Rule

Before frontend/SDK/backend parallelization:

freeze/version:

```text
contract ABI
event schema
normalized market state
TransactionIntent schema
WebSocket envelope
critical API models
```

Changes require coordinated migration.

---

# 1048. Product Surface Acceptance Gate

Homepage, Terminal, and Creator Launch cannot be marked done individually based only on screenshots.

Each requires:

```text
correct data
correct state
correct failure handling
responsive layout
accessible controls
brand consistency
performance
realtime behavior
transaction integrity where applicable
```

---

# 1049. Final Design-Planning Boundary

After this section, design/product architecture should not keep expanding speculatively.

New requirements should be added only if:

- implementation discovers a real gap;
- external verification changes an assumption;
- testing exposes a usability/safety issue;
- product owner explicitly changes scope.

Default next action:

> **implement the approved system.**

---

# 1050. Final Handoff Snapshot — V1

The implementation agent now has explicit direction for:

```text
WHAT
product / economics / lifecycle

HOW MONEY MOVES
fees / Stockback / Treasury / creator / founder

WHO CONTROLS WHAT
wallets / Safe / keys / roles

HOW IT RUNS
contracts / indexer / API / realtime / infra

HOW USERS ACT
wallet / trading / creator launch / claims

HOW IT LOOKS
SENT / logo direction / Volt Lime / typography / components

HOW IT MOVES
Experience Mode / Trading Mode / motion laws

HOW PRIMARY SCREENS ARE COMPOSED
Homepage / Terminal / Creator Launch

HOW IT IS BUILT
milestone dependency sequence

HOW IT SHIPS
tests / security / audit / deployment / release gates
```

---

---

# 1051. Seven-Day Mainnet Execution Mandate — CRITICAL LOCK

SENT V1 is required to reach a production-ready mainnet launch candidate within:

```text
7 CALENDAR DAYS
```

from implementation kickoff.

This is a **mandatory execution constraint**, not a casual estimate.

The implementation strategy, agent topology, milestone sizing, tooling, review flow, and parallelism must all be optimized around this seven-day deadline.

---

# 1052. Definition of "Finished in Seven Days"

By the end of Day 7, the project target is:

```text
core product implemented
+
critical integrations verified
+
contracts tested
+
frontend/backend/realtime operational
+
SENT brand/design system implemented
+
creator/trader flows functional
+
security review completed to the required launch bar
+
production infrastructure ready
+
mainnet deployment completed or immediately deployable
+
controlled on-chain validation completed
+
public launch ready if all P0 gates PASS
```

Cosmetic or non-critical maintenance may continue after launch.

Core financial/security correctness may not be deferred as "post-launch maintenance".

---

# 1053. No Public Testnet Phase — LOCKED

V1 does not require a prolonged public testnet campaign.

The preferred validation path is:

```text
LOCAL TESTING
↓
HYPEREVM / HYPERSWAP FORK TESTING
↓
DETERMINISTIC SIMULATION
↓
ADVERSARIAL / SECURITY REVIEW
↓
DEPLOYMENT REHEARSAL
↓
MAINNET DEPLOYMENT
↓
CONTROLLED MAINNET CANARY TRANSACTIONS
↓
PUBLIC OPENING
```

This removes unnecessary calendar delay while preserving technical proof.

---

# 1054. "No Testnet" Does Not Mean "No Testing"

The seven-day deadline may NOT be interpreted as permission to skip:

- unit tests;
- Foundry fuzz tests;
- invariants;
- fork tests;
- economic simulations;
- V3 graduation math verification;
- xStock normalization tests;
- Stockback conservation tests;
- reorg/reconnect tests;
- transaction-intent tests;
- frontend E2E;
- deployment rehearsal;
- security review.

The schedule is compressed through **parallel execution and automation**, not by deleting correctness work.

---

# 1055. Seven-Day Priority Rule

When schedule pressure exists:

```text
P0 SECURITY / FINANCIAL CORRECTNESS
>
CORE PRODUCT FUNCTION
>
REALTIME RELIABILITY
>
TRANSACTION SAFETY
>
PREMIUM UX
>
COSMETIC POLISH
```

However the SENT premium visual quality bar remains required for launch.

Only non-critical micro-polish may move to immediate post-launch maintenance.

---

# 1056. Seven-Day Day-by-Day Target

## Day 1 — Verification + Foundations

Target:

```text
masterplan comprehension complete
external VERIFY ledger opened
HyperEVM/xStock/HyperSwap dependencies verified
economics executable
Stockback model executable
V3 graduation geometry proven or blocking issue surfaced
repo/interfaces frozen
SENT brand tokens/logo vector work started
```

P0 blocker discovery must happen as early as possible.

---

# 1057. Day 2 — Protocol Core

Target:

```text
LaunchToken
XStockRegistry
XStockAssetAdapter
FeeVault
HolderRewardVault
Stockback primitives
curve library
LaunchMarket core
```

Parallel agents may handle isolated modules after interfaces are agreed.

Mandatory:

```text
unit tests
fuzz tests
core invariants
```

begin immediately alongside implementation.

---

# 1058. Day 3 — Factory / Graduation / Security Proof

Target:

```text
LaunchpadFactory
CREATE2 creator-bound launch
GraduationRouter
ReferencePriceAdapter
HyperSwap integration
LP permanent-lock path
crossing trade behavior
full contract invariant suite
fork/integration proof
```

Stockback attestation/proof pipeline should also be running in parallel.

---

# 1059. Day 4 — Data / Realtime / SDK

Target:

```text
reorg-safe indexer
PostgreSQL projections
Redis/realtime coordination
WebSocket service
API
SDK
TransactionIntent
Stockback TWAB engine
proof service
attestor pipeline
```

Frontend-critical schemas should be frozen by the end of Day 4.

---

# 1060. Day 5 — Product Surfaces

Target:

```text
Homepage / Explore
Trading Terminal
trade flow
wallet integration
Creator Launch Flow
Preview
Account / Portfolio
Stockback claim UX
Creator Control Center
```

All critical screens must use the SENT design system.

Do not postpone integration until after visual implementation.

---

# 1061. Day 6 — Full Integration + Premium Pass

Target:

```text
full lifecycle E2E
mobile/responsive
reconnect/reorg states
error/loading/stale states
SENT motion / 3D
visual regression
performance
accessibility
operator console
production infrastructure
deployment rehearsal
```

Independent security/audit review should already be running in parallel before Day 6 where possible.

---

# 1062. Day 7 — Remediation / Mainnet / Controlled Opening

Target:

```text
close critical audit/security findings
freeze production config
deployment ceremony
mainnet deployment
source verification
role handoff
Treasury/Guardian/attestor verification
controlled real on-chain validation
monitoring verification
GO / NO-GO
public opening if GO
```

Day 7 is not reserved for first-time integration work.

---

# 1063. Parallel Agent Architecture — REQUIRED

The seven-day target assumes aggressive but controlled parallelism.

Recommended workstreams:

```text
STREAM A
Contracts / economics

STREAM B
Stockback / TWAB / proof pipeline

STREAM C
Indexer / API / realtime

STREAM D
SDK / TransactionIntent / wallet integration

STREAM E
SENT design system / frontend primitives

STREAM F
Homepage / Explore / Terminal

STREAM G
Creator / Account / Stockback UX

STREAM H
Infrastructure / CI / observability / ops

STREAM I
Security review / tests / adversarial analysis
```

Shared interfaces must be frozen before multiple streams depend on them.

---

# 1064. Parallelism Safety Rule

Parallel execution is encouraged.

Parallel ownership of canonical financial logic is not.

Only one canonical implementation/source exists for:

- curve math;
- fee math;
- Stockback accounting;
- creator identity;
- TransactionIntent;
- xStock normalization;
- graduation math;
- contract ABIs/events;
- production address config.

Other agents consume these interfaces.

They do not recreate them independently.

---

# 1065. Continuous Integration From Hour One

No "integration day at the end".

Every merged unit must continuously run:

```text
compile
typecheck
unit tests
contract tests
lint
schema checks
relevant integration tests
```

As milestones become available, CI expands to:

```text
fork tests
Playwright
visual regression
performance
security/static checks
```

Broken main blocks downstream parallel work and must be fixed immediately.

---

# 1066. Continuous Adversarial Review

Security review is not delayed until the product is complete.

From Day 2 onward, continuously review:

- privileged functions;
- withdrawal paths;
- accounting invariants;
- reentrancy;
- rounding;
- graduation;
- CREATE2;
- signature domains;
- Stockback claims;
- relayer/attestor boundaries;
- transaction builder.

This reduces Day-7 audit surprise.

---

# 1067. External Audit Compression Strategy

If using an external auditor/reviewer:

```text
send frozen modules incrementally
↓
review in parallel
↓
fix findings immediately
↓
final review of integrated commit
```

Do not wait until Day 6 to first contact the reviewer.

The seven-day requirement should be communicated to the reviewer before kickoff.

---

# 1068. Audit Deadline Reality Rule

The seven-day product deadline is mandatory for the build team.

However:

> A missing external auditor response cannot be converted into a false "audit passed" claim.

If external review timing is outside the team's control:

- internal implementation still finishes within seven days;
- automated/adversarial proof continues;
- launch remains subject to the required P0 security gate.

Never fabricate audit completion to satisfy calendar reporting.

---

# 1069. Mainnet Canary — REQUIRED

Because there is no prolonged public testnet phase, mainnet opening must use controlled validation.

After deployment, perform tiny-value production transactions covering critical paths such as:

```text
launch
buy
sell
fee routing
creator claim
Stockback funding
root / commitment path
claim where epoch mechanics permit
routing / lifecycle reads
indexer/realtime ingestion
frontend transaction intent
```

Graduation must be proven by fork/integration testing before deployment and validated live when feasible without manufacturing unsafe economics.

---

# 1070. Mainnet Canary Restrictions

Canary transactions must:

- use minimal sensible economic value;
- use approved operator/test wallets;
- never use user funds;
- never bypass canonical contracts;
- never rely on hidden admin state manipulation;
- remain visible/auditable on-chain.

Do not artificially rewrite protocol state merely to create a successful demo.

---

# 1071. Public Opening Gate

Public opening can happen on Day 7 only when:

```text
all P0 launch blockers PASS
no unresolved Critical security issue
no unexplained accounting mismatch
no unverified production-critical external dependency
production addresses verified
wallet/role wiring verified
monitoring live
frontend points to canonical production contracts
controlled mainnet validation passes
```

This gate remains stronger than the deadline.

---

# 1072. Deadline vs Safety — LOCKED

Canonical rule:

> **The team is obligated to finish within seven days; the protocol is not obligated to accept unsafe code merely to satisfy the calendar.**

Therefore:

- schedule pressure forces earlier parallelism;
- schedule pressure forces smaller milestones;
- schedule pressure forces faster review loops;
- schedule pressure does NOT authorize unsafe deployment.

---

# 1073. What May Remain as Post-Launch Maintenance

Acceptable immediate post-launch maintenance:

- tiny spacing adjustments;
- secondary motion tuning;
- non-critical copy refinement;
- low-priority analytics;
- non-critical social assets;
- minor internal operator UX;
- performance micro-optimizations after baseline passes;
- visual polish on secondary routes.

These must not materially alter locked product behavior.

---

# 1074. What May NOT Be Deferred

Forbidden "we'll fix after launch" categories:

```text
curve solvency
fee accounting
Stockback solvency
creator fee correctness
xStock canonical verification
graduation safety
LP permanent lock
creator identity
Treasury routing
permission boundaries
wallet transaction integrity
claim correctness
double-spend prevention
production contract addresses
critical monitoring
critical mobile trade usability
```

Any unresolved item above is a NO-GO.

---

# 1075. Daily Progress Reporting — REQUIRED

At least once per day during the seven-day sprint, implementation lead/agent reports:

```text
DAY X / 7

COMPLETED
IN PROGRESS
P0 BLOCKERS
VERIFY OPEN
AUDIT FINDINGS
TEST STATUS
MAINNET READINESS %
NEXT 24 HOURS
```

Do not use readiness percentage as a substitute for explicit blocker reporting.

---

# 1076. Hour-Level Escalation

Any issue that could threaten:

- curve correctness;
- funds;
- graduation;
- Stockback;
- xStock integration;
- production deployment;
- audit completion;
- frontend transaction integrity;

must be escalated immediately.

Do not wait for end-of-day reporting.

---

# 1077. Scope Freeze Under Seven-Day Mandate

Once implementation starts:

```text
NO NEW SPECULATIVE FEATURES
```

unless needed to correct:

- security;
- correctness;
- critical usability;
- verified external integration.

New nice-to-have ideas go into post-launch backlog.

The seven-day sprint executes the frozen V1.

---

# 1078. Decision Latency Rule

Product/engineering decisions that block implementation must be resolved rapidly.

Target:

```text
P0 decision
→ same working session where possible

non-P0 decision
→ use documented DEFAULT / CHOOSE rule
```

Do not stall work waiting for aesthetic micro-decisions already covered by the design system.

---

# 1079. Tooling / Agent Autonomy

Agents are expected to:

- run tests autonomously;
- inspect logs;
- fix failed builds;
- compare against masterplan;
- verify official documentation for VERIFY items;
- maintain milestone progress;
- surface material deviations.

They should not stop for approval on ordinary `CHOOSE` implementation details already delegated by the masterplan.

They must stop/escalate for changes to `LOCKED` behavior.

---

# 1080. Seven-Day Definition of Done

At seven-day completion, SENT should be:

```text
functionally complete
economically proven
security-reviewed
production-configured
mainnet-deployed or deployment-ready
realtime
responsive
premium
creator-ready
trader-ready
operationally observable
```

Not merely:

```text
a frontend prototype
a contract demo
a staging-only app
```

---

# 1081. Seven-Day Handoff Instruction for Coding Agents

Every coding agent must understand:

> **Speed is a first-class requirement. Do not gold-plate non-critical abstractions. Use the approved stack, reuse canonical primitives, parallelize independent work, continuously integrate, continuously test, and move directly toward production.**

But:

> **Never trade away financial correctness, security boundaries, transaction integrity, or P0 release gates for speed.**

---

# 1082. Final Seven-Day Lock

Canonical V1 delivery constraint:

```text
IMPLEMENTATION WINDOW
7 calendar days

PUBLIC TESTNET CAMPAIGN
not required

VALIDATION
local + deterministic simulation + fork + E2E + adversarial review

AUDIT / SECURITY
parallelized during build

MAINNET
Day 7 target

PUBLIC OPENING
Day 7 target if P0 = PASS

POST-LAUNCH
minor maintenance / polish only
```

---

**SEVEN-DAY MAINNET EXECUTION MANDATE: V1 LOCKED AND CRITICAL.**

**MASTERPLAN STATUS: V1 PRODUCT-AND-ENGINEERING SPECIFICATION FREEZE READY — SEVEN-DAY DELIVERY / MAJOR PRODUCT / ECONOMIC / SECURITY / WALLET / INFRASTRUCTURE / BRAND / DESIGN / PRIMARY UX / EXECUTION ARCHITECTURE LOCKED — FINAL LOGO VECTOR / EXTERNAL VERIFY / IMPLEMENT / TEST / AUDIT / MAINNET / RELEASE GATES REMAIN.**
