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

Last updated: Day 1.

---

## Status summary

| Status | Count | Rows |
|---|---|---|
| VERIFIED | 3 | V-01, V-07, V-16 |
| PARTIAL | 3 | V-06, V-10, V-15 |
| UNVERIFIED | 11 | V-02, V-03, V-04, V-05, V-08, V-09, V-11, V-12, V-13, V-14, V-17 |
| OWNER-BLOCKED | 1 | V-18 |

**P0 rows still open: V-02, V-03, V-05, V-09, V-13.** These can invalidate LOCKED behaviour.

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

## V-02 — Canonical HyperEVM xStock representations + exact addresses · **UNVERIFIED · P0**

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
STATUS:             UNVERIFIED — mechanism understood, addresses not yet confirmed
```

**Day 1 findings (context, not resolution):** xStocks launched tokenized US equities on
Hyperliquid — initially NVDAx, SPYx, QQQx, SKHYx, MUx — as **HyperCore spot markets** quoted
against USDC, bridged via Chainlink CCIP. Press describes them as composable on HyperEVM. That
is a SECONDARY lead. It does **not** establish a canonical ERC-20 address, and no address will be
written into `packages/config` until read from chain.

---

## V-03 — xStock decimals, wrapper / multiplier / share semantics · **UNVERIFIED · P0**

```text
UNKNOWN:            exact decimals on the EVM side, and the Core<->EVM decimal offset
WHY IT MATTERS:     XStockAssetAdapter normalizes every quote amount to 18 decimals before curve
                    and fee math (§399, §400). A wrong offset silently corrupts all economics.
CURRENT ASSUMPTION: none permitted
HOW TO VERIFY:      read decimals() on the linked ERC-20; read the token's weiDecimals and
                    evmExtraWeiDecimals from HyperCore spot metadata
BLOCKS:             XStockAssetAdapter, curve accounting, Stockback funding
OWNER:              Stream A
STATUS:             UNVERIFIED
```

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

## V-05 — xStock ERC-20 transfer behaviour · **UNVERIFIED · P0**

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
STATUS:             UNVERIFIED
```

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
STATUS:             PARTIAL — factory confirmed by PRIMARY read; NPM/quoter still open
```

**Result, Day 1 (PRIMARY):** a candidate SwapRouter surfaced by a SECONDARY source was probed
read-only and behaves as a genuine Uniswap-V3-style router:

```text
candidate SwapRouter  0x4e2960a8cd19b467b82d26d83facb0fae26b094d
  .factory()       ->  0xb1c0fa0b789320044a6f623cfe5ebda9562602e3
  .WETH9()         ->  0x5555555555555555555555555555555555555555   (WHYPE)
```

Still required before any address enters `packages/config`: first-party confirmation that these
are the canonical HyperSwap deployments, plus the NonfungiblePositionManager and quoter.
First-party docs at `docs.hyperswap.exchange` returned HTTP 403 to automated fetch; the
`docs.hyperswap.pro` deployment page lists **V2 only** (factory
`0x4df039804873717bff7d03694fb941cf0469b79e`, V2Router02
`0xda0f518d521e0dE83fAdC8500C2D21b6a6C39bF9`) and no V3 section.

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

## V-08 — Exact V3 mint geometry at the final marginal price · **UNVERIFIED · P0 (C-03)**

```text
UNKNOWN:            the tick range policy that consumes remaining TOKEN + curve collateral within
                    a documented dust tolerance while preserving spot price continuity
WHY IT MATTERS:     §416 forbids treating reserve-ratio math as exact V3 mint math. The §8
                    analytic endpoint is the economic reference model, not the mint amounts.
CURRENT ASSUMPTION: analytic endpoint holds; NOT yet proven against tick math
HOW TO VERIFY:      simulate mint amount0/amount1 at PG for candidate ranges on a HyperEVM fork
BLOCKS:             GraduationRouter, §417 dust destination, graduation acceptance
OWNER:              Stream A
STATUS:             UNVERIFIED — analytic side proven Day 1 (`pnpm sim`), tick side open
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

What is left open is the tick side against a real pool: the router hands both balances to the
position manager and lets IT compute liquidity, rather than deriving amounts from a ratio,
which is what §416 forbids. The leftover is bounded by test at one part in ten thousand of the
migration and goes to the lock (§417). Confirming that bound against HyperSwap's own
`NonfungiblePositionManager` is the remaining fork-test.

---

## V-09 — Delegated-position permanent lock + creator fee-right custody · **UNVERIFIED · P0 (C-07)**

```text
UNKNOWN:            can a V3 position have principal permanently non-withdrawable while fee
                    collection rights remain exercisable for the creator?
WHY IT MATTERS:     two LOCKED rules meet here — permanent LP principal lock (§17) and creator
                    post-grad fee rights (§11, §413)
HOW TO VERIFY:      inspect NonfungiblePositionManager capabilities; fork-test collect() while
                    decreaseLiquidity() is unreachable
BLOCKS:             §178.4 release gate. The custody design is no longer blocked — see below.
OWNER:              Stream A / I
STATUS:             UNVERIFIED — the primitive question is ANSWERED; the addresses are not
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

**Still owner-blocked:** the three HyperSwap addresses. Two are immutable in the router's
constructor, so they cannot be guessed and corrected later.

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

## V-13 — Safe deployment on HyperEVM · **UNVERIFIED · P0 (C-09)**

```text
UNKNOWN:            are Safe singleton/factory/fallback contracts deployed at usable addresses on
                    chain 999, and is there a usable transaction service / UI?
WHY IT MATTERS:     the entire six-account platform custody architecture (§555, §598-§600) assumes
                    Safe: Governance, Treasury, Founder Profit, Guardian
HOW TO VERIFY:      probe canonical Safe deployment addresses on chain 999
BLOCKS:             custody architecture, §178.17, key ceremony (C-08)
OWNER:              Stream H / owner
STATUS:             UNVERIFIED
```

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

## V-19 — Crossing-order slippage bound covers only the curve leg · **OPEN, surfaced**

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
STATUS:             OPEN — surfaced in the UI rather than hidden
```

**Interim handling.** The intent now carries `estimateIsPartial` and
`boundCoversPartialRoute`, the review labels the figure "curve leg only", and a
row states plainly that slippage protection does not cover the HyperSwap leg. A
user is told what their protection does and does not cover.

This is mitigation, not a fix. The bound is genuinely weaker than §14 requires
until the router can quote both legs, and it must not ship to mainnet in this
state without an explicit accepted-risk decision.
