# SENT — External Verification Ledger

**Authority:** Masterplan §126 (Phase 0 gate), §143 (Known Unknowns template), §421 (DO NOT GUESS),
§420 (xStock availability rule), §1029 (Milestone 1).

**Rule:** no row may be silently assumed. A row is either `VERIFIED` with a cited authoritative
source, `PARTIAL`, or `BLOCKED` and escalated. Nothing in production may depend on an
`UNVERIFIED` row.

**Evidence classes**

| Class | Meaning |
|---|---|
| **PRIMARY** | read directly from chain via RPC, or from the protocol's own deployed bytecode |
| **OFFICIAL** | first-party documentation of the protocol in question |
| **SECONDARY** | press, aggregators, third-party docs — a lead, never a basis for production |

> Addresses discovered through SECONDARY sources were **not trusted**; they were used only as
> candidates to probe on-chain, and are recorded below with the PRIMARY read that confirmed
> what they actually are.

Last updated: Day 8.

---

## Status summary

| Status | Count | Rows |
|---|---|---|
| VERIFIED | 9 | V-01, V-03, V-05, V-07, V-08, V-09, V-13, V-16, V-20 |
| PARTIAL | 4 | V-02, V-06, V-10, V-15 |
| UNVERIFIED | 5 | V-04, V-11, V-12, V-14, V-17 |
| OWNER-BLOCKED | 1 | V-18 |
| CLOSED | 1 | V-19 |

**P0 rows still open: V-02.** And it is now a product question rather than an engineering one.

V-03 and V-05 are VERIFIED in the uncomfortable sense: they were answered, and the answers
disqualify the only xStock that exists on HyperEVM. SPYx rebases, is pausable, and sits behind
an upgradeable proxy with an EOA minter. V-02 found it and simultaneously found that no first
party lists HyperEVM as a supported chain at all.

**Day 8 movement.** V-08 and V-09 closed together, against the real HyperSwap deployment
rather than against a mock — see `contracts/test/fork/HyperSwapFork.t.sol`. V-06 located its
last missing address by on-chain measurement but stays PARTIAL, because locating an address
and having its vendor confirm it are different claims and only the second one clears this row.

V-20 is new, and it is the uncomfortable kind of VERIFIED: what was verified is a constraint
the masterplan does not account for anywhere in its 28,051 lines. Graduation costs 5.40M gas;
HyperEVM's default block lane caps at 3.00M. The response is D-016.

V-19 closed as a side effect of that response rather than by being solved on its own terms —
the split removed the leg the bound could not cover. Recorded as such in the row, because a
row that closes by accident should not read as a row that was worked.

---

## V-01 — HyperEVM chain identity and liveness · **VERIFIED**

```text
UNKNOWN:            HyperEVM mainnet chain id, RPC reachability, head liveness, gas token
WHY IT MATTERS:     every contract, the indexer, the SDK and all wallet UX bind to the chain id
CURRENT ASSUMPTION: (none needed — measured)
HOW TO VERIFY:      eth_chainId + eth_blockNumber against the public RPC
BLOCKS:             everything
OWNER:              Stream A / H
STATUS:             VERIFIED (PRIMARY)
```

**Result, Day 1:**

```text
endpoint      https://rpc.hyperliquid.xyz/evm
eth_chainId   0x3e7  = 999
eth_blockNumber observed 0x2ab7085 = 44,789,893 (chain live and advancing)
gas token     HYPE
wrapped native (WHYPE) 0x5555555555555555555555555555555555555555
```

`chainId = 999` is now a frozen constant in `packages/config` and is bound into the Stockback
attestation domain (§405) and every EIP-712 domain.

---

## V-02 — Canonical HyperEVM xStock representations + exact addresses · **PARTIAL · P0**

```text
UNKNOWN:            which xStock assets have a canonical, verified ERC-20 representation on
                    HyperEVM, and at what exact addresses
WHY IT MATTERS:     LOCKED core pairing (§2). Without at least one qualifying asset the product
                    has no quote substrate. §420 forbids inferring availability from the global
                    xStocks catalog; §421 forbids guessing an address.
CURRENT ASSUMPTION: none permitted
HOW TO VERIFY:      1. obtain the HIP-1 spot token indices for the xStock assets from HyperCore
                    2. derive each system address (see V-03) and read the linked ERC-20 via
                       the spot-deployer's finalized requestEvmContract linkage
                    3. read name/symbol/decimals/totalSupply on-chain
                    4. confirm against first-party xStocks/Hyperliquid publication
BLOCKS:             XStockRegistry, every market, launch flow, the entire product
OWNER:              Stream A
STATUS:             PARTIAL — one genuine xStock LOCATED on HyperEVM and read on-chain;
                    canonicity for this chain is contradicted by first-party sources
```

**Day 1 findings (context, not resolution):** xStocks launched tokenized US equities on
Hyperliquid — initially NVDAx, SPYx, QQQx, SKHYx, MUx — as **HyperCore spot markets** quoted
against USDC, bridged via Chainlink CCIP. Press describes them as composable on HyperEVM. That
is a SECONDARY lead. It does **not** establish a canonical ERC-20 address, and no address will be
written into `packages/config` until read from chain.

---

**Day 8 (PRIMARY): one xStock found, by measurement.**

Not by guessing an address. HyperSwap's `NonfungiblePositionManager` was sampled for the token
pairs its 177,889 positions actually hold — 500 of the most recent positions, 433 unique
tokens — and the list was filtered for equity-shaped names. Exactly one hit:

```text
SP500 xStock   SPYx    0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48   18 dec
  totalSupply      14,496.95 units
  implementation   0xd865ce1b07540b5ede20e8298f48da69770fe22e
                   name() -> "Backed Token Implementation"  (EIP-1967 proxy)
  minter()         0x0a934bc9c64309c9654451f23d8331c2dad34c2a   (an EOA)
  owner()          0x49754062e35f7591b93cc4f9915965be89643a65   (a 171-byte contract)
  isPaused()       false

Wrapped SP500 xStock   wSPYx   0xe7e553cd128f0011777323a0b44a7b96ea1cb540   18 dec
  asset()          -> SPYx        an ERC-4626 wrapper over it
  convertToAssets(1e18) -> 1.0057145603      NOT one-to-one
```

The implementation is Backed Finance's own. This is the real issuer's code, not a lookalike.

**But canonicity for THIS chain is contradicted by the first party.** `xstocks.com` lists the
supported chains as Ethereum, Solana, BNB Smart Chain, Mantle, TON and Ink; `docs.xstocks.fi`
lists Ethereum, Solana, Arbitrum, Mantle, TON, Ink "and other EVM-compatible networks".
**Neither names HyperEVM.** So what is on HyperEVM is genuine Backed code at an address no
first party has published for this chain, which is precisely the situation §420 was written
against: *"Do not infer availability from the global xStocks product catalog."*

**And it is the only one.** 433 unique tokens across the sampled positions, and no NVDAx,
TSLAx, AAPLx or anything else. Whatever else is true, the HyperEVM xStock universe is one
asset with 14,497 units outstanding and a single thin pool — which is a product question
(§420's "at least one qualifying asset") before it is a verification one.

**This row stays PARTIAL, and the blocker has moved rather than shrunk.** The address is no
longer unknown; what is unknown is whether Backed considers this deployment canonical, who
controls the EOA that can mint it, and whether it is intended to exist on this chain at all.
Only a first party can answer those, and §421 forbids proceeding without.

---

## V-03 — xStock decimals, wrapper / multiplier / share semantics · **VERIFIED · P0**

```text
UNKNOWN:            exact decimals on the EVM side, and the Core<->EVM decimal offset
WHY IT MATTERS:     XStockAssetAdapter normalizes every quote amount to 18 decimals before curve
                    and fee math (§399, §400). A wrong offset silently corrupts all economics.
CURRENT ASSUMPTION: none permitted
HOW TO VERIFY:      read decimals() on the linked ERC-20; read the token's weiDecimals and
                    evmExtraWeiDecimals from HyperCore spot metadata
BLOCKS:             XStockAssetAdapter, curve accounting, Stockback funding
OWNER:              Stream A
STATUS:             VERIFIED (PRIMARY), Day 8 — and the answer disqualifies the asset
```

**Answered, and it is the answer nobody wanted.**

The only xStock on HyperEVM (V-02) has multiplier semantics of the most dangerous kind. Read
directly from `SPYx` at `0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48`:

```text
multiplier()            1005714560286254000   =  1.0057145603
sharesOf(address)       present
getCurrentMultiplier()  present in the implementation bytecode
decimals()              18
```

`balanceOf` is `sharesOf × multiplier`. **SPYx rebases**, and its multiplier has already left
1.0 — this is not a dormant capability, it has fired at least once.

xStocks' own documentation says why, and says it plainly: corporate actions such as *"dividends,
stock splits, and reverse splits are reflected through an onchain rebasing mechanism"* so that
*"token balances always reflect a 1:1 exposure of the underlying equity."* The rebase is the
product working as designed, not a flaw in it.

The `wSPYx` wrapper at `0xe7e553cd128f0011777323a0b44a7b96ea1cb540` is the other half of the
picture: an ERC-4626 over SPYx whose `convertToAssets(1e18)` returns the same 1.0057145603. It
does not rebase, but a share is not an asset — which is the wrapper/share semantics this row
also names.

**Why this is a P0 disqualification rather than an integration detail.** `LaunchMarket` treats
collateral as a LIABILITY derived from curve maths, never as a balance — that separation is what
makes the accounting auditable, and it rests on an assumption that was never written down: a
balance only changes when someone transfers.

A reverse split lowers the multiplier. Every holder's balance shrinks and so does the market's,
while `curveCollateral` does not move, because no transfer happened and no event fired. The
market is then **insolvent against its own books**, `sell` reverts for everyone, and it stays
that way. There is no attack, no bug, no moment where anything looks wrong beforehand, and
nobody to blame.

**Acted on, not merely recorded.** §420's `multiplierBehaviour` gate is a boolean governance
ticks, which is the exact defect shape this codebase has hit five times: a check nobody
performs. `RebaseDetector` now sits UNDERNEATH that gate and reverts regardless of it — an
asset with all eight gates green is still refused — at registration and again at enable, because
these are upgradeable proxies and the answer can change between the two.

**Verified mechanism (OFFICIAL — Hyperliquid docs):**

- The spot deployer links a HIP-1 token to an ERC-20 by `requestEvmContract` (token index, ERC-20
  address, `evmExtraWeiDecimals`), then proves intent via `finalizeEvmContract` using one of:
  the deploying EOA nonce, the finalizer address at storage slot 0, or the finalizer address at
  `keccak256("HyperCore deployer")`. Only the verified finalizer completes linking.
- **System address derivation:** first byte `0x20`, remaining bytes zero except the token index
  big-endian. Token index 200 → `0x20000000000000000000000000000000000000c8`.
  HYPE is special-cased at `0x2222222222222222222222222222222222222222`.
- `evmExtraWeiDecimals` is the Core↔EVM wei-decimal difference. **If a transfer amount is not
  evenly divisible by the extra decimals, the non-round remainder is burned** (sub-1-wei).

**Implication already accepted into design:** the adapter must treat the Core↔EVM decimal offset
as a first-class parameter per asset, and dust-burn behaviour must be covered by the normalization
tests. This is exactly the §399/§400 normalized-bucket requirement.

---

## V-04 — xStock trading-halt and corporate-action interfaces · **UNVERIFIED**

```text
UNKNOWN:            whether a halt / corporate-action signal is exposed, and how
WHY IT MATTERS:     §401 requires a corporate-action / multiplier safety gate
HOW TO VERIFY:      first-party xStocks documentation + contract inspection
BLOCKS:             §401 safety gate, ReferencePriceAdapter policy
OWNER:              Stream A / owner
STATUS:             UNVERIFIED
```

---

## V-05 — xStock ERC-20 transfer behaviour · **VERIFIED · P0**

```text
UNKNOWN:            fee-on-transfer? rebasing? pausable? blacklist? upgradeable proxy?
WHY IT MATTERS:     curve solvency assumes the quote asset moves 1:1. A fee-on-transfer or
                    pausable quote asset breaks collateral accounting and sell solvency, and a
                    blacklist can strand HolderRewardVault obligations.
CURRENT ASSUMPTION: none permitted
HOW TO VERIFY:      read and review the deployed bytecode/source of each candidate ERC-20;
                    fork-test a transfer round trip
BLOCKS:             LaunchMarket solvency, HolderRewardVault, §420 allowlist gate
OWNER:              Stream A / I
STATUS:             VERIFIED (PRIMARY), Day 8 — for the only candidate that exists
```

**Read on-chain, Day 8, against `SPYx` `0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48`:**

| This row asked | Answer |
|---|---|
| fee-on-transfer? | no |
| **rebasing?** | **YES** — `multiplier()` = 1.0057145603, `sharesOf()` present. See V-03. |
| pausable? | **YES** — `isPaused()` exists and currently reads false |
| blacklist? | none found among the probed selectors |
| upgradeable proxy? | **YES** — EIP-1967, implementation `0xd865ce1b…` ("Backed Token Implementation") |
| minting authority | `minter()` is an **EOA**, `0x0a934bc9c64309c9654451f23d8331c2dad34c2a` |
| permit? | yes — `DOMAIN_SEPARATOR()` and `nonces()` present |

This row's own UNKNOWN line asks "rebasing?" first. It is answered, and the answer is the one
that breaks curve solvency — the row anticipated exactly the right question.

**Three of these are disqualifying on their own terms**, and it is worth separating them:

- *Rebasing* breaks solvency silently and permanently (V-03). Structurally refused now.
- *Pausable* means a third party can stop every sell and every Stockback payout at will. That is
  a live dependency, not a tail risk, and §420's `transferBehaviour` gate is where it belongs.
- *Upgradeable behind a proxy, with an EOA minter* means today's answers are not binding. Any of
  the rows above can change without notice, which is why `RebaseDetector` re-checks at enable
  rather than trusting the registration-time read.

**Explicit risk raised by V-03's source (OFFICIAL, quoted):** the docs state there are currently
no checks that the system address has sufficient supply or that the linked contract is a valid
ERC-20, and that users must independently verify the contract implementation and balances.

> **This directly validates §420.** SENT's registry must verify the ERC-20 itself — bytecode,
> transfer semantics, supply backing — and must never treat "it is linked" as authenticity.
> Linkage is a routing fact, not a safety guarantee.

---

## V-06 — HyperSwap V3 core addresses · **PARTIAL**

```text
UNKNOWN:            factory, NonfungiblePositionManager, SwapRouter, quoter on HyperEVM
WHY IT MATTERS:     graduation venue (LOCKED §17, §20)
HOW TO VERIFY:      probe candidate addresses on-chain; confirm against first-party docs
BLOCKS:             GraduationRouter, §416 geometry, LP lock
OWNER:              Stream A
STATUS:             PARTIAL — all three addresses located and mutually confirmed by
                    PRIMARY on-chain read; first-party confirmation still absent
```

**Result, Day 1 (PRIMARY):** a candidate SwapRouter surfaced by a SECONDARY source was probed
read-only and behaves as a genuine Uniswap-V3-style router:

```text
candidate SwapRouter  0x4e2960a8cd19b467b82d26d83facb0fae26b094d
  .factory()       ->  0xb1c0fa0b789320044a6f623cfe5ebda9562602e3
  .WETH9()         ->  0x5555555555555555555555555555555555555555   (WHYPE)
```

**Result, Day 8 (PRIMARY):** the NonfungiblePositionManager, which was the missing piece,
located by on-chain measurement rather than from a docs page.

The method matters, because it is what makes the address self-evidencing. A position manager
does not advertise itself, but it is the contract that *emits* `IncreaseLiquidity` — so
scanning that event with no address filter returns the emitter, which IS the NPM. There is
nothing to guess and nothing to trust:

```text
NonfungiblePositionManager  0x6eDA206207c09e5428F281761DdC0D300851fBC8
  .name()        ->  "Hyperswap V3 Positions NFT-V1"
  .symbol()      ->  "HSPX-V3-POS"
  .factory()     ->  0xb1c0fa0b789320044a6f623cfe5ebda9562602e3
  .totalSupply() ->  177,878 positions
```

**The three addresses are one deployment**, and that is asserted rather than assumed — a
router pointed at a factory that does not know its own position manager would mint a market's
entire liquidity into a pool nothing else can see:

```text
factory           0xB1c0fa0B789320044A6F623cFe5eBda9562602E3
positionManager   0x6eDA206207c09e5428F281761DdC0D300851fBC8   .factory() -> factory
swapRouter        0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D   .factory() -> factory
```

The loop was closed from the other end too: position #90652 (WHYPE / 0xb8ce59fc…, fee 3000)
-> `factory.getPool(...)` = `0x56abfaf40f5b7464e9cc8cff1af13863d6914508` -> `pool.factory()`
= the same factory. A live position, its pool, and the factory all agree.

`test/fork/HyperSwapFork.t.sol` re-asserts the mutual references on every run, so this cannot
rot silently into a copied constant.

**Still required before any address enters `packages/config`: first-party confirmation.**
That has not moved. Measurement proves these contracts are a coherent Uniswap-V3 deployment
serving one factory with 177,878 live positions. It does not prove they are the deployment
HyperSwap's team considers canonical, or that they will not be superseded. Those are claims
only a first party can make.

First-party docs at `docs.hyperswap.exchange` returned HTTP 403 to automated fetch; the
`docs.hyperswap.pro` deployment page lists **V2 only** (factory
`0x4df039804873717bff7d03694fb941cf0469b79e`, V2Router02
`0xda0f518d521e0dE83fAdC8500C2D21b6a6C39bF9`) and no V3 section. The quoter is still not
located, and is not needed: V-19's blended bound needs a quote, but the router quotes the
post-grad leg through the pool it just created.

---

### §254's fee-tier checklist, scored

§254 asks for five things before a tier is chosen. The choice is 1% (tick spacing 200),
recorded as D-015, and three of the five are done:

| Step | State |
|---|---|
| inspect official deployed fee tiers | done — V-07 |
| check compatibility with the target xStock pair | **open** — V-02, V-03 |
| model the initial LP | done — the endpoint-balance test in `V3Math.t.sol` |
| validate the final curve price mapping | done — `V3Math`, round-trip fuzzed |
| simulate tick rounding | done — measured on the real HyperSwap pool, V-08 |
| document the resulting choice | done — D-015 |

One open item remains, and it is not a venue question: the target xStock pair (V-02, V-03).
Tick rounding closed on Day 8 against the real pool. Neither can change the tier by itself: §254's escalation clause applies only if an integration detail
"changes product economics materially", and a full-range position at a fixed tier has no
parameter left for a venue detail to move.

---

## V-07 — HyperSwap V3 fee tiers and tick spacings · **VERIFIED**

```text
UNKNOWN:            which fee tiers are enabled, and each tier's tick spacing
WHY IT MATTERS:     §254 requires an exact fee-tier/tick decision; §416 geometry depends on it
HOW TO VERIFY:      factory.feeAmountTickSpacing(uint24) for each candidate tier
BLOCKS:             V3 graduation geometry, price continuity, dust bound
OWNER:              Stream A
STATUS:             VERIFIED (PRIMARY)
```

**Result, Day 1** — read from factory `0xb1c0fa0b789320044a6f623cfe5ebda9562602e3`:

| fee (pips) | rate | tickSpacing | enabled |
|---:|---:|---:|:--|
| 100 | 0.01% | 1 | yes |
| 500 | 0.05% | 10 | yes |
| 2500 | 0.25% | 0 | **no** |
| 3000 | 0.30% | 60 | yes |
| 10000 | 1.00% | 200 | yes |
| 20000 | 2.00% | 0 | **no** |

The standard Uniswap V3 tier set is available. Tier selection for graduation is a §254 decision
feeding the V-08 geometry proof; it is not yet made.

---

## V-08 — Exact V3 mint geometry at the final marginal price · **VERIFIED · P0 (C-03)**

```text
UNKNOWN:            the tick range policy that consumes remaining TOKEN + curve collateral within
                    a documented dust tolerance while preserving spot price continuity
WHY IT MATTERS:     §416 forbids treating reserve-ratio math as exact V3 mint math. The §8
                    analytic endpoint is the economic reference model, not the mint amounts.
CURRENT ASSUMPTION: analytic endpoint holds; NOT yet proven against tick math
HOW TO VERIFY:      simulate mint amount0/amount1 at PG for candidate ranges on a HyperEVM fork
BLOCKS:             GraduationRouter, §417 dust destination, graduation acceptance
OWNER:              Stream A
STATUS:             VERIFIED — analytic side Day 1 (`pnpm sim`), tick side Day 8 on the
                    real HyperSwap pool
```

If exact geometry demands a material economic change, that is a **product escalation** under
§416, not an engineering fix.

**No escalation is needed.** §415 locks V1 to the full range, which removes the tick-policy
choice entirely — there is no range to select, so there is nothing to tune and nothing that
could demand an economic change.

At full range the mint consumes both sides in the ratio `amount1/amount0 = P`, and the §8
endpoint puts the remaining supply at exactly the collateral that came with it: 342.105M
TOKEN at `pg` against the ~$17,105 the curve accumulated reaching it. That is not a fit — the
endpoint was derived to make it true, and `V3Math.t.sol` asserts the balance directly.

The tick side is the part a mock cannot settle. The router hands both balances to the position
manager and lets IT compute liquidity, rather than deriving amounts from a ratio — which is
what §416 forbids — so the leftover depends on HyperSwap's arithmetic, not on ours.

**Measured, Day 8, on the real HyperSwap `NonfungiblePositionManager`** (`HyperSwapFork.t.sol`):

```text
migrated    342,105,263e18 TOKEN   /   171.0526315 WHYPE
token dust             119 wei     =  3.5e-25 of the migration
quote dust          13,161 wei     =  7.7e-14 of the migration
```

The §416 tolerance is one part in ten thousand. The real venue came in **twenty-one orders of
magnitude** inside it on the token side. The dust is not a rounding allowance being spent; it
is the last representable wei of a 256-bit division, and it goes to the lock (§417).

`slot0().sqrtPriceX96` after the mint equals `V3Math.initialSqrtPriceX96(pg, …)` **exactly** —
not within tolerance, equal. §15's spot-price continuity is a hard invariant and it holds on
the venue rather than only in our model of it.

This is what the row asked for: "simulate mint amount0/amount1 requirements at PG for candidate
ranges on a HyperEVM fork." Done, against the deployed contract.

---

## V-09 — Delegated-position permanent lock + creator fee-right custody · **VERIFIED · P0 (C-07)**

```text
UNKNOWN:            can a V3 position have principal permanently non-withdrawable while fee
                    collection rights remain exercisable for the creator?
WHY IT MATTERS:     two LOCKED rules meet here — permanent LP principal lock (§17) and creator
                    post-grad fee rights (§11, §413)
HOW TO VERIFY:      inspect NonfungiblePositionManager capabilities; fork-test collect() while
                    decreaseLiquidity() is unreachable
BLOCKS:             §178.4 release gate. The custody design is no longer blocked — see below.
OWNER:              Stream A / I
STATUS:             VERIFIED — the primitive question is answered and the lock is
                    fork-tested against the real position manager
```

If no venue primitive provides this, the lock must be a purpose-built non-withdrawable holder
contract — an architecture decision with security consequences, to be escalated, not improvised.

**No venue primitive provides this, and the escalation is resolved.**

Uniswap V3 — and HyperSwap, its fork — offers an NFT holder exactly two states, and neither is
the one §17 and §11 require together:

| | |
|---|---|
| Hold the NFT | `decreaseLiquidity` stays reachable. The principal is un-withdrawn, not locked — a promise rather than a property. |
| Burn the NFT | `collect` dies with it, ending the creator's post-graduation fee rights. |

There is no third state, so `PermanentLiquidityLock` is the purpose-built contract this row
anticipated. Its security consequence is stated rather than buried: **the lock IS the
guarantee.** If it can be made to move the NFT or reduce liquidity, §17's permanence is a
claim and not a fact.

What it does not have: an owner, governance, a guardian, a pause, an upgrade path, an
initialiser, `execute`, `delegatecall`, an ERC-721 transfer, an approval, or any call to
`decreaseLiquidity` or `burn`. Not gated — **absent**. A gate is a key somebody holds. One test
asserts that against the ABI, which is the strongest form the claim can take.

`collect` takes no recipient: it pays the market the position was minted for, recorded when
the NFT arrived and never writable again. A recipient argument would be a "send a stranger's
fees anywhere" function with a harmless name. It is permissionless, because §414 requires that
accrued rights are never lost to unavailable collection — a permissioned collector is a party
who can stop paying the creator by doing nothing.

§413 recommends FeeVault custody; this is a dedicated contract because FeeVault has governance,
and §17's permanence should not depend on a key. Custody with no keys is strictly stronger than
custody behind good ones.

**Proven on the real venue, Day 8.** The claim in this row is not one a mock can support — a
mock position manager does whatever our reading of V3 says it does, including being wrong in
the same direction as the contract under test. So the whole question was re-asked against
HyperSwap's deployed `NonfungiblePositionManager`:

```text
ownerOf(positionId)        ->  the lock          a real HyperSwap NFT, really held
positions(positionId)      ->  liquidity > 0     and a real position
lock.collect(positionId)   ->  succeeds, pays the market, position does not move
decreaseLiquidity(...)     ->  reverts
```

The last line is the one that carries §17, and it is worth being precise about *why* it
reverts. Not because the lock refuses it — the lock has no function that would call it. The
NPM accepts `decreaseLiquidity` only from the owner or an approved operator; the lock is the
owner and approves nobody. **There is no sender who could make the call.** That is a property
of the arrangement, not a check somebody could find a way around.

**Still owner-blocked:** first-party confirmation of the three HyperSwap addresses — the V3
factory, the `NonfungiblePositionManager` and the `SwapRouter`. V-06 has now *located* all
three by on-chain measurement and the fork suite asserts they are one deployment, which is a
different and weaker thing than the vendor saying so.

**All three are immutable in the router's constructor**, and the position manager is immutable
in the lock as well. A wrong address is therefore not a configuration mistake to correct later:
it means redeploying both contracts, while the old lock still holds a real LP position that
nothing can move.

---

## V-10 — HyperSwap pause / upgrade / admin risk surface · **PARTIAL**

```text
UNKNOWN:            what powers the venue's admin holds over pools SENT depends on
WHY IT MATTERS:     §414 external pause risk
HOW TO VERIFY:      review factory/NPM ownership and privileged functions
BLOCKS:             §414 degraded-dependency policy, risk disclosure
OWNER:              Stream I
STATUS:             PARTIAL
```

**Day 1 (PRIMARY):** factory `owner()` = `0xbc7e493fd3ed834ed563f9597aaaed94e446bbc7`. In stock
Uniswap V3 the factory owner may only `enableFeeAmount` and `setOwner` — it cannot touch existing
pools or LP positions. **Whether this deployment is stock or modified has not been verified**, and
that verification is required before it can be treated as a bounded risk.

---

## V-11 — Launch-anchor reference price + multiplier source · **UNVERIFIED · P0**

```text
UNKNOWN:            which feed provides the launch-time xStock/USD reference snapshot
WHY IT MATTERS:     §402 splits oracle roles. The anchor fixes P0 for the market's entire life,
                    so it must be manipulation-resistant; a manipulated anchor mis-prices the
                    market permanently.
HOW TO VERIFY:      identify available feeds on HyperEVM and review their security model
BLOCKS:             the launch flow. Every launch reverts with ReferencePriceNotSet
                    until governance configures a feed and points the factory at it.
OWNER:              Stream A
STATUS:             UNVERIFIED
```

**The mechanism is built; only the feed is open.** `ReferencePriceAdapter`
exists, is tested against stale, zero, negative, out-of-band, unreadable and
wrong-decimals feeds, and is what the factory reads. `xStockUsdWad` is no longer
the anchor — it is the bound on how far the feed may have moved since the
creator's preview.

What is still needed is one decision and three numbers per asset: the
aggregator, its staleness bound, and its sanity band. §253's criteria apply in
order — **manipulation resistance first**. A DEX spot price is disqualified on
that alone: the anchor would be settable by anyone willing to move the pool for
one block, and it fixes `p0` for the market's entire life.

`REFERENCE_PRICE_FEEDS` in `packages/config/src/chain.ts` is where they land.
It is empty, and `assertProductionConfigReady` names V-11 while it is.

---

## V-12 — Live USD display feed · **UNVERIFIED**

```text
WHY IT MATTERS:     §402/§403 live USD display; must degrade visibly, never silently
BLOCKS:             terminal display, §211 data-freshness UI
OWNER:              Stream C
STATUS:             UNVERIFIED
```

---

## V-13 — Safe deployment on HyperEVM · **VERIFIED · P0 (C-09)**

```text
UNKNOWN:            are Safe singleton/factory/fallback contracts deployed at usable addresses on
                    chain 999, and is there a usable transaction service / UI?
WHY IT MATTERS:     the entire six-account platform custody architecture (§555, §598-§600) assumes
                    Safe: Governance, Treasury, Founder Profit, Guardian
HOW TO VERIFY:      probe canonical Safe deployment addresses on chain 999
BLOCKS:             custody architecture, §178.17, key ceremony (C-08)
OWNER:              Stream H / owner
STATUS:             VERIFIED (PRIMARY), Day 8
```

**The row said how to verify it — "probe canonical Safe deployment addresses on chain 999" —
and that is all it took.** It sat UNVERIFIED for eight days as an owner task when it was one
`eth_getCode` sweep. Worth recording as a process note: a row is only owner-blocked if its own
`HOW TO VERIFY` needs a person.

**Measured on HyperEVM, chain 999.** The full Safe v1.4.1 deployment is present at the
canonical cross-chain addresses:

```text
Safe singleton        0x41675C099F32341bf84BFc5382aF534df5C7461a   23,579 b   VERSION() -> "1.4.1"
SafeL2                0x29fcB43b46531BcA003ddC8FCB67FFE91900C762   24,421 b
SafeProxyFactory      0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67    3,054 b   proxyCreationCode() -> 576 b
MultiSend             0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526      629 b
MultiSendCallOnly     0x9641d764fc13c8B624c04430C7356C1C7C8102e2      410 b
CompatibilityFallback 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99    5,637 b
```

Not just bytecode presence — the singleton answers `VERSION()` with `1.4.1` and
`getThreshold()` with 1, which is the mastercopy's own state, and the factory returns real
proxy creation code. v1.3.0 is deployed too, at its own canonical addresses.

Deployed alongside them, and worth knowing for deployment: the Arachnid CREATE2 deployer
(`0x4e59b44847b379578588920cA78FbF26c0B4956C`), Multicall3
(`0xcA11bde05977b3631167028862bE2a173976CA11`) and Permit2
(`0x000000000022D473030F116dDEE9F6B43aC78BA3`).

**What is NOT verified here, and is genuinely the owner's:** whether a hosted Safe transaction
service and UI cover chain 999. The contracts being present means a Safe can be created and
used with any client that can build the calldata; it does not mean `app.safe.global` will show
it. That is a convenience question, not a custody one, and it does not block §555.

**Still owner-blocked, separately: C-08** — who the signers are. No amount of probing answers
that.

---

## V-14 — Explorer + source verification tooling · **UNVERIFIED**

```text
WHY IT MATTERS:     §178.18 requires verified source for production contracts
CANDIDATES:         hyperevmscan.io, hyperscan.com (both observed to exist; API/verification
                    workflow not yet exercised)
BLOCKS:             §178.18 release gate
OWNER:              Stream H
STATUS:             UNVERIFIED
```

---

## V-15 — RPC / WebSocket limits and official RPC limitations · **PARTIAL**

```text
WHY IT MATTERS:     §542 warns about official RPC limitations; the indexer and realtime layer
                    depend on log range limits, WS stability and historical depth
HOW TO VERIFY:      measure eth_getLogs range caps, WS behaviour, archive depth; evaluate
                    redundant providers
BLOCKS:             indexer design, reorg strategy, realtime SLOs
OWNER:              Stream C / H
STATUS:             PARTIAL — endpoint reachable and advancing (V-01); limits not yet measured
```

Redundant independent providers are required regardless, because §406 requires independently
deployed indexer instances for the attestor set.

---

## V-16 — CREATE2 determinism on HyperEVM · **VERIFIED**

```text
UNKNOWN:            standard EVM CREATE2 semantics on chain 999
WHY IT MATTERS:     vanity address architecture (§4, §412)
STATUS:             VERIFIED (PRIMARY, by construction)
```

HyperEVM is an EVM-equivalent execution environment and the chain is live at `chainId = 999`
(V-01). CREATE2 address derivation is therefore the standard
`keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:]`. **Still to prove on fork
(Day 3):** that the creator-bound `effectiveSalt` construction of §412 actually defeats a mempool
copy attempt — that is a test obligation, not a chain-capability question.

---

## V-17 — Hardware wallet + Safe signing support for chosen signers · **UNVERIFIED**

```text
WHY IT MATTERS:     §603 requires hardware-wallet-backed human signers; §601 requires signer-set
                    separation across Governance / Treasury / Founder / Guardian
BLOCKS:             key ceremony, mainnet Day 7
OWNER:              **owner action (C-08)** — not an engineering task
STATUS:             UNVERIFIED — awaiting signer identities and hardware procurement
```

---

## V-18 — Legal / operator restrictions · **OWNER-BLOCKED**

```text
WHY IT MATTERS:     §32, §311, §1027 M22 — a permissionless venue pairing against tokenized
                    equities carries jurisdictional constraints that engineering cannot resolve
BLOCKS:             public opening, §178.21
OWNER:              **owner / counsel**
STATUS:             OWNER-BLOCKED
```

---

## Sources consulted Day 1

Primary evidence was read from the HyperEVM RPC directly. Secondary sources below were used only
to locate candidates and to understand mechanisms; none were treated as production authority.

- [HyperCore ↔ HyperEVM transfers — Hyperliquid Docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/hypercore-less-than-greater-than-hyperevm-transfers) (OFFICIAL — linking, system addresses, decimals, the "no checks" warning)
- [Hyperswap Deployment Addresses](https://docs.hyperswap.pro/technical-reference/contracts/deployment-addresses) (V2 only)
- [HyperSwap V3 Swap Router on HyperEVMScan](https://hyperevmscan.io/address/0x4e2960a8cd19b467b82d26d83facb0fae26b094d) (candidate lead)
- [xStocks goes live on Hyperliquid — xStocks](https://xstocks.fi/us/news/xstocks-goes-live-on-hyperliquid-bringing-the-markets-deepest-tokenized-equities-framework-to-traders)
- [Hyperliquid integrates xStocks via Chainlink CCIP — Crypto Briefing](https://cryptobriefing.com/hyperliquid-xstocks-chainlink-ccip-integration/)
- [Hyperliquid adds xStocks spot markets — Crypto Adventure](https://cryptoadventure.com/hyperliquid-adds-xstocks-spot-markets-for-nvidia-spy-qqq-and-chip-stocks/)
- [Chainlink Hyperliquid Integration Guide](https://docs.chain.link/ccip/tools-resources/network-specific/hyperliquid-integration-guide)

---

## V-19 — Crossing-order slippage bound covers only the curve leg · **CLOSED**

```text
UNKNOWN:            how to bound the post-graduation leg of a crossing order
WHY IT MATTERS:     §14 requires ONE user-wide minimum covering blended execution
                    between the final curve segment and post-grad HyperSwap
CURRENT STATE:      `minTokensOut` is derived from the curve leg alone, because
                    quoting the HyperSwap leg needs the router (V-06, V-09)
CONSEQUENCE:        the post-grad portion is effectively unprotected — it could
                    return almost nothing and the trade would still clear, since
                    the curve leg alone satisfies the bound
HOW TO RESOLVE:     once the router exists, quote both legs and set the bound
                    from the blended total
BLOCKS:             §14 acceptance, §178.10 trader UX readiness
OWNER:              Stream A / D
STATUS:             CLOSED, Day 8 — the leg it could not bound no longer exists
```

**Interim handling, Day 7.** The intent carried `estimateIsPartial` and
`boundCoversPartialRoute`, the review labelled the figure "curve leg only", and a
row stated plainly that slippage protection did not cover the HyperSwap leg. A
user was told what their protection did and did not cover.

That was mitigation, not a fix, and this row said so: it must not ship to mainnet
in that state without an explicit accepted-risk decision.

---

**Closed, Day 8 — and not by accepting the risk.**

D-016 split graduation into a crossing buy and a permissionless finalise, because
a full migration costs 5,395,811 gas and HyperEVM's default block lane caps at
3,000,000 (V-20). The buy that closes the curve now refunds what the curve had no
supply left to sell, because at that instant the pool does not exist — there is
no venue to route a remainder into and no price to route it at.

So there is no second leg. The curve leg IS the trade, `minTokensOut` bounds all
of it, and §14's requirement of one user-wide minimum over the whole execution is
satisfied by there being only one execution to cover.

This row is closed as a **side effect** of an unrelated constraint, which is
worth recording honestly: the fix was not designed to close it. The block lane
forced the split; the split happened to dissolve the gap. Had the lane been
larger, this row would still be open and would still need the router to quote
both legs.

The two flags are **deleted** from the SDK rather than left always-false. A flag
that cannot be true is worse than no flag: every UI keeps a branch for a state
that cannot occur, nobody exercises it, and a warning that is never real is one
users learn to click past — which costs them the warnings that are.

---

## V-20 — HyperEVM block gas lanes vs. the cost of graduation · **VERIFIED · P0**

```text
UNKNOWN:            the gas ceiling a graduating transaction must fit inside on HyperEVM
WHY IT MATTERS:     LOCKED §14 graduates inside the buy that crosses the endpoint. If that
                    transaction cannot be included in the block lane an ordinary buyer sends
                    to, then the market that reaches qG cannot be graduated by the person who
                    got it there - and every crossing buy fails for the user who makes it.
CURRENT ASSUMPTION: (none needed - measured)
HOW TO VERIFY:      sample eth_getBlockByNumber gasLimit across the tip; measure the
                    graduation path on a fork
BLOCKS:             §14 atomic graduation, §16 failure handling, §178.4 release gate
OWNER:              Stream A / H
STATUS:             VERIFIED (PRIMARY) - the constraint is real; the RESPONSE is D-016
```

**The masterplan does not mention this.** A grep of all 28,051 lines for block lanes, gas
limits or big blocks returns nothing. This is not a spec the code failed to follow; it is a
property of the chain that no part of the plan accounts for.

**Measured, Day 8.** 600 blocks sampled from the tip:

```text
gasLimit  3,000,000   394 of 400 sampled   the default lane
gasLimit 30,000,000     6 of 400 sampled   the opt-in lane, roughly 1 block in 120

highest gasUsed observed in a default-lane block   2,993,188 of 3,000,000
```

The default lane is not merely small, it runs **saturated** - 99.8% of its ceiling in an
ordinary block. There is no headroom to grow into.

**And the graduation path does not fit in it:**

```text
full graduation, measured on the fork          5,395,811 gas
  of which createAndInitializePoolIfNecessary  2,777,465 gas
default lane ceiling                           3,000,000 gas
```

`createPool` alone is 92.6% of an entire default-lane block. The pool deployment is the
dominant cost and it is not ours to optimise - it is HyperSwap's pool bytecode.

**Corroboration from an independent direction.** Foundry's `isolate` mode models each
top-level call as a real transaction. Under it, this suite capped at 3.19M gas and refused to
rise no matter what `block_gas_limit` was set to, failing as `OutOfGas` inside the pool
deployment. That was not a tooling defect to work around. Isolate mode was reproducing the
chain's actual ceiling, and it found this constraint before the block sampling did.

**What this means, stated plainly.** A buy that crosses qG needs ~5.4M gas. A user who has not
opted into the large lane cannot have that transaction included at all. So under §14 as
written, the crossing buy fails for essentially every buyer, and the market stalls one wei
short of graduating - permanently, since every subsequent attempt fails the same way.

**NOT verified, and it matters.** The mechanism for opting an address into the large lane is
a Hyperliquid L1 action, not an EVM call, so nothing above measures it. What is measured is
that the two lanes exist, what they cap at, and how often each is produced. Any design that
depends on a specific opt-in mechanism must confirm it first-hand before it ships.

**Response:** §16 and §95.6 already prescribe one, for exactly this case - "jika dependency
eksternal mengharuskan retryable workflow: deterministic escrow, permissionless
`finalizeGraduation()`, no retry caller privilege." The block lane is that external
dependency. Carried into D-016 rather than decided here; this row records the constraint.
