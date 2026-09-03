# Monitoring

What to alert on, and why each one is the symptom rather than the cause.

This is written before there is anything to monitor on purpose. Choosing alerts
after an incident produces alerts shaped like that incident.

## The projection is behind the chain

`GET /health` reports `headBlock`, `indexedBlock` and a freshness state per §211.

| Condition | Severity | Why |
|---|---|---|
| `headBlock - indexedBlock > 50` for 5 min | warning | The API is serving DELAYED data. Honest, but stale. |
| `headBlock - indexedBlock > 500` for 5 min | page | Quotes come from the chain, but explore, charts and holder counts are all wrong enough to mislead. |
| `/health` returns 503 for 2 min | page | The service is telling the load balancer to stop sending traffic. |

The API deliberately keeps answering while behind, so absence of errors is not
evidence of freshness. This is the alert that catches what error rates cannot.

## The indexer stopped

| Condition | Severity | Why |
|---|---|---|
| `indexedBlock` unchanged for 5 min | page | Distinct from being behind: behind is catching up, unchanged is stuck. |
| Reorg depth exceeds `confirmations` | page | A block treated as settled was reorganised. `blocks.finalized` is now a lie, and the finalizer acts on it. |

The second one is the serious one. Everything downstream of settlement —
Stockback commitments, attestor signatures — assumes it cannot happen.

## Reconciliation found drift

`reconciliation_findings` is written by the worker and is empty in a healthy
system.

| Condition | Severity | Why |
|---|---|---|
| Any `block_gap` finding | page | §138's rebuildable projection is false while a block is missing. |
| Any `cursor_ahead_of_blocks` finding | page | A restart would skip blocks and never return for them. |
| `holder_balance` findings > 0 in an hour | warning | Ingestion produced a wrong running total. Repaired, but the cause is still there. |
| `holder_balance` findings on one market repeatedly | page | Not noise. A specific market's events are being mishandled. |

Findings are kept after repair precisely so this alert is possible. A worker
that silently corrected the projection would leave nothing to alert on.

## The job queue is failing

| Condition | Severity | Why |
|---|---|---|
| Any `DEAD` job | warning | Bounded retry is exhausted; nothing will run it again. |
| `PENDING` older than 15 min | warning | The runner is not draining. Charts stop updating before anyone notices. |
| `DEAD` jobs of kind `holders` | page | Reconciliation is the check on the projection. A dead check is worse than no check, because the dashboard still shows green. |

## Stockback stopped distributing

| Condition | Severity | Why |
|---|---|---|
| No new `stockback_datasets` row for a funded market in 48h | page | Epochs are 24h. Two missed means holders are accruing nothing. |
| A dataset's `total_cumulative` below the previous one | page | Cumulative entitlements must never decrease; a claim would underpay. Should be impossible — see `services/finalizer/sim/finalizer.ts`. |
| `carry_forward` growing every epoch | warning | The pool is not reaching holders. Usually every eligible holder is excluded. |

## The scrape targets

Every service exposes `/metrics` in Prometheus text format, and every one except
the API also exposes `/healthz` for an orchestrator's liveness probe.

| Service | Metrics | Liveness |
|---|---|---|
| API | `:8080/metrics` | `/health` (§211 freshness, 200/503) |
| Indexer | `:9101/metrics` | `:9101/healthz` |
| Finalizer | `:9102/metrics` | `:9102/healthz` |
| Worker | `:9103/metrics` | `:9103/healthz` |
| Realtime | `:9104/metrics` | `:9104/healthz` |

**Liveness is not freshness, anywhere.** `/healthz` answers "is this process
doing its job", which is what an orchestrator restarts on. None of them report
unhealthy because the chain is slow: a service that restarted itself whenever
the RPC degraded would turn a degraded dependency into an outage. The API's
`/health` is the exception and reports §211 freshness deliberately, because a
load balancer removing a stale replica is the correct response.

`/metrics` and `/health` are never rate limited. They are exactly the requests
that must still work while something is hammering the service.

### The gauges that are null rather than zero

Several gauges return nothing when they cannot be determined, so the series
disappears from the scrape instead of reading zero:

- `sent_api_indexer_lag_blocks`, `sent_indexer_lag_blocks` — before the first
  successful head read
- `sent_indexer_event_delay_seconds` — before the first block is written
- `sent_finalizer_publication_age_seconds` — before the first dataset
- `sent_worker_jobs_pending` — when the queue depth read failed

**Alert on `absent()` for these, not only on their value.** A lag gauge reading
zero during an RPC outage is the reassuring answer and it is wrong; a missing
series is honest and is the one worth catching.

### Metric-based versions of the alerts above

| Expression | Severity |
|---|---|
| `sent_indexer_lag_blocks > 50` for 5m | warning |
| `sent_indexer_lag_blocks > 500` for 5m | page |
| `absent(sent_indexer_lag_blocks)` for 5m | page |
| `sent_indexer_event_delay_seconds > 600` for 5m | page |
| `increase(sent_indexer_reorgs_total{depth="13+"}[1h]) > 0` | page |
| `increase(sent_indexer_reindexes_total[24h]) > 0` | page |
| `sent_finalizer_publication_age_seconds > 172800` | page |
| `increase(sent_finalizer_failures_total[1h]) > 0` | warning |
| `sent_worker_jobs_dead > 0` | warning |
| `increase(sent_realtime_dropped_total[15m]) > 0` | warning |
| `sent_realtime_connections > 0 and rate(sent_realtime_delivered_total[10m]) == 0` | page |
| `rate(sent_api_rate_limited_total{route="/quote"}[15m]) > 1` | warning |

The realtime one is worth reading twice. Connections open and delivery flat is
a gateway that is accepting sockets and sending nothing — which looks identical
to a quiet market from outside, and is a bug this service has already had:
`Gateway.open()` constructs a session rather than returning one, and the flush
loop called it per connection, wiping every subscription fifty times a second.

`sent_indexer_event_delay_seconds` is the one that catches a stopped CHAIN. Lag
goes to zero and stays there when no blocks are being produced, because the
indexer is perfectly caught up with a chain that is not moving.

## What is deliberately NOT alerted on

- **Quote latency.** Quotes are read from the chain per §423. A slow quote is an
  RPC problem, and paging on it trains people to ignore the page. It is
  measured — `sent_api_quote_seconds` — because the histogram is what tells you
  whether an incident was the RPC's fault, which is a question asked after the
  fact rather than at 3am.
- **WebSocket disconnects.** Clients reconnect and replay. Individual drops are
  normal; the replay buffer overflowing is not, and that is covered by dropped
  message counts.
- **Trade volume.** A quiet market is not an incident. Alerting on business
  metrics puts a pager on something nobody can fix at 3am.

## Logs

One JSON object per line, on stdout, from every service. Never pretty-printed:
a multi-line entry is one that every aggregator splits into several, and the
tail arrives as an unparseable fragment with no service name on it.

Correlate on §437's fields: `requestId`, `chainId`, `blockNumber`, `txHash`,
`logIndex`, `tokenAddress`, `marketAddress`, `epochId`, `account`. The API
generates a `requestId` per request, accepts an inbound `X-Request-Id`, and
echoes it — so a user reporting a problem can quote the identifier that finds
their exact request.

**Secrets cannot reach the aggregator.** Redaction is a property of the logger
rather than of the call sites: keys whose name looks like a secret are replaced
whatever they contain, recursively through nested objects, and a bare 32-byte
hex string is replaced unless it arrived under a name that says it is a public
hash. See `packages/observability/src/logger.ts`.

## Not yet decided

- The collector itself. Every service is scrapeable and every log line is
  structured; nothing scrapes or collects them because the deployment target is
  not fixed (§434).
- Reference-price freshness (§146). There is no live oracle to measure — V-11 is
  unverified, and §279 forbids a placeholder standing in for one.
