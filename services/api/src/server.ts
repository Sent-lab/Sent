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

import { Database } from "@sent/database";

import {
  handleExplore,
  handleMarket,
  handleTape,
  handleQuote,
  handleCandles,
  CANDLE_INTERVALS,
  handleStockback,
  handleHealth,
  type ExploreOptions,
} from "./handlers.ts";
import { PostgresPort, type PortConfig } from "./port.ts";

export interface ServerConfig extends PortConfig {
  readonly port: number;
  readonly host: string;
  readonly chainId: number;
  /** How often the freshness snapshot is refreshed, in ms. */
  readonly refreshIntervalMs: number;
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

  const refresh = setInterval(() => void port.refresh(), config.refreshIntervalMs);
  app.addHook("onClose", async () => clearInterval(refresh));

  // -------------------------------------------------------------------------

  app.get("/health", async (_req, reply) => {
    const result = handleHealth(port);
    // A service that is behind still answers, and says so. Returning 200 with
    // fresh-looking data while minutes stale is the failure §211 is written
    // against; returning 503 with a body is how a load balancer learns to stop
    // sending traffic without the body becoming a lie.
    return reply.code(result.data.serving ? 200 : 503).send(result);
  });

  app.get("/markets", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;

    // Query values are validated against the allowed set rather than cast into
    // it. A cast tells the compiler a claim it cannot check, and the value here
    // comes straight off the wire.
    const sort = parseSort(q.sort);
    const status = parseStatus(q.status);

    const options: Partial<ExploreOptions> = {
      sort,
      limit: q.limit !== undefined ? Number(q.limit) : 25,
      ...(status !== null ? { status } : {}),
      ...(q.quoteAsset !== undefined ? { quoteAsset: q.quoteAsset } : {}),
    };

    await port.loadMarkets(options as ExploreOptions);
    const result = handleExplore(port, options);
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  app.get("/markets/:token", async (request, reply) => {
    const { token } = request.params as { token: string };

    await port.loadMarket(token);
    const result = handleMarket(port, token);
    return reply.code(result.ok ? 200 : 404).send(result);
  });

  app.get("/markets/:token/trades", async (request, reply) => {
    const { token } = request.params as { token: string };
    const q = request.query as Record<string, string | undefined>;
    const limit = q.limit !== undefined ? Number(q.limit) : 50;

    await port.loadMarket(token);
    const market = port.getMarket(token);
    if (market !== null) await port.loadTrades(market.market, Math.min(Math.max(limit, 1), 100));

    const result = handleTape(port, token, limit);
    return reply.code(result.ok ? 200 : 404).send(result);
  });

  app.get("/markets/:token/candles", async (request, reply) => {
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
  app.post("/quote", async (request, reply) => {
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

  app.get("/markets/:token/stockback/:account", async (request, reply) => {
    const { token, account } = request.params as { token: string; account: string };

    await port.loadMarket(token);
    const market = port.getMarket(token);
    if (market !== null) await port.loadStockback(market.market, account, market.quoteDecimals);

    const result = handleStockback(port, token, account);
    return reply.code(result.ok ? 200 : 404).send(result);
  });

  return app;
}

const SORTS = ["NEWEST", "PROGRESS", "VOLUME", "HOLDERS"] as const;
const STATUSES = ["PRE_GRAD", "GRADUATED"] as const;

/** Unknown or absent sort falls back to the default rather than erroring. */
function parseSort(value: string | undefined): ExploreOptions["sort"] {
  return SORTS.includes(value as (typeof SORTS)[number])
    ? (value as ExploreOptions["sort"])
    : "NEWEST";
}

/** An unrecognised status filters nothing, rather than filtering everything. */
function parseStatus(value: string | undefined): "PRE_GRAD" | "GRADUATED" | null {
  return STATUSES.includes(value as (typeof STATUSES)[number])
    ? (value as "PRE_GRAD" | "GRADUATED")
    : null;
}

export async function startServer(db: Database, config: ServerConfig): Promise<FastifyInstance> {
  const app = await createServer(db, config);
  await app.listen({ port: config.port, host: config.host });
  return app;
}
