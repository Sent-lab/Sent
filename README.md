# SENT

**Launch. Pair. Create market.**

A permissionless fixed-supply token launchpad on HyperEVM, where every market is
quoted against an official xStock — a tokenized equity — rather than a
stablecoin or the native gas token.

A market opens at a $2,000 reference market cap, trades two-way on a bonding
curve, and **graduates automatically at $50,000** into permanently locked
HyperSwap V3 liquidity. Holders earn **Stockback**: a share of every trade paid
back to them in the market's own paired xStock, weighted by how much they held
and for how long.

Creator allocation is 0%. Platform allocation is 0%. Nobody deposits liquidity.

---

## Status

> **Pre-audit and pre-deployment. Nothing here is live, and no contract has
> touched mainnet.**

| | |
|---|---|
| Contracts | Core protocol complete except the graduation router |
| Backend | Indexer, projection, API, realtime gateway, Stockback pipeline, workers |
| Frontend | Discovery, trading terminal, chart, live tape, create and account |
| Wallet signing | Wired; unverified against a browser extension |
| External audit | Not started |
| Deployment | None |

The whole stack is exercised end to end against a local chain: contracts
deployed, a market launched and traded, a real reorg performed and reconciled,
graduation, and a Stockback distribution whose Merkle proofs verify against
their own root. That suite found twelve defects that unit tests could not,
every one of them in a seam between two components that were each correct on
their own.

**Not yet resolvable** — these depend on external facts that have not been
confirmed, and the project deliberately refuses to guess them:

- canonical xStock ERC-20 addresses on HyperEVM
- a HyperSwap primitive that locks LP principal while preserving fee rights
- the launch-time reference price source

The read surface is documented in [`docs/API.md`](docs/API.md).

Every open dependency is tracked in [`docs/VERIFY-LEDGER.md`](docs/VERIFY-LEDGER.md)
with its evidence class. Nothing in production may depend on an unverified row.

---

## How it works

**Pre-graduation.** A creator names a token, picks an official xStock pair, and
pays about a dollar plus gas. The factory deploys a 1,000,000,000 fixed-supply
ERC-20 through creator-bound CREATE2 and opens a market against the chosen
xStock. The whole supply goes to the market, which releases it along a linear
curve. Buys cost 2%, sells 3% — a 1% core fee split 65/35 between creator and
platform, plus a Stockback contribution of 1% on buys and 2% on sells that goes
entirely to holders.

**Graduation.** When the marginal price reaches 25× the launch price, the market
graduates inside the triggering trade. There is no manual trigger for anyone.
The endpoint is chosen so that curve collateral exactly equals the value of the
remaining supply at the final price — which is why the HyperSwap position needs
no creator or treasury top-up, and why a full-range mint consumes both sides with
no meaningful dust.

**Post-graduation.** The curve closes permanently. The token address never
changes. LP principal is locked forever; the creator keeps 65% of eligible fee
revenue for the life of the market.

**Stockback.** Rewards are time-weighted over 24-hour epochs — amount held times
time held — so a snapshot buy pays almost nothing. Independent attestors compute
the same distribution from the same chain events and sign a cumulative Merkle
commitment. Anyone may submit it; the submitter earns nothing. A guardian can
freeze claims before a suspicious root activates, and only governance can
release that freeze.

---

## Repository

```
contracts/        Solidity, Foundry tests, invariant suites
packages/
  economics/      Canonical curve, fee and V3 geometry math
  stockback/      TWAB engine and Merkle distribution
  sdk/            TransactionIntent builder — the only place calldata is built
  contracts/      Generated ABIs
  realtime/       Shared event schema and the freshness contract
  database/       PostgreSQL schema
  config/         Verified chain constants and validated environment loading
services/
  indexer/        Reorg-safe ingestion and the state projection
  api/            HTTP handlers
  realtime/       WebSocket gateway
  stockback/      TWAB to Merkle commitment pipeline
  finalizer/      Computes distributions from settled state. Never signs.
  worker/         Candles, reconciliation, health sweeps
apps/web/         Next.js application
infra/            Container image, local stack, migrations, alerting
tests/
  integration/    The projection SQL against a real PostgreSQL
  e2e/            The whole stack against a real chain
docs/             API reference, comprehension pass, verify ledger, decisions
```

---

## Two rules the whole codebase is built around

**One canonical source.** Curve math, fee math, Stockback accounting, creator
identity, transaction building and address config each exist in exactly one
place. Where a second implementation is unavoidable — Solidity on-chain and
TypeScript for the SDK and indexer — the two are **differential-tested against
each other** so they cannot drift.

**What the user reviews is what they sign.** A quote is not a number, it is a
complete signable transaction. The API returns an intent built by the SDK; the
review rows carry the exact figures, computed by the same code the contract runs.
A Foundry test submits SDK-generated calldata byte for byte to a real market and
asserts the on-chain outcome equals what the review showed.

---

## Running it

```bash
pnpm install
pnpm typecheck
pnpm sim:all
```

Contracts need [Foundry](https://getfoundry.sh):

```bash
forge test --root contracts
FOUNDRY_PROFILE=inv forge test --root contracts
```

Fixtures shared between TypeScript and Solidity are committed. CI regenerates
them and fails on any diff, so the two halves cannot drift silently:

```bash
pnpm fixtures:all
```

The integration and end-to-end suites need a database and a chain. Both skip
rather than fail when those are absent, because failing on a laptop is how a
test result stops being read:

```bash
docker run --rm -e POSTGRES_PASSWORD=sent -e POSTGRES_USER=sent   -e POSTGRES_DB=sent -p 5432:5432 postgres:16-alpine
anvil

export DATABASE_URL=postgres://sent:sent@localhost:5432/sent
export RPC_URL=http://127.0.0.1:8545

node --experimental-strip-types tests/integration/projection.ts
node --experimental-strip-types tests/integration/live.ts
pnpm e2e
```

---

## What is actually verified

Tests are not the point; the properties are. These are proven rather than
asserted:

- the graduation endpoint reproduces the reference outcomes exactly, and its
  collateral equals the remaining supply valued at the final price
- a full-range V3 mint consumes both sides with 0 ppb dust, at every enabled fee
  tier and in both token orderings
- curve and fee math agree between Solidity and TypeScript across 459 cases,
  spanning the regime where a naive `uint256` port overflows
- Merkle proofs built off-chain actually pay out against the real vault
- five independent attestors, given the same events in five different orders,
  produce a byte-identical root
- the off-chain projection reproduces on-chain state from real logs
- collateral is a liability, never a balance: donating either asset changes
  nothing about what the curve owes or what graduation migrates
- what a user reviews is byte-for-byte what their wallet signs, from the SDK
  builder through the API to the transaction handed to the wallet
- the projection converges back onto the chain after a real reorg: the orphaned
  trade is gone, the replacement is present, and no block above the new head
  survives
- a Stockback commitment computed from real indexed funding stays inside its
  funding ceiling, and its proofs verify against its own root while failing for
  an amount one wei different

---

## Where the bugs have actually been

Thirty-one defects were found and fixed during the build, and none of them was
caught by a unit test. They fell into four shapes — a seam between two
components that were each individually correct, a placeholder that outlived the
reason it was written, code that was correct but quadratic, and a failed read
that renders exactly like a real answer.

The largest single group is a table that was read by something and written by
nothing. Five of them, including one that would have paid every pre-graduation
Stockback reward to the bonding curve instead of to holders.

[`docs/REVIEW-NOTES.md`](docs/REVIEW-NOTES.md) lists every one of them and what
the pattern implies for reviewing this codebase. It is the first thing worth
reading before auditing anything here.

---

## Security

Not audited. Do not deploy this.

If you find something, please open an issue — the commit history is deliberately
explicit about bugs found and fixed during development, and that record is more
useful than a clean-looking history.

---

## License

[Business Source License 1.1](LICENSE). Converts to GPL-2.0-or-later on
2030-09-02. Reading, auditing, research and integrations are expressly
permitted; running a competing launchpad is not.
