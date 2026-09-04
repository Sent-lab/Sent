/**
 * SENT — HTTP server.
 *
 * Fastify per §418, wiring routes to the pure handlers. This file does three
 * things and nothing else: load what a route needs, call the handler, serialise
 * the result.
 *
 * §418 also states what this API must NOT be: authority for balances, authority
 * for graduation, a creator of reward entitlement, a signer of user trades, or a
 * custodian of keys. It does none of those — every route reads a projection or
 * returns an intent the user signs themselves.
 *
 * BIGINT AT THE SERIALISATION BOUNDARY
 * ------------------------------------
 * `JSON.stringify` throws on a BigInt. The naive fix is to convert with
 * `Number()`, which is the exact precision loss the whole stack uses BigInt to
 * avoid — and it would fail silently above 2^53 rather than throwing.
 *
 * So every quantity is serialised as a STRING, and the replacer is installed
 * once at the boundary rather than left to each route.
 */

import Fastify, { type FastifyInstance } from "fastify";

import { createLogger } from "@sent/observability/logger";

import { randomUUID } from "node:crypto";

import { referenceMarketCapUsd } from "@sent/economics";

import { Database } from "@sent/database";

import {
  handleExplore,
  handleMarket,
  handleTape,
  handleQuote,
  handleCandles,
  CANDLE_INTERVALS,
  handleStockback,
  handleCreator,
  handleAccount,
  handleEpochs,
  handlePlatformStats,
  handlePulse,
  handleHealth,
  handlePendingGraduations,
  handleLaunchConfig,
  EXPLORE_SORTS,
  type ExploreOptions,
} from "./handlers.ts";
import { PostgresPort, type PortConfig } from "./port.ts";
import { renderPreview, PREVIEW_CACHE_CONTROL } from "./preview.ts";
import { renderPreviewPng, PNG_CACHE_CONTROL } from "./preview-png.ts";
import {
  RateLimiter,
  clientKey,
  READ_LIMIT,
  QUOTE_LIMIT,
} from "./ratelimit.ts";
import {
  createApiRegistry,
  routeLabel,
  statusClass,
  REQUEST_SECONDS,
  REQUESTS_TOTAL,
  RATE_LIMITED,
} from "./observability.ts";

export interface ServerConfig extends PortConfig {
  readonly port: number;
  readonly host: string;
  readonly chainId: number;
  /** Structured log threshold (§437). Defaults to info. */
  readonly logLevel?: "debug" | "info" | "warn" | "error";
  /**
   * Whether `X-Forwarded-For` may be believed.
   *
   * Off by default. Trusting it without a proxy in front makes rate limiting
   * useless, because the header is attacker-controlled and every request can
   * claim a fresh identity. Turning it on without a proxy is worse than having
   * no limiter at all, so it is opt-in and the deployment has to say so.
   */
  readonly trustProxy?: boolean;
  /** How often the freshness snapshot is refreshed, in ms. */
  readonly refreshIntervalMs: number;
  /**
   * Origins allowed to call this API from a browser.
   *
   * §434 puts the web tier and the API tier behind separate hostnames, so every
   * request from the app is cross-origin and needs these headers. An empty list
   * means no browser may call it — which is the correct default for a service
   * that also serves bots and other backends.
   *
   * An explicit list, never a wildcard: `*` would let any page on the internet
   * read this API with a user's cookies attached the moment credentials are
   * ever added, and getting that wrong later is much harder to notice.
   */
  readonly allowedOrigins: readonly string[];
}

/**
 * Serialise BigInt as a decimal string.
 *
 * Never as a number: a uint256 does not fit, and the loss is silent.
 */
function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

export async function createServer(db: Database, config: ServerConfig): Promise<FastifyInstance> {
  const port = new PostgresPort(db, config);
  await port.refresh();

  const app = Fastify({ logger: false });

  /*
   * §437: structured logs and metrics.
   *
   * Fastify's own logger is off because its output is Pino's shape rather than
   * this project's, and two log formats from one process is one format too
   * many for anything downstream to parse.
   */
  const log = createLogger({ service: "api", level: config.logLevel ?? "info" });

  const metrics = createApiRegistry({
    lagBlocks: () => {
      const head = port.headBlock();
      const indexed = port.indexedBlock();
      // Null rather than zero when the head is unknown: a lag gauge reading
      // zero during an RPC outage is the reassuring answer, and it is wrong.
      if (head === 0n) return null;
      return Number(head > indexed ? head - indexed : 0n);
    },
    chainConnected: () => port.chainConnected(),
    serving: () => handleHealth(port).data.serving,
  });

  /*
   * One request id, generated here and carried everywhere.
   *
   * §437 lists requestId first among the correlation fields. It is echoed in
   * the response header so a user reporting a problem can quote the identifier
   * that finds their exact request in the logs — which is the entire point of
   * having one.
   */
  /*
   * §425's rate limiting, in two budgets.
   *
   * Reads are generous — a terminal polling several endpoints while someone
   * watches a chart is normal and must never be throttled. Quotes are not: each
   * one is an RPC call on a shared provider quota (§423 requires the quote to
   * come from the chain), so a bot with a retry loop and no backoff would
   * exhaust it and break quoting for everybody else.
   */
  const readLimiter = new RateLimiter(READ_LIMIT);
  const quoteLimiter = new RateLimiter(QUOTE_LIMIT);

  app.addHook("onRequest", async (request, reply) => {
    const id = request.headers["x-request-id"];
    const requestId =
      typeof id === "string" && id.length > 0 && id.length <= 128 ? id : randomUUID();

    (request as { sentRequestId?: string; sentStartedAt?: bigint }).sentRequestId = requestId;
    (request as { sentStartedAt?: bigint }).sentStartedAt = process.hrtime.bigint();

    reply.header("x-request-id", requestId);

    // Never rate limited: an operator's scrape and an orchestrator's probe are
    // exactly the requests that must still work while something is hammering
    // the service, and refusing them turns a load problem into an outage that
    // also cannot be observed.
    const path = request.url.split("?")[0] ?? "/";
    if (path === "/metrics" || path.endsWith("/health")) return;

    const isQuote = request.method === "POST" && path.endsWith("/quote");
    const limiter = isQuote ? quoteLimiter : readLimiter;
    const budget = isQuote ? QUOTE_LIMIT : READ_LIMIT;

    const key = clientKey(
      request.socket.remoteAddress,
      request.headers["x-forwarded-for"] as string | undefined,
      config.trustProxy ?? false,
    );

    const decision = limiter.take(key, Date.now());

    reply.header("x-ratelimit-limit", String(budget.capacity));
    reply.header("x-ratelimit-remaining", String(decision.remaining));

    if (!decision.allowed) {
      metrics.increment(RATE_LIMITED, { route: routeLabel(request.url) });
      reply.header("retry-after", String(decision.retryAfter));

      /*
       * §42: contextual and recovery-oriented, never a bare "Too many
       * requests." A client that is being limited needs to know it is a rate
       * and not a failure, and that nothing about their position changed.
       */
      return reply.code(429).send({
        ok: false,
        code: "RATE_LIMITED",
        message: `Too many requests. Try again in ${decision.retryAfter}s — nothing about your position or funds has changed.`,
        retryable: true,
        freshness: handleHealth(port).freshness,
      });
    }

    return;
  });

  app.addHook("onResponse", async (request, reply) => {
    const started = (request as { sentStartedAt?: bigint }).sentStartedAt;
    const route = routeLabel(request.url);
    const status = reply.statusCode;

    if (started !== undefined) {
      metrics.observe(REQUEST_SECONDS, Number(process.hrtime.bigint() - started) / 1e9, {
        route,
        status: statusClass(status),
      });
    }

    metrics.increment(REQUESTS_TOTAL, { route, status: statusClass(status) });

    // Only failures are logged per request. A line per successful read at this
    // volume is noise that buries the lines that matter, and the histogram
    // already carries what a healthy request contributes.
    if (status >= 500) {
      log.error("request failed", {
        requestId: (request as { sentRequestId?: string }).sentRequestId,
        chainId: config.chainId,
        route,
        status,
        method: request.method,
      });
    }
  });

  // Fastify's default JSON serialiser cannot handle BigInt, so it is replaced
  // once here rather than every route remembering to convert.
  app.setSerializerCompiler(() => (data) => serialise(data));
  app.addHook("onSend", async (_req, reply, payload) => {
    if (typeof payload === "object" && payload !== null && !(payload instanceof Buffer)) {
      reply.header("content-type", "application/json; charset=utf-8");
      return serialise(payload);
    }
    return payload;
  });

  /*
   * CORS.
   *
   * Deliberately hand-rolled rather than pulled from a plugin: the entire policy
   * is six lines, and it is the kind of policy that should be readable in the
   * file it applies to rather than configured somewhere else.
   *
   * The origin is echoed back only when it is on the list. Echoing whatever
   * arrives is the common shortcut and is equivalent to a wildcard.
   */
  const allowed = new Set(config.allowedOrigins);

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin === undefined || !allowed.has(origin)) return;

    reply.header("access-control-allow-origin", origin);
    // Tells caches that the response body varies by origin. Without it a shared
    // cache can serve one origin's allowed response to another origin.
    reply.header("vary", "origin");
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-max-age", "600");
  });

  // Preflight. Answered for any path so a new route cannot silently fail from
  // the browser while working perfectly from curl.
  app.options("/*", async (request, reply) => {
    const origin = request.headers.origin;
    return reply.code(origin !== undefined && allowed.has(origin) ? 204 : 403).send();
  });

  const refresh = setInterval(() => void port.refresh(), config.refreshIntervalMs);
  app.addHook("onClose", async () => clearInterval(refresh));

  // -------------------------------------------------------------------------

  /*
   * §432: "REST endpoints should be versionable and typed."
   *
   * Every route is registered twice — once under /v1 and once at the root. The
   * versioned path is the one to build against; the bare path exists because
   * clients are already using it, and breaking them to introduce a version is
   * the opposite of what versioning is for.
   *
   * Registered from ONE function rather than two lists. Two lists is how a
   * route ends up existing under one prefix and not the other, and the failure
   * is a 404 on a path that demonstrably works somewhere else.
   */
  const routes = async (scope: FastifyInstance): Promise<void> => {
  scope.get("/health", async (_req, reply) => {
    const result = handleHealth(port);
    // A service that is behind still answers, and says so. Returning 200 with
    // fresh-looking data while minutes stale is the failure §211 is written
    // against; returning 503 with a body is how a load balancer learns to stop
    // sending traffic without the body becoming a lie.
    return reply.code(result.data.serving ? 200 : 503).send(result);
  });

  /*
   * D-016's operational dependency, exposed rather than buried in a metric.
   *
   * The keeper polls it, the operator alerts on `stalled`, and a UI can offer
   * the finalise to whoever is looking at a stalled market. A permissionless
   * call that only one party's tooling can find is permissionless on paper.
   */
  /*
   * §219's precondition read.
   *
   * Not cached beyond the response header: an operator enabling an asset or
   * setting the router expects the create page to notice, and a long cache here
   * is the difference between "governance acted" and "governance acted and the
   * product found out tomorrow".
   */
  scope.get("/launch/config", async (_request, reply) => {
    try {
      const config = await port.loadLaunchPreconditions();
      return reply.code(200).send(handleLaunchConfig(port, config));
    } catch (error) {
      // The chain, not the database. Saying so matters: a creator seeing this
      // should retry, not conclude the product is closed.
      return reply.code(503).send({
        ok: false,
        code: "CHAIN_UNREACHABLE",
        message:
          "Could not read the launch registry from the chain. Nothing is wrong with your wallet — try again shortly.",
        retryable: true,
        freshness: handleHealth(port).freshness,
      });
    }
  });

  scope.get("/graduations/pending", async (_request, reply) => {
    await port.loadPendingGraduations();
    const result = handlePendingGraduations(port);

    // 200 either way. An empty list is the healthy answer, not an absence, and
    // a keeper that treats 404 as "nothing to do" would treat a routing mistake
    // as the same thing.
    return reply.code(200).send(result);
  });

  scope.get("/markets", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;

    // Query values are validated against the allowed set rather than cast into
    // it. A cast tells the compiler a claim it cannot check, and the value here
    // comes straight off the wire.
    const sort = parseSort(q.sort);
    const status = parseStatus(q.status);

    const options: Partial<ExploreOptions> = {
      sort,
      limit: q.limit !== undefined ? Number(q.limit) : 25,
      // Parsed strictly, like the candle interval: `Number("abc")` is NaN and
      // would reach the handler as a nonsense offset.
      offset: /^\d+$/.test(q.offset ?? "") ? Number(q.offset) : 0,
      ...(status !== null ? { status } : {}),
      ...(q.quoteAsset !== undefined ? { quoteAsset: q.quoteAsset } : {}),
      ...(q.q !== undefined && q.q.trim() !== "" ? { query: q.q } : {}),
    };

    await port.loadMarkets(options as ExploreOptions);
    const result = handleExplore(port, options);
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  scope.get("/markets/:token", async (request, reply) => {
    const { token } = request.params as { token: string };

    await port.loadMarket(token);
    const result = handleMarket(port, token);
    return reply.code(result.ok ? 200 : 404).send(result);
  });

  scope.get("/markets/:token/trades", async (request, reply) => {
    const { token } = request.params as { token: string };
    const q = request.query as Record<string, string | undefined>;
    const limit = q.limit !== undefined ? Number(q.limit) : 50;

    await port.loadMarket(token);
    const market = port.getMarket(token);
    if (market !== null) await port.loadTrades(market.market, Math.min(Math.max(limit, 1), 100));

    const result = handleTape(port, token, limit);
    return reply.code(result.ok ? 200 : 404).send(result);
  });

  scope.get("/markets/:token/candles", async (request, reply) => {
    const { token } = request.params as { token: string };
    const q = request.query as Record<string, string | undefined>;

    // Parsed strictly. `Number("1m")` is NaN and `Number("")` is 0, either of
    // which would reach the handler as a nonsense interval; an unparseable value
    // becomes -1 so the handler's own validation rejects it with a named error.
    const intervalSeconds = /^\d+$/.test(q.interval ?? "") ? Number(q.interval) : -1;
    const limit = /^\d+$/.test(q.limit ?? "") ? Number(q.limit) : 200;

    await port.loadMarket(token);
    const market = port.getMarket(token);

    // Loaded only for a supported interval: an unsupported one is about to be
    // refused, and issuing the query first would spend a round trip on it.
    if (market !== null && CANDLE_INTERVALS.includes(intervalSeconds as never)) {
      await port.loadCandles(market.market, intervalSeconds, Math.min(Math.max(limit, 1), 500));
    }

    const result = handleCandles(port, token, intervalSeconds, limit);
    return reply.code(result.ok ? 200 : result.code === "MARKET_NOT_FOUND" ? 404 : 400).send(result);
  });

  /**
   * Quote an order.
   *
   * Returns a complete signable intent, not a price (§694). The user signs the
   * calldata this produced, and the review rows carry the same numbers.
   */
  scope.post("/quote", async (request, reply) => {
    const body = request.body as {
      token?: string;
      side?: "BUY" | "SELL";
      amount?: string;
      slippageBps?: string;
      deadline?: string;
    };

    if (body.token === undefined || body.side === undefined || body.amount === undefined) {
      return reply.code(400).send({
        ok: false,
        code: "MISSING_FIELDS",
        message: "token, side and amount are required",
        retryable: false,
      });
    }

    let amount: bigint;
    let slippageBps: bigint;
    let deadline: bigint;

    try {
      // Parsed as BigInt from a string. Accepting a JSON number here would put a
      // trade size through floating point at the very first boundary.
      amount = BigInt(body.amount);
      slippageBps = BigInt(body.slippageBps ?? "100");
      deadline = BigInt(body.deadline ?? Math.floor(Date.now() / 1000) + 300);
    } catch {
      return reply.code(400).send({
        ok: false,
        code: "INVALID_NUMBER",
        message: "amount, slippageBps and deadline must be integer strings",
        retryable: false,
      });
    }

    await port.loadMarket(body.token);
    const market = port.getMarket(body.token);

    if (market !== null) {
      await port.loadQuote(market.market, body.side, amount, market.qG, market.distributed);
    }

    const result = handleQuote(port, {
      token: body.token,
      side: body.side,
      amount,
      slippageBps,
      deadline,
      chainId: config.chainId,
    });

    return reply.code(result.ok ? 200 : 400).send(result);
  });

  /*
   * A creator's own markets and fees (§432).
   *
   * No authentication, because there is nothing here to protect: every figure is
   * derived from public chain events, and the claim itself is authorised by the
   * vault against `msg.sender` rather than by this API. Requiring a signature to
   * READ public data would only teach creators to sign things on request.
   */
  scope.get("/creators/:address", async (request, reply) => {
    const { address } = request.params as { address: string };

    if (/^0x[0-9a-fA-F]{40}$/.test(address)) await port.loadCreator(address);

    const result = handleCreator(port, address);
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  /*
   * §333's public dataset and §367's distribution status.
   *
   * On its own path segment rather than under /stockback, which already ends in
   * `:account`. A static `epochs` would win against that parameter today and
   * would keep winning — until someone adds a route and the precedence changes
   * under a path that had been working. Distinct paths do not need the rule to
   * hold.
   */
  /*
   * §117's social preview, as an SVG.
   *
   * This is what a link to a token looks like pasted into X, Telegram or
   * Discord. It deliberately does not embed the creator's IPFS image — see
   * `preview.ts` for why fetching a stranger's URL from a public endpoint is a
   * request-forgery surface with a public trigger, and why a mark derived from
   * the address is the better answer rather than the fallback one.
   */
  scope.get("/markets/:token/preview.svg", async (request, reply) => {
    const { token } = request.params as { token: string };

    await port.loadMarket(token);
    const market = port.getMarket(token);

    if (market === null) {
      // 404 as JSON, not as a broken image. A crawler that gets an SVG saying
      // "not found" will cache and display it.
      return reply.code(404).send({
        ok: false,
        code: "MARKET_NOT_FOUND",
        message: `No market for token ${token}`,
        retryable: false,
        freshness: handleHealth(port).freshness,
      });
    }

    const svg = renderPreview({
      symbol: market.symbol,
      name: market.name,
      quoteSymbol: market.quoteSymbol,
      token: market.token,
      status: market.status,
      graduationProgressBps: market.qG > 0n ? (market.distributed * 10_000n) / market.qG : 0n,
      referenceMarketCapUsd: referenceMarketCapUsd(market.p0, market.price),
      holderCount: market.holderCount,
    });

    return reply
      .code(200)
      .header("content-type", "image/svg+xml; charset=utf-8")
      .header("cache-control", PREVIEW_CACHE_CONTROL)
      .send(svg);
  });

  /*
   * The same card, rasterised (§117).
   *
   * X, Discord and Telegram do not render SVG in a link unfurl — they drop the
   * image and show text — so the SVG route alone is invisible on exactly the
   * three surfaces this feature is for. This is the one `og:image` points at.
   *
   * It builds the SVG through the same `renderPreview` call rather than a
   * parallel path. Two renderers would be two cards that agree until one of
   * them is edited.
   */
  scope.get("/markets/:token/preview.png", async (request, reply) => {
    const { token } = request.params as { token: string };

    await port.loadMarket(token);
    const market = port.getMarket(token);

    if (market === null) {
      // JSON, not a PNG saying "not found": a crawler caches whatever image it
      // is handed, and an error rendered as an image outlives the error.
      return reply.code(404).send({
        ok: false,
        code: "MARKET_NOT_FOUND",
        message: `No market for token ${token}`,
        retryable: false,
        freshness: handleHealth(port).freshness,
      });
    }

    const png = renderPreviewPng(
      renderPreview({
        symbol: market.symbol,
        name: market.name,
        quoteSymbol: market.quoteSymbol,
        token: market.token,
        status: market.status,
        graduationProgressBps: market.qG > 0n ? (market.distributed * 10_000n) / market.qG : 0n,
        referenceMarketCapUsd: referenceMarketCapUsd(market.p0, market.price),
        holderCount: market.holderCount,
      }),
    );

    return reply
      .code(200)
      .header("content-type", "image/png")
      .header("cache-control", PNG_CACHE_CONTROL)
      .send(png);
  });

  scope.get("/markets/:token/epochs", async (request, reply) => {
    const { token } = request.params as { token: string };
    const q = request.query as Record<string, string | undefined>;
    const limit = /^\d+$/.test(q.limit ?? "") ? Number(q.limit) : 30;

    await port.loadMarket(token);
    const market = port.getMarket(token);
    if (market !== null) await port.loadEpochs(market.market, Math.min(Math.max(limit, 1), 365));

    const result = handleEpochs(port, token);
    return reply.code(result.ok ? 200 : 404).send(result);
  });

  scope.get("/markets/:token/stockback/:account", async (request, reply) => {
    const { token, account } = request.params as { token: string; account: string };

    await port.loadMarket(token);
    const market = port.getMarket(token);
    if (market !== null) await port.loadStockback(market.market, account, market.quoteDecimals);

    const result = handleStockback(port, token, account);
    return reply.code(result.ok ? 200 : 404).send(result);
  });

  /*
   * One wallet's positions, rewards and claim history (§64, §347).
   *
   * Public and unauthenticated, like every other route here: it reads what the
   * chain already publishes. Requiring a signature to read public data would
   * only teach people to sign things on request, which is the habit §505 is
   * written against.
   */
  scope.get("/accounts/:address", async (request, reply) => {
    const { address } = request.params as { address: string };

    if (ADDRESS.test(address)) await port.loadAccount(address);

    const result = handleAccount(port, address);
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  /*
   * The Stockback half of an account, on its own path (§432, §347).
   *
   * The same data the account route carries, so a client that only needs the
   * claim centre does not pay for holdings and history it will not render.
   */
  scope.get("/accounts/:address/stockback", async (request, reply) => {
    const { address } = request.params as { address: string };

    if (ADDRESS.test(address)) await port.loadAccount(address);

    const result = handleAccount(port, address);
    if (!result.ok) return reply.code(400).send(result);

    return reply.code(200).send({
      ok: true,
      data: {
        account: result.data.account,
        markets: result.data.stockback,
        totalClaimable: result.data.totalClaimable,
        claims: result.data.claims,
      },
      freshness: result.freshness,
    });
  });

  /* §52's market heat and §53's pulse, refreshed on the freshness timer. */
  scope.get("/platform/pulse", async (_request, reply) => {
    const result = handlePulse(port);
    return reply.code(result.ok ? 200 : 503).send(result);
  });

  /* §166's live platform stats, from §168's sources. */
  scope.get("/platform/stats", async (_request, reply) => {
    const result = handlePlatformStats(port);
    return reply.code(result.ok ? 200 : 503).send(result);
  });

  };

  await app.register(routes, { prefix: "/v1" });
  await app.register(routes);

  /*
   * Scrape endpoint, deliberately outside the versioned API.
   *
   * /metrics is an operational surface, not a product one: it has no freshness
   * envelope, no JSON shape and no compatibility promise to clients. Versioning
   * it would imply all three. It also stays off the /v1 prefix so a scrape
   * config never has to be updated when the API version moves.
   */
  app.get("/metrics", async (_request, reply) => {
    return reply
      .code(200)
      .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
      .send(metrics.render());
  });

  return app;
}

/** Mirrors the handler's own pattern; see `ADDRESS` there for why it is shared. */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const SORTS = EXPLORE_SORTS;
/*
 * GRADUATING is filterable, because it is now a state a market rests in
 * (D-016). Leaving it out would make the one status an operator most needs to
 * list - markets whose curve has closed and whose holders cannot act - the only
 * one the API could not be asked about.
 */
const STATUSES = ["PRE_GRAD", "GRADUATING", "GRADUATED"] as const;

/** Unknown or absent sort falls back to the default rather than erroring. */
function parseSort(value: string | undefined): ExploreOptions["sort"] {
  return SORTS.includes(value as (typeof SORTS)[number])
    ? (value as ExploreOptions["sort"])
    : "NEWEST";
}

/** An unrecognised status filters nothing, rather than filtering everything. */
function parseStatus(
  value: string | undefined,
): "PRE_GRAD" | "GRADUATING" | "GRADUATED" | null {
  return STATUSES.includes(value as (typeof STATUSES)[number])
    ? (value as "PRE_GRAD" | "GRADUATING" | "GRADUATED")
    : null;
}

export async function startServer(db: Database, config: ServerConfig): Promise<FastifyInstance> {
  const app = await createServer(db, config);
  await app.listen({ port: config.port, host: config.host });
  return app;
}
