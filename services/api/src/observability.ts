/**
 * SENT — the API's metrics (§146, §437).
 *
 * §146 names what has to be monitored. The four this service is the only place
 * to see are request latency, quote latency, indexer lag as the API perceives
 * it, and whether the chain connection is up.
 *
 * WHY THE METRIC NAMES ARE DECLARED HERE RATHER THAN AT THE CALL SITE
 * -------------------------------------------------------------------
 * A metric that is incremented under a name that was never registered is
 * silently dropped — `increment` has nothing to increment. Declaring the whole
 * set in one file makes a typo a missing chart on a dashboard nobody built yet,
 * rather than a missing alert on the day it matters. The registry is
 * deliberately not permissive about this: it does NOT auto-create on write.
 */

import { Registry } from "@sent/observability/metrics";

export const REQUEST_SECONDS = "sent_api_request_seconds";
export const REQUESTS_TOTAL = "sent_api_requests_total";
export const QUOTE_SECONDS = "sent_api_quote_seconds";
export const QUOTE_FAILURES = "sent_api_quote_failures_total";
export const INDEXER_LAG = "sent_api_indexer_lag_blocks";
export const CHAIN_CONNECTED = "sent_api_chain_connected";
export const SERVING = "sent_api_serving";

export interface ApiMetricSources {
  /** Chain head minus indexed height, as this process last observed it. */
  readonly lagBlocks: () => number | null;
  readonly chainConnected: () => boolean;
  /** §211's judgement: is this service fresh enough to be answering at all. */
  readonly serving: () => boolean;
}

export function createApiRegistry(sources: ApiMetricSources): Registry {
  const registry = new Registry();

  registry.histogram(REQUEST_SECONDS, "HTTP request duration in seconds, by route and status.");
  registry.counter(REQUESTS_TOTAL, "HTTP requests served, by route and status class.");

  /*
   * Quote latency is separate from request latency (§146 names it on its own).
   *
   * A quote goes to the chain over RPC while every other route reads the
   * projection, so folding it into the general histogram would let one slow
   * dependency move a number that is supposed to describe this service.
   */
  registry.histogram(QUOTE_SECONDS, "Quote round trip to the chain, in seconds.");
  registry.counter(QUOTE_FAILURES, "Quotes the chain would not answer.");

  /*
   * Lag, connectivity and serving are all read at scrape time.
   *
   * A stored lag number needs something to remember to refresh it, and a lag
   * metric that quietly stops updating reports "no lag" — which is exactly the
   * incident it exists to catch. Null when the head is unknown, so the series
   * disappears rather than reading zero.
   */
  registry.gauge(INDEXER_LAG, "Blocks the projection is behind the chain head.", sources.lagBlocks);

  registry.gauge(CHAIN_CONNECTED, "1 when the RPC connection is up, 0 when it is not.", () =>
    sources.chainConnected() ? 1 : 0,
  );

  registry.gauge(
    SERVING,
    "1 when the service considers itself fresh enough to answer (§211).",
    () => (sources.serving() ? 1 : 0),
  );

  return registry;
}

/**
 * Collapse a path to its route shape.
 *
 * `/markets/0xabc…/trades` becomes `/markets/:token/trades`. Without this every
 * token address becomes its own label value, and a metrics store with one time
 * series per market is a metrics store that falls over on the day the product
 * succeeds. It also puts user-supplied strings into label values, which is a
 * cardinality bomb with a search box attached.
 */
export function routeLabel(url: string): string {
  const path = url.split("?")[0] ?? "/";

  return path
    .replace(/^\/v1(?=\/|$)/, "")
    .replace(/\/0x[0-9a-fA-F]{40}(?=\/|$)/g, "/:address")
    .replace(/\/\d+(?=\/|$)/g, "/:n")
    // Anything still unrecognised collapses too. A 404 on a random path must
    // not be able to create a label value.
    .replace(/\/[^/]{60,}(?=\/|$)/g, "/:long");
}

/** 2xx, 4xx, 5xx. Fine-grained status codes are on the histogram already. */
export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}
