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

## What is deliberately NOT alerted on

- **Quote latency.** Quotes are read from the chain per §423. A slow quote is an
  RPC problem, and paging on it trains people to ignore the page.
- **WebSocket disconnects.** Clients reconnect and replay. Individual drops are
  normal; the replay buffer overflowing is not, and that is covered by dropped
  message counts.
- **Trade volume.** A quiet market is not an incident. Alerting on business
  metrics puts a pager on something nobody can fix at 3am.

## Not yet decided

- Metric transport. The runner exposes counters in-process (`JobRunner.metrics`)
  and the API exposes `/health`; neither is scraped yet. Prometheus is the
  obvious default but the deployment target is not fixed (§434).
- Log aggregation. Workers emit one JSON object per line, which is ready for a
  collector that does not exist yet.
