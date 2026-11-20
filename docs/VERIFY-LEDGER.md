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

Last updated: 2026-11-20 (historical ledger below; read the dated updates immediately after this notice).

## Remote CI failure reconciliation — 2026-11-20

The latest GitHub Actions run visible from the logged-in repository is run
[`33953526440`](https://github.com/Sent-lab/Sent/actions/runs/33953526440), on
remote SHA `ac6fba1a7f7f1fbc413e6bc6d1eda6b892bee31b` (2026-09-05), not the
current local worktree. Typecheck/build and Foundry jobs passed there. Two jobs
failed: the economic gate's Docker-manifest check reported missing copies for
`packages/observability/package.json` and `services/keeper/package.json`; the
full-stack E2E job stopped in `tests/e2e/stack.ts` with an ABI parameter/value
length mismatch while deploying `XStockRegistry`.

The current working tree contains both Docker manifest copies in
`infra/docker/Dockerfile`, and its E2E fixture deploys a `WrappedXStockFactory`
then passes `(governance, wrapperFactory)` to `XStockRegistry`. These match the
two recorded failure conditions, but that is source inspection only: no fresh
CI run proves the fix. Local `main` is 12 commits ahead of `origin/main`, with
additional uncommitted changes; none of the current worktree is represented by
that remote run. No push was performed.

## Fresh HyperEVM deployment gate re-check — 2026-11-20

Read-only calls to the official HyperEVM RPC at block `51,708,543` reconfirmed
that the deployed factory `0xcEa3AcF9b70cE9807a99bcBdF0F93A437518Eaeb` has a
zero `router()` and zero `referencePrice()`, with `launchFee()` equal to
`40000000000000000` wei (`0.04 HYPE`). Registry
`0xA54BC1b31d17a6B9F76d6De1BE43B8efb8843c2B` reports `registeredCount() = 0`
and the expected wrapper factory `0xc7b674f6Ec9de46852A25897305292a3d1E18d63`.
Reward vault `0xF7dce0CC413D6d7F855A742A02545253Bbb0cB92` still reports a zero
guardian, zero quorum and zero attestors; `launchConfigurationReady()` reverts
because the deployed bytecode does not expose that source-level selector.

At block `51,708,555`, Safe reads show governance
`0x791fb66Ac5ff91eE7D3F1697f85c4D8b646D1e22` is 2-of-3, while Treasury
`0xEd7709178EF1De028E965B4107f56b5AecBE92A2` is 1-of-1 with one owner. The
Treasury Safe therefore does not meet the current mainnet deployment script's
minimum 2-of-3 threshold. These observations keep launch, graduation, stockback
and redeployment gates closed. No transaction or state change occurred.

Primary evidence: read-only `eth_call` and `eth_blockNumber` against
`https://rpc.hyperliquid.xyz/evm`, blocks `51,708,543` and `51,708,555`,
2026-11-20.

## Independent treasury routing audit — 2026-11-20

Source review found two independently mutable fee destinations. The factory
sends native launch fees to its own `treasury`; `FeeVault` settles ERC-20
platform trading fees to its `treasury`. Both are initialized to the same
configured Safe, but `LaunchpadFactory.setTreasury` does not update
`FeeVault.treasury`, and `FeeVault.setTreasury` does not update the factory.
This is intentional separate storage in the current source, so a one-sided
governance update can split platform revenue across recipients without a revert.
The deployment recovery runbook now requires both calls and read-back
verification for a Treasury rotation, unless the two recipients are explicitly
intended to differ. No contract code or chain state changed.

Evidence: current source `contracts/src/LaunchpadFactory.sol` (constructor and
`setTreasury`) and `contracts/src/FeeVault.sol` (constructor and `setTreasury`),
2026-11-20.

## Post-graduation fee asset decimals — 2026-11-20

Static review found that `FeeVault.FeesAccrued` carries an `asset` field and
post-graduation LP collection accrues both the launched TOKEN and the paired
xStock quote asset. The indexer normalized both amounts with the market's quote
decimals. On a 6-decimal quote market, this scaled TOKEN accruals by `10^12`;
when a creator later claimed TOKEN fees, the claim handler also tried to read
the launched token from `XStockRegistry`, where it is not registered. The
resulting registry revert would stop that indexer batch.

`services/indexer/src/ingest.ts` now resolves decimals per event asset: a token
in the indexed factory launch map is fixed at 18 decimals; other fee assets are
looked up in the xStock registry, with unknown assets still failing closed. This
matches `LaunchMarket.collectPostGradFees`, which accrues token and quote fees
separately. The creator API now also maps every creator's launched token to 18
decimals so claimable and claim-history reads can display either fee asset. The
page labels those amounts generically by asset and describes trade and pool fee
earnings. This is a source-level correction only; no test, build, or live
indexer run was performed. `pnpm typecheck` passed after all indexer/API/UI
changes. No chain state changed.

## HyperEVM RPC limits and public-beta bootstrap — 2026-11-20

Hyperliquid's official HyperEVM JSON-RPC page documents a maximum `eth_getLogs`
range of 50 blocks and says historical-state methods are unsupported on the
default public RPC. Its rate-limit page sets a ceiling of 100 EVM JSON-RPC
requests per minute per IP. The public-beta template had selected that endpoint
while the indexer requested 500-block log ranges and polled every 2 seconds.
Those defaults could fail the indexer at its first range and spend a large share
of the endpoint's shared quota during catch-up. The indexer now defaults to a
50-block range and a 15-second poll; the public-beta RPC URL is required rather
than silently defaulted. The runbook requires a provider with archive access and
quota suitable for both API and indexer, or a verified database restore. The
new 50-block/15-second defaults were not built or exercised in this follow-up;
the official public RPC is still not approved for public-beta bootstrap.

At the latest recorded head (`51,706,686`) and the configured earliest cursor
(`45,027,931`), replay spans about 6.68 million blocks. At a 50-block range,
that is roughly 133,600 ranges. The current indexer reads a boundary block and
at least one log range per batch, so even at the full 100-request/minute quota
with no API traffic or retries, the lower-bound catch-up time is about 44.5
hours. Shared API reads, launches that need a second log pass, and rate-limit
retries make it longer. This is a measured release-operability blocker for the
default public-beta topology, not a claim that the RPC is unavailable.

Primary sources: Hyperliquid [HyperEVM JSON-RPC](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc),
[rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits),
and [raw block data](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/raw-hyperevm-block-data).

## Launch-fee exact-payment guard — 2026-11-20

Review of the current public `LaunchpadFactory.launch` path found that it
accepted `msg.value > launchFee` and forwarded the entire amount to the Treasury
Safe. The website and SDK send the exact configured fee, but direct callers
could accidentally pay an unadvertised extra amount. The factory now preserves
the existing insufficient-fee error and rejects overpayment with
`ExcessiveLaunchFee(sent, required)`; the package ABI includes the new error.
The launch fee is now exact by contract, with no implicit Treasury tip or
refund-call edge case. No tests or Solidity compile were run in this follow-up,
and no chain state changed. `pnpm typecheck` passed after the ABI update; this
does not compile Solidity or exercise the new revert path.

## NVIDIA Pyth Pro option — 2026-11-20

Pyth's current Terminal documentation describes an NVDA equity feed in a Pyth
Pro package used by Polymarket. This proves catalog/package availability, not
that SENT's Terminal trial can access the feed. The account's `My Feeds` list
does not contain regular NVDA or NVDAX. Pyth's contract table lists its Pyth
Pro verifier on HyperEVM at
`0xACeA761c27A909d4D3895128EBe6370FDE2dF481`; its EVM guide requires the signed
update to be verified and parsed in the consuming transaction. Pyth lists a
1-wei EVM verification fee, excluding transaction gas and subscription cost.

This gives SENT a technically supported route to evaluate for NVDAx, but the
feed entitlement, subscription quote, price-unit/multiplier match for the exact
NVDAx wrapper, and integration with SENT's launch transaction are unverified.
The separately listed `Crypto.NVDAX/USD` stream (numeric Pro ID `1833`) is not
assumed equivalent to the regular `Equity.US.NVDA/USD` feed. No key was read,
plan changed, contract deployed, or transaction sent. Keep both NVIDIA routes
disabled until those checks pass.

Sources: Pyth [Terminal and package description](https://docs.pyth.network/pro/pyth-terminal),
[HyperEVM contract addresses](https://docs.pyth.network/pro/contract-addresses),
[EVM integration guide](https://docs.pyth.network/pro/use-prices-on-blockchain/evm),
and [on-chain fees](https://docs.pyth.network/pro/on-chain-fees).

## Pyth re-check — 2026-11-19

The current first-party Pyth documentation changes the cost wording in the
2026-11-18 snapshot, but does not establish a production-ready free equity feed
for SENT:

- Pyth Terminal currently offers a free API trial key with no credit card. The
  same official docs say paid plans cover ongoing use; a trial is not a durable
  production entitlement and the public page does not state its duration or
  limits. Hermes requests now require an API key after the August 26, 2026 Core
  upgrade.
- Pyth's current Sponsored Feeds page includes HyperEVM among the EVM networks,
  but its HyperEVM table currently displays no sponsored feed rows. SPYx is not
  shown as a sponsored HyperEVM feed. A self-operated price pusher still needs a
  Pyth Pro API key and pays the onchain gas for updates; the documentation warns
  that tighter update thresholds raise that gas cost.
- The 2026-11-18 direct HyperEVM read remains the actual chain observation: the
  SPY equity value was stale by far more than SENT's 60-second freshness bound,
  and the 24/7 SPY index feed reverted. The free API trial does not repair those
  onchain observations or prove access to a fresh SPYx-compatible feed.
- A fresh direct RPC read on 2026-11-19 reconfirmed the same state: `getPriceUnsafe`
  returned `price=61075000`, `expo=-5`, `publishTime=1739981335`
  (`2025-02-19T16:08:55Z`) for `Equity.US.SPY/USD`; `getPriceNoOlderThan(..., 60)`
  reverted, and both reads for `Equity.Index.SPY/USD` reverted. The official
  Sponsored Feeds page now lists `SPYX/USD` under Ethereum, but HyperEVM's current
  sponsored table contains no SPY/SPYX equity row. This is a fresh check of the
  chain and catalog, not proof that a Pyth Pro update subscription is unavailable.

**Disposition:** Pyth remains an evaluation path only. Recheck the Terminal's
current entitlement in the account and confirm a fresh, multiplier-compatible
SPYx feed/update route before changing the oracle decision. Do not rely on the
old claim that current data plans start at $500/month; current official docs
describe a free trial and paid ongoing plans without publishing a universal
price. No oracle config or onchain state changed from this research.

Sources: [Pyth Terminal trial](https://docs.pyth.network/pro/pyth-terminal),
[current sponsored feeds by network](https://docs.pyth.network/pro/sponsored-feeds),
[Pyth Core upgrade and API-key requirement](https://docs.pyth.network/pro/pyth-core-upgrade).

## External re-check — 2026-11-18

This update preserves the Day 8 record as history and corrects its claims using
new first-party API metadata and direct mainnet reads. These changes do **not**
clear the production gates by themselves.

- **V-02 remains verified for canonical deployment identity, but the old narrative is stale.**
  xStocks' public asset API now lists HyperEVM deployments and V2 wrapper addresses.
  Hyperliquid's `spotMetaAndAssetCtxs` metadata maps those V2 wrappers to Core spot
  tokens and markets. For example, SPYx's official wrapper V2
  `0xe7e553cd128f0011777323a0b44a7b96ea1cb540` matches `SPYX`'s `evmContract.address`
  and spot market `@703`; the `spotPx(703)` HyperEVM read precompile responds.
  Therefore the old statements that no xStock has a Core spot market are superseded.
- **V-03 remains a production blocker for raw xStocks.** The raw issuer token rebases.
  A non-rebasing V2 wrapper is a candidate quote asset, but SENT must verify its
  provenance, transfer behavior, decimals, corporate-action conversion and accounting
  against SENT's wrapper/market contracts before setting any registry gates.
- **V-11 remains PARTIAL.** The xStocks API lists a HyperEVM Chainlink pull-based
  Tokenized Asset (v10) stream for SPYx: feed ID
  `0x000ac6ba1b453a15c1fe9dcd82265ca47bcd04e7b3667de1623617c45cef2a77`, verifier
  `0x60fAa7faC949aF392DFc858F5d97E3EEfa07E9EB`, and 18 decimals. Fresh HyperEVM
  reads confirm deployed code and `typeAndVersion()` returns `VerifierProxy 2.0.0`.
  The xStocks API identifies that same address as the feed's verifier. This is a
  credible integration path, not a configured SENT oracle: SENT currently consumes
  a Chainlink-style `latestRoundData()` adapter, while Data Streams supplies signed
  reports that must be fetched and verified. A direct request to the official latest
  report endpoint returned HTTP 400 requiring `UserId`, `Timestamp` and
  `HmacSignature` headers, so report delivery credentials are not public/anonymous.
  The current official Data Streams network source now lists HyperEVM Mainnet
  with verifier `0x60fAa7faC949aF392DFc858F5d97E3EEfa07E9EB`, matching the xStocks
  metadata and the live proxy. This resolves the network-support discrepancy, but
  not authorization for SENT's account to fetch this specific feed. On 2026-11-18,
  an unauthenticated request to Chainlink's public discovery endpoint returned
  175 live streams and did not include the xStocks SPYx v10 feed ID; it returned
  three SPY/USD V11 equity streams instead. This is not proof that SPYx is
  unavailable: Chainlink documents that hidden streams are excluded from public
  discovery and require an entitled account's authenticated discovery request.
  SENT has no credentials to perform that entitlement check. The public
  SPY/USD V11 stream is not a substitute: it has no xStock multiplier, and the
  HyperEVM address directory classifies it as a Streams verifier entry rather
  than a push-feed proxy. It does not remove the access requirement or solve
  SENT's wrapper conversion requirement. A first SENT v10 aggregator shim now
  exists in source and compiles; it is not deployed, tested, or independently
  audited. Its full-report envelope parsing and empty verifier fee-metadata call
  match Chainlink's current EVM verification guide; this checks the documented
  interface shape, not the shim's v10 decoding or live verification. An optional
  server-only HMAC credential configuration and fixed-feed API route can return
  signed SPYx payloads, but no credentials are configured and the live authorized
  endpoint has not been verified. The create page now offers
  a wallet-reviewed update when an asset's configured source reports the fixed
  SPYx feed ID; launch config exposes each asset's adapter source. The user
  reviews the SDK-built intent before sending it through their wallet, and the
  transaction center tracks the update. No compatible source or deployed shim is
  configured.
  The new shim constructor binds it to one quote asset, the adapter checks that
  optional binding against the asset being priced, and the page checks both the
  feed ID and SPYx route identity (official V2 wrapper or SENT wrapper over the
  canonical raw SPYx) before preparing a transaction. Deploy a separate shim per
  selected wrapper; this source path has not been live-verified.
  Expiry/freshness, multiplier treatment, market status, and weekend/split
  handling remain unverified in SENT. Review against the
  v10 schema and xStocks' multiplier guidance found and fixed a source-level gate:
  the shim now rejects every report with a scheduled activation timestamp, rather
  than only after activation. It also starts a 15-minute price-read cooldown on
  first report and whenever the observed multiplier changes. A late report starts
  that cooldown when SENT observes the change, which is conservative; this new
  behavior is compiled but not tested, audited, or deployed.
- **Pyth fallback recheck (PRIMARY, 2026-11-18):** a direct HyperEVM read of
  Pyth `getPriceUnsafe` at `0xe9d69CdD6Fe41e7B621B4A688C5D1a68cB5c8ADc` for the
  `Equity.US.SPY/USD` feed ID
  `0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5`
  returned `price=61075000`, `expo=-5`, `publishTime=1739981335`
  (`2025-02-19T16:08:55Z`). The 60-second `getPriceNoOlderThan` used by
  `PythAggregatorShim` therefore cannot serve it. The `Equity.Index.SPY/USD`
  24/7 feed ID `0xf32c3fbdd20b846bb53395bf175c42955e00b1bffb5a778bb624982b318f5461`
  reverts when read from the same HyperEVM contract. Current Pyth docs require an
  API key for update endpoints. The Core Upgrade documentation at that time
  described paid data plans; see the 2026-11-19 re-check above for current free
  trial and paid-plan wording. This is not yet a viable production replacement
  for the missing entitled SPYx stream.
- **V-22 must be read narrowly.** No xStock HyperSwap V3 pool was confirmed in the
  earlier audit. HyperCore spot markets now exist for several xStock wrappers. These
  are different venues and do not supply SENT's missing HyperSwap position-manager
  or permanent-lock configuration.
- **Production state is still blocked on chain.** Direct calls to the deployed
  LaunchpadFactory returned zero for `router()` and `referencePrice()`. The current
  config also has an empty xStock allowlist and empty reference-price feeds.

Primary sources: [xStocks asset API](https://docs.xstocks.fi/apis/openapi/assets),
[xStocks oracle API](https://docs.xstocks.fi/apis/openapi/oracles/get_public_oracles_by_symbol),
[Hyperliquid spot API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot),
[HyperEVM read precompiles](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore),
[Chainlink Tokenized Asset v10 schema](https://docs.chain.link/data-streams/reference/report-schema-v10),
[Chainlink signed-report verification](https://docs.chain.link/data-streams/tutorials/evm-onchain-report-verification),
[Chainlink supported networks](https://docs.chain.link/data-streams/supported-networks),
[Chainlink's Discovery endpoint and hidden-stream behavior](https://docs.chain.link/data-streams/reference/data-streams-api/discovery-endpoint),
[Chainlink's published verifier network data](https://github.com/smartcontractkit/documentation/blob/main/src/features/feeds/data/StreamsNetworksData.ts),
[Pyth's current update API authentication](https://docs.pyth.network/api-reference/hermes/latest-price-updates),
and [Pyth Core Upgrade documentation](https://docs.pyth.network/pro/pyth-core-upgrade).

---

## Status summary

| Status | Count | Rows |
|---|---|---|
| VERIFIED | 12 | V-01, V-02, V-03, V-05, V-06, V-07, V-08, V-09, V-13, V-16, V-20, V-22 |
| PARTIAL | 3 | V-10, V-11, V-15 |
| UNVERIFIED | 4 | V-04, V-12, V-14, V-17 |
| OWNER-BLOCKED | 1 | V-18 |
| CLOSED | 1 | V-19 |

**No P0 row is open on engineering grounds. One decision is open on product grounds.**

- **V-02** — the full xStock suite is deployed on HyperEVM at Backed's canonical addresses, with
  byte-identical code to Optimism and BNB and **the largest EVM supply of the three**. Over
  $100M of assets. *This row first read "none", and that was wrong — the error and its shape are
  recorded in the row rather than overwritten.*
- **V-03** — every one of them **rebases**, and six of the ten largest have already moved off a
  1.0 multiplier. Not escapable by changing chain: Backed's own docs say every EVM deployment
  rebases. The observed direction is upward (dividends), which leaves surplus rather than
  insolvency; a reverse split is the failure case.
- **V-05** — they are also pausable and upgradeable behind proxies.
- **V-22** — no xStock has a HyperSwap pool at any fee tier. Holders exist; an EVM-side market
  between them does not.
- **V-11** — the launch anchor's mechanism is built and fork-tested against Pyth, whose equity
  feeds were stale in the Day 8 snapshot. The 2026-11-18 re-check found an xStocks-listed
  Chainlink pull-based v10 stream candidate on HyperEVM; SENT has not integrated it or verified
  report access yet. The earlier statement that no HyperCore xStock spot market existed is
  superseded by the dated update above.

§2 LOCKS every market to an official xStock, and the assets are there. What is not resolved is
how the accounting meets a rebasing quote asset. `RebaseDetector` currently refuses the entire
class, which is correct for today's balance-based accounting and is why the allowlist is empty.

The options are narrow and each is a product decision, not an engineering one: book collateral
in **shares** (the rebase-invariant unit these tokens already expose), quote against a
**non-rebasing wrapper**, or restrict to assets where a reverse split is implausible and accept
the tail. None is blocked by code.

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

## V-02 — Canonical HyperEVM xStock representations + exact addresses · **VERIFIED · P0**

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
STATUS:             VERIFIED (PRIMARY), Day 8 — the suite is deployed and this
                    chain holds the largest EVM supply of it
```

**Day 1 findings (context, not resolution):** xStocks launched tokenized US equities on
Hyperliquid — initially NVDAx, SPYx, QQQx, SKHYx, MUx — as **HyperCore spot markets** quoted
against USDC, bridged via Chainlink CCIP. Press describes them as composable on HyperEVM. That
is a SECONDARY lead. It does **not** establish a canonical ERC-20 address, and no address will be
written into `packages/config` until read from chain.

---

**Day 8 (PRIMARY): the whole xStock suite is deployed on HyperEVM.**

Every one of the ten largest xStocks by AUM exists on this chain, at Backed's address, holding
real supply:

```text
sym      units on HyperEVM     global AUM      multiplier
CRCLx           312,842.17    $ 82,435,641      1.0
STRCx           108,351.50    $142,453,184      1.0808929977
NVDAx           104,729.99    $ 40,197,476      1.0009180758
MSTRx            66,795.81    $ 72,231,310      1.0
GOOGLx           59,252.11    $ 36,006,406      1.0023772501
TSLAx            46,467.32    $ 71,847,306      1.0
SPCXx            30,000.00    $ 40,173,058      1.0
MUx              24,113.04    $ 17,590,887      1.0004015986
QQQx             16,106.56    $ 36,363,722      1.0027250297
SPYx             14,496.95    $ 55,393,845      1.0057145603
```

Priced against the spot reads available on-chain, CRCLx alone is ~$32M here, GOOGLx ~$20M and
TSLAx ~$11M. The three that can be priced from measured feeds come to **~$63M**; the suite is
well over $100M.

**These are Backed's canonical deployments, and that is asserted rather than assumed.** Backed
deploys deterministically, so the address is the same on every EVM chain — `SPYx` is
`0x90a2…dd48` on HyperEVM *and* on Optimism. The runtime bytecode hash is byte-identical across
all three chains checked:

```text
                 HyperEVM      Optimism       BNB
codehash         07152ae5      07152ae5       07152ae5
TSLAx supply     46,467.32      8,882.85    20,000.00
CRCLx supply    312,842.17     67,223.12    41,413.21
SPYx  supply     14,496.95      6,482.16    10,057.15
```

**HyperEVM is not a fringe deployment. It is the largest EVM deployment of xStocks** — several
times Optimism's and BNB's on every asset checked.

---

**THIS ROW WAS FIRST ANSWERED "NONE", AND THAT WAS WRONG.**

Recorded rather than quietly overwritten, because the mistake is more instructive than the
correction and the same reasoning would produce it again.

Two searches were run, both came back empty, and both empties were read as absence of the
asset:

| What was searched | What empty actually meant |
|---|---|
| HyperSwap V3 positions, sampled for token pairs | xStocks have **no HyperSwap pools**. True, and a different fact — a token can be widely held and never pooled. |
| HyperCore `tokenInfo.evmContract` for 400 HIP-1 tokens | xStocks are **EVM-native**. They were never HyperCore tokens, so they have no HIP-1 record to link. Asking that table about them is asking the wrong table. |

`SPYx` was found — through a pool belonging to its *wrapper*, `wSPYx` — and was then treated as
an anomaly rather than as the edge of a suite. The step never taken was the cheapest one
available: take a published xStock address and call `eth_getCode` on it. That is one RPC call,
and it would have answered the row on day one.

**The general shape:** absence in a derived index was read as absence in the world. A pool
registry indexes what trades; a HIP-1 table indexes what was bridged from Core. Neither is a
census of what exists, and both were treated as one. This is the same defect shape as the rows
recorded in `REVIEW-NOTES.md` — a reader with no writer, an argument nobody checked — turned on
the verification process itself.

---

**What this row does NOT clear.**

- **The assets rebase.** See V-03. It is not a HyperEVM problem and it is not fixable by
  changing chain: Backed's own developer documentation states that "on EVM chains … tokens
  implement the ERC-20 standard with rebasing logic". Ethereum, Arbitrum, Optimism, Mantle, Ink
  and BNB are all the same. Only Solana and TON keep raw balances constant, and neither runs
  this codebase.
- **There is no EVM-side trading venue.** No xStock has a HyperSwap V3 pool at any fee tier
  (V-22). Holders exist; a market between them does not yet.
- **`xstocks.com` and `docs.xstocks.fi` still do not list HyperEVM** among supported chains.
  Given identical bytecode at identical addresses with the largest supply of any EVM chain, the
  most likely explanation is that the site lags the deployment — but "most likely" is not
  first-party confirmation, and §420 asks for the confirmation before an address is written into
  `packages/config`.

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

Every xStock has multiplier semantics of the most dangerous kind — not one stray asset, the
whole suite (V-02). Measured multipliers on HyperEVM:

```text
STRCx  1.0808929977      NVDAx  1.0009180758      GOOGLx 1.0023772501
SPYx   1.0057145603      QQQx   1.0027250297      MUx    1.0004015986
```

Six of the ten largest have already moved off 1.0. Read directly from `SPYx` at
`0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48`:

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

**And it is not escapable by changing chain.** Their developer documentation is explicit: *"On
EVM chains (e.g. Ethereum, Arbitrum, Mantle, Ink, etc.) tokens implement the ERC-20 standard
with rebasing logic."* Only Solana (SPL Token-2022 Scaled UI) and TON keep the raw balance
constant and apply the multiplier for display — and neither runs Solidity. Any EVM chain this
product could move to has the same problem.

**Which direction it moves matters, and the observed direction is the safe one.** Every
multiplier measured is ≥ 1.0 and has drifted upward, because dividends accrue into it. A rising
multiplier leaves the market holding MORE than its books owe — surplus, not insolvency. The
failure case needs a **reverse split**, which drives the multiplier down. That is rare, absent
in practice for the ETFs (SPYx, QQQx), and entirely real for individual equities.

**There is a principled fix, and it is not a wrapper.** These tokens expose `sharesOf(address)`,
and shares are the rebase-invariant unit: `balanceOf = sharesOf × multiplier`. A market that
booked collateral in SHARES rather than balance units would be neutral to the multiplier in both
directions — every holder's claim scales with it, dividends accrue to whoever holds the claim,
and a reverse split cannot make it insolvent. That is an accounting change, not a workaround.

**It is also not sufficient, and D-017 explains why.** Shares fix the pre-graduation curve and
say nothing about the Uniswap V3 position graduation locks forever — V3 pays out from internal
liquidity accounting and has no `skim()`, so a rising multiplier buries every dividend in the
pool permanently and a falling one breaks it. The quote asset has to be non-rebasing end to
end, which is what `WrappedXStock` provides. Shares remain the right answer for anything that
never graduates.

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

**Be clear about what that detector currently does: it refuses the entire intended asset
class.** It is correct given today's accounting, and it is not a safety net catching one bad
token — it is the reason the allowlist is empty. Either the accounting moves to shares, or a
non-rebasing wrapper becomes the quote asset, or there is no market. That is a product decision
and the detector's job is to make sure it is taken deliberately rather than discovered after a
reverse split.

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

**Read on-chain, Day 8, against `SPYx` `0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48`** (whose
runtime bytecode is identical to every other xStock on this chain):

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

**It applies to the whole suite, not this one token.** All ten xStocks measured on HyperEVM run
byte-identical code (V-02), so these answers are properties of Backed's implementation rather
than of one deployment.

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

## V-06 — HyperSwap V3 core addresses · **VERIFIED · 2026-11-18**

```text
UNKNOWN:            factory, NonfungiblePositionManager, SwapRouter, quoter on HyperEVM
WHY IT MATTERS:     graduation venue (LOCKED §17, §20)
HOW TO VERIFY:      probe candidate addresses on-chain; confirm against first-party docs
BLOCKS:             GraduationRouter, §416 geometry, LP lock
OWNER:              Stream A
STATUS:             VERIFIED — first-party deployment docs and live bytecode /
                    factory-reference reads agree for factory, router, NPM and quoter
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

**Day 10 correction (first-party docs + PRIMARY reads):** HyperSwap now publishes its V3
deployment table at [docs.hyperswap.exchange](https://docs.hyperswap.exchange/docs/amm/contracts/hyper-evm/v3/).
It lists factory `0xB1c0fa0B789320044A6F623cFe5eBda9562602E3`, SwapRouter01
`0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D`, QuoterV2
`0x03A918028f22D9E1473B7959C927AD7425A45C7C`, and position manager
`0x6eDA206207c09e5428F281761DdC0D300851fBC8`. All four addresses return deployed
bytecode on HyperEVM. `factory()` on SwapRouter01, QuoterV2 and the position manager
returns the documented factory. This closes V-06 and these addresses are now recorded
in `packages/config/src/chain.ts`.

The graduation router and SENT's own permanent lock are still not deployed/configured.
The lock address is a SENT deployment output (V-09), not HyperSwap's DelegatedPositionVault:
SENT needs its own lock interface and its custom fee-destination behavior.

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

**Historical note (superseded 2026-11-18):** this section originally treated vendor
confirmation as outstanding. HyperSwap's first-party deployment page now confirms the
factory, `NonfungiblePositionManager`, `SwapRouter01`, and QuoterV2, and live HyperEVM
code plus `factory()` reads agree. V-06 is VERIFIED; see its dated update above. SENT's
own router and lock still require deployment and governance configuration.

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

## V-11 — Launch-anchor reference price + multiplier source · **PARTIAL · P0**

```text
UNKNOWN:            which feed provides the launch-time xStock/USD reference snapshot
WHY IT MATTERS:     §402 splits oracle roles. The anchor fixes P0 for the market's entire life,
                    so it must be manipulation-resistant; a manipulated anchor mis-prices the
                    market permanently.
HOW TO VERIFY:      identify available feeds on HyperEVM and review their security model
BLOCKS:             the launch flow. Every launch reverts with ReferencePriceNotSet
                    until governance configures a feed and points the factory at it.
OWNER:              Stream A
STATUS:             PARTIAL — the mechanism is built and fork-tested; the FEED is not
                    published on this chain and the update API needs a key
```

**A candidate exists, on-chain, with no third party in it (PRIMARY, Day 8).**

HyperEVM exposes HyperCore's read precompiles, and they answer:

```text
0x…0809  l1BlockNumber()      1,134,825,491     (live)
0x…0806  markPx(uint32)       810740, 252260, 15239
0x…0807  oraclePx(uint32)     810952, 252231, 15265
0x…0808  spotPx(uint32)       12480000, 16550000, 7168
0x…080B  spotInfo(uint32)     spot market metadata
0x…080C  tokenInfo(uint32)    HIP-1 token metadata, incl. evmContract + decimals
```

`oraclePx` is Hyperliquid's own oracle price and `spotPx` is the live spot mid. For an xStock
this is the price **at the venue where the asset actually trades**, read from the chain rather
than pushed by a publisher — which answers §253's manipulation-resistance concern differently
and better than any third-party feed available here: there is no separate publisher to
compromise, no staleness window of someone else's choosing, and no off-chain signing key.

`USPYX` (V-02) has spot market 189 and reads `spotPx(189) = 620000000`, so the path is not
theoretical.

**Why this is PARTIAL and not VERIFIED.** Three things are unresolved and two of them are real:

1. **It prices the wrong thing today.** §402's anchor is xStock/**USD**. `spotPx` is quoted in
   the spot market's own quote token, which needs reading from `spotInfo` and converting. That
   is mechanical, and it is not done.
2. **The precompiles' own failure modes are unmeasured.** What `oraclePx` returns for an unknown
   index, during a HyperCore halt, or for a delisted market has not been tested. The adapter
   refuses rather than clamps, so a wrong answer becomes a refused launch rather than a
   mispriced market — but "refuses correctly" has to be demonstrated, not assumed.
3. **It is moot while V-02 stands.** There is no linked xStock to price. A feed decision made
   before the asset question is settled would be a decision about a market that cannot exist.

---

**Day 8, continued: the field is narrower than it looked, and it is now measured.**

This section records the state observed on Day 8. Its conclusion that there were
no HyperCore xStock spot markets and Pyth was the only available xStock price
source was superseded by the 2026-11-18 external re-check at the top of this
ledger. Keep this dated passage as history, not as current production guidance.

The HyperCore precompiles above turned out **not** to price an xStock. `spotPx` reads a HIP-1
spot market, and xStocks are EVM-native with no HIP-1 linkage (V-02) — so there is nothing for
it to read. `oraclePx` prices perps, and a scan of all 233 perp assets on Hyperliquid found no
equity: the only equity-shaped ticker is `SPX` at index 171, which reads ~$0.60 and is the
SPX6900 memecoin.

Combined with V-22 — **no xStock has a HyperSwap pool** — that leaves HyperEVM with no venue
price for any of these assets at all.

**Day 8 snapshot: Pyth was the only source known at that time:**

```text
Pyth v1.4.6   0xe9d69CdD6Fe41e7B621B4A688C5D1a68cB5c8ADc
getValidTimePeriod()  60 seconds

crypto feeds, LIVE          HYPE   183s old        BTC  2,101s old
equity feeds, ABANDONED     TSLA    63 days old    NVDA    71 days    SPY  561 days
equity 24/7 variants        never published here — the call reverts
```

The equity prices are **present and wrong**, which is worse than absent: `getPriceUnsafe` would
return a two-month-old TSLA without complaint, and §402 fixes `p0` for a market's entire life.

**The mechanism is now built and fork-tested.** `PythAggregatorShim` presents one Pyth feed as
a Chainlink round, so `ReferencePriceAdapter` consumes it unchanged and every §135 refusal it
already implements — stale, zero, negative, out-of-band, unreadable, wrong decimals — applies to
a Pyth source with nothing rewritten. It reads through `getPriceNoOlderThan`, so an abandoned
feed **reverts rather than answering**, and `test/fork/PythFork.t.sol` asserts exactly that
against the live contract.

**What is left is not code, and it is not a research question either.** Someone has to publish
equity prices to HyperEVM's Pyth. Pyth is pull-based by design, so the intended pattern is that
the launch transaction carries the signed update — `updatePriceFeeds` then read, in one call.
Two obstacles, both operational:

1. **Nobody publishes equities here today.** Crypto feeds are maintained; equities are not.
2. **Pyth's public price-update API now requires authentication.** Every update endpoint tried
   (`hermes.pyth.network/v2/updates`, `/api/latest_price_feeds`, `benchmarks.pyth.network`)
   returned **401**. Only the feed-metadata endpoint answers anonymously. Fetching a signed
   update needs a key or a paid endpoint.

**Deliberately not adopted yet.** §253 attaches criteria to this choice and the adapter already
refuses every launch until one is made. The shim is deployed by nobody and configured for
nothing; wiring a feed in is a governance action taken once the two obstacles above are
resolved, not a code change.

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

**And the hosted service covers it too** — checked after the contracts, because the two are
different questions and only the first is a custody one.

```text
safe-config.safe.global/api/v1/chains  ->  chainId 999, "HyperEVM", shortName "hyper-evm"
```

So a Safe can be created and operated through `app.safe.global` like any other chain, rather
than by hand-building calldata. That does not change what §555 requires; it changes how
painful the key ceremony is, which is the difference between a procedure people follow and one
they work around.

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
HOW TO VERIFY:      official docs confirm 50-block eth_getLogs cap, 100 EVM calls/min/IP,
                    no JSON-RPC WebSocket, and no historical-state support on default RPC;
                    select/test an archive provider and redundant endpoints
BLOCKS:             indexer design, reorg strategy, realtime SLOs
OWNER:              Stream C / H
STATUS:             PARTIAL — public endpoint limits documented; provider failover,
                    archive depth, replay duration and sustained workload remain unverified
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
UNKNOWN:            the gas ceiling a graduation transaction must fit inside on HyperEVM
WHY IT MATTERS:     atomic graduation inside the crossing buy exceeded the ordinary lane.
                    D-016 splits the crossing buy from migration; finalization still needs
                    the large lane and markets remain unavailable during the handoff.
CURRENT ASSUMPTION: (none needed - measured)
HOW TO VERIFY:      sample eth_getBlockByNumber gasLimit across the tip; measure the
                    graduation path on a fork
BLOCKS:             §14 graduation design, §16 failure handling, §178.4 release gate
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

**Historical design consequence (superseded by D-016).** Under the earlier atomic design, a buy
that crossed qG needed ~5.4M gas. A user who had not opted into the large lane could not have
that transaction included, so the crossing buy failed for essentially every buyer.

**Current design response — D-016.** The crossing transaction now closes the curve and refunds
unspent quote without creating the pool. A separate, permissionless `finalizeGraduation()`
performs the ~5.4M-gas migration on the large lane. Until it succeeds, the market remains in
`GRADUATING`; curve trades are closed and the pool is not yet available. This removes the
crossing-buy gas failure, while leaving a real handoff window and a keeper/holder finalization
dependency. The decision log records the measured crossing-buy and migration costs.

**NOT verified, and it matters.** The mechanism for opting an address into the large lane is
a Hyperliquid L1 action, not an EVM call, so nothing above measures it. What is measured is
that the two lanes exist, what they cap at, and how often each is produced. Any design that
depends on a specific opt-in mechanism must confirm it first-hand before it ships.

**And it applies to LAUNCHING, which was the dangerous one.**

`launch()` deploys a `LaunchToken` and a `LaunchMarket` inside one transaction, so
the creator pays 200 gas per byte of both. Measured with
`script/LaunchGasProbe.s.sol`, at the optimizer setting this repository shipped
with:

```text
launch(), minimal metadata      3,014,132    OVER
launch(), typical metadata      3,062,062    OVER
launch(), MAXIMUM metadata      3,068,481    OVER
```

Every one of them over the 3,000,000 ceiling — **including a launch with no
metadata at all.** That is not an operations problem like the deployment or the
graduation. It means every CREATOR would need a Hyperliquid L1 opt-in before
using the product, and a launchpad whose core action requires an L1 action most
users have never heard of is not a launchpad.

It was 2% over, which is why it had to be measured rather than reasoned about.

**Fixed by the optimizer, after checking what it cost.** Dropping `optimizer_runs`
from 1000 to 400 shrinks `LaunchMarket` from 9,516 to 8,880 bytes:

```text
runs   launch() at MAX metadata      buy() warm
1000              3,068,481  OVER       160,862
 400              2,893,462  fits       160,913
```

175,019 gas saved on every launch; **51 gas added to every trade** — 0.03%.
Trades are far more frequent than launches, so the direction of that trade-off
was measured rather than assumed before taking it. Headroom at maximum metadata
is 106,562 gas.

The probe now REVERTS if a launch stops fitting, rather than printing a number
nobody reads.

**It applies to DEPLOYMENT too, and that was nearly missed.**

The lane is a property of the chain, not of graduation, so it constrains every
transaction — including the ones that put the protocol on-chain. Measured with
`script/GasProbe.s.sol`:

```text
WrappedXStockFactory      1,552,649    fits
XStockRegistry            1,385,239    fits
LaunchpadFactory (+2)     7,360,896    2.45x the ceiling  <-- needs the large lane
ReferencePriceAdapter       691,542    fits
                         ----------
total                    10,990,326
```

`LaunchpadFactory`'s constructor also deploys `FeeVault` and `HolderRewardVault`,
so one transaction pays for three contracts. **The deployer account must be opted
into the large lane before it starts**, and that is a Hyperliquid L1 action rather
than anything the script can do — with a failure mode of a transaction that never
mines rather than one that reverts.

*Measured with a SCRIPT, not a test.* The first attempt used `forge test` and
reported 3,228 gas for a 22KB deployment: the test VM does not meter the
code-deposit cost, so every figure came back three orders of magnitude low and the
assertions passed on nonsense. A gas measurement taken in `forge test` is not a
gas measurement.

**Response:** §16 and §95.6 already prescribe one, for exactly this case - "jika dependency
eksternal mengharuskan retryable workflow: deterministic escrow, permissionless
`finalizeGraduation()`, no retry caller privilege." The block lane is that external
dependency. Carried into D-016 rather than decided here; this row records the constraint.

---

## V-21 — The ticker `SENT` is already taken on Hyperliquid · **VERIFIED · surfaced**

```text
UNKNOWN:            (not previously asked)
WHY IT MATTERS:     branding, HyperCore listing, and every place a user types a ticker
CURRENT ASSUMPTION: (none needed — measured)
HOW TO VERIFY:      read HyperCore tokenInfo for the token named SENT
BLOCKS:             nothing in code. Named because it is cheaper to know now.
OWNER:              owner
STATUS:             VERIFIED (PRIMARY), Day 8
```

Found while reading `tokenInfo` for V-02, not looked for:

```text
HyperCore token index 186   name "SENT"
  evmContract   0xed912f61368be50835ad7696f67d106b0cd08fe2
  name()        "Sentient AI"
  symbol()      "SENT"
  decimals      18
  totalSupply   1,200,000,000
  spot market   135    spotPx(135) = 12
```

An unrelated project already holds `SENT` as a HIP-1 token on HyperCore, with a linked EVM
contract and a live spot market. This protocol does not issue a token, so nothing here breaks —
but the name collides on the chain this product launches on, in the venue its own quote assets
would trade in.

Recorded rather than acted on. It is a naming decision, and the only thing worse than making it
late is making it silently.

---

## V-22 — EVM-side trading venue for the quote asset · **VERIFIED · surfaced**

```text
UNKNOWN:            can a trader acquire the quote asset ON HyperEVM, and can a graduated
                    market's pool find natural counterparty flow
WHY IT MATTERS:     §14 graduates every market into a HyperSwap V3 pool quoted in the xStock.
                    A quote asset nobody can buy on this chain makes the post-graduation venue
                    a pool with one side and no traffic.
CURRENT ASSUMPTION: (none needed — measured)
HOW TO VERIFY:      query the HyperSwap V3 factory for pools of each xStock against WHYPE,
                    USDT0 and USDC at every fee tier
BLOCKS:             nothing in code. Named because it shapes what launch day looks like.
OWNER:              Stream A / owner
STATUS:             VERIFIED (PRIMARY), Day 8
```

**Measured.** `getPool` was called for every xStock and dStock found, against WHYPE, USDT0 and
USDC, at the 500 / 3000 / 10000 tiers:

```text
AAPLd  GOOGLd  CRCLd  HOODd  SLVd  TSLA(Wagyu)  SPYx      →  NO POOL, any pair, any tier
```

The only equity-linked pool found on HyperSwap at all was for `wSPYx`, the ERC-4626 wrapper —
which is how SPYx was found in the first place.

**What this does and does not mean.** It does not mean the assets are unreachable: on
Hyperliquid the deep venue is HyperCore's order book, and holders bridge to the EVM side. Over
$100M of xStocks sit on this chain, so people clearly do. What it means is that **the EVM side
has no spot market for them yet**, and §14's graduated pool is an EVM-side venue.

For this product that is a two-sided fact. A market graduating into a pool whose quote asset has
no other EVM venue has thin external arbitrage keeping it honest — and equally, this protocol
would be creating the first real EVM-side liquidity for tokenized equities on this chain. Which
of those dominates is a launch-strategy question, not a verification one.

Recorded now because it is invisible until launch day, and expensive to discover then.

---

## Indexer bootstrap block re-check — 2026-11-19

Read-only `eth_getTransactionReceipt` calls against HyperEVM RPC confirm:

| Contract | Deployment transaction | Block | Receipt |
| --- | --- | ---: | --- |
| `XStockRegistry` (`0xA54BC1b31d17a6B9F76d6De1BE43B8efb8843c2B`) | `0xed7d84bd9a2a3ff93b4869afec466ae8f6aa350210ee9898464f4756352e7dbb` | 45,027,931 | success |
| `LaunchpadFactory` (`0xcEa3AcF9b70cE9807a99bcBdF0F93A437518Eaeb`) | `0xa1693e14fb822204516f00b9a623b6deeb493a9a3e8c0ef4ce9f87a5eae20f04` | 45,027,992 | success |

The indexer resolves the registry from the factory and includes registry logs in
its `getLogs` address set. Therefore its bootstrap block must include the
registry deployment, which predates the factory by 61 blocks. `START_BLOCK` is
now `45027931` in `.env.example`; a future redeployment must recalculate the
earliest monitored contract block. No container or chain transaction was run.

## Chainlink SPYx stream metadata re-check — 2026-11-19

A direct read-only request to xStocks' documented public Oracle API for
`SPYx`, filtered to `HyperEVM` and `Chainlink`, returned one `PullBased` record:
feed ID `0x000ac6ba1b453a15c1fe9dcd82265ca47bcd04e7b3667de1623617c45cef2a77`,
`reportSchema=v10`, `decimals=18`, quote asset `USD`, and verifier
`0x60fAa7faC949aF392DFc858F5d97E3EEfa07E9EB`. This confirms the exact stream
metadata used by `ChainlinkTokenizedAssetAggregatorShim.decimals()` and its
feed/verifier constants. It resolves the prior uncertainty about whether the
SPYx-specific feed uses 8 or 18 decimals; it does not establish that SENT has
authenticated report access, a production subscription, or a fresh payload.
The V-11 disposition therefore remains **PARTIAL / P0**.

Source: [xStocks Oracle API reference](https://docs.xstocks.fi/apis/openapi/oracles/get_public_oracles_by_symbol),
with the current public response queried on 2026-11-19. Chainlink's official
[v10 schema](https://docs.chain.link/data-streams/reference/report-schema-v10)
defines report field types and market/corporate-action semantics; the xStocks
API supplies this feed's decimals and deployment metadata.

## HyperCore SPYX quote-asset unit re-check — 2026-11-19

A fresh read-only `spotMetaAndAssetCtxs` request identifies market `@703` as
base token index `846` (`SPYX`, `szDecimals=2`) and quote token index `0`
(`USDC`). The accompanying context reports market prices in USDC. Thus the
previous `spotPx(703)` observation scaled to `735.45 USDC` per SPYX; calling it
`$735.45` silently assumed USDC parity. The BBO values are in the same quote
unit. A HyperCore-based launch anchor needs a separately trusted USDC/USD
conversion or explicit depeg bounds, in addition to market manipulation,
liquidity, and freshness controls. This correction further narrows that option;
it does not replace the Chainlink V-11 candidate or change the mainnet NO-GO.

Source: Hyperliquid's [spot metadata and context API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot).

## HyperCore SPYX market live-liquidity re-check — 2026-11-19

A fresh unauthenticated `spotMetaAndAssetCtxs` read identifies `@703` as token
indices `[846, 0]` (SPYX/USDC), but its current context reports `midPx: null`,
`dayNtlVlm: 0.0`, and `dayBaseVlm: 0.0`. Its `markPx` field is `0.99994`; with
no current midpoint or reported volume, that value is not a usable SPYX/USD
launch anchor. It is also denominated in the pair's quote token, USDC, so it
would not independently solve the USDC/USD basis.

A direct `spotPx(703)` read against the documented HyperEVM read precompile
`0x0000000000000000000000000000000000000808` returned `PrecompileError` on
mainnet. Hyperliquid's integration material describes direct order-book reads
as a possible HyperEVM primitive, while its read-precompile guide specifies
testnet for the listed L1Read calls. Until the mainnet precompile behavior,
the market's usable depth, and its USDC/USD treatment are independently
verified, this is not a substitute for a production equity/USD oracle.

Sources: Hyperliquid [spot metadata and contexts](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot),
[HyperEVM/HyperCore integration overview](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperevm),
and [read-precompile guide](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore).

## HyperEVM launch-gate re-check — 2026-11-19

At block `51,623,001`, a fresh read-only RPC check returned chain ID `999` and
deployed code at the configured factory. `router()` and `referencePrice()` are
zero; `launchFee()` is `40000000000000000` wei (`0.04 HYPE`). I resolved
`REGISTRY()` from the factory, then read `registeredCount()` and
`launchableAssets()` from that registry: count `0`, launchable list `[]`. The
earlier probe of `launchableAssets()` against the factory itself reverted
because that getter belongs to the registry; the corrected reads above match
the production API's factory-to-registry lookup. No chain state changed.

The local process environment and `.env.local.dev` contain neither Chainlink
report credential. This confirms the workspace's API route cannot fetch a
signed report as configured; it says nothing about secrets in a separate
production secret manager. The report route now also has a PostgreSQL-backed,
transactional token bucket shared across API replicas, with a five-request burst
and one-request-per-second refill. It fails closed when the shared budget cannot
be checked. This is an aggregate request-rate cap, not a provider subscription
spend cap; the provider account's own quota and billing terms still govern.
General API routes still have process-local limits, so a public deployment
should use an ingress limit for broad traffic protection. The new database
migration and API code have not been deployed in this check.

## Chainlink Data Streams zero-budget check — 2026-11-19

Chainlink's official changelog states that Data Streams free tiers were winding
down, with access terminating on September 1, 2026, and directs users to move
to paid subscriptions. That date has passed. SENT must not plan the SPYx v10
route on an assumed free tier; the owner must confirm an existing entitlement
or provide a subscription budget before production. The EVM verification call
uses empty fee metadata under current subscription billing, but that only means
there is no per-verification LINK payment from the user's wallet. It does not
waive the offchain subscription/access requirement.

Source: Chainlink's [Data Streams changelog](https://docs.chain.link/changelog?product=Data+Feeds),
entry “Data Streams free tier winding down” (June 24, 2026), and its
[onchain verification tutorial](https://docs.chain.link/data-streams/tutorials/evm-onchain-report-verification).

## Pyth SPYX zero-budget alternative check — 2026-11-19

Pyth's current sponsored-feed table lists `SPYX/USD` for Ethereum Mainnet, but
does not list it under HyperEVM Mainnet. HyperEVM's sponsored list currently
contains only `KHYPE/HYPE.RR`, `KHYPE/USD`, and `USDT0/USD`. Therefore the
Ethereum SPYX feed cannot be treated as an automatically maintained HyperEVM
price, and SENT cannot rely on a free Pyth push for the required launch oracle.

Pyth Core is deployed on HyperEVM and charges no on-chain update fee on EVM.
That makes a pull-update integration a plausible alternative to the current
Chainlink shim from a transaction-fee perspective, but does not make the data
path free: Pyth's August 2026 Core upgrade moved Hermes to authenticated API-key
access, its docs say the key includes a free trial and paid plans cover ongoing
use, and the sponsored-feed table warns that its push service can be delayed.
An independently operated pusher would also incur update transaction gas. No
Pyth report was fetched, verified, or submitted to HyperEVM in this check, and
no Pyth adapter is implemented in SENT. The Pyth path is a research candidate,
not a cleared production oracle or a zero-budget solution.

Sources checked 2026-11-19: Pyth [sponsored feeds](https://docs.pyth.network/pro/sponsored-feeds),
[HyperEVM contract addresses](https://docs.pyth.network/pro/contract-addresses),
[Core update flow](https://docs.pyth.network/pro/use-prices-on-blockchain/evm),
[Core upgrade/API-key requirement](https://docs.pyth.network/pro/pyth-core-upgrade),
[API-key trial and subscription](https://docs.pyth.network/pro/acquire-api-key), and
[on-chain update fees](https://docs.pyth.network/pro/on-chain-fees).

## Fee and Stockback vault state re-check — 2026-11-19

At block `51,623,586`, read-only RPC calls to the deployed vaults confirm the
FeeVault treasury is `0xed7709178ef1de028e965b4107f56b5aecbe92a2` and its
governance matches the factory Safe. The Governance Safe is version `1.4.1`,
with 3 owners and threshold 2; the Treasury Safe is version `1.4.1`, with 1
owner and threshold 1. The treasury signer and single-signer custody model
should be confirmed before public platform fees are routed there. The
HolderRewardVault governance also matches the Governance Safe, but
`guardian()` is zero, `attestorCount()` is `0`, `quorum()` is `0`, and
`claimsPaused()` is false. A zero quorum is intentionally rejected by
`submitCommitment`; the reward path is therefore not configured even though the
vault is deployed. Governance must set a guardian, onboard attestors and set a
valid nonzero quorum before Stockback distributions can be submitted. No
transaction or vault state change was made.

The launch-config API now reads these fields from the factory's reward vault and
includes them in its readiness result. The create UI blocks its launch intent
when the guardian/quorum is missing or claims are paused. This is a web/API
guard for the current deployment. The source factory now also checks the
reward vault's `launchConfigurationReady()` before `launch()`, so direct
callers are blocked in a deployment compiled from this source. The immutable
factory already deployed on HyperEVM predates that check; a replacement
deployment and complete reconfiguration are still required before the onchain
restriction applies to mainnet.

## Chainlink report daily cap — 2026-11-19

The earlier shared PostgreSQL token bucket only capped request rate. If a
public report endpoint were enabled with paid provider credentials, sustained
traffic could still consume a large daily request allowance. A follow-on
`0011_api_upstream_daily_budget.sql` migration adds a UTC-day counter for
authenticated report-route requests to the shared row. The API requires
`CHAINLINK_REPORT_DAILY_MAX_REQUESTS` whenever Chainlink report credentials are
configured; requests fail closed when the shared database budget is unavailable,
and daily exhaustion returns `429` with
the reset delay and remaining-budget headers. The configured ceiling is an
operator-selected cap and must not exceed the actual provider account quota; it
does not prove a provider-side spend limit or entitlement.

`pnpm typecheck` passed after the config, API and migration changes. The
credential route remains disabled in this workspace because no Chainlink
credentials or daily cap are configured. The migration and API change have not
been deployed, and database concurrency behavior has not been tested.

**Superseded 2026-11-20:** A licensing review found the public report-proxy
design did not comply with Chainlink's current Fair Use Policy. The endpoint,
its credentials/budget plumbing, and its migrations were removed before
deployment. The public API no longer returns signed reports; a future updater
must fetch privately and submit directly onchain after feed access and terms are
confirmed. See the launch-readiness report for the current evidence.

## NVDAx issuer token address re-check — 2026-11-20

The xStocks public Assets API identifies the HyperEVM NVDAx issuer token as
`0xc845b2894dbddd03858fd2d643b4ef725fe0849d` and its V2 wrapper as
`0xa8ddb5cd96b5222afe198316e9a57caa642850d5`. Read-only calls to HyperEVM at
block `51,700,018` returned deployed code for both. The issuer token reports
`symbol=NVDAx`, `decimals=18`, and
`multiplier=1.001701196801074`; the V2 wrapper reports `symbol=wNVDAx`,
`decimals=18`, and `asset()` equal to the issuer token address. The wrapper's
`asset()` binding and the xStocks API deployment record agree.

This confirms the official address pair for candidate configuration; it does
not pass SENT's eight registry gates, create SENT's own share-backed wrapper,
verify a live Chainlink report, or make NVDAx launchable. `XSTOCK_ALLOWLIST`
and `REFERENCE_PRICE_FEEDS` remain empty.

Primary sources: xStocks [Assets API](https://docs.xstocks.fi/apis/openapi/assets)
and the HyperEVM read-only RPC at `https://rpc.hyperliquid.xyz/evm` (block
`51,700,018`).

## NVDAx Chainlink v10 stream metadata — 2026-11-20

The xStocks public oracle-by-symbol API returns a HyperEVM `PullBased`
Chainlink Tokenized Asset v10 record for NVDAx: feed ID
`0x000a37a55df2ef907d8fa06af6632bc16da58a62b68be2e1994efaa037a0918a`,
18 report decimals, USD quote, and verifier proxy
`0x60fAa7faC949aF392DFc858F5d97E3EEfa07E9EB`. The proxy address agrees with
the existing SPYx v10 candidate and has already been read as deployed on
HyperEVM. This verifies public stream metadata, not SENT's account entitlement,
report freshness, decoded stream report for NVDAx, multiplier continuity, or
an end-to-end call through SENT's shim. V-11 remains PARTIAL / P0.

Primary source: xStocks [public oracle-by-symbol API](https://docs.xstocks.fi/apis/openapi/oracles/get_public_oracles_by_symbol),
queried for `NVDAx` with `network=HyperEVM` on 2026-11-20.

## HyperEVM launch-gate recheck — 2026-11-20

Read-only RPC at block `51,703,586` reconfirmed chain ID `999` and the deployed
factory's state: `router=0x0`, `referencePrice=0x0`, launch fee `0.04 HYPE`,
and factory links to the recorded registry and reward vault. Registry
`registeredCount=0`. The reward vault reports zero guardian, zero attestors,
zero quorum, and `claimsPaused=false`; its source-level
`launchConfigurationReady()` selector remains unsupported/reverting on this
deployed bytecode. Mainnet launch remains blocked, and no transaction or state
change occurred.

Local public-stack validation on the same date passed `pnpm typecheck`, the
`@sent/web` production build, and Docker Compose config parsing with temporary
dummy deployment values. The unfilled public template correctly rejects missing
factory, vault, and `START_BLOCK` values. No container was started. Test suites
were not run.

Evidence: read-only HyperEVM RPC `https://rpc.hyperliquid.xyz/evm` and local
workspace command output, 2026-11-20.

## Treasury Safe guard — 2026-11-20

Read-only calls to the configured treasury returned a Safe with threshold `1`
and one owner; the configured governance Safe returned threshold `2` and three
owners. The production deployment script now validates both Safe interfaces
and refuses treasury quorum below 2 or a threshold without a spare owner. The
existing 1-of-1 treasury therefore cannot pass a new HyperEVM deployment until
its Safe configuration is changed. A regression case was added for that exact
rejection. This does not change the already deployed FeeVault's treasury or
modify the Safe. No contract was deployed and no transaction was sent.

Evidence: read-only calls to `getThreshold()` and `getOwners()` on the existing
factory governance and treasury Safe addresses; local source changes in
`contracts/script/Deploy.s.sol` and `contracts/test/Deploy.t.sol`, 2026-11-20.
Solidity 0.8.28 with optimizer runs 400 and `viaIR` compiled the deploy script
and guard suite successfully. Test functions were not executed.

## GitHub release state — 2026-11-20

The repository is public (`Sent-lab/Sent`), with local `main` 12 commits ahead
of `origin/main` and additional uncommitted workspace changes. The only active
workflow listed on GitHub is CI; no deployment workflow is configured there.
The latest visible CI run, on 2026-09-05 at commit `ac6fba1`, failed its Docker
manifest check because the image recipe omitted `packages/observability` and
`services/keeper`. The current local Dockerfile includes both. That run also
failed the full-stack job while deploying `XStockRegistry`: the old fixture
supplied one constructor argument although the contract required governance
and wrapper-factory addresses. The current local fixture deploys
`WrappedXStockFactory` and supplies both arguments. These are source-level
reconciliations only; no CI run has validated the current workspace. No commit,
push, release, or deployment was made.

Evidence: GitHub [run 33953526440](https://github.com/Sent-lab/Sent/actions/runs/33953526440),
`gh repo view`, `gh workflow list`, local `git status`, Dockerfile and current
E2E fixture, 2026-11-20.

## Stockback zero-root and Guardian recheck — 2026-11-20

Static review found that `submitCommitment` used a zero Merkle root as an
empty-slot sentinel without rejecting it as input. A quorum-signed zero root
could replace a valid pending distribution while remaining indistinguishable
from an empty slot to activation and monotonicity logic. The vault now rejects
zero roots before evaluating or storing the commitment; a regression case
asserts the valid pending root, total and sequence survive the attempted
replacement. Further review showed Guardian cancellation erased the only record
of the highest accepted epoch: previously signed superseded data could be
replayed, and the cumulative total could decrease in a newer sequence. A
public per-market submission watermark now survives activation and cancellation;
new regression coverage rejects old signatures and decreasing totals, then
confirms a newer non-decreasing root still succeeds. The public getter lets
operators read the accepted sequence and cumulative floor after a cancellation.
Review also found
`setGuardian(address(0))` could remove the emergency brake after launch. It now
rejects zero addresses, and a regression case asserts the existing Guardian
remains configured.

Solidity 0.8.28, optimizer 400, `viaIR` compiled `Deploy`, `HolderRewardVault`,
`DeployTest`, and `HolderRewardVaultTest`; the 77-entry vault ABI was generated
from compiler output and `pnpm typecheck` passed. Tests were not executed. No
deployment or chain state changed. Sources: current workspace
`contracts/src/HolderRewardVault.sol` and
`contracts/test/HolderRewardVault.t.sol`, 2026-11-20.

## Pyth sponsored-equity availability recheck — 2026-11-20

Pyth's live sponsored-feed table lists three HyperEVM Core feeds (KHYPE/HYPE.RR,
KHYPE/USD and USDT0/USD) and no equities. Pyth Core EVM updates have a zero
protocol update fee, but since the August 2026 upgrade Hermes requires an
authenticated Pyth API key; network gas and feed entitlement still apply. Pyth
Pro verifies signed reports in the consumer transaction for 1 wei per EVM
verification, plus network gas. The public Pyth symbology API returns stable
records for regular `Equity.US.NVDA/USD` (Hermes ID
`b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593`),
`Crypto.NVDAX/USD`
(`4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f`)
and `Crypto.NVDAX/NVDA.RR`
(`b675c4e9f46d94afa9174a7df09966b77a2950970bb50a77ec8ad4fcfd8266f4`). The
Core Hermes IDs differ from Pyth Pro numeric IDs. The user's Terminal screenshot
shows a signed-in 14-day demo and 21 My Feeds results, but only part of the table
is visible; it cannot establish whether NVDA/NVDAX is in the account or whether
the API key is entitled to stream it. Catalog presence is not trial entitlement.
We still need to decide whether SENT's wrapped NVDAX should be priced from the tokenized
asset's USD feed or its redemption ratio against NVDA, and confirm its
multiplier, session/freshness behavior, trial and ongoing API access, and gas
payer. The repo's `PythAggregatorShim` is read-only and factory launch does not
call Pyth `updatePriceFeeds`; a Hermes ID alone cannot supply a fresh anchor.
Caller-supplied Pyth Core update data in the launch transaction is a candidate
low-recurring-cost architecture (zero Core update fee, user pays gas), subject
to access, integration and source-compliance review. Stock-backed launches
remain disabled pending those checks. No token, subscription, API key, or chain
state was changed.

Sources: Pyth [sponsored HyperEVM feeds](https://docs.pyth.network/pro/sponsored-feeds),
[Terminal equity package](https://docs.pyth.network/pro/pyth-terminal),
[EVM on-chain updates](https://docs.pyth.network/pro/use-prices-on-blockchain/evm),
[on-chain fees](https://docs.pyth.network/pro/on-chain-fees),
[Core upgrade](https://docs.pyth.network/pro/pyth-core-upgrade),
and [token permissions](https://docs.pyth.network/pro/faq#access-tokens--permissions).
Feed symbols and Hermes IDs were queried from Pyth's public [symbology API](https://docs.pyth.network/api-reference/price-feeds/symbols),
2026-11-20.

## NVDAx issuer and on-chain cross-check — 2026-11-20

The issuer's public NVDAx asset endpoint for HyperEVM returns raw asset
`0xc845b2894dbddd03858fd2d643b4ef725fe0849d`, chain ID `999`, and V2 wrapper
`0xa8ddb5cd96b5222afe198316e9a57caa642850d5`. The raw address matches the
NVDAx constant in `DeployXStockPriceSource.s.sol`. The issuer multiplier endpoint
returned `1.001701196801074`; at pinned HyperEVM block `51,706,107`, calling
`multiplier()` on the raw token returned `1001701196801074000`, the same value
at 1e18 scale. The issuer's cached price-data quote was `148.096`; that API
value is not accepted as a launch oracle.

At the same block, Pyth Core `getPriceNoOlderThan(..., 60)` for
`Equity.US.NVDA/USD` reverted `StalePrice` (`0x19abf40e`). `Crypto.NVDAX/USD`
and `Crypto.NVDAX/NVDA.RR` reverted `PriceFeedNotFound` (`0x14aebe68`), showing
that these catalog feeds had no stored Core update at this observation. This
does not invalidate the catalog feeds; they require a valid update before the
read-only `PythAggregatorShim` can use them. The exact price denomination for
SENT's wrapper is still not proven. No transaction or account change occurred.

Evidence: read-only HyperEVM RPC at `https://rpc.hyperliquid.xyz/evm`, pinned
block `51,706,107`; xStocks public API [`NVDAx asset metadata`](https://api.xstocks.fi/api/v2/public/assets/NVDAx?network=HyperEVM),
[`multiplier`](https://api.xstocks.fi/api/v2/public/assets/NVDAx/multiplier?network=HyperEVM),
and [`price data`](https://api.xstocks.fi/api/v2/public/assets/NVDAx/price-data?network=HyperEVM),
2026-11-20.

## Pyth trial vs. ongoing equity access — 2026-11-20

The current Pyth Terminal pricing page lists Free at `$0/month` with no API
access; Starter at `$500/month` with API access for crypto symbols; and Pro
starting at `$2,500/month` with equities and limited redistribution rights.
The user's account screenshot shows a 14-day demo trial, which is not an
ongoing free equity API entitlement. Pyth Core's zero EVM update fee does not
remove the API subscription cost or user-paid transaction gas. This makes Pyth
equities incompatible with a verified `$0/month` public production budget once
the trial ends, unless the provider grants a continuing sponsorship or a
separate licensed distributor covers the feed. No plan was changed and no key
was accessed.

Source: Pyth [Terminal Plans & Pricing](https://app.pyth.com/plans),
checked 2026-11-20. Pricing and package contents are provider-controlled and
must be rechecked before production.

## HyperCore NVDAX market-price recheck — 2026-11-20

Hyperliquid `spotMetaAndAssetCtxs` maps `@702` to token indices `[845, 0]`
(`NVDAX/USDC`), with NVDAX `szDecimals=2`. Its context reported mark `0.0001`,
no mid-price and zero 24-hour volume. A separate `l2Book` response showed
148.74/148.83 top prices with size 33.62 on each side. At pinned HyperEVM block
`51,706,686`, read-only `spotPx(702)` returned raw `148610000`, which scales to
`148.61 USDC` using the documented `10^(8 - szDecimals)` conversion. This
cross-source disagreement means a live spot observation is not enough to prove
freshness or price integrity. `spotPx` has no update timestamp; order-book depth
is cancellable/manipulable; earlier calls to the precompile reverted; and USDC
is not a direct USD observation. Do not use this route for an unrestricted
launch anchor without a separate risk design and review. No chain state changed.

Evidence: Hyperliquid public [`spotMetaAndAssetCtxs`](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot)
and [`l2Book`](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book)
responses; read-only HyperEVM RPC at `https://rpc.hyperliquid.xyz/evm`, block
`51,706,686`, 2026-11-20.

## WHYPE MVP quote and HYPE/USD source — 2026-11-20

Read-only HyperEVM RPC calls confirmed `WHYPE` at `0x5555555555555555555555555555555555555555`
has deployed code, `symbol() = WHYPE`, and `decimals() = 18`. The Chainlink
HyperEVM HYPE/USD standard proxy at
`0x2b25bc41d55de29f3a2e163f8eebf63966b25b57` returned a positive 18-decimal
answer and a recent `latestRoundData()` timestamp on 2026-11-20. Chainlink's
current official address table marks this feed unrated and lists a 0.5% deviation
and 86,400-second heartbeat. SENT's config uses the same 86,400-second maximum
age and a broad $0.10–$10,000 sanity interval. That interval is an explicit MVP
operator guard, not a Chainlink guarantee.

The existing factory accepts ERC-20 quote assets through the registry, and
`XStockRegistry.registerAsset` already supports a non-rebasing direct asset;
governance must still register WHYPE, verify its decimals, set the registry gates,
and enable it. The factory's USD anchor can price WHYPE through the existing
ReferencePriceAdapter. The web now exposes the generic quote-asset label and a
reviewed 1:1 HYPE/WHYPE wrap/unwrap flow.

This does not clear the deployed launchpad: the current factory still lacks a
graduation router and reference-price configuration, the live registry has no
registered quote asset, the deployed reward vault lacks the readiness selector
required by current launch code, and Treasury Safe threshold remains 1-of-1.
No transaction was sent and no account or subscription was changed.

Primary sources: Chainlink [HyperEVM feed address table](https://docs.chain.link/data-feeds/price-feeds/addresses?network=hyperevm&page=1&search=HYPE&showSvr=true);
read-only RPC `https://rpc.hyperliquid.xyz/evm` (`eth_getCode`, `symbol`,
`decimals`, and `latestRoundData`), 2026-11-20.

## Signed-in Pyth My Feeds NVDA entitlement check — 2026-11-20

With the user's authorization, the signed-in Pyth Terminal's **My Feeds** page
was searched for `NVDA`. The page returned **0 results** out of 21 feeds. Its
unfiltered list includes other equities (TSLA and QQQ), but no matching NVDA or
NVDAX feed. This is stronger account-specific evidence than the earlier partial
screenshot: this demo account's displayed My Feeds entitlement currently does
not include NVIDIA. The page describes My Feeds as the feeds the plan entitles
the account to stream.

This read only proves the Terminal's displayed feed entitlement; it does not
prove whether another product/API token could separately grant access, and it
does not turn the public NVDAX catalog record into a usable SENT oracle. No feed
was requested or added, no plan was changed, and no API key or credential was
viewed. The UI search was cleared and the original My Feeds list restored.

## WHYPE launch-anchor fork regression — 2026-11-20

Added `contracts/test/fork/HypeReferencePriceFork.t.sol` and ran it against a
read-only fork of HyperEVM using the official Chainlink HYPE/USD proxy and
canonical WHYPE. Both checks passed: the real WHYPE reports 18 decimals, the
feed produces a positive in-band answer no older than the configured 86,400
seconds, and the adapter refuses the same answer once it is beyond that bound.
The HyperSwap production-fork suite also passed all 5 tests; it measured
graduation at about 5.39M gas, which still requires HyperEVM's large block lane.
These results verify the code against live dependencies; they do not configure
SENT's deployed factory or authorize a launch.

A fresh read-only check at HyperEVM block `51,729,280` found the deployed
factory's `router` and `referencePrice` still zero, WHYPE still not launchable
in the deployed registry, and the deployed reward vault without the
`launchConfigurationReady()` selector used by the current code. Its Guardian,
quorum and attestor count read as zero. Governance Safe threshold is 2-of-3;
Treasury Safe is still 1-of-1. The launch fee remains `0.04 HYPE`. Mainnet has
not been changed.

## HyperEVM MVP router and WHYPE oracle configured — 2026-11-20

Governance Safe transaction
`0x5ccaf373dc99d877275ea3e2f7e98e5f204ab441b0573f69cc67e01f26fb4909`
was executed successfully; the factory now points to the verified SENT
graduation router `0xa4c6F6Cc2754CD8E47172f9e10e9a227F6E2339b`. The subsequent
two-call Safe batch
`0x0152b6f937461daf39093f6f737535863d87c7c254a1fceeb38558a7becea38f`
was also executed with 2/2 confirmations. It configured the existing
ReferencePriceAdapter for canonical WHYPE using the HyperEVM HYPE/USD proxy,
then connected that adapter to the factory.

Read-only HyperEVM RPC readback confirms `factory.router()` equals the router
above and `factory.referencePrice()` equals
`0x772AEDd551E38de727248e2925F53aAc80BE2b32`. The adapter's
`sourceOf(WHYPE)` returns the Chainlink proxy
`0x2b25bc41d55de29f3a2e163f8eebf63966b25b57`, `maxAge=86400`, `minUsdWad=1e17`
and `maxUsdWad=1e22`; the proxy reports 18 decimals and a positive, recent
answer. This closes the router and HYPE/USD wiring steps, but does not enable
WHYPE launches.

The router wiring was independently read back again while preparing the MVP
batch: factory `router()` is
`0xa4c6F6Cc2754CD8E47172f9e10e9a227F6E2339b`; its `LAUNCHPAD()` equals the
factory, `V3_FACTORY()`, `POSITION_MANAGER()` and `SWAP_ROUTER()` match the
verified HyperSwap V3 deployment, and `FEE_TIER()`/`TICK_SPACING()` read as
`10000`/`200`. Its immutable `LOCK()` is
`0xb0B94d10cFCABF57467CFa193CB992c27714969D`; both contracts have live code.
The canonical config and its readiness simulation now record these verified
addresses instead of the stale null values.

At the same read, `XStockRegistry.registeredCount()` remains `0`, and the
deployed HolderRewardVault still reports zero guardian, attestors and quorum.
Its `launchConfigurationReady()` call reverts, and the deployed factory runtime
does not include the current source's `StockbackNotReady()` guard marker. The
next release work is therefore WHYPE registration and evidence-backed gates,
Stockback guardian/attestor configuration, and a deliberate MVP compatibility
path for the older deployed bytecode. No token launch has been executed.

## sWHYPE public-launch batch prepared — 2026-11-20

Direct `registerAsset(WHYPE, ...)` was dry-run through the live registry and
exceeded HyperEVM's 30M eth-call ceiling in the deployed `RebaseDetector` probe.
The MVP now routes quotes through a minimal SENT-owned-by-no-one receipt token:
`sWHYPE` holds canonical WHYPE, wraps and unwraps exactly 1:1, and has no
administrative, fee, pause or upgrade controls. The wrapper source compiles with
Solidity 0.8.28, optimizer 400 and viaIR. Its CREATE2 address and initcode hash
are recorded in `docs/transactions/SENT-WHYPE-MVP.md`.

The web terminal now renders the two conversion steps for sWHYPE markets, and
the API assigns it the trusted quote label `sWHYPE`. API and web TypeScript
checks pass, and the Next.js production build completes. These are local code
checks; the wrapper has not been deployed and the live registry remains
unchanged.

The exact 10-action, zero-value Safe batch is serialized in
`docs/transactions/SENT-WHYPE-MVP.safe.json`. It has not been sent. It deploys
the wrapper; configures its HYPE/USD price; registers, attests and enables it;
sets the per-launch fee to zero; and configures a guardian, two reward
attestors and quorum 2. The gate payload
sets `legalReviewed=true`, which is an on-chain governance attestation and has
not been independently reviewed by counsel. The Safe owners must examine this
field before signing. The batch does not move user funds.

Even once the batch executes, reward claims are not fully operational: the repo
has deterministic distribution computation but no attestor-key signing and
submission service. Also, no public web host/domain deployment is configured in
this checkout. The launch contract route can be tested after the Safe batch,
but a genuinely public website and a claimable Stockback distribution each need
their respective operator steps.
