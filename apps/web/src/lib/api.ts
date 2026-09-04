/**
 * SENT — API client.
 *
 * Typed against the handler contracts in `services/api/src/handlers.ts`, which
 * are imported rather than restated. A hand-copied response shape is a second
 * definition, and the two drift the first time a field is added — §1064 says
 * one canonical source, and this is one of the places that is easiest to break.
 *
 * QUANTITIES ARRIVE AS STRINGS AND STAY THAT WAY UNTIL A BIGINT WANTS THEM
 * ------------------------------------------------------------------------
 * The API serialises every BigInt as a decimal string, because JSON has no
 * integer type that holds a uint256. `JSON.parse` would happily turn a numeric
 * literal into a lossy double, so the wire format never contains one.
 *
 * This client does NOT eagerly convert them. A price that is only ever displayed
 * goes straight to `formatFixed`, which takes a BigInt — so conversion happens
 * at the point of use, where the decimals are known, rather than in a blanket
 * pass that has to guess.
 *
 * EVERY RESPONSE CARRIES ITS FRESHNESS (§87, §211)
 * ------------------------------------------------
 * The envelope is not optional and is not stripped here. A component that
 * renders a number without access to how old it is cannot meet §211, and the
 * easiest way to lose that is a client that unwraps `data` for convenience.
 */

import type {
  ApiResult,
  ExploreItem,
  ExplorePage,
  MarketDetail,
  TapeItem,
  StockbackResponse,
  CreatorResponse,
  AccountResponse,
  PlatformStatsResponse,
  HealthResponse,
  PendingGraduationsResponse,
  LaunchConfigResponse,
} from "@sent/api/handlers";
import type { IntentKind, IntentRow } from "@sent/sdk";
import type { FreshnessEnvelope } from "@sent/realtime";

export type {
  ApiResult,
  ExploreItem,
  ExplorePage,
  MarketDetail,
  TapeItem,
  StockbackResponse,
  CreatorResponse,
  AccountResponse,
  PlatformStatsResponse,
  HealthResponse,
  PendingGraduationsResponse,
  LaunchConfigResponse,
  IntentKind,
  IntentRow,
};

/**
 * A transaction intent as it arrives over the wire.
 *
 * NOT the SDK's in-process type. That one has `bigint` fields, and the API
 * serialises every BigInt as a decimal string because JSON has no integer wide
 * enough for a uint256. Typing the response as the in-process type would compile
 * perfectly and be false at run time: `intent.value * 2n` throws on a string, and
 * `Number(intent.value)` silently loses precision on a large one.
 *
 * So the boundary type is explicit, and conversion happens where a caller
 * actually needs arithmetic. `data`, `to` and the review rows need none — they go
 * to the wallet and to the screen exactly as received, which is the whole point
 * of §694: what is reviewed is what is signed, with nothing rebuilt in between.
 */
export interface WireIntent {
  readonly kind: IntentKind;
  readonly chainId: number;
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  /** Decimal string. Native value, zero on every ERC-20 path. */
  readonly value: string;
  readonly review: WireIntentReview;
  /** Decimal string of a unix timestamp. Absent for actions with no deadline. */
  readonly deadline?: string;
}

export interface WireIntentReview {
  readonly kind: IntentKind;
  readonly summary: string;
  readonly rows: readonly IntentRow[];
  readonly fees?: Record<string, string>;
  readonly minimumReceived?: string;
  readonly crossesGraduation?: boolean;
}

/*
 * `estimateIsPartial` and `boundCoversPartialRoute` were declared here.
 *
 * They carried V-19: a crossing order ran on the curve and then on HyperSwap,
 * `minimumReceived` bounded only the first leg, and the UI surfaced that rather
 * than hiding it. D-016 removed the second leg — the curve leg IS the trade —
 * so the estimate is whole and the bound covers all of it.
 *
 * The SDK deleted the flags instead of leaving them always-false, on the
 * grounds that a branch which cannot be taken is never exercised and rots
 * unnoticed. Declaring them here kept exactly that branch alive on the client,
 * describing an open finding on a wire that can no longer report one.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** A transport failure, shaped like an API error so callers have one path. */
export class ApiUnreachable extends Error {
  readonly code = "NETWORK_UNREACHABLE";
  readonly retryable = true;

  constructor(cause: unknown) {
    super(
      // §42: contextual and recovery-oriented, never "Failed." The copy a user
      // sees when the network drops is part of the product.
      "Market data is reconnecting. Your funds and on-chain position are unchanged.",
    );
    this.name = "ApiUnreachable";
    this.cause = cause;
  }
}

/**
 * A BODY THAT PARSED IS NOT YET AN ANSWER (§87, §211, §694)
 * ---------------------------------------------------------
 * `JSON.parse` succeeding says the bytes were JSON. It says nothing about the
 * shape, and `body as ApiResult<T>` is a compile-time assertion the runtime
 * never checks — so every field the UI reads is trusted on the strength of a
 * cast.
 *
 * That is not hypothetical. `/markets` once returned a bare array and now
 * returns a page; a cached body of the old shape passed `ok === true`, reached
 * `data.items.length`, and took the whole homepage down with a 500. TypeScript
 * was correct about the contract, and the contract was not what arrived.
 *
 * A stale cache, a rolling deploy where API and web are briefly different
 * versions, a proxy that returns its own error JSON, a captive portal — all
 * produce well-formed JSON that is not this API's answer. Each becomes a typed
 * error result here, which the UI already knows how to render, instead of an
 * exception thrown from inside a component tree.
 *
 * The guards are DELIBERATELY SHALLOW. They check the structure a caller
 * indexes into — that `items` is an array, that an intent has calldata and a
 * review — and not every leaf field. A full schema validator over every
 * response would be a second definition of types that already exist, and the
 * second definition is the one that goes stale. What is checked here is what,
 * if absent, would throw.
 */

/** Checks the shape of `data` a caller is about to index into. */
type DataGuard = (data: unknown) => boolean;

const FRESHNESS_STATES: ReadonlySet<string> = new Set([
  "LIVE",
  "SYNCING",
  "DELAYED",
  "RECONNECTING",
  "STALE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFreshness(value: unknown): value is FreshnessEnvelope {
  return (
    isRecord(value) &&
    typeof value["state"] === "string" &&
    FRESHNESS_STATES.has(value["state"]) &&
    typeof value["headBlock"] === "string" &&
    typeof value["lagBlocks"] === "number" &&
    typeof value["serverTime"] === "number"
  );
}

/**
 * The envelope shown when a response carried no usable one.
 *
 * RECONNECTING rather than LIVE or a zeroed LIVE: we genuinely do not have an
 * answer, and that is the state §211 has for exactly this. `headBlock` is "0"
 * because inventing a plausible height would be the specific lie the envelope
 * exists to prevent.
 */
function disconnected(): FreshnessEnvelope {
  return {
    state: "RECONNECTING",
    headBlock: "0",
    lagBlocks: 0,
    serverTime: Math.floor(Date.now() / 1000),
  };
}

/**
 * How far behind `serverTime` may be before the envelope stops being believed.
 *
 * Generous on purpose. This is compared against whichever clock is doing the
 * reading — the app server on an SSR pass, the USER'S clock on a browser fetch —
 * and a browser clock being a few minutes out is ordinary. A tight threshold
 * would paint STALE over live data for anyone whose laptop never synced, which
 * is a worse failure than the one it guards against.
 */
const ENVELOPE_MAX_AGE_SECONDS = 600;

/**
 * A cached body carries a cached envelope, and a cached envelope lies.
 *
 * Next's data cache, a CDN, and a browser cache all replay a response that was
 * true when it was produced. `state: "SYNCING"` from twenty minutes ago renders
 * as "Syncing. Values settle within seconds." — which is precisely the claim
 * §211 exists to prevent, and the UI has no way to know it is reading a replay.
 *
 * The producer still owns classification: this only ever DOWNGRADES, and only
 * on the one fact the producer cannot know and the consumer can — how long the
 * answer took to arrive.
 */
function aged(freshness: FreshnessEnvelope): FreshnessEnvelope {
  if (freshness.state === "STALE") return freshness;

  const age = Math.floor(Date.now() / 1000) - freshness.serverTime;
  if (age <= ENVELOPE_MAX_AGE_SECONDS) return freshness;

  return { ...freshness, state: "STALE" };
}

/**
 * A response that did not match the contract, expressed as an ordinary error.
 *
 * The user-facing copy is the transport-failure copy, because from where they
 * are standing the two are the same event: the data is not available and their
 * position is untouched. The DEVELOPER-facing detail goes to the console —
 * a contract drift that is invisible in logs is found by users first.
 */
function malformed<T>(path: string, detail: string, freshness: unknown): ApiResult<T> {
  console.warn(`[api] ${path}: ${detail}`);

  return {
    ok: false,
    code: "MALFORMED_RESPONSE",
    message:
      "Market data is reconnecting. Your funds and on-chain position are unchanged.",
    retryable: true,
    freshness: isFreshness(freshness) ? aged(freshness) : disconnected(),
  };
}

/**
 * Read one response body and admit it only if it is this API's contract.
 *
 * Shared by `request` and `quote` rather than written twice: two copies of a
 * validation rule is one copy that gets updated and one that does not.
 */
async function receive<T>(
  path: string,
  response: Response,
  guard: DataGuard | undefined,
): Promise<ApiResult<T>> {
  // 4xx and 5xx still carry a typed body — including /health at 503, which is a
  // meaningful answer rather than a failure. Parsing it is how the UI shows
  // DELAYED rather than a blank screen.
  const body: unknown = await response.json().catch(() => null);

  if (body === null) {
    throw new ApiUnreachable(new Error(`${response.status} with no JSON body`));
  }

  if (!isRecord(body) || typeof body["ok"] !== "boolean") {
    // JSON, but not ours: a proxy error page, a login redirect rendered as
    // JSON, or a body from a different version of this service.
    return malformed<T>(path, "response is not an API envelope", undefined);
  }

  const freshness = body["freshness"];

  if (body["ok"] === false) {
    if (typeof body["code"] !== "string" || typeof body["message"] !== "string") {
      return malformed<T>(path, "error body has no code/message", freshness);
    }

    return {
      ok: false,
      code: body["code"],
      message: body["message"],
      retryable: body["retryable"] === true,
      freshness: isFreshness(freshness) ? aged(freshness) : disconnected(),
    };
  }

  if (!isFreshness(freshness)) {
    // §211 is not optional and cannot be reconstructed here. A success rendered
    // without a freshness envelope is a number with no stated age, which is the
    // one thing the envelope exists to make impossible.
    return malformed<T>(path, "success carries no freshness envelope", undefined);
  }

  const data = body["data"];

  if (data === undefined) {
    return malformed<T>(path, "success carries no data", freshness);
  }

  if (guard !== undefined && !guard(data)) {
    return malformed<T>(path, "data does not match the expected shape", freshness);
  }

  return { ok: true, data: data as T, freshness: aged(freshness) };
}

// --- guards, one per shape a caller indexes into ---------------------------

const pageOfItems: DataGuard = (data) => isRecord(data) && Array.isArray(data["items"]);
const listOfRows: DataGuard = (data) => Array.isArray(data);
const anyObject: DataGuard = (data) => isRecord(data);
const candleSet: DataGuard = (data) => isRecord(data) && Array.isArray(data["candles"]);

/**
 * An intent is held to a higher bar than the read endpoints.
 *
 * §694: what the user reviews is what they sign. An intent that reached the
 * wallet with `data` missing would prompt for a signature on a transaction the
 * review panel could not describe — so calldata and review rows are both
 * required before this is allowed to be a success at all.
 */
const signableIntent: DataGuard = (data) => {
  if (!isRecord(data)) return false;

  const to = data["to"];
  const calldata = data["data"];
  const review = data["review"];

  return (
    typeof to === "string" &&
    to.startsWith("0x") &&
    typeof calldata === "string" &&
    calldata.startsWith("0x") &&
    typeof data["value"] === "string" &&
    isRecord(review) &&
    Array.isArray(review["rows"])
  );
};

interface RequestOptions {
  readonly signal?: AbortSignal;
  /** Server components render fresh; the browser may reuse briefly. */
  readonly revalidateSeconds?: number;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  guard?: DataGuard,
): Promise<ApiResult<T>> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { accept: "application/json" },
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      // Trading data is never served from a stale cache by default. A cached
      // quote is a quote for a market that has moved.
      ...(options.revalidateSeconds === undefined
        ? { cache: "no-store" as const }
        : { next: { revalidate: options.revalidateSeconds } }),
    });
  } catch (error) {
    throw new ApiUnreachable(error);
  }

  return receive<T>(path, response, guard);
}

// ---------------------------------------------------------------------------

export type ExploreSort =
  | "NEWEST"
  | "PROGRESS"
  | "VOLUME"
  | "HOLDERS"
  | "TRENDING"
  | "GAINERS"
  | "RECENTLY_GRADUATED";
export type ExploreStatus = "PRE_GRAD" | "GRADUATED";

export interface ExploreQuery {
  /** Name, ticker, or an exact address (§95.21). */
  readonly query?: string;
  readonly offset?: number;
  readonly sort?: ExploreSort;
  readonly status?: ExploreStatus;
  readonly quoteAsset?: string;
  readonly limit?: number;
}

/**
 * Explore, as a PAGE.
 *
 * The endpoint used to return a bare array, which cannot say how many results
 * exist — so a client could only guess whether another page was there. §50 asks
 * for pagination, and guessing is what `items.length === limit` amounts to: it
 * is wrong exactly once, on the page that ends flush with the limit.
 */
export function listMarkets(
  query: ExploreQuery = {},
  options?: RequestOptions,
): Promise<ApiResult<ExplorePage>> {
  const params = new URLSearchParams();
  if (query.sort !== undefined) params.set("sort", query.sort);
  if (query.status !== undefined) params.set("status", query.status);
  if (query.quoteAsset !== undefined) params.set("quoteAsset", query.quoteAsset);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.query !== undefined && query.query.trim() !== "") params.set("q", query.query);

  const qs = params.toString();
  return request<ExplorePage>(`/markets${qs === "" ? "" : `?${qs}`}`, options, pageOfItems);
}

export function getAccount(
  address: string,
  options?: RequestOptions,
): Promise<ApiResult<AccountResponse>> {
  return request<AccountResponse>(`/accounts/${address}`, options, anyObject);
}

export function getPlatformStats(
  options?: RequestOptions,
): Promise<ApiResult<PlatformStatsResponse>> {
  return request<PlatformStatsResponse>("/platform/stats", options, anyObject);
}

export function getMarket(
  token: string,
  options?: RequestOptions,
): Promise<ApiResult<MarketDetail>> {
  return request<MarketDetail>(`/markets/${token}`, options, anyObject);
}

export function getTape(
  token: string,
  limit = 50,
  options?: RequestOptions,
): Promise<ApiResult<TapeItem[]>> {
  return request<TapeItem[]>(`/markets/${token}/trades?limit=${limit}`, options, listOfRows);
}

export interface CandleItem {
  /** Bucket start, unix seconds. */
  readonly t: number;
  /** Open, high, low, close and volume — decimal strings in raw quote units. */
  readonly o: string;
  readonly h: string;
  readonly l: string;
  readonly c: string;
  readonly v: string;
  readonly n: number;
}

export interface CandleResponse {
  readonly intervalSeconds: number;
  readonly quoteDecimals: number;
  readonly candles: readonly CandleItem[];
}

/**
 * Candles for one market and interval.
 *
 * Served from the projection rather than the chain: history is not a decision
 * anyone signs, and the freshness envelope says how far behind it is (§211).
 */
export function getCandles(
  token: string,
  intervalSeconds: number,
  limit = 200,
  options?: RequestOptions,
): Promise<ApiResult<CandleResponse>> {
  return request<CandleResponse>(
    `/markets/${token}/candles?interval=${intervalSeconds}&limit=${limit}`,
    options,
    candleSet,
  );
}

export function getStockback(
  token: string,
  account: string,
  options?: RequestOptions,
): Promise<ApiResult<StockbackResponse>> {
  return request<StockbackResponse>(`/markets/${token}/stockback/${account}`, options, anyObject);
}

export function getCreator(
  address: string,
  options?: RequestOptions,
): Promise<ApiResult<CreatorResponse>> {
  return request<CreatorResponse>(`/creators/${address}`, options, anyObject);
}

/**
 * Markets whose curve has closed and whose pool has not been minted (§16, V-20).
 *
 * The API's own note on this endpoint says who wants it: "the keeper reads it,
 * the operator alerts on it, and a UI can offer the finalise to whoever is
 * looking at a stalled market. All three want the same list." Two of the three
 * were using it.
 *
 * It carries `waitingBlocks`, which is the only place that number exists —
 * `MarketDetail` has no graduation timestamp, so without this a finalise panel
 * cannot say whether the market has been waiting a minute or a week. That
 * difference is the whole decision: one is waiting for a block lane, the other
 * has been forgotten.
 */
export function getPendingGraduations(
  options?: RequestOptions,
): Promise<ApiResult<PendingGraduationsResponse>> {
  return request<PendingGraduationsResponse>("/graduations/pending", options, anyObject);
}

/**
 * What a launch needs before the form can offer one (§219).
 *
 * Read from the chain by the API rather than written into the page: whether an
 * xStock is enabled and whether the graduation router is set are both
 * governance actions, and a page carrying a hand-written explanation of their
 * absence is wrong the moment governance acts.
 */
export function getLaunchConfig(
  options?: RequestOptions,
): Promise<ApiResult<LaunchConfigResponse>> {
  return request<LaunchConfigResponse>("/launch/config", options, anyObject);
}

export function getHealth(options?: RequestOptions): Promise<ApiResult<HealthResponse>> {
  return request<HealthResponse>("/health", options, anyObject);
}

export interface QuoteRequestBody {
  readonly token: string;
  readonly side: "BUY" | "SELL";
  /** Decimal string in the asset's own units. Never a JS number (§424). */
  readonly amount: string;
  readonly slippageBps?: string;
  readonly deadline?: string;
}

/**
 * Quote an order.
 *
 * Returns a complete signable intent, not a price (§694). The review the user
 * reads and the calldata they sign come from this one response — a UI that
 * quoted here and rebuilt the transaction elsewhere would be showing a review of
 * something other than what gets signed.
 */
export async function quote(
  body: QuoteRequestBody,
  options: RequestOptions = {},
): Promise<ApiResult<WireIntent>> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    throw new ApiUnreachable(error);
  }

  return receive<WireIntent>("/quote", response, signableIntent);
}

/** Narrowing helper, so callers do not test `ok` by hand at every call site. */
export function isOk<T>(
  result: ApiResult<T>,
): result is Extract<ApiResult<T>, { ok: true }> {
  return result.ok;
}
