# SENT launch readiness — 2026-11-18

## Decision

**NO-GO for an unrestricted public mainnet launch today.** The core deployment
exists, but the live factory is not configured to launch. Candidate quote routes
are SENT share-backed wrappers over HyperEVM SPYx and NVDAx. Chainlink v10 stream
metadata is verified, and Pyth Pro catalog metadata includes dedicated SPYX and
NVDAX feeds, but neither provider's entitlement for SENT is verified. Pyth's
current plan page lists no API access on Free, crypto-only API access on Starter,
and equity API access on Pro starting at `$2,500/month`; the account's 14-day demo
trial is not a sustainable `$0` production entitlement. No stock oracle source
is deployed; the public Chainlink report proxy was removed after a licensing
review. A permitted private updater, verified wrapper accounting, independent
contract review and the remaining onchain configuration are still missing.

The website can be made public as a preview or read-only mainnet explorer without
representing the mainnet market, fees or rewards as live. A public mainnet beta
should not be announced until the release gates below pass. API and indexer
processes no longer refuse to start solely because launch configuration is
incomplete; the API reports launch availability from live factory/registry/feed
and Stockback-vault reads, and the create flow stays blocked while those checks
fail.

## Direct mainnet observations

- HyperEVM reports chain ID `999`.
- `LaunchpadFactory` at
  `0xcEa3AcF9b70cE9807a99bcBdF0F93A437518Eaeb` has deployed bytecode.
  `router()` and `referencePrice()` both currently return zero. A launch reverts
  when the reference-price adapter is unset, and the normal launch path also
  requires the graduation router.
- `XStockRegistry` at
  `0xA54BC1b31d17a6B9F76d6De1BE43B8efb8843c2B` and the other core contracts have
  deployed bytecode, but the repository's production configuration still has no
  launchable xStock, no price feed, and no graduation-router/lock address.
- The factory's configured launch fee is recorded in code/config as `0.04 HYPE`.
  This is paid by a creator when launching; protocol fee income still depends on
  actual trading volume.

These observations do not establish that the front end, API, indexer, Stockback
workers or claim flow are hosted and running in production.

The repository already contains the intended fee and reward economics: a `0.04
HYPE` creator launch fee; core trading fee split 65% creator / 35% platform; and
Stockback contributions of 1% on buys and 2% on sells. FeeVault and
HolderRewardVault contracts are part of the core deployment. These mechanisms
cannot produce public market fees or claims while no launchable market exists,
and Stockback operations still need configured attestors, an independent guardian
and funded transaction execution.

## Stock-pair evidence

The xStocks public Assets API lists HyperEVM deployments for SPYx, NVDAx, QQQx,
MUx and SKHYx, with official V2 wrapper addresses. Current Hyperliquid spot
metadata maps those wrappers to Core token contracts and spot markets:

| xStock | Official wrapper V2 | HyperCore spot market |
| --- | --- | --- |
| SPYx | `0xe7e553cd128f0011777323a0b44a7b96ea1cb540` | `@703` (`SPYX`) |
| NVDAx | `0xa8ddb5cd96b5222afe198316e9a57caa642850d5` | `@702` (`NVDAX`) |
| QQQx | `0x4c1ae29c159838fc1b224636e28e086eb69101f7` | `@704` (`QQQX`) |
| MUx | `0xe2047ee3bddb5c99ae428ab83df63f8730698e30` | `@706` (`MUX`) |
| SKHYx | `0x6215a58ed045d71f2561aaabe54f4c885c522998` | `@705` (`SKHYX`) |

The raw issuer xStocks are rebasing. The issuer's V2 wrappers are intended for
DeFi use, but their exchange rate is accounting information, not a price oracle.
SENT's existing architecture chose its own share-backed wrapper because its
market and graduation accounting is built around stable share units. No wrapper
is allowlisted today; the selected route still needs its eight registry gates and
live balance/accounting verification. The issuer V2 route remains unsupported by
the current multiplier-adjusted feed shim.

## Price-feed candidate

The xStocks public Oracle API lists a SPYx Chainlink pull feed on HyperEVM:

- Feed ID: `0x000ac6ba1b453a15c1fe9dcd82265ca47bcd04e7b3667de1623617c45cef2a77`
- Report schema: Tokenized Asset (v10)
- Verifier: `0x60fAa7faC949aF392DFc858F5d97E3EEfa07E9EB`
- The xStocks API lists this as the feed's verifier. Fresh HyperEVM reads confirm
  deployed bytecode and `typeAndVersion()` returns `VerifierProxy 2.0.0`.

The v10 report includes the equity `price`, `marketStatus`, `currentMultiplier`,
`newMultiplier`, activation time, and `tokenizedPrice`. SENT's current
`ReferencePriceAdapter` reads a push-style `latestRoundData()` feed. I added
`ChainlinkTokenizedAssetAggregatorShim.sol` to verify/cache signed v10 reports
and expose the underlying price times its current multiplier through that shape.
The shim now also binds its feed to one immutable quote-asset address, and
`ReferencePriceAdapter` refuses an asset-bound source when that binding differs
from the asset being priced. A separate shim instance must therefore be deployed
for each supported quote asset. The current shim returns `price ×
currentMultiplier`; this matches SENT's own share-backed wrapper, where one
wrapper unit represents one immutable underlying share unit. It does **not**
match the issuer's V2 ERC-4626 wrapper denomination, which already mints shares
using the live multiplier. The deployment script accepts SENT's canonical SPYx
or NVDAx wrapper, selects its corresponding v10 stream from the registered raw
underlying, and checks the registry's wrapper factory and canonical raw token
before deployment. It does not require the asset to be launchable yet, because
the price-source gate can only be completed after the shim is configured.
Supporting the issuer V2 wrapper needs a separately reviewed price adapter that
returns the unscaled equity price.
Review against Chainlink's schema and xStocks' multiplier guidance found and fixed
a corporate-action gate that only refused reports after activation. The shim
refuses reports with a scheduled activation, pauses price reads for 15 minutes
after its first report or a multiplier change, and requires a fresh update after
activation. This is conservative but still needs independent contract review and
full test execution before production.

The shim code and deployment script support separately bound SPYx and NVDAx
sources. They are not deployed or independently audited. The shim returns the
v10 underlying `price × currentMultiplier`, matching SENT's own share-backed
wrapper; it is not the issuer V2 ERC-4626 wrapper denomination. The source refuses
to provide a launch price while `marketStatus` is closed, the report is stale or
expired, or a corporate action is pending. It does not use the less liquid
`tokenizedPrice` field as a weekend fallback.

**Current correction:** SENT's public API no longer fetches or returns signed
Chainlink reports, and the browser no longer submits those reports. Chainlink's
Fair Use Policy prohibits proxying reports for redistribution to a wider
audience. A future updater must fetch through permitted private access and submit
directly to the onchain verifier. Chainlink's current billing documentation says
mainnet Data Streams is subscription-based and directs builders to request pricing;
it does not publish the previous `$150/month` starting price. The free-tier sunset
notice says access ended September 1, 2026. SENT has no confirmed feed entitlement
or price, so this path is not cleared for a $0 operating budget.

Pyth is not yet a production fallback on the evidence gathered: neither NVDAX/USD
nor regular NVDA/USD is listed as a sponsored HyperEVM Core feed. The user's
Terminal screenshot shows a signed-in 14-day demo and 21 My Feeds results, but
only part of that list is visible; it does not prove whether NVDA/NVDAX is
included or entitled for API updates. The official
sponsored-feed list currently shows crypto/stablecoin feeds on HyperEVM only.
Pyth Core can use sponsored on-chain updates or an update payload submitted by a
caller; Pyth Pro verifies signed data in the consuming transaction. SENT has not
integrated the latter path, and the account's current entitlement, post-trial
cost and NVDA/NVDAX denomination against SENT's share wrapper remain unverified.
No provider currently supplies a confirmed, compliant, zero-cost NVDAx launch-
price path for SENT.

No live authorized report was fetched, no chain transaction was sent, and the
shim was not deployed. `API_TRUST_PROXY` remains configurable and defaults to
false; production should enable it only behind an ingress that overwrites
`X-Forwarded-For` and blocks direct access to the API.

The public catalog does include SPY/USD V11 equity streams. That is not a
drop-in replacement: [V11 reports equity fields but no xStock multiplier](https://docs.chain.link/data-streams/reference/report-schema-v11), while
SENT's share-backed wrapper price needs the multiplier when a corporate action
changes the issuer token's share conversion. The official [HyperEVM price-feed
address page](https://docs.chain.link/data-feeds/price-feeds/addresses?network=hyperevm&page=1&search=SPY)
classifies its SPY/USD entry as a Data Streams verifier item, with no push-feed
proxy address. Using it would still require Data Streams access and
a separately reviewed multiplier source, so it does not solve the $0 budget gate.

Pyth is not a production fallback on current evidence. A direct HyperEVM Pyth
read returned the SPY equity price at `610.75` with a publish time of
2025-02-19, so SENT's 60-second Pyth shim rejects it; the listed SPY 24/7 index
feed reverts on HyperEVM. A current first-party re-check found that Pyth
Terminal offers a free API trial key with no credit card, while its docs say
paid plans cover ongoing use. Hermes now requires an API key, and the current
[Sponsored Feeds page](https://docs.pyth.network/pro/sponsored-feeds) displays
no sponsored feed rows beneath HyperEVM. Running a pusher also requires a Pyth
Pro API key and incurs onchain update gas. The trial does not prove durable
production entitlement, a fresh HyperEVM SPYx feed, or a $0 update path. Current
official sources do not publish a universal ongoing price, so remove the older
specific `$500/month` estimate from the decision; SENT still needs an account
entitlement check and a verified feed before using Pyth.

A fresh 2026-11-19 RPC read reconfirmed the same SPY publish time and the
60-second freshness revert. Pyth's current sponsored catalog shows `SPYX/USD`
for Ethereum, while its HyperEVM sponsored list has no SPY/SPYX equity row.
This keeps Pyth as an evaluation path; it does not rule out an account-authorized
Pyth Pro update flow, whose entitlement, cost after trial and multiplier handling
would still need verification.

The HyperCore SPYx market is now a technically verified, no-subscription price
source candidate, but it is not accepted as the launch anchor yet. At HyperEVM
block `51,620,968`, a pinned read-only `eth_call` to precompile `0x...0808`
(`spotPx`) with spot-pair index `703` returned raw `735450000`. Hyperliquid's
spot metadata maps pair `@703` to token `SPYX` (`szDecimals=2`) quoted in
`USDC` (token index `0`). Its spot context reported `markPx=735.45`,
`midPx=735.425`; applying the documented `10^(8 - szDecimals)` scale makes the
precompile value `735.45 USDC` per SPYX, not a direct USD observation. The same
info snapshot reported 24-hour notional volume of `21,587.8786 USDC` and base
volume of `29.27` SPYX. This proves a live mainnet read path and a market/index
mapping, despite the dedicated [read-precompile guide](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore)
still describing those precompiles as testnet-only. Hyperliquid's [spot API
documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot)
describes the metadata/context used for that cross-check.

At the same EVM block, the `bbo` precompile returned raw best bid/ask
`735650000` / `735920000` for spot asset ID `10,703` (the spot pair index plus
10,000, per Hyperliquid's [spot asset-ID convention](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids));
at the six-place scale this is `735.65` / `735.92 USDC`. That is a roughly 3.7 bp
top-of-book spread at the instant sampled. The BBO read exposes prices but not
depth or the time of the last SPYX-specific update, so a contract cannot use
this read alone to enforce minimum executable liquidity or a market-data age.

A fresh `spotMetaAndAssetCtxs` metadata read on 2026-11-19 reconfirmed that
`@703` uses token indices `[846, 0]`: base `SPYX`, quote `USDC`. Any HyperCore
price-anchor design must therefore combine the spot observation with a trusted
USDC/USD rate or an explicitly reviewed depeg bound. Multiplying by `1e18` or
formatting the spot value as dollars does not establish USD parity.

This is not equivalent to an independent equity oracle. `spotPx` exposes a
market-derived mark for one order book; the observable 24-hour volume is modest,
and a point-in-time orderbook can change or disappear. The [oracle guide](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/oracle)
describes validator spot oracles as inputs to perp pricing, not a decentralized
SPYx equity feed. Treat this as an option for a separately reviewed,
explicitly risk-limited launch mode only after manipulation bounds, market-state
checks, freshness handling, wrapper/share conversion, USDC/USD conversion risk,
and legal review are approved. It does not clear the unrestricted public-mainnet
release gate by itself.

## Code and operations blockers

1. **Oracle integration:** verify that SENT's provider account can access a
   multiplier-compatible SPYx/NVDAx feed, confirm subscription price and terms,
   then deploy and review the matching adapter. The account's current Pyth trial
   screenshot does not expose the full My Feeds list or a credential entitlement
   result for NVDAX/NVDA. Chainlink's authenticated feed entitlement remains
   unknown. Any updater must submit directly onchain; the
   public API cannot proxy Chainlink signed reports. No source is configured.
2. **Asset route:** select one quote asset and verify exact wrapper provenance,
   transfer behavior, decimals, multiplier conversion, halt handling and market
   accounting. Keep the registry disabled until all eight gates have evidence.
3. **Graduation:** HyperSwap V3 factory, SwapRouter, QuoterV2 and position-manager
   addresses are now documented by HyperSwap and match live onchain reads (V-06
   closed). A post-deployment script now deploys SENT's immutable lock/router
   pair and prints the Safe call, but that pair is still not deployed or
   configured. The earlier ledger records graduation at roughly 5.4M gas against
   a 3M default block lane, so the public path must handle Hyperliquid's
   large-lane requirement.
4. **Rewards safety:** the governance/treasury core exists, but `guardianSafe`,
   `opsRelayer` and `founderProfitSafe` remain unset in config. The guardian is
   the independent brake for Stockback commitment disputes. Attestors and claim
   operations need a real configuration and owner-controlled key handling. The
   finalizer computes datasets but deliberately does not sign or submit roots;
   no attestor signer/relayer is supplied by this repository. Independent
   operators must provide that service and key quorum before rewards can move.
   A read-only attestor proposal command now recomputes from each operator's
   database and checks the EIP-712 digest against the live vault, but signature
   collection and transaction submission still need an owner-run process.
5. **Public services:** `.env.example` and Docker Compose describe local
   development, not production hosting. API origins, HTTPS endpoints, database
   backup, indexer recovery, monitoring, relayer gas and deployment secrets are
   not configured here. Behind an ingress, set `API_TRUST_PROXY=true` only when
   the ingress overwrites forwarding headers and direct API access is blocked.
   The public API has no signed-report proxy; general API routes still need
   ingress-level limits across replicas. The default HyperEVM RPC is not suitable
   for an unmeasured public bootstrap: the official endpoint caps `eth_getLogs`
   at 50 blocks and allows 100 JSON-RPC requests per minute per IP, shared by
   the indexer and API. The public-beta template now requires an archive-capable
   provider URL, but no provider/quota is selected or verified.
   The graduation keeper is now an opt-in Docker profile and starts watch-only
   without `KEEPER_PRIVATE_KEY`; on HyperEVM, sender mode also requires the key
   to match the explicitly configured `PLATFORM_ACCOUNTS.opsRelayer`. A relayer
   key would enable automatic sends for every pending market, so the profile
   requires an explicit operator action.
6. **Distribution review:** xStocks describes its products as structured
   financial instruments and puts jurisdictional distribution assessment on
   integrators. The legal/operator row V-18 remains owner-blocked.
7. **Release verification:** wallet signing, complete mainnet buy/sell/fee/reward
   claims and graduation must be verified against the deployed addresses before
   describing those features as live. The repository's most recent GitHub CI
   runs predate the 12 local commits ahead of `origin/main`.

## Release gates

Mainnet public access requires all of the following:

- One verified stock wrapper is registered, enabled and correctly valued.
- Fresh, signed oracle reports are available and verified onchain; stale, closed,
  malformed, wrong-feed, future-dated and multiplier-transition cases fail closed.
- Factory `referencePrice` and graduation `router` are set to verified contracts.
- A small creator launch can complete; buy/sell fees reach the expected vaults;
  the Stockback record, proof and claim flow reconcile to chain balances.
- Graduation and permanent LP lock succeed within the real transaction/block lane
  requirements, with a tested fallback if the large lane is unavailable.
- Production services have public HTTPS endpoints, backups, monitoring, recovery
  instructions and funded operational accounts.
- The owner has resolved the legal/distribution restrictions and has a runbook for
  halts, bad feeds, reward disputes and incident response.

Until these gates pass, keep mainnet launch disabled. Do not populate the allowlist
or feed config based solely on API metadata, token branding, or a spot-market read.

## Workspace integrity

At the start of this audit, local `main` was 12 commits ahead of `origin/main`,
with eight modified frontend files and three untracked transaction-center files.
Those changes are existing work and must be preserved during follow-up changes.

## Local verification performed

- `pnpm typecheck` passed, including the existing uncommitted frontend work and
  the paged dataset endpoint, browser verifier, attestor proposal command and
  keeper relayer guard.
- The local stack parsed with the keeper profile using:
  `docker compose -f infra/docker/docker-compose.yml --profile keeper config --no-interpolate --services`.
  No container was started; the keeper healthcheck targets its `/healthz` liveness route.
- The new `DeployGraduation.s.sol` script compiled with Solidity 0.8.28,
  optimizer 400 and `viaIR` enabled. Foundry itself is not installed in this
  environment, so the Foundry build command could not run.
- The deployment source compiled earlier as `DeploySpyxPriceSource.s.sol` with
  Solidity 0.8.28, optimizer 400 and `viaIR`; it has since been renamed and its
  identifiers generalized to `DeployXStockPriceSource.s.sol`. The current source
  selects the v10 feed for canonical raw SPYx or NVDAx, checks that the chosen
  quote token is SENT's registered wrapper, deploys a quote-bound shim, and
  prints the governance calls without executing them. The renamed source was not
  recompiled in this follow-up and the script was not run; no contract or
  governance state changed.
- `ChainlinkTokenizedAssetAggregatorShim.sol` compiled with Solidity 0.8.28,
  optimizer 400 and `viaIR` enabled. No Solidity tests were added or run, so the
  new verifier/report behavior remains unverified beyond compilation.
- The optional signed-report API route described in the earlier audit was
  subsequently removed after the licensing review above; no public API route now
  returns signed reports. The live private report fetch/update service is not
  implemented or configured. A production multi-replica API deployment still
  needs shared ingress limits.
- The public epochs endpoint now has a paged `/epochs/:sequence/entries` route
  that returns the ordered cumulative leaves plus root/hash/count, so users can
  reconstruct the Stockback dataset independently. Docker's local API service
  now forwards `API_TRUST_PROXY` and optional Chainlink credentials from the
  environment without baking secrets into the image.
- The market's Stockback history now has a browser-side **Verify dataset**
  action. It fetches every page, rebuilds the tree with the canonical package,
  and reports whether the root and hash match the published values. It only
  reads public data; it does not sign or send a transaction.
- The homepage now reads `/launch/config` and displays live launch availability,
  including the API freshness badge. When checks fail or the API is unavailable,
  the CTA changes to **View launch requirements** and the page says launches
  cannot currently proceed. Fee and Stockback figures are labelled as terms for
  enabled markets and explicitly conditional on live trades/reward activation.
- The local Docker stack now includes `keeper` under the opt-in `keeper` profile.
  The default compose stack cannot begin sending graduation transactions just
  because a key happens to be present in the environment. The keeper also
  refuses HyperEVM sender mode until its private key matches the configured
  relayer address. See [the keeper runbook](KEEPER-RUNBOOK.md).
- `pnpm --filter @sent/finalizer proposal -- <token-address>` now rebuilds the
  latest dataset from the operator's own finalized indexer data, checks live
  vault funding/quorum/guardian/monotonicity, and compares its EIP-712 digest
  against `hashCommitment` on-chain. It emits typed data only; it has no signing
  key or submit path. See [the attestor handoff](STOCKBACK-ATTESTOR.md).
- The launch form exposes each asset's configured onchain price source. If the
  selected asset is SENT's registered wrapper over canonical SPYx, and the
  source reports the fixed feed ID with a matching immutable
  quote-asset binding, the page fetches a signed report, displays the SDK-built
  intent for review, and sends that exact intent through the user's wallet. A
  submitted update is recorded in the transaction center; the user must recheck
  launch preconditions after the onchain cooldown. No configured source or
  authorized report access exists to exercise this flow yet.
- The first production build found that the web package had not declared the
  canonical Stockback package used by the verifier. `@sent/stockback` is now a
  direct workspace dependency and the lockfile is updated.
- `pnpm build` exited successfully and compiled the web app. Static generation
  attempted to contact the default API at `localhost:8080` and logged connection
  refused errors because no local API service was running; the pages still
  generated through their unavailable-data fallback. Only the web package had a
  build task in the workspace run.
- No test suite was run in this pass. `git diff --check` reported no whitespace
  errors in the files changed during this pass; Git only warned that it will
  normalize line endings in the Windows worktree.
- The latest GitHub CI run available through `gh` is from 2026-09-05 and predates
  the 12 local commits ahead of `origin/main`. Its contract build passed; the two
  failures were concrete integration drift: the Docker manifest gate omitted
  `packages/observability` and `services/keeper`, and the E2E fixture deployed
  `XStockRegistry` without its now-required wrapper-factory argument. Both are
  corrected in the current worktree. The run does not verify current local code,
  and these fixes have not been pushed or observed in CI.
- No contract deployment, governance transaction, or public hosting action was
  performed during this audit.

## Follow-up copy audit — 2026-11-19

- The homepage's launch CTA and status now follow `/launch/config`; fee and
  Stockback terms are expressly conditional on enabled markets, actual trading,
  and reward activation.
- README, roadmap and Updates copy now distinguish protocol design, deployed
  core contracts, launch-blocking configuration, and the fact that the current
  repository changes are not deployed to the public site.
- `pnpm typecheck` passed and `pnpm build` exited successfully. Static
  generation logged `ECONNREFUSED` for the default local API, then generated
  pages using their unavailable-data fallback. No test suite was run.
- This copy audit does not change the mainnet decision or close any external
  release gate above.
- The README and comprehension guide now describe the implemented two-step
  graduation: the endpoint closes the curve, then anyone can submit the
  permissionless finalization transaction. They also disclose that curve
  trading is unavailable during this handoff. Solidity comments, the progress
  component and pending-market operations notes now describe `GRADUATING` as a
  state that can persist through venue failures or keeper outages.
- A read-only recheck of GitHub Actions still finds the latest remote run on
  2026-09-05 failing the Docker workspace-manifest gate and the PostgreSQL E2E
  job. Current local evidence shows the Dockerfile manifest gate passes and the
  E2E fixture now supplies the registry's wrapper-factory constructor argument.
  These checks do not rerun or clear the remote CI failure; the current worktree
  is ahead of `origin/main` and contains uncommitted changes.

## Oracle evidence re-check — 2026-11-19

- Current Pyth docs offer a free API trial, require API keys for Hermes, and
  describe paid ongoing plans without publishing a universal price. The current
  Sponsored Feeds page has no feed rows listed under HyperEVM; a self-operated
  pusher requires a Pyth Pro key and pays update gas. This corrects the older
  `$500/month` wording and does not establish a production-ready free SPYx path.
- No provider credentials, oracle config, contract deployment or chain state
  changed. The mainnet decision remains **NO-GO**.
- Evidence recorded in [the external verification ledger](VERIFY-LEDGER.md).

## Chainlink integration re-check — 2026-11-19

- The API HMAC implementation's timestamp uses `Date.now()` milliseconds and
  signs `GET path sha256(empty body) userId timestamp`, matching the format in
  Chainlink's current [JavaScript authentication example](https://docs.chain.link/data-streams/reference/data-streams-api/authentication/javascript-examples).
  The docs label their sample as a community example, so this is a format
  cross-check rather than a live authentication proof. No timestamp conversion
  change was needed; the earlier suspicion that it should use Unix seconds was
  incorrect.
- The shim's `verify(fullReport, bytes(""))` call matches Chainlink's current
  [EVM verification tutorial](https://docs.chain.link/data-streams/tutorials/evm-onchain-report-verification):
  current subscription billing uses empty fee metadata and does not require
  LINK funding for per-verification fees. This does not make Data Streams
  entitlement free; API access and subscription pricing still require account
  confirmation.
- `pnpm typecheck` passed after this review. No code, credential, deployment,
  governance or chain state changed, and no tests were run. Mainnet remains
  **NO-GO** pending the release gates above.
- The root `pnpm lint` command had reported success while Turbo executed zero
  lint tasks; no JavaScript/TypeScript linter is configured in the workspace.
  Removed that misleading no-op and renamed the CI job to `Typecheck` so its
  label matches the check it actually runs. Solidity lint remains informational
  in CI as recorded by D-008.
- Removed the launch-readiness startup gate from the API and indexer. They can
  now support public read-only access and indexing while launch remains disabled
  by the live launch-config response and the on-chain factory's own guards. This
  was source-reviewed and typechecked; no hosted service was started or deployed.
- The production web build completed and `pnpm typecheck` passed after the startup
  change. Next's static generation logged `ECONNREFUSED` for the default local API,
  then rendered the pages using their unavailable-data fallback. No test suite was
  run.
- The HyperEVM indexer now requires `START_BLOCK` to be explicitly provided, and
  the Docker stack no longer silently defaults it to zero. Other services do not
  require this indexer-only setting. Set it to the earliest monitored deployment
  block for normal indexing; set zero only for an intentional full-history
  reindex.
- `docker compose config --services` parsed successfully with explicit HyperEVM
  endpoints and `START_BLOCK`; no containers were started. The start block is
  now recorded from live receipts as the current registry deployment block
  below; change it if the core is redeployed.
- The local Compose stack now binds PostgreSQL, API and realtime host ports to
  loopback only. This prevents a local/developer stack from exposing its default
  database credentials or plain-HTTP endpoints on every network interface; a
  public deployment still needs HTTPS ingress and reviewed production secrets.
- Browser transaction activity now waits for 20 blocks before labelling a
  transaction confirmed, matching the indexer/finalizer settlement depth rather
  than stopping after two blocks. This is SENT's confirmation threshold, not a
  guarantee against deeper chain reorgs.
- Read-only HyperEVM RPC receipts confirm the current `XStockRegistry` deployment
  succeeded in block `45,027,931`, followed by the factory in block `45,027,992`.
  The indexer subscribes to registry events as well as factory and reward-vault
  events, so the correct bootstrap block is the earlier registry block. Using
  only the factory block would miss initial registry events. The `.env.example`
  now carries `START_BLOCK=45027931`; this is public deployment metadata, not a
  secret, and must be revised after any redeployment.
- A fresh read-only RPC re-check on 2026-11-19 returned chain ID `999`, the
  expected registry address, zero `router()` and zero `referencePrice()` on the
  factory, a `0.04 HYPE` launch fee, and an empty `launchableAssets()` list. This
  reconfirms that launches must remain disabled; no chain state changed.
- The wallet now re-reads the active account immediately before sending and
  requires the user to review again if it changed since the transaction was
  prepared. Buy/sell flow also tracks the approval transaction separately and
  reports clearly when approval was submitted but the trade was not. `pnpm
  typecheck` and the production web build passed; static page generation still
  logged `ECONNREFUSED` against the absent local API and used its fallback. No
  test suite was run.
- Read-only GitHub CLI inspection confirms the latest remote Actions run is
  still for `origin/main` commit `ac6fba1` from 2026-09-05 and failed two jobs:
  the Docker manifest completeness gate and the PostgreSQL full-stack
  projection job. The remote default branch is still at that same commit; these
  results do not cover the 12 local commits or the uncommitted worktree.
- A fresh read-only HyperEVM RPC check at block `51,618,817` reconfirms chain ID
  `999`, the factory's expected registry, zero `router()` and zero
  `referencePrice()`, a `0.04 HYPE` launch fee, and no launchable registry
  assets. The public-mainnet decision remains **NO-GO**; no chain state changed.
- `ReferencePriceAdapter` now handles future-dated feed rounds explicitly:
  `peekUsdPriceWad` reports them unavailable and `usdPriceWad` reverts with a
  named `FuturePrice` error rather than reaching an arithmetic-underflow panic.
  Solidity 0.8.28 compilation with optimizer runs 400 passed, the generated ABI
  includes the new error, and `pnpm typecheck` passed. No tests were run.
- The production Docker image now installs only workspace production
  dependencies; Node 22 handles the repository's TypeScript at runtime, so the
  image does not need the root typecheck/Turbo toolchain. The package/service
  manifest audit found no missing Docker `COPY` entries. Local image build
  succeeded with the non-root `node` user: 417,278,428 bytes versus 485,894,504
  bytes for the full-dependency image (about 14% smaller). No service was
  started, and no image was pushed.
- The API's in-memory rate limiter no longer clears every client bucket when
  its bounded map fills. It prunes only naturally refilled buckets and refuses
  new identities temporarily if all entries still carry a penalty, preserving
  existing clients' limits. Typecheck and `git diff --check` passed; no tests
  were run. Limits are still per API process, so multi-replica production needs
  a shared ingress/API quota as documented above.
- A further review of Chainlink's current [v10 schema](https://docs.chain.link/data-streams/reference/report-schema-v10)
  and [corporate-action handling guide](https://docs.chain.link/data-streams/tokenized-asset-streams/handling-stock-splits)
  found that the shim's 15-minute cooldown alone did not prove the underlying
  price updated after a multiplier activation. On a later multiplier change,
  the shim now also refuses reads until `lastUpdateTimestamp` is strictly after
  the announced activation time, or after the first onchain observation when
  SENT missed the announcement. Market status must still be open. Operators
  must independently confirm the theoretical price is continuous before
  enabling the source; the contract cannot infer an acceptable continuity band
  without an explicitly reviewed threshold. Standalone Solidity 0.8.28
  compilation of all 44 production source/dependency files passed with optimizer
  runs 400 and `viaIR` enabled; all 30 concrete artifacts, including the factory,
  market, shim, price adapter and xStock adapter, emitted bytecode with zero
  warnings. This used solc's standard JSON interface because Foundry itself is
  unavailable in this environment. No tests or independent review were run.
- A final UI/API unit audit found Stockback vault amounts are raw quote-token
  units, but the account and market screens had been formatting some of them as
  normalized 18-decimal values. Creator claim balances had the same ambiguity,
  and account summaries added amounts across different xStock denominations.
  API responses now carry quote/reward decimals alongside raw claim amounts,
  including Stockback and creator claim histories; the Stockback and creator
  screens format with those decimals, claim intents keep the raw amount, and
  account summaries no longer add unlike assets. `docs/API.md` now specifies
  those units.
  `pnpm typecheck`, the production web build, and `git diff --check` passed. The
  build logged `ECONNREFUSED` while static pages tried the absent local API, then
  generated all pages with the unavailable-data fallback. No tests were run.
  Mainnet remains **NO-GO** for the independent deployment, price-source,
  launchable-asset, attestor, governance, hosting/monitoring, and legal gates
  recorded above.

## Continuation re-check — 2026-11-19

- The documented xStocks public Oracle API currently returns the HyperEVM SPYx
  Chainlink record with `reportSchema=v10`, `decimals=18`, quote `USD`, and the
  feed/verifier addresses recorded above. This supports the shim's 18-decimal
  setting, but does not establish SENT's authenticated access or a fresh report.
- A fresh Hyperliquid `spotMetaAndAssetCtxs` read confirms market `@703` is
  `SPYX/USDC`. The precompile/BBO numbers previously labelled as USD must be
  read as USDC; a HyperCore oracle path would need a trusted USDC/USD conversion
  or reviewed depeg bound. The readiness section above now uses the correct unit.
- A fresh HyperEVM RPC read at block `51,623,001` resolved `REGISTRY()` from
  the deployed factory and then read `registeredCount()` and
  `launchableAssets()` from that registry: the current registry has zero
  registered assets and returns an empty launchable list. The factory still
  reports zero router and reference-price adapter and a `0.04 HYPE` launch fee.
- Neither Chainlink credential is present in the local process environment or
  `.env.local.dev`. The server-side report route therefore remains disabled in
  this workspace. A production secret manager could differ and must be checked
  in the actual deployment environment. The public route's in-process rate
  limits still need a shared ingress quota before a paid subscription is
  exposed to arbitrary internet traffic.
- `pnpm typecheck` passed after this continuation. No test suite, contract
  transaction, deployment, credential change, Git push, or hosting action was
  performed. GitHub's newest available workflow run is still the failed
  `origin/main` run from 2026-09-05; the current `main` is 12 commits ahead and
  the worktree contains uncommitted changes, so remote CI has not checked them.
- Public-mainnet status remains **NO-GO** until the independent price-feed
  entitlement, deployment/configuration, asset accounting, governance/rewards,
  operations and legal gates above are resolved.

## Contract/source re-check — 2026-11-19

- Reviewed `ChainlinkTokenizedAssetAggregatorShim.sol` against Chainlink's
  current v10 schema and corporate-action guide. The field widths and order,
  nanosecond `lastUpdateTimestamp`, `marketStatus == 2` open-market gate, and
  `price * currentMultiplier` conversion match the published schema. The shim
  also refuses expired/future reports, wrong feed IDs, non-increasing
  observations, closed markets, and announced or unsettled multiplier changes.
- This source review does not prove report verification against an entitled
  live SPYx payload, correct deployed verifier behavior on HyperEVM, or absence
  of contract vulnerabilities. Foundry tests and an independent contract audit
  are still required before public launch.
- The public RPC was re-read at block `51,623,001`: the factory has code, but
  its router and reference-price adapter remain zero, its fee is `0.04 HYPE`,
  and the registry's launchable asset array is empty. No chain state changed.
- A latest-state read-only check of the graduation script's HyperSwap
  dependencies confirmed deployed bytecode for the V3 factory, position
  manager and swap router; both router contracts report the configured V3
  factory, and fee tier `10,000` reports tick spacing `200`. The factory's
  governance address responds as Safe `1.4.1` with three owners and threshold
  two. This validates the script's address/factory preconditions, but does not
  prove the deployer has large-lane access or fund the deployment, submit the
  Safe action, or complete an actual graduation.
- A read-only vault check at block `51,623,586` confirmed the fee vault points
  to the configured Treasury Safe and shares the factory's Governance Safe.
  The Governance Safe is version `1.4.1`, 2-of-3; the Treasury Safe is version
  `1.4.1`, 1-of-1. The deployment script previously checked only that treasury
  was a contract. It now applies a 2-of-3 minimum quorum and spare-owner check to
  the Treasury Safe too, so that current 1-of-1 Safe cannot be used for a new
  HyperEVM deployment.
  The reward vault also shares that Governance Safe, but has no guardian, zero
  attestors and quorum `0`; it is not configured to accept Stockback
  commitments. Before rewards can operate, governance must appoint the guardian,
  add independent attestors and set a nonzero quorum no greater than the
  attestor count. No vault state changed.
- At block `51,623,699`, the registry's immutable wrapper factory has code.
  Its `wrapperOf(SPYx)` mapping is still zero, but its `predict(SPYx)` view
  returns `0xbc2a414cffd0e06e8540c3e25f3aa8f692ad4721`; that predicted wrapper
  has no code yet. The raw SPYx token reports 18 decimals. The next safe sequence
  is to create the canonical wrapper, register it as disabled, deploy/configure
  the quote-bound price source, connect the adapter, and only then set all eight
  verified gates and enable launches. Do not infer the missing Core token index,
  transfer-decimal offset, feed bounds or legal gate from this prediction.
- The public launch-config API and create form now include live Stockback
  readiness: guardian present, nonzero quorum covered by the attestor set, and
  claims not paused. The launch CTA fails closed until these checks pass, so an
  unavailable rewards path is not presented as a fully ready launch. This is an
  UI/API gate. The source contracts now also enforce this condition in
  `LaunchpadFactory.launch()` through the reward vault's
  `launchConfigurationReady()` view, preventing direct callers from bypassing
  it in a deployment of this source. The existing mainnet factory is immutable
  and does not have this new check; it must be replaced and the ecosystem
  reconfigured before this onchain protection is active.
- Solidity 0.8.28 standard-JSON compilation with optimizer 400, `viaIR`,
  Cancun and no metadata bytecode hash completed without warnings. The updated
  factory runtime is `21,136` bytes (below EIP-170's `24,576`-byte limit), and
  the updated reward vault runtime is `6,726` bytes. The package ABIs for both
  contracts were regenerated from that compiler output. No Solidity tests or
  independent audit were run.
- The core `Deploy.s.sol`, `DeployGraduation.s.sol` and the then-named
  `DeploySpyxPriceSource.s.sol` deployment scripts compiled with Solidity 0.8.28
  under the same settings. The two specialized deployment scripts produced no
  compiler warnings. The xStock script was subsequently renamed to
  `DeployXStockPriceSource.s.sol`; that rename was not recompiled in the latest
  follow-up. `Deploy.s.sol` produces code-size warnings for the local
  script harness itself (runtime `51,736` bytes and initcode `51,779` bytes);
  this is not the bytecode sent for the deployed factory, whose compiled runtime
  is within the limit. Foundry is unavailable here, so no script was executed.
- At block `51,624,550`, the live factory bytecode does not contain the
  `StockbackNotReady()` selector (`0x8406d091`), while the newly compiled source
  bytecode does. Calling `launchConfigurationReady()` on the currently deployed
  reward vault reverts, confirming the live vault predates that source change.
  This is direct bytecode/RPC evidence that the onchain launch gate is not yet
  active on HyperEVM.
- A consolidated read at block `51,624,533` still shows router and reference
  price set to zero, registry count and launchable assets both zero, a `0.04 HYPE`
  launch fee, Stockback guardian/quorum/attestors unset, and the predicted
  canonical SPYx wrapper (`0xbc2a414cffd0e06e8540c3e25f3aa8f692ad4721`) not
  deployed or registered. No chain state changed.
- Chainlink's current billing documentation describes subscription-based
  pricing and directs builders to request a quote; it does not publish the
  prior `$150/month` starting price. A June 2026 changelog states the free tier
  ended September 1, 2026. SENT's account entitlement and feed-specific price
  remain unknown, so the SPYx/NVDAx path is not cleared for a `$0` budget.

## Stale-data fail-closed re-check — 2026-11-19

- A production build with the local API stopped exposed a cached homepage state
  claiming launches were available while its freshness badge said `Stale`; it
  also rendered a cached `Northwind Industries` / `wTSLAx` sample market. The
  root cause was that the CTA trusted `data.ready` without requiring usable
  freshness, and ISR's stale-while-revalidate path could preserve old discovery
  responses when the API was down.
- The homepage now fetches launch configuration without the Next data cache and
  only permits launch availability for `LIVE` or `SYNCING` data. The create
  form follows the same gate, clears a previous config on failures, and re-reads
  fee/router/asset/price before opening the wallet; any changed review value
  requires the creator to inspect and submit again.
- Homepage and Explore hide market cards when their response is `STALE` or
  `RECONNECTING`; ISR-cached envelopes are downgraded after a shorter bounded
  age. The trade panel clears quote intents immediately when amount/slippage
  changes, disables submission while a quote is pending, and refuses stale or
  reconnecting quotes.
- The create form now says the launch fee is “Not confirmed” when the API
  cannot provide a current `LIVE`/`SYNCING` factory read. It no longer implies
  “Gas only” while the fee is unknown or stale.
- Chainlink's official changelog says Data Streams free-tier access ended on
  September 1, 2026. The SPYx v10 path therefore requires the owner to confirm
  an existing entitlement or fund a paid subscription; empty EVM fee metadata
  does not eliminate offchain subscription access costs.
- `pnpm typecheck` and `pnpm --filter @sent/web build` passed. The build still
  logs `ECONNREFUSED` while trying the absent local API, then completes with its
  fallback. A local production-server HTTP check returned 200 for `/` and
  `/explore`; with the API unavailable, the homepage said launch status could
  not be checked, the CTA did not say launches were available, and neither page
  rendered the cached sample market. No test suite or browser visual review was
  run; browser access was unavailable in this session.

## xStock wrapper reverse-split re-audit — 2026-11-19

- `WrappedXStock` uses the stable `sharesOf` delta on deposits to mint wrapper
  shares, and its `unwrap` burns wrapper units before transferring the current
  multiplier-adjusted underlying amount. It measures the actual underlying
  share delta and reverts if more shares left than wrapper units were burned.
  Therefore a multiplier decrease changes redemption value without changing
  wrapper balances or reducing backing below wrapper supply.
- The arithmetic matches Backed's published implementation: EVM transfer
  amounts convert to share units with floor division, and share units convert
  back to balance amounts with floor division. The wrapper's
  `floor(floor(shares × multiplier / 1e18) × 1e18 / multiplier)` transfer
  cannot consume more than the burned shares under that model. It can consume
  fewer, leaving dust in the wrapper; the contract intentionally has no rescue
  path, so that dust is stranded rather than creating an under-backed claim.
- Existing unit coverage includes a 1-for-10 reverse split with two independent
  redeemers, a rebase between deposit and withdrawal, a bounded fuzz invariant
  over multipliers from 0.1× to 10×, and a fork test for a real xStock token.
  These tests were inspected but not run in this session. The fork test's
  multiplier mutation relies on locating and overwriting proxy storage, so it
  must be treated as a harness check, not a safe production operation.
- `RebaseDetector` refuses raw tokens exposing Backed's `multiplier()`,
  `getCurrentMultiplier()` or `sharesOf()` interfaces (and a common Lido
  interface). The registry separately requires wrappers to be named by its
  immutable wrapper factory and to expose the expected underlying. This is a
  sensible defense-in-depth path for known interface shapes; it cannot prove a
  token is non-rebasing if the token rebases through an unknown interface or is
  later upgraded.
- No wrapper source change was justified by this audit. This does not clear
  xStock pairing for public production: the current HyperEVM deployment still
  has no canonical SPYx wrapper code or registry entry, and the price adapter,
  asset gates, and graduation configuration remain unset as recorded above.
- The SPYx price shim's unit conversion is internally consistent with the
  wrapper: the v10 equity price is multiplied by `currentMultiplier` to produce
  the USD value of one stable wrapper share unit, while `tokenizedPrice` is not
  used. The shim pins both the feed ID and quote wrapper, checks the v10 report
  fields, and refuses pending corporate actions, closed markets and the
  post-activation cooldown. Chainlink's current v10 schema confirms the decoded
  field order/types, that `lastUpdateTimestamp` is nanoseconds, and that
  `marketStatus` uses 0/1/2 for unknown/closed/open.
- Static review found no price-unit mismatch, but this is not runtime
  verification: no checked-in shim-specific tests were found in the contract
  test tree and no signed SPYx report was submitted to the deployed verifier in
  this session. The chain's advertised v10 feed ID, verifier code, decimals and
  quote metadata were recorded earlier, but the subscription entitlement and
  end-to-end report acceptance are still operator prerequisites. Chainlink's
  separate 24/7 equity stream is early access and uses other schemas without
  the xStock multiplier fields, so it is not a drop-in replacement for this
  shim.

## Stockback launch-gate boundary — 2026-11-19

- The source-level `launchConfigurationReady()` gate checks that the guardian
  address is nonzero, claims are not paused, and a nonzero quorum is no larger
  than the current attestor count. It does not prove that the guardian Safe is
  independent from governance or that its signers meet the key-separation
  policy. Those are owner/Safe configuration checks and must be verified before
  setting the guardian and enabling launches.
- Governance can later change the guardian, attestors or quorum. Removing the
  guardian or reducing the quorum to zero makes the new factory refuse future
  launches; the current check does not retroactively freeze rewards for already
  created markets. This is consistent with governance retaining configuration
  authority, but it makes monitoring and the documented separation ceremony
  production requirements, not optional housekeeping.
- The create page has a user-wallet flow to fetch a signed SPYx report from the
  API and submit it to the pinned shim; it tracks the transaction and offers a
  launch-config refresh. The API keeps Chainlink credentials server-side. This
  flow still depends on provisioning valid subscription credentials and on the
  new shim being deployed and configured; neither prerequisite is satisfied by
  the current live deployment evidence.

## Trading fee settlement and live-state recheck — 2026-11-19

- The current source applies a 1% core fee plus 1% Stockback on buys, and a 1%
  core fee plus 2% Stockback on sells. `FeeVault` receives only the core fee;
  creator accrual is 65% rounded up in the quote asset's raw units and the
  platform receives the exact remainder. Pre-graduation Stockback is transferred
  to `HolderRewardVault` in the same transaction. Post-graduation, paired-asset
  LP fees split 65% creator / 17.5% Stockback / 17.5% platform; token-side LP
  fees never fund Stockback.
- A projection discrepancy was found for assets with fewer than 18 decimals:
  the indexer previously split normalized `coreFee` directly, while the contract
  first rounds that fee into raw quote-token units and then applies the 65/35
  split. The indexed trade breakdown could therefore differ from FeeVault's
  actual credited balances by raw-unit rounding. The indexer now reproduces the
  contract's raw-unit conversion and split, then normalizes the amounts for the
  API/tape. The displayed core fee and Stockback are also derived from the raw
  amounts actually transferred to their vaults. For 18-decimal assets this is
  numerically unchanged.
- `pnpm --filter @sent/indexer typecheck` passed after this change. No Solidity
  or other test suite was run in this pass.
- A fresh read-only HyperEVM RPC check at block `51,625,156` confirms the live
  state remains unready: factory router and reference-price adapter are zero,
  launchable registry assets are empty, the canonical SPYx wrapper mapping is
  zero, the launch fee is `0.04 HYPE`, and the reward vault has no guardian or
  attestors, with quorum `0`. Calling the live vault's new
  `launchConfigurationReady()` view reverts, so the deployed vault does not
  expose the source-level gate. No chain state was changed.

## Stockback same-second event determinism — 2026-11-19

- The TWAB calculator accepted unordered events but previously sorted only by
  timestamp. Distinct transfers recorded in the same second could therefore be
  applied in input order; a same-second outgoing transfer could temporarily
  appear to make a holder's balance negative even when the aggregate
  end-of-second balance was valid. Independent indexers or shuffled replay
  inputs could disagree on this result.
- The calculator now groups signed deltas by normalized account and timestamp,
  then integrates balances after applying each account's net same-second
  change. No modeled time elapses between events with the same timestamp, so
  this removes input-order dependence while retaining the negative-balance
  corruption check on the resulting balance.
- The previous-epoch opening state now also rejects negative balances and
  duplicate addresses after lowercase normalization. Previously a negative
  opening balance was silently omitted, which could hide a corrupt carry-forward
  and produce a plausible but incorrect distribution.
- `pnpm --filter @sent/stockback typecheck` and
  `pnpm --filter @sent/stockback-service typecheck` passed. Tests were not run.
- This is a source-level determinism fix. It does not change the HyperEVM
  deployment state or clear the launch blockers recorded above.

## Cross-package build and current deployment recheck — 2026-11-19

- `pnpm typecheck` passed for the root TypeScript project. `pnpm build` exited
  successfully and built the Next.js web application; during static page
  generation, API requests to the default local endpoint returned
  `ECONNREFUSED`. Those reads are handled as unavailable and do not fail the
  build, but a production deployment still needs its configured API and
  realtime endpoints before the discovery rails can show live data. The root
  build graph did not build other packages because they do not expose build
  scripts in this workspace.
- Solidity production sources and their imported OpenZeppelin dependencies
  compiled with `solc 0.8.28`, optimizer runs `400`, `viaIR`, and metadata hash
  disabled: 44 source units, 30 SENT contract bytecodes, zero compiler errors
  or warnings. Foundry is not installed/available, so Foundry deployment
  scripts and the Foundry build pipeline were not verified. No test suite was
  run.
- A fresh read-only RPC check at block `51,626,430` reconfirmed chain ID 999.
  Factory router and reference-price adapter remain zero; the registry still
  returns no launchable assets; the wrapper factory has no canonical SPYx
  wrapper; the reward vault guardian is zero, attestor count and quorum are
  both zero, and claims are not paused. Launch fee remains `0.04 HYPE`. No
  chain state was changed.
- The web build and TypeScript checks establish source buildability for the
  checked scope only. They do not establish a live API deployment, successful
  SPYx report acceptance, a configured Stockback quorum, or public launch
  readiness. The separate Solidity source compile is recorded above; Foundry
  scripts and its full build pipeline remain unverified.

## Zero-budget stock oracle alternative check — 2026-11-19

- Pyth's current sponsored-feed table lists `SPYX/USD` on Ethereum Mainnet,
  not HyperEVM Mainnet. The HyperEVM push list has `KHYPE/HYPE.RR`, `KHYPE/USD`
  and `USDT0/USD`; there is no sponsored SPYX price there. A free, maintained
  HyperEVM push feed is therefore not available from the evidence checked.
- Pyth Core is deployed on HyperEVM and its EVM update fee is zero, but its
  current Core data path fetches signed updates through Hermes, which now
  requires a Pyth API key. Pyth describes that key as including a free trial
  with paid plans for ongoing use. Operating a pusher also submits EVM
  transactions. Pyth is a technical candidate, not a verified ongoing-zero-cost
  solution; SENT has not integrated or live-tested it.
- The actual zero-budget release bar is unresolved: use an existing valid
  oracle entitlement, obtain a provider whose sustained access and HyperEVM
  feed are verified, or do not open stock-paired launches. Do not substitute a
  HyperCore spot midpoint for an equity/USD oracle; it is a market price with a
  USDC quote and separate manipulation/depeg risks.
- A fresh HyperCore `spotMetaAndAssetCtxs` read found the current SPYX/USDC
  market context with `midPx: null` and zero 24-hour base/quote volume. Its
  `markPx` was `0.99994`, which is not a usable SPYX/USD anchor under those
  conditions. A direct mainnet `spotPx(703)` read at the documented HyperEVM
  precompile returned `PrecompileError`. The book-derived route is therefore
  neither liquid nor operationally verified as a production oracle today.
- Primary sources checked 2026-11-19: Pyth [sponsored feeds](https://docs.pyth.network/pro/sponsored-feeds),
  [HyperEVM contracts](https://docs.pyth.network/pro/contract-addresses),
  [Core EVM update flow](https://docs.pyth.network/pro/use-prices-on-blockchain/evm),
  [Core upgrade and API-key requirement](https://docs.pyth.network/pro/pyth-core-upgrade),
  [API-key trial/subscription](https://docs.pyth.network/pro/acquire-api-key),
  [on-chain fees](https://docs.pyth.network/pro/on-chain-fees), and Hyperliquid
  [spot contexts](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot),
  [HyperEVM/HyperCore integration](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperevm),
  and [L1Read guide](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore).

## Paid oracle route budget guard — 2026-11-19

- The public `/oracle/spyx/report` route used a per-client and per-process
  limiter. Replicas each had their own aggregate bucket, so horizontal scaling
  multiplied the maximum report-fetch rate against one shared provider account.
- A new migration adds a single-row PostgreSQL token bucket, and the API now
  takes from it transactionally before it can call Chainlink. All replicas
  sharing the database share one five-request burst and one-request-per-second
  refill. If the DB budget cannot be checked, the endpoint returns unavailable
  and does not call upstream. This caps request rate; it does not cap provider
  subscription spend or replace the provider's own usage limits.
- `pnpm --filter @sent/api typecheck` and
  `pnpm --filter @sent/database typecheck` passed. No test suite was run. The
  migration and API code are not yet deployed to production.

## GitHub CI re-check — 2026-11-19

- The latest GitHub run available for `main` is from 2026-09-05 at commit
  `ac6fa1a`; it is not evidence for the 12 local commits ahead of `origin/main`
  or the current uncommitted worktree. Its typecheck and Foundry jobs passed,
  while the economic gate and PostgreSQL/E2E job failed.
- The economic gate reported that the Dockerfile omitted manifests for
  `packages/observability` and `services/keeper`. The current worktree's
  Dockerfile has explicit manifest copies for both. The E2E job failed while
  deploying `XStockRegistry`: that run passed one constructor argument although
  the contract requires governance and the wrapper-factory address. The current
  worktree's E2E setup deploys `WrappedXStockFactory` first and passes both
  registry arguments.
- These source differences match the two historical failure causes, but they
  have not been pushed or rerun in GitHub CI. The current remote CI status is
  therefore unverified; no result from the old run is treated as a pass for the
  current tree. No push was made.

## SPYx report-window guard — 2026-11-19

- The onchain v10 shim now rejects a verified report whose validity window is
  inverted (`validFromTimestamp > observationsTimestamp`) or whose expiry is
  not after the observation. Chainlink defines the first two fields as the
  beginning and end of the interval for which the price is valid; malformed
  interval semantics now fail closed before the report can replace the cache.
- This complements the existing feed-ID, expiry, future-time, freshness,
  market-status, multiplier and corporate-action checks. The edit is source-only
  and compiled with `solc 0.8.28`; it still needs unit/fork coverage and an
  independent contract review. No report was verified on HyperEVM and no
  contract was deployed.

Source: Chainlink [v10 report schema](https://docs.chain.link/data-streams/reference/report-schema-v10)
and [report-window semantics](https://docs.chain.link/data-streams/how-report-timestamps-work).

## HyperEVM release-state recheck — 2026-11-19

Read-only calls against the configured HyperEVM public RPC at block
`51,627,276` returned:

- chain factory `router()` and `referencePrice()` are both zero;
- `launchFee()` remains `0.04 HYPE` and `launchableAssets()` is empty;
- the registry's wrapper factory returns zero from `wrapperOf()` for the
  canonical raw SPYx address;
- the factory reward vault still has a zero guardian, zero attestors and zero
  quorum; `claimsPaused()` is false.

No transaction was sent. This confirms the mainnet release gates remain closed;
the enabled-launch state cannot be inferred from source code or UI readiness.

## HyperCore SPYX market and EVM-read recheck — 2026-11-19

The official Hyperliquid spot API now returns active data for pair `@703`,
superseding the earlier zero-volume snapshot recorded above. At
`2026-11-18T21:40:04Z`, metadata mapped `@703` to token indices `[846, 0]`
(`SPYX/USDC`); its 24-hour context reported `midPx=736.23`,
`dayNtlVlm=14,210.9916 USDC`, and `dayBaseVlm=19.25 SPYX`. The sampled L2 book
had a 736.12/736.34 BBO (about 3 bp spread) and displayed roughly $58.8k of
USDC notional on each side inside 50 bp across the first ten levels. The ten most
recent returned fills were between two Core addresses; that small sample is a
concentration signal, not a market-wide participant count. Book depth is
cancellable and these observations do not establish manipulation resistance.

At EVM block `51,627,459`, direct `eth_call`s to `spotPx(703)` at `0x...0808`,
`spotInfo(703)` at `0x...080B`, and `bbo(10_703)` at `0x...080E` each reverted
with `PrecompileError`. Earlier snapshots had a successful `spotPx` read, so
the precompile's mainnet behavior is inconsistent across observed blocks/RPC
calls and is not a production dependency SENT can safely rely on. The API
market is useful as a venue/liquidity signal, but it is quoted in USDC, is
thinly traded by the 24-hour volume evidence, and does not supply SENT an
onchain equity/USD source. It remains rejected as the launch anchor.

Sources: Hyperliquid [spot metadata and contexts](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot),
[HyperEVM/HyperCore overview](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperevm),
[read-precompile guide](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore),
and [spot asset-ID convention](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids).

## GitHub deployment wiring check — 2026-11-19

Read-only GitHub CLI inspection of `Sent-lab/Sent` found only
`.github/workflows/ci.yml`; repository Actions secrets returned `[]`, and the
repository has zero GitHub environments. No production deploy workflow or
GitHub-managed hosting configuration is present in this repository. This does
not rule out a separately managed provider account, but none is connected here.
The existing Docker Compose file explicitly describes local development, not
production. A public web/API/realtime deployment therefore still needs an
operator-selected host, configured production endpoints/secrets, database and
monitoring, plus a verified deploy and rollback path. No secrets were read and
no GitHub settings or remote state was changed.

## Zero-cost hosting fit check — 2026-11-19

The common free hosting candidates checked do not currently clear SENT's
production needs:

- Vercel's Hobby plan is restricted to personal, non-commercial use. SENT is a
  fee-generating launchpad, so that plan is not an appropriate production host.
- Render labels its free instances as unsuitable for production; free web
  services sleep after 15 minutes idle, and free Postgres expires after 30 days.
- Cloudflare Workers Free allows 100,000 requests/day but limits CPU to 10 ms per
  request. It may host static assets or carefully adapted lightweight endpoints;
  the current Dockerized Node API, persistent realtime service, indexer and
  background operators have not been ported or validated there.

This is not a survey of every hosting provider. It establishes that no
production-capable $0 deployment path is configured or validated for this repo.
A free static preview may be possible, but it would not satisfy the requested
public launchpad behavior. No account or service was created.

Sources: Vercel [Hobby plan and use restriction](https://vercel.com/docs/plans/hobby),
Render [free service limitations](https://render.com/docs/free), and Cloudflare
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Deployment gas lane and cost recheck — 2026-11-19

The current official Hyperliquid dual-block documentation confirms a 3M-gas
fast lane and a 30M-gas slow lane. An EOA can target the large lane by submitting
the HyperCore `evmUserModify` action with `usingBigBlocks: true`; the setting is
on the Core user and must be switched off again to return that account to fast
blocks. This confirms the deployment prerequisite in `infra/deployment/RECOVERY.md`
and `infra/deployment/big-blocks.py`.

The read-only HyperEVM JSON-RPC methods `eth_gasPrice` and
`eth_bigBlockGasPrice` both returned `0x5f5e100` (0.1 gwei) during this check.
Using the repository's last recorded `GasProbe` total of 11,023,962 gas gives an
indicative core-deployment fee of about 0.0011024 HYPE. At the HYPE spot quote
checked the same day ($66.25), that is about $0.073. This is a planning estimate,
not a fresh source build measurement or a deployment quote: Foundry (`forge`) is
not installed in this workspace, and deployment bytecode has changed since the
last committed gas measurement. The exact cost at send time can also change with
the next-block base fee.

Decision: keep the current deployment sequence and use the documented large
lane for the factory transaction. Splitting the factory/vault constructor would
add deployment steps and alter trust/address wiring to avoid a one-time estimated
fee of only a few cents; there is not enough evidence to justify that architecture
change. This does not remove the need for the deployer to be a Core user and to
opt in before deployment. No key was used, no account flag was changed, and no
transaction was sent.

Sources: Hyperliquid [dual-block architecture](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/dual-block-architecture)
and [HYPE spot quote](https://www.google.com/finance/quote/HYPE-USD?hl=en).

## Mainnet/source guard divergence recheck — 2026-11-19

At HyperEVM block `51,628,271`, read-only RPC checks reconfirmed that the
deployed factory has no graduation router or reference-price adapter, the
SPYx wrapper mapping is zero, and the reward vault has zero guardian, zero
attestors and zero quorum. The live vault reverts on the source-level
`launchConfigurationReady()` selector, and that selector is also absent from
the deployed factory runtime bytecode. The Stockback launch guard in the current
workspace therefore does not protect the already-deployed mainnet factory.
Although other current gates prevent launching today, this source change cannot
be treated as an onchain mainnet restriction. A replacement factory/vault
deployment, followed by Safe wiring and registry reconfiguration, is required
before relying on that guard. No transaction or configuration change was made.

The local Chainlink report credentials remain absent from process environment,
`.env.local.dev`, `.env.production` and `.env.production.local`. The oracle route
cannot be exercised end-to-end here. No secret values were read or printed.

## Production API fallback hardening — 2026-11-19

The web client previously defaulted to `http://localhost:8080` in every
environment. If a production deployment omitted `NEXT_PUBLIC_API_URL`, visitors'
browsers would contact localhost on their own devices. The client now uses that
default only in development; production without an API origin returns a clear
unconfigured-service state, and the independent Stockback dataset verifier also
refuses to issue a relative request.

Current workspace verification: `pnpm typecheck` and `pnpm build` both passed.
The build completed with no local API server or production API URL, and a scan of
the generated production client bundle found no `http://localhost:8080` fallback.
This confirms safe disconnected rendering only; it does not verify a deployed
API, endpoint, database, or end-to-end public use. Tests were not run.

## Redeployment feasibility and Solidity compilation — 2026-11-19

The live factory's `totalLaunches()` returned zero at block `51,628,512`. There
are no SENT launch records on this factory to migrate, so replacing the factory,
registry and vault set does not currently strand an existing SENT market. This
does not preserve the old contract addresses or remove the need to reconfigure
the new deployment. The existing no-router/no-oracle/no-launchable-asset gates
remain unchanged.

Because Foundry is unavailable in this workspace, the full production Solidity
source and deployment-script trees were compiled directly with solc `0.8.28`,
optimizer runs `400`, and `viaIR=true`, matching `contracts/foundry.toml`:
30 Solidity source files and 94 contracts compiled with no compiler errors.
This is compile evidence only; no Solidity tests, fork tests, gas probe or audit
was run in this step.

## Chainlink report quota guard — 2026-11-19

The shared report limiter now also enforces a hard daily maximum across API
replicas using PostgreSQL. The API refuses to start with Chainlink report
credentials unless `CHAINLINK_REPORT_DAILY_MAX_REQUESTS` is set to a positive
safe integer. The value must be chosen from the actual provider account's
documented quota; the repository does not assume a free plan or invent that
quota. Daily exhaustion is visible to callers, and database failures remain
fail-closed. The additive schema change is migration `0011`, preserving the
already-recorded `0010` migration history.

`pnpm typecheck` passed after this change. No database was migrated and no
request was sent to Chainlink. The credential route remains disabled locally;
the code's daily quota behavior and concurrent database locking still need
runtime verification before public deployment.

## Oracle-free launch-price alternative rejected — 2026-11-19

The locked product model in `docs/M0-COMPREHENSION.md` defines a $2,000
reference launch market cap and a $50,000 graduation reference, with `p0`
derived from an xStock/USD snapshot at launch. `docs/DECISION-LOG.md` D-012
also requires the factory to take that anchor from a feed, never from the
creator's calldata, because `p0` is immutable for the market's lifetime.
Allowing a caller-chosen xStock-denominated `p0` would remove the paid oracle
dependency but would change both the locked market-cap economics and the
front-running/price-integrity decision. It is therefore not a production
workaround under the current product spec. The zero-budget blocker must be
resolved by obtaining an entitled, trusted SPYx/USD report source or by
explicitly revising the product specification before implementation.

## Oracle Always Free hosting candidate recheck — 2026-11-19

Oracle's current Always Free offer includes an Ampere A1 allowance equivalent
to 2 OCPUs and 12 GB RAM, plus 200 GB combined boot/block storage; the public
offer also lists up to 10 TB/month of outbound transfer. That is enough on paper
to investigate a single-host Docker beta for SENT's web, API, realtime, indexer
and Postgres, subject to image/build/runtime measurements and ARM64 validation.

It is not a dependable production guarantee: Oracle documents that an Always
Free compute instance may be reclaimed after seven days if CPU and network
utilization are both below 20% (and, for A1, memory is also below 20%). Free
accounts also do not qualify for Oracle Support, and host capacity may be
unavailable in the chosen home region. So this can be evaluated as a no-monthly-
bill beta host with tested database backups and an accepted outage/reclamation
risk; it does not clear SENT's production uptime or support gate. No account,
instance, DNS record or secret was created.

Sources: Oracle [Always Free resources and reclaim policy](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[Free Tier support and limits FAQ](https://www.oracle.com/cloud/free/faq/), and
[current Free Tier service list](https://www.oracle.com/cloud/free/).

## Create-flow price readiness message — 2026-11-19

The create form already disabled its launch intent when the global USD reference
adapter was unset or every enabled xStock lacked a readable anchor, but the
blocking message could be absent in those states. The form now explains whether
governance still needs to connect the adapter or an enabled xStock needs a fresh,
in-range price. This makes the disabled launch state actionable without weakening
the onchain or client-side launch checks.

Verification: `pnpm typecheck` and `pnpm build` passed after the edit. No test
suite or transaction was run.

## Public beta container liveness — 2026-11-19

The public Compose stack now checks the indexer, realtime gateway, worker, and
finalizer liveness endpoints in addition to the web and API checks. These
operations ports remain private to the Compose network; Docker container status
is enough for an operator's first-pass check and does not expose metrics to the
public internet. The Compose definition parses successfully with placeholder
deployment values. This verifies configuration structure, not service behavior
against a live database, RPC, or production chain state.

## Deployed factory Stockback guard signal — 2026-11-19

The launch-config API previously derived Stockback readiness from vault guardian,
attestor, quorum and pause reads. That could say `ready` for an older factory
whose runtime bytecode does not enforce the source-level `StockbackNotReady`
guard. The API now checks for the custom-error selector (`0x8406d091`) as a
necessary bytecode marker and separately calls the deployed vault's
`launchConfigurationReady()` view. It includes the marker, getter support and
getter result in readiness. The homepage and create form explain which signal is
missing. This is a narrow marker/compatibility check, not a full runtime-code
equivalence audit; production readiness still requires comparing deployed
implementations and completing the other configuration gates.

`pnpm typecheck` passed after the change. The selector was independently derived
with viem and matched the factory ABI's `StockbackNotReady()` error. No test suite
or transaction was run.

A fresh read-only RPC check at block `51,631,949` confirmed the deployed factory
runtime lacks `0x8406d091`, and the deployed reward vault's
`launchConfigurationReady()` call still reverts or is missing. The new API status
therefore holds this live deployment closed for the additional reason that the
factory cannot enforce the Stockback gate. This RPC observation does not replace
a full bytecode audit or verify the API against a production database.

## Public API metrics ingress — 2026-11-19

The API intentionally skips rate limits for `/metrics`; the initial public Caddy
site block forwarded that route unchanged. The public ingress now returns 404
for `/metrics` and `/v1/metrics`, while `/health` stays public for freshness
checks. Operators can scrape API metrics over the private Compose network with
`docker compose exec api wget -qO- http://127.0.0.1:8080/metrics`. The worker,
indexer, realtime and finalizer operations ports are not published. The updated
Caddyfile passed `caddy validate`; the Compose topology also passes
`docker compose config --quiet` with placeholder deployment values. These are
configuration checks, not an end-to-end ingress test against running services.
Caddy's adapted route confirms the metrics 404 matcher is evaluated before the
API reverse proxy.

## Pyth sponsored-feed recheck — 2026-11-19

The current Pyth sponsored-feed catalog separates feeds by chain. Its HyperEVM
section reports only three sponsored markets—KHYPE/HYPE.RR, KHYPE/USD and
USDT0/USD—and no SPYX/USD feed. SPYX/USD is listed for Ethereum, which does not
make that on-chain value readable from HyperEVM. Pyth says sponsored feeds are
subject to change and recommends operators run their own price pusher when
needed; its current pusher guide requires a Pyth Pro API key and each update
incurs the destination-chain transaction fee. The existing SPYX Pyth route
therefore remains unavailable as a verified, maintained $0 HyperEVM launch
anchor. No feed update or transaction was sent.

Source: Pyth [Sponsored Feeds](https://docs.pyth.network/pro/sponsored-feeds) and
[Run Price Pusher](https://docs.pyth.network/pro/sponsored-feeds#run-price-pusher).

## Chainlink tokenized-equity feed network check — 2026-11-19

The current Chainlink changelog search surfaced new `wSPYx / USD` Data Feed
support on X Layer, alongside other xStock V2 wrapper feeds. That is a push feed
on a different chain, not a HyperEVM feed address. SENT is currently pinned to
HyperEVM chain ID 999; reading the X Layer contract would require a separately
secured cross-chain observation and would not satisfy the existing onchain
price-source invariant. It is not a drop-in free oracle route for SENT.

Source: Chainlink [Nov. 1, 2026 Data Feeds changelog](https://docs.chain.link/changelog?product=Data+Feeds).

## NVIDIA xStock Pyth feed follow-up — 2026-11-20

The Pyth Terminal account is on an active demo trial with 21 feeds in `My
Feeds`. A direct read-only inspection of the signed-in list confirmed that
`NVDAX/USD` and the regular NVDA/USD equity feed are not among those 21 feeds.
Because the page describes My Feeds as the symbols the plan entitles the
account to stream, this account is not currently entitled to either NVIDIA feed
through its displayed trial plan. The account check did not open billing, add a
feed, create a key, or change the plan.

The public Pyth catalog does list `Crypto.NVDAX/USD` (“NVIDIA XSTOCK / US
DOLLAR”) as Stable, Spot, USD-quoted, exponent `-8`, with three minimum
publishers and `fixed_rate@200ms`. The public symbol API returns two distinct
IDs: Pyth Pro/Lazer numeric feed ID `1833`, and Pyth Core/Hermes ID
`0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f`.
These IDs are for different contract interfaces and cannot be interchanged.

A read-only `eth_call` to HyperEVM's Pyth Core contract using that Hermes ID
reverted at the sampled latest block; SENT therefore has no verified fresh
Core price for this feed at that point. The current HyperEVM sponsored-feed
list still has only KHYPE/HYPE.RR, KHYPE/USD, and USDT0/USD. The existing SENT
`PythAggregatorShim` only reads a stored Core price and does not submit
updates, so this feed is not launch-ready through SENT's current Pyth route.

There are two pull-update designs to evaluate. Pyth Core keeps the same 32-byte
ID and contract interface SENT already reads; the launch transaction can carry
Hermes update bytes, call `updatePriceFeeds`, then read the fresh value. Pyth
documents zero Core update fee on EVM, but the caller still pays destination
chain gas. Since the August 26, 2026 Core upgrade, Hermes requires a Pyth API
key, so the payload service must keep that secret server-side and the account
must be entitled to NVDAX. This is likely the smaller contract change for SENT.

Pyth Pro is the other option: it verifies a signed price inside each consuming
transaction and stores no price; its contract/API uses the Terminal's numeric
feed ID. It still requires Pyth Pro API entitlement, a new contract/data path
wired into SENT's launch call, and native gas (Pyth lists a 1-wei EVM
verification fee). SENT's current launch function calls a read-only
`usdPriceWad(quoteAsset)` and accepts no update payload, so neither approach is
a config-only change. The account's 14-day trial is not evidence of permanent,
production API access or zero operating cost.

The current Pyth Terminal documentation also describes a Pyth Pro package used
by Polymarket that includes regular US-equity feeds such as `NVDA`; this is
evidence that Pyth distributes an NVDA equity stream under at least one plan,
not evidence that this account can access it or that it is the same stream as
`Crypto.NVDAX/USD`. Pyth's official contract-address table lists Pyth Pro at
`0xACeA761c27A909d4D3895128EBe6370FDE2dF481` on HyperEVM. Its EVM guide says a
consumer contract must verify and parse the signed update in the consuming
transaction. Pyth Pro is therefore a real technical route to evaluate, but the
account's feed permission, subscription quote, exact NVDA-vs-NVDAX semantics,
and SENT transaction integration remain unverified. The 1-wei verification
fee does not include transaction gas or Pyth's subscription cost.

Conclusion: NVIDIA xStock is a credible next asset candidate and Pyth now has a
specifically named NVDAX/USD feed, unlike the earlier SPYX-only assessment.
Before enabling it, the Pyth plan must explicitly include the NVDAX feed and
the API entitlement must permit on-chain updates for the 32-byte ID; if it does
not, compare Pro's signed-update access for ID 1833 and its plan cost. Then test
a valid HyperEVM update in a non-production transaction and reconcile the
quoted unit against SENT's exact canonical NVDAx wrapper, decimals and issuer
multiplier. Keep it disabled in production until access, the on-chain update
path and all wrapper/registry gates are verified. No API key was accessed, no
contract or configuration was changed, and no transaction was sent.

Sources: Pyth [NVDAX/USD Terminal page](https://app.pyth.com/explore/Crypto.NVDAX%2FUSD),
[feed ID documentation](https://docs.pyth.network/pro/price-feed-ids),
[HyperEVM contract addresses](https://docs.pyth.network/pro/contract-addresses),
[EVM integration guide](https://docs.pyth.network/pro/use-prices-on-blockchain/evm),
[Terminal package description](https://docs.pyth.network/pro/pyth-terminal),
[Core upgrade](https://docs.pyth.network/pro/pyth-core-upgrade),
[on-chain fees](https://docs.pyth.network/pro/on-chain-fees), and
[sponsored feeds](https://docs.pyth.network/pro/sponsored-feeds).

## Official NVDAx Chainlink stream discovery — 2026-11-20

A fresh unauthenticated request to xStocks' public oracle-by-symbol endpoint
for `NVDAx`, filtered to `network=HyperEVM`, returned one Chainlink-managed
`PullBased` Tokenized Asset v10 stream. Its feed ID is
`0x000a37a55df2ef907d8fa06af6632bc16da58a62b68be2e1994efaa037a0918a`, report
decimals are 18, quote asset is USD, and verifier is
`0x60fAa7faC949aF392DFc858F5d97E3EEfa07E9EB`. The API's record has no direct
feed contract address because delivery is pull-based; it is a signed-report
source, not a Chainlink `latestRoundData()` push feed.

The same public xStocks API returned the HyperEVM NVDAx token as
`0xc845b2894dbddd03858fd2d643b4ef725fe0849d` and the issuer's V2 wrapper as
`0xa8ddb5cd96b5222afe198316e9a57caa642850d5`. It reported an NVDAx USD quote of
`150.235` and current multiplier `1.001701196801074` during this read. Those
values are a point-in-time API observation; they are not an on-chain feed
verification or a substitute for reconciling SENT's own share-backed wrapper.

This is an issuer-verified NVDAx source candidate and fits the existing v10
shim path. Pyth's public Terminal catalog also lists NVDAx/USD and regular NVDA
equity feeds, but that does not establish that the user's trial API token is
entitled to either feed or that an update is stored on HyperEVM. The user's
My Feeds screenshot shows 21 total entries but only a partial table, so account
membership remains unverified. The workspace's report-fetching route was removed
after a licensing review; the deployment script is generalized but no permitted
private updater or report entitlement is verified. NVDAx is not live-ready until
feed entitlement, allowed data use, a permitted direct-to-chain update path,
multiplier/activation behavior, and every wrapper registry gate are verified.
No key was accessed and no transaction was sent.

Sources: xStocks [NVDAx public oracle record](https://docs.xstocks.fi/apis/openapi/oracles/get_public_oracles_by_symbol),
[public assets data](https://docs.xstocks.fi/apis/openapi/assets), and
[multiplier guide](https://docs.xstocks.fi/developers/multipliers).

## Local public-stack verification — 2026-11-20

`pnpm typecheck` and the `@sent/web` production build both passed. Docker Compose
configuration also parsed with temporary, dummy deployment addresses and a
temporary env file; the example template's first unfilled run correctly refused
to proceed because factory, reward-vault and indexer start-block values are
required. The temporary env file was removed, no container was started, and no
host, secret, or production value was changed. Test suites were not run.

## NVDAx source path generalized in workspace — 2026-11-20

The source configuration, shim and deployment script support issuer-listed
SPYx and NVDAx v10 streams. The API response route and browser wallet-update
flow that were initially added have since been removed after a licensing review
(see the corrective audit below). The deployment script still verifies the
canonical wrapped underlying, pins the quote asset and feed ID, and prints
governance calldata only.

Verification before the licensing correction: `pnpm typecheck`, the web
production build (`pnpm build`, `@sent/web`), and `git diff --check` passed.
Solidity `0.8.28`, optimizer runs 400 and `viaIR` compiled all 25 production
Solidity sources (61 contracts), all five deployment scripts (90 contracts),
and all 29 test/invariant Solidity sources (167 contracts) with no compiler
errors. Test functions were not executed because Foundry is unavailable. No
deployment, API key access, account upgrade, or transaction occurred.
The user's screenshot shows a signed-in Pyth Terminal 14-day demo and 21 My
Feeds results; the visible portion does not show NVDA/NVDAX, and the remaining
rows are not visible. Account feed membership and API entitlement therefore
remain unknown. No Chainlink credentials were accessed; entitlement and price
remain unknown.

## HyperEVM deployment gate re-check — 2026-11-20

Read-only RPC reads at block `51,703,586` show the deployed factory has
`router=0x0` and `referencePrice=0x0`, with launch fee `0.04 HYPE`. The
factory's registry has `registeredCount=0`, no launchable assets, and a
nonzero share-wrapper factory. The reward vault has zero guardian, zero
attestors and zero quorum; the `launchConfigurationReady()` selector is
unsupported/reverts. The deployed factory bytecode does not contain the
`StockbackNotReady()` selector marker expected from the current source. All four
factory/registry/wrapper-factory/reward-vault addresses have deployed code.

Therefore public market creation, price updates through a configured shim,
graduation and Stockback claims still cannot be enabled by the NVDAx feed-path
code alone. Mainnet remains **NO-GO**. No chain state changed.

Primary evidence: read-only HyperEVM RPC at `https://rpc.hyperliquid.xyz/evm`,
block `51,703,586` (factory, registry and reward-vault calls). Factory router
and reference price were zero; launch fee was `0.04 HYPE`; registry count was
zero; vault guardian, attestor count and quorum were zero; claims were not
paused. No transaction or chain-state change occurred.

The first standalone compile caught a Solidity address-checksum error in the
new NVDAx underlying constant. It now uses the compiler-provided checksum, and
the subsequent full production-source plus deployment-script compilation
passed as recorded above.

## Data Streams redistribution and source-update correction — 2026-11-20

The prior design returned the signed `fullReport` from the public SENT API to
each visitor for a wallet-submitted update. Chainlink's current Fair Use Policy
prohibits proxying Data Streams to redistribute reports to a wider audience and
requires each consumer to authenticate directly under its own credentials.
Data Streams billing is subscription-based; public docs do not establish a
zero-cost entitlement for SENT's NVDAx or SPYx feeds. Chainlink's changelog also
states the free tier wound down with access ending September 1, 2026. Therefore
the public report endpoint, its API-side credentials/budget plumbing, and the
browser report-fetch/update flow were removed. The API no longer re-serves
signed stream payloads. Public launch remains gated on a provider-compliant,
privately operated onchain updater and confirmed feed entitlement/cost.

The same review found the transaction-intent builder still hard-coded the SPYx
feed ID despite the new NVDAx feed mapping. It now accepts only the configured
SPYx and NVDAx v10 feed IDs. The Create page reports that a missing onchain
price keeps launch disabled; it does not fetch or display the signed report.

The public-beta runbook referenced `infra/deployment/.env.public.example`, but
that ignored file did not exist in the repository. A non-secret template is now
present and explicitly unignored so the documented copy command works from a
fresh checkout. No secret, chain transaction, subscription, or deployment was
created. No tests were run during this corrective pass.

Sources: Chainlink [Data Streams Fair Use Policy](https://docs.chain.link/data-streams/rate-limits),
[Billing](https://docs.chain.link/data-streams/billing), [v10 schema](https://docs.chain.link/data-streams/reference/report-schema-v10),
[September 1, 2026 free-tier sunset notice](https://docs.chain.link/changelog?product=Data+Feeds),
and the [xStocks NVDAx public oracle record](https://docs.xstocks.fi/apis/openapi/oracles/get_public_oracles_by_symbol).

## Treasury Safe deployment guard — 2026-11-20

The configured Treasury Safe was re-read on HyperEVM as 1-of-1; Governance is
2-of-3. The mainnet deployment guard now validates both Safe interfaces and
requires `threshold >= 2` and `owners.length > threshold` for each. A deployment
using the existing treasury now fails before broadcasting until the owner
rotates it to a resilient multisig. The deploy suite includes a rejection case
for a 1-of-1 Treasury Safe. No chain configuration or funds changed.

## Stockback sentinel and Guardian hardening — 2026-11-20

The reward vault used `merkleRoot == 0` as the empty-slot sentinel but did not
reject a signed zero-root commitment. A quorum-signed zero root could overwrite
a valid pending root, then appear empty to activation and monotonicity checks.
Submission now rejects `bytes32(0)` before storing a commitment. A second review
found that Guardian cancellation deleted the only record of the highest
accepted epoch. Previously signed, superseded data could then be replayed and a
newer sequence could lower the cumulative total. The vault now preserves a
public per-market epoch/total watermark across activation and cancellation,
rejecting replays and decreases while allowing a genuinely newer,
non-decreasing root. Operators can query `submissionWatermark(market)` after a
Guardian cancellation to learn the next valid sequence and minimum cumulative
total.
Governance could also set the Guardian to zero after launch, removing the
emergency pause for existing markets; `setGuardian` now refuses zero while
still allowing initial configuration and rotation to another address.
Regression cases cover zero-root replacement, cancelled-root replay, cumulative
downgrade, newer-root recovery, and zero-Guardian removal. Solidity 0.8.28 viaIR
compiled the deploy and reward-vault contracts plus both associated test
contracts; the 77-entry HolderRewardVault ABI was regenerated from compiler
output and `pnpm typecheck` passed. Test functions were not run. No chain state
changed.

## Pyth stock-feed availability and low-gas path re-check — 2026-11-20

The current Pyth-sponsored HyperEVM Core list contains KHYPE/HYPE.RR, KHYPE/USD
and USDT0/USD; it contains no equity feeds. Sponsored pushes therefore do not
provide an NVDA/SPY stock price source for SENT. Pyth Core's EVM update fee is
zero, but its August 2026 upgrade requires an authenticated Pyth API key for
Hermes updates; transaction gas and feed entitlement still apply. Pyth Pro
verifies a signed update in the consuming transaction and charges 1 wei per EVM
verification (plus transaction gas). This makes the on-chain verification fee
negligible, but does not establish zero-cost entitlement or production access.

The public Pyth symbology API lists stable candidates for NVIDIA: regular
`Equity.US.NVDA/USD` (Hermes ID
`b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593`),
tokenized `Crypto.NVDAX/USD` (Hermes ID
`4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f`), and
`Crypto.NVDAX/NVDA.RR` (Hermes ID
`b675c4e9f46d94afa9174a7df09966b77a2950970bb50a77ec8ad4fcfd8266f4`). The
Core Hermes IDs are distinct from the Pyth Pro numeric IDs. This is better than
assuming NVDA has no Pyth feed, but public catalog presence does not establish
that the user's trial token can request the feeds: tokens are permissioned by
asset class and may be restricted by feed ID. The user's Terminal screenshot
shows 21 My Feeds results, but only part of the list is visible, so account
membership and API entitlement remain unverified. It also does not decide
whether SENT's wrapped NVDAX
should be anchored to the issuer's NAV/redemption ratio or the regular equity
price. The repository currently has a read-only `PythAggregatorShim`; the
`LaunchpadFactory.launch` path does not submit `updatePriceFeeds`, so obtaining a
Hermes ID alone cannot make a fresh pull feed usable. A low recurring-cost
design to evaluate is caller-supplied Pyth Core update data in the launch
transaction: Core's protocol update fee is zero and the launcher pays the chain
gas, while SENT would still need a provider-compliant way to obtain the signed
update using an entitled API token. Pyth documents a free trial and paid plans
for continuing Hermes use. Keep SPYx/NVDAx launch disabled until feed access,
wrapper conversion, freshness/session policy, and that update delivery flow are
confirmed. No Pyth key was read or changed, no subscription was modified, and
no transaction was sent.

Sources: Pyth [sponsored HyperEVM feeds](https://docs.pyth.network/pro/sponsored-feeds),
[Pyth Pro Terminal and equity package](https://docs.pyth.network/pro/pyth-terminal),
[EVM update integration](https://docs.pyth.network/pro/use-prices-on-blockchain/evm),
[on-chain fees](https://docs.pyth.network/pro/on-chain-fees),
[August 2026 Pyth Core upgrade](https://docs.pyth.network/pro/pyth-core-upgrade),
and [feed-token permissions](https://docs.pyth.network/pro/faq#access-tokens--permissions).
Feed symbols and Hermes IDs were queried from Pyth's public [symbology API](https://docs.pyth.network/api-reference/price-feeds/symbols),
checked 2026-11-20.

### Pyth ongoing equity-access cost gate — 2026-11-20

The current Pyth Terminal plans page lists Free at `$0/month` with view-only
Terminal access and **no API access**; Starter at `$500/month` with API access
for crypto symbols; and Pro starting at `$2,500/month` with API access that
includes equities and limited redistribution rights. The account screenshot is
a 14-day demo trial, not an ongoing free API plan. Therefore the free trial may
be useful for testing an update flow if NVIDIA feeds are explicitly enabled, but
it does not provide a verified $0 public production route after the trial. The
Core contract's zero update fee only removes the protocol charge; it does not
remove the paid equity-data entitlement or the consumer's gas. No plan was
selected or changed.

Source: Pyth [Terminal Plans & Pricing](https://app.pyth.com/plans), checked
2026-11-20. Prices and feed package contents are provider-controlled and should
be checked again before any production commitment.

## HyperCore NVDAX price-path recheck — 2026-11-20

The official Hyperliquid `spotMetaAndAssetCtxs` response maps `@702` to token
indices `[845, 0]` (`NVDAX/USDC`); the NVDAX token has `szDecimals=2`. The same
response reported `markPx=0.0001`, no `midPx`, and zero 24-hour volume. A
separate `l2Book` response for `@702` showed a 148.74 bid and 148.83 ask with
size 33.62 on each top level, and further visible levels. A pinned read-only
HyperEVM `eth_call` at block `51,706,686` to `spotPx(702)` returned raw
`148610000`; dividing by `10^(8 - 2)` gives `148.61 USDC` per NVDAX. The
precompile, book and API mark therefore do not agree on one coherent freshness
signal, even though spotPx currently responds on mainnet.

This is a no-subscription price observation candidate, not a production oracle:
the precompile result has no market-update timestamp, the API context claims no
mid/volume while its separate book has standing orders, the book can be pulled
or manipulated, and the quote is USDC rather than USD. Earlier pinned calls to
the same precompiles reverted, so availability has also varied across blocks.
Keep it out of the unrestricted launch path unless a separately reviewed
design proves freshness, executable depth, manipulation bounds and a safe
USDC/USD treatment. No chain state changed.

Sources: Hyperliquid [spot metadata and contexts](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot),
[spot order book API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book),
[HyperEVM/HyperCore integration](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperevm),
and read-only RPC `https://rpc.hyperliquid.xyz/evm`, block `51,706,686`,
2026-11-20.

## Fresh onchain release-gate snapshot — 2026-11-20

Read-only HyperEVM RPC calls at block `51,708,543` reconfirmed the live factory
has no graduation router or reference-price adapter, and the xStock registry has
zero registered assets. The launch fee remains `0.04 HYPE`. The deployed reward
vault still has no guardian, attestors or quorum, and its bytecode does not
support the source-level `launchConfigurationReady()` check.

At block `51,708,555`, the governance Safe is 2-of-3, but the Treasury Safe is
1-of-1. The current mainnet deployment script requires Treasury threshold at
least 2-of-3, so its deployment/redeployment path remains blocked until the Safe
owners operate a threshold update. No transactions were sent. See the
verification ledger for the exact addresses and block-pinned reads.

## NVDAx issuer and HyperEVM cross-check — 2026-11-20

The issuer's public `GET /api/v2/public/assets/NVDAx?network=HyperEVM` response
identifies the raw NVDAx asset as
`0xc845b2894dbddd03858fd2d643b4ef725fe0849d` on chain `999`, with V2 wrapper
`0xa8ddb5cd96b5222afe198316e9a57caa642850d5`. The raw address matches
`NVDAX_RAW_ASSET` in `DeployXStockPriceSource.s.sol`. The issuer reports its
underlying as NVDA/USD, trading not halted, and trading mode 24/5. Its public
multiplier endpoint returned `1.001701196801074`; a pinned HyperEVM
`eth_call` at block `51,706,107` to `multiplier()` on the raw token returned
`1001701196801074000` (1e18 scale), an exact match. The issuer price-data
endpoint returned quote `148.096` at that observation; this cached API value is
recorded only as a comparison datum, not an allowed launch oracle.

At the same pinned block, Pyth Core's 60-second `getPriceNoOlderThan` read for
`Equity.US.NVDA/USD` reverted `StalePrice` (`0x19abf40e`). The reads for
`Crypto.NVDAX/USD` and `Crypto.NVDAX/NVDA.RR` reverted `PriceFeedNotFound`
(`0x14aebe68`): these feed IDs had no stored on-chain update at this block.
That does not disprove the catalog entries; it confirms that a valid Hermes
update must be submitted before SENT's read-only shim can use them. The current
feed-to-wrapper semantics remain unresolved: an issuer API quote and a matching
multiplier do not prove which Pyth feed represents the denomination of SENT's
own wrapper.

Primary evidence: read-only `eth_call` against
`https://rpc.hyperliquid.xyz/evm`, block `51,706,107`; issuer public endpoints
[`/assets/NVDAx`](https://api.xstocks.fi/api/v2/public/assets/NVDAx?network=HyperEVM),
[`/multiplier`](https://api.xstocks.fi/api/v2/public/assets/NVDAx/multiplier?network=HyperEVM),
and [`/price-data`](https://api.xstocks.fi/api/v2/public/assets/NVDAx/price-data?network=HyperEVM).
No transaction or account change occurred.

## User-directed public MVP path — WHYPE first, stocks optional — 2026-11-20

The product target is now a usable public MVP, not an xStock-only release gate.
The first launch pair is WHYPE, the canonical ERC-20 wrapper for native HYPE;
the web has a reviewed 1:1 wrap/unwrap path. The existing factory and market
contracts already use an ERC-20 quote-asset interface, and the registry's direct
asset registration path can list a non-rebasing quote asset. The source config
now includes WHYPE and the Chainlink HYPE/USD standard proxy with a 24-hour
freshness limit and a broad displayed sanity band.

SPYx and NVDAx remain follow-up pairs only after their wrappers and price sources
are live and entitled. This avoids making the first release wait on paid equity
feeds while retaining the xStock route for a later activation.

The change is code/config preparation only. On-chain mainnet is still NO-GO:
current factory router and reference price are zero, registry count is zero, and
the deployed reward vault lacks the current launch-readiness check. The next
release work is to verify the 2-of-3 governance Safe, replace Treasury's 1-of-1
setup, configure guardian and reward operators, deploy the graduation router,
register WHYPE with reviewed gates, configure/read back HYPE/USD, then verify
launch, buy/sell, fee accrual, rewards, and graduation before public opening. A
later read-only fork run passed the WHYPE/HYPE/USD freshness checks
and the five HyperSwap venue checks; the mainnet factory, registry and reward
vault remain unconfigured as recorded in the latest
[verification-ledger entry](VERIFY-LEDGER.md#whype-launch-anchor-fork-regression--2026-11-20).

### Live mainnet recheck — 2026-11-20 02:44 UTC

Read-only calls to `https://rpc.hyperliquid.xyz/evm` at block `51,733,651`
confirm the launch path is still blocked: factory `router()` and
`referencePrice()` are zero, registry `registeredCount()` is zero, and
`launchableAssets()` is empty. Factory launch fee remains `0.04 HYPE`.

The shortest intended pair is technically present: WHYPE at
`0x5555555555555555555555555555555555555555` has code, symbol `WHYPE` and 18
decimals. The configured Chainlink HYPE/USD proxy also has code, 18 decimals,
and returned `$4.098536361321559` with `updatedAt=2026-11-20 02:40:07 UTC` at
this read. This establishes a fresh feed observation, not SENT's on-chain
adapter configuration.

The Safe state has changed since older notes: governance Safe is now 2-of-3
with three owners. Treasury remains 1-of-1. On the factory's configured reward
vault, `guardian()`, `quorum()` and `attestorCount()` all return zero. A direct
call to `launchConfigurationReady()` reverts, and selector `0xd7bc7502` is
absent from both deployed runtime bytecodes. The current repository source adds
this launch guard, but it is not present in the already-deployed factory. Before
enabling WHYPE, configure the deployed vault with an independent guardian and
attestor quorum, then verify its full commitment/claim path. Treat this
deployed-source difference as a release gate; do not assume the current source
is what users are calling on mainnet.

**Fastest viable MVP sequence:** keep stock pairs off the first mainnet release;
confirm the governance Safe signers, replace Treasury's 1-of-1 setup, configure
the deployed reward vault with a real guardian plus attestor quorum and verify
the live commitment/claim path; deploy the graduation lock/router using the
large-lane-capable funded deployer; configure and read back WHYPE's HYPE/USD
source; register WHYPE and enable it only after the gates have evidence; then
run a small launch, buy/sell, fee, Stockback claim and graduation rehearsal.
Governance changes require 2-of-3 Safe execution. Mainnet deployment and
launch transactions still require HYPE for gas and the configured `0.04 HYPE`
launch fee. No transaction was submitted in this recheck.
