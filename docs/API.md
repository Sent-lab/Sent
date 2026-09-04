# API

The read surface. §432 asks for REST/JSON plus a WebSocket, versionable and
typed; this is what exists and what each field means.

Every route is served twice — at `/v1/…` and at the bare path — from one
definition. Build against `/v1`.

Base URL is deployment-specific. Locally: `http://localhost:8080`.

---

## Every response has the same shape

```jsonc
{
  "ok": true,
  "data": { /* the answer */ },
  "freshness": {
    "state": "LIVE",          // LIVE | SYNCING | DELAYED | RECONNECTING | STALE
    "headBlock": "1042",
    "lagBlocks": 0,
    "finalizedBlock": "1022",
    "serverTime": 1788400000
  }
}
```

A failure keeps the envelope:

```jsonc
{ "ok": false, "code": "MARKET_NOT_FOUND", "message": "…", "retryable": false, "freshness": { … } }
```

**The freshness envelope is not optional and is never stripped** (§87, §211). A
client that renders a number without access to how old it is cannot be honest
about it. Errors carry it too, including 404s and 503s — "we could not answer"
and "we could not answer and we are also twenty minutes behind" are different
problems.

### Quantities are strings

Every amount, price and block number crosses the wire as a decimal string. A
`uint256` does not fit in a JSON number, and `Number()` on one loses precision
silently above 2^53 rather than throwing (§424). Parse with `BigInt`.

### Provenance travels with values

Numbers that could be misread carry a `Sourced` wrapper:

```jsonc
{ "value": "20000000000", "provenance": "INDEXED", "asOfBlock": "1042", "asOf": 1788400000 }
```

`provenance` is one of:

| | |
|---|---|
| `CHAIN` | read from a contract in this request |
| `INDEXED` | a row the projection holds |
| `CALCULATED` | arithmetic over indexed rows |
| `ESTIMATED` | a projection of something not yet settled |

The distinction is not decoration. A portfolio value is `CALCULATED` because
selling the position walks down the curve and returns less; a price is
`INDEXED` because it is what the chain last said.

---

## Markets

### `GET /v1/markets`

The explore listing, as a page.

| Query | Default | Notes |
|---|---|---|
| `sort` | `NEWEST` | `NEWEST`, `PROGRESS`, `VOLUME`, `HOLDERS`, `TRENDING`, `GAINERS`, `RECENTLY_GRADUATED` |
| `status` | — | `PRE_GRAD`, `GRADUATING`, or `GRADUATED` |
| `quoteAsset` | — | filter to one xStock |
| `q` | — | name, ticker, or an exact address |
| `limit` | 25 | capped |
| `offset` | 0 | |

```jsonc
{ "items": [ … ], "total": 128, "offset": 0, "limit": 25, "hasMore": true }
```

`hasMore` is stated rather than inferred from `items.length === limit` — that
inference is wrong exactly once, on the page that ends flush with the limit,
where it promises a page that does not exist.

**Search matches addresses exactly and text fuzzily.** A near-miss on twenty
bytes is a different market, so a truncated address is refused with
`MALFORMED_ADDRESS` rather than falling through to a name search that would
quietly return the wrong token.

**`TRENDING` is defined**, not a vibe (§95.21):

```
24h volume × log₂(2 + 24h trades) / (2 + age in days)
```

Volume is the base because it is the part that cannot be faked for free. The
trade term is logarithmic so a wash-trading loop cannot outrank real size. The
age divisor is what makes it trending rather than "biggest": a market that did
the same volume on its first day outranks one that did it on its thirtieth.

**Paging is an offset, not a cursor.** Volume, holders and trending all reorder
between requests, so a cursor encoding "after this row's sort key" would
silently skip or repeat rows as the data moved — and would look correct doing
it. An offset is honestly approximate.

### `GET /v1/markets/:token`

One market, in full. `:token` is the token contract address — the canonical
identity. A ticker is display metadata and is not unique.

Beyond the obvious fields:

- **`curve`** — `p0`, `pg`, `qG`, `totalSupply`. Enough to price locally between
  blocks (§21). Without it a bot has to ask this API for every quote, which
  makes the API a dependency of something that should run without one.
- **`pool`** — the HyperSwap pool, or `null` before graduation (§21
  `graduatedPool`).
- **`referenceMarketCapUsd`** — runs from $2,000 to exactly $50,000 at
  graduation. **No oracle is involved**: the launch-time xStock/USD snapshot is
  already baked into `p0`, so `price / p0` is the market's movement along its
  own reference path. This is what graduation follows.
- **`liveMarketCapUsd`** — **absent**. It needs the live xStock/USD display
  feed, which is unverified (V-11). §403 requires the two to be
  distinguishable and forbids implying the live number triggers anything; §279
  forbids a placeholder standing in for an unverified dependency. An absent
  field renders as nothing. A zero would render as a market worth nothing.
- **`authentic`** — from the factory's own registry, never from the address
  shape (§4).
- **`metadata`** — the newest revision, or `null` when the market has none. See
  below; `null` and an empty description are different things.

#### Metadata

On-chain (§95.20, D-013). The description and links are emitted by the factory;
the image is an IPFS CID, which is a hash of the bytes — a gateway serving
something else fails the check without this platform storing anything.

```jsonc
{
  "revision": "1",
  "description": "…",
  "imageCid": "bafybei…",
  "links": [ { "label": "website", "url": "https://example.com" } ],
  "unsafeLinksRemoved": 1,
  "verified": null
}
```

**`verified` is `null`, not `false`, when it cannot be determined.**
`launchIntentHash` is bound into the token's CREATE2 address (§412) and commits
to what the creator reviewed **at launch** — a revision deliberately cannot
alter the address. So only revision 0 is verifiable; a revision reports `null`,
and so does a market launched before the event carried the hash.

"We have not checked" and "this does not match" are opposite claims about a
creator. Rendering the first as the second accuses people who did nothing wrong.

**Links are filtered to `http(s)` before they leave this API,** and
`unsafeLinksRemoved` says how many were dropped. The chain deliberately does not
validate schemes — a `javascript:` URL is inert in calldata and dangerous only
where something renders it — so the check happens here, and the count travels
with it so a UI can say "1 link hidden" rather than silently showing fewer than
the creator published. A client should still not render a URL it has not checked
itself; this API is not the only consumer, and it is not the last line.

To fetch the image, pick a gateway: `https://<gateway>/ipfs/<imageCid>`. This
API does not choose one for you.

### `GET /v1/markets/:token/trades`

The tape. `limit` up to 100.

Every trade carries the **full fee split** — `coreFee`, `creatorFee`,
`platformFee`, `stockback` — never aggregated into one number. §316 forbids
that, because the tape is where most people form their impression of who earns
what.

### `GET /v1/markets/:token/candles`

`interval` in seconds, from a fixed set. An unsupported interval is refused by
name (`UNSUPPORTED_INTERVAL`) rather than clamped to the nearest — a client bug
should surface, not silently receive a different timeframe.

### `GET /v1/markets/:token/preview.svg`

The social preview (§117), 1200×630, as `image/svg+xml`. Point `og:image` at
it.

**The creator's image is deliberately not embedded.** Fetching a
creator-supplied IPFS CID from a public, unauthenticated endpoint would be an
outbound request from this service to a URL a stranger chose — request forgery
with a public trigger — and would make render time depend on somebody else's
gateway. The mark on the card is derived from the token address instead:
deterministic, unique per market, always available. The real logo is served as
`metadata.imageCid`, for a client to fetch in a browser where the request is the
user's.

Cached for five minutes with an hour of `stale-while-revalidate`. A preview that
500s during a slow database renders as a bare URL, and a slightly old card beats
no card by a wide margin.

An unknown token returns a **JSON 404**, not an SVG saying "not found" — a
crawler would cache and display the second.

Most crawlers want PNG for `og:image`. Rasterising needs a native dependency
whose choice depends on the deployment runtime (§434), so it sits behind a
documented seam rather than being guessed at.

### `GET /v1/markets/:token/epochs`

§333's public distribution dataset and §367's status.

Each epoch carries its **inputs** — `pool`, `eligibleHolders`, `totalWeight` —
alongside its outputs — `merkleRoot`, `datasetHash`, `totalCumulative`. The
dataset exists so someone who does not trust this service can re-derive the
root themselves; a response carrying only a root is asking to be believed.

`attested` is the line §293 draws. It is a join against the on-chain
commitments, not a stored flag: an epoch this node computed and an epoch the
chain honours are different things, and a boolean written by the finalizer
would be the finalizer's opinion of the chain rather than the chain.

`status.state`:

| | |
|---|---|
| `OPEN` | nothing submitted; the epoch is still accumulating |
| `FINALIZING` | a root is on-chain, waiting out §334's activation delay |
| `FINALIZED` | a root is active and entitlements against it are payable |

`status.outstanding` is funded minus claimed — what the vault still owes. It is
deliberately **not** "what is claimable": money funded into an unattested epoch
belongs to holders and is payable to nobody, and collapsing the two reports a
solvency problem that does not exist.

### `GET /v1/markets/:token/stockback/:account`

One holder's position on one market.

`estimatedAccrued` and `claimable` are separate fields and must stay separate in
any UI (§293). `claimable` exists only under a root the attestors activated
on-chain, and the `proof` is served with it — a claimable amount without a proof
is a number the user cannot act on. `estimatedAccrued` comes from the newest
dataset this node computed, which nobody has signed and the vault will not
honour.

---

### `GET /v1/graduations/pending`

Markets whose curve has closed and whose HyperSwap position is not minted yet.

```jsonc
{
  "pending": [
    {
      "market": "0x…",
      "token": "0x…",
      "symbol": "NVDA1",
      "graduatingAtBlock": "44941720",
      "waitingBlocks": "12"
    }
  ],
  "stalled": false
}
```

**Why this is public.** Graduation is two transactions (D-016): a full migration
costs 5,388,986 gas and HyperEVM's default block lane caps at 3,000,000, so the
buy that crosses the endpoint closes the curve and a permissionless
`finalizeGraduation()` mints the position afterwards.

§16 requires that call to be permissionless so that no single party can freeze a
graduated market by doing nothing — and a permissionless call that only one
party's tooling can *find* is permissionless on paper. So the list is served to
everyone. A keeper polls it, an operator alerts on `stalled`, and a UI can offer
the finalise to whoever is looking at a stalled market.

`waitingBlocks` is what a threshold compares against. A market passes through
this state once and briefly, so a large value means nobody has finalised it —
not that the market is busy. `stalled` is true when any market has waited past
600 blocks.

**Always 200, never 404, and an empty array is the healthy answer.** A caller
that treated 404 as "nothing to do" would read a routing mistake and a quiet
protocol identically.

A market in this state has **no venue**: its curve is permanently closed and its
pool does not exist. Quotes against it are refused with
`MARKET_AWAITING_FINALISATION`.

### Quote assets are wrappers, and every market says what it wraps

Markets are quoted in a **non-rebasing wrapper**, not in the xStock itself
(D-017). A Uniswap V3 position cannot hold a rebasing token — it pays out from
internal liquidity accounting and has no `skim()` — so a raw xStock in a
permanently locked pool would bury every dividend it ever pays and break outright
on a reverse split.

The consequence for a client is small and not optional. `quoteSymbol` is
something like `wTSLAx`, which a user has no reason to recognise, so every market
response carries:

```jsonc
{
  "quoteAsset":      "0x…",      // the wrapper — what the market actually holds
  "quoteSymbol":     "wTSLAx",
  "quoteUnderlying": "0x8aD3…",  // the xStock it wraps, or null
  "quoteDecimals":   18
}
```

**Render `quoteUnderlying` when it is present.** A contract called "Wrapped Tesla
xStock" that holds something else is the cheapest attack on a user who reads
before signing, and a client showing only the symbol is asking them to trust it.
The registry verifies the wrapper's provenance against a fixed factory on-chain;
this field is how that verification reaches the screen.

`null` means the asset wraps nothing. Show nothing — inventing a relationship is
worse than showing none.

A holder of the underlying has one extra step before trading: approve, wrap, then
approve the market. `buildWrapIntent` and `buildUnwrapIntent` in the SDK build
both, and their reviews explain why the step exists.

## Accounts and creators

### `GET /v1/accounts/:address`

Holdings, cross-market Stockback, claim history, launch count.

`portfolioValue` is a **mark**, marked `CALCULATED`. Every holding is valued at
the curve's current price; selling the whole position walks down the curve and
returns less, sometimes much less on a thin market. The only thing that can
answer "what would I get" is a sell quote against the chain.

`totalClaimable` only ever includes attested roots. A cross-market "claim
everything" figure that included unattested arithmetic would be a total the
vault refuses to pay, offered as a button.

An address with nothing is `200` with empty arrays, not `404`. Everyone starts
there, and a 404 makes a first visit look broken rather than empty (§209).

### `GET /v1/accounts/:address/stockback`

The Stockback half on its own, so a claim centre does not pay for holdings and
history it will not render.

### `GET /v1/creators/:address`

§221's cockpit. **Three fee figures, and they are different questions:**

| | source | meaning |
|---|---|---|
| `claimable` | the **vault** (§423) | what a claim would pay right now |
| `accrued` | the projection | everything ever earned |
| `claims` | the projection | every withdrawal, newest first |

Summing indexed accruals for `claimable` would tell a creator they can withdraw
money already in their wallet, and the claim would revert with `NothingToClaim`
after they paid gas to find out. Without `claims` a creator sees "earned 4.2,
claimable 0" and cannot tell a past withdrawal from a failure.

`stats` is §26's reputation layer: launches, graduations, lifetime volume,
trades, holders, and a graduation rate **per mille**. Every figure is derived
from what the chain did and none of it can be granted, bought or set — which is
the section's whole point, and also why there is no field here an operator could
write. The rate is an integer per mille rather than a float because 2 of 3 as a
float is `0.6666666666666666`, which every consumer then rounds differently.

`feeVault` is returned so the claim a creator signs targets the same contract
the balance came from. A client holding its own vault address could show one
contract's balance over a button that calls another.

When the vault cannot be reached, `feeVault` is `null` and `claimable` is empty
— **the whole list, not the assets that failed**. A partial answer about a
balance is worse than a stated gap: with one asset, an omission leaves an empty
list, which reads exactly like a successful zero.

---

## Platform

### `GET /v1/platform/stats`

§166's metrics from §168's sources. Counts are `INDEXED`, sums are
`CALCULATED`; every figure is counted from the projection's own tables rather
than kept as a running total a reorg could leave disagreeing with the pages it
summarises.

`stockbackDistributed` is what holders were **paid**, not what has been funded.
Money sitting in the vault has been distributed to nobody, and counting it would
be exactly the flattering-but-false figure §168 rules out.

`activeXStockPairs` comes from the registry, not from a `DISTINCT` over markets:
a verified, enabled asset is an available pair whether or not anyone has
launched against it.

### `GET /v1/platform/pulse`

§52's market heat per xStock ecosystem, and §53's live presence.

`buyPressureBps` is by **notional**, not by count — one large sell against fifty
dust buys is selling pressure, and a count renders it as the opposite. An
ecosystem with no volume reads `5000`, not `0`: zero would claim everything was
a sell during a period in which nothing happened.

**Nothing is normalised to a heat value.** Ecosystems differ by orders of
magnitude, so any normalisation is a presentation choice and §52's warning about
becoming a noisy colour heatmap is a warning about that mapping.

`presence.activeTraders` is **distinct traders who traded in the window**, not
open sockets. §53 requires the implementation to be honest about the metric it
uses; counting connections would be a different number wearing the same label —
higher, flattering, and moved by any bot with a reconnect loop. `windowSeconds`
travels with it so nothing can be rendered as "right now".

### `GET /health`

`200` when serving, `503` when too far behind to be trusted — with a body
either way. A service that is behind still answers and says so; returning 200
with fresh-looking data while minutes stale is the failure §211 is written
against.

Never rate limited.

### `GET /metrics`

Prometheus text, outside the versioned surface. It is operational, not a
product API — no freshness envelope, no JSON shape, no compatibility promise —
and versioning it would imply all three while making a scrape config change
whenever the API version does.

Never rate limited.

---

## Quoting

### `POST /v1/quote`

```jsonc
{ "token": "0x…", "side": "BUY", "amount": "1000000", "slippageBps": "100", "deadline": "1788400600" }
```

Returns a **complete signable intent**, not a price:

```jsonc
{
  "kind": "BUY",
  "chainId": 999,
  "to": "0x…",        // the market
  "data": "0x…",      // the calldata
  "value": "0",
  "review": { "summary": "…", "rows": [ { "label": "You receive", "value": "…" } ] }
}
```

§694: **UI review = transaction intent = SDK builder = actual calldata.** The
numbers in `review.rows` and the bytes in `data` come from the same object. A
client renders the rows verbatim and sends `to`/`data`/`value` untouched. If a
value is not in the intent, it should not be shown.

The quote is computed from the market's own `quoteBuy`/`quoteSell` over RPC
(§423) — the same functions the trade will execute against — not from the
projection, which may be blocks behind.

**Rate limited more tightly than reads.** Each quote is an RPC call on a shared
provider quota; a retry loop with no backoff would exhaust it and break quoting
for everyone. A refusal is `429` with `Retry-After` and
`code: "RATE_LIMITED"`.

---

## Realtime

WebSocket, separate port. Subscribe by channel:

```jsonc
{ "type": "subscribe", "channels": [ { "kind": "market", "market": "0x…" } ] }
```

Channels: `market`, `account`, `explore`, `platform`.

Server messages: `hello`, `trade`, `market_state`, `graduation`, `freshness`,
`error`, and the §368 Stockback stream:

| | |
|---|---|
| `stockback_funded` | a trade contributed to the pool |
| `stockback_epoch_closed` | the window ended and was computed |
| `stockback_finalizing` | a commitment is on-chain, waiting out §334's delay |
| `stockback_finalized` | the root activated; entitlements are payable |
| `stockback_claimed` | the vault paid somebody |

`finalizing` and `finalized` are separate because §334's delay is real: between
them a root is on-chain and pays nothing, and a UI treating submission as
finality would show a claim button six hours early.

`stockback_claimed` carries an `account` and is delivered to that wallet's
channel as well as the market's — it changes what one wallet can withdraw, and
that wallet is usually not on the market page at the time.

A cancellation is deliberately **not** published. A cancelled root never paid
anything, so there is no client state to correct, and announcing it would raise
an alarm about money that was never at risk.

Events are published inside the transaction that writes the row, so a
subscriber can never be told about a block that rolled back.

Reconnect with `sinceBlock` to replay the gap. If the buffer no longer reaches
back that far, the session is refused and marked degraded rather than silently
resuming with a hole in it.

---

## The claim flow, end to end

1. The finalizer computes a distribution over settled epochs and stores the
   dataset with every holder's proof. Nothing is payable yet.
2. Attestors independently compute the same commitment and sign it (§404). The
   signature covers chainId and the vault as struct **fields**, so it is useless
   on any other chain, vault, market or version.
3. Anyone submits the quorum-signed commitment. `stockback_finalizing`.
4. Six hours pass (§334). A bad root can be cancelled in this window.
5. Anyone activates it. `stockback_finalized`. Entitlements become payable.
6. A holder reads `claimable` and `proof` from
   `/markets/:token/stockback/:account` and calls `claim(market, account,
   cumulative, proof)`.

Entitlements are **cumulative** (§365). The vault pays `cumulative − claimed`,
so claiming twice pays nothing rather than paying twice, and each root must be a
superset of the last.

---

## Error codes

| code | status | |
|---|---|---|
| `MARKET_NOT_FOUND` | 404 | no launched market for that token |
| `INVALID_ADDRESS` | 400 | not a 20-byte address |
| `MALFORMED_ADDRESS` | 400 | looks like an address, is not one |
| `UNSUPPORTED_SORT` | 400 | not a sort this API offers |
| `UNSUPPORTED_INTERVAL` | 400 | not a candle interval this API offers |
| `QUOTE_UNAVAILABLE` | 503 | the chain would not answer; retryable |
| `MARKET_AWAITING_FINALISATION` | 400 | curve closed, pool not minted yet; retryable |
| `MARKET_GRADUATED` | 400 | trade on the HyperSwap pool instead |
| `RATE_LIMITED` | 429 | with `Retry-After`; retryable |
| `STATS_UNAVAILABLE` | 503 | aggregates could not be read |
| `PULSE_UNAVAILABLE` | 503 | activity could not be read |

`retryable` is on the body. It says whether the same request unchanged could
succeed later — which is a different question from whether the status code
happens to be a 5xx.

`MARKET_AWAITING_FINALISATION` and `MARKET_GRADUATED` are separate codes for one
reason: they need different advice. The second sends the caller to a HyperSwap
pool. The first must not, because at that moment there is no pool — a refusal
that names a venue which is not there is worse than one that says nothing,
because the caller goes looking for it. It is also the only refusal in this
table that is a `400` and retryable, and both are correct: the request is
well-formed and will succeed unchanged as soon as anyone finalises the market.
