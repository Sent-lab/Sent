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
  MarketDetail,
  TapeItem,
  StockbackResponse,
  HealthResponse,
} from "@sent/api/handlers";
import type { IntentKind, IntentRow } from "@sent/sdk";

export type {
  ApiResult,
  ExploreItem,
  MarketDetail,
  TapeItem,
  StockbackResponse,
  HealthResponse,
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
  readonly estimateIsPartial?: boolean;
  /**
   * True when the slippage bound covers only part of a crossing order's route.
   *
   * V-19, still open. The UI must render this differently rather than showing a
   * bound that looks like it protects the whole trade.
   */
  readonly boundCoversPartialRoute?: boolean;
}

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

interface RequestOptions {
  readonly signal?: AbortSignal;
  /** Server components render fresh; the browser may reuse briefly. */
  readonly revalidateSeconds?: number;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
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

  // 4xx and 5xx still carry a typed body — including /health at 503, which is a
  // meaningful answer rather than a failure. Parsing it is how the UI shows
  // DELAYED rather than a blank screen.
  const body = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (body === null) {
    throw new ApiUnreachable(new Error(`${response.status} with no JSON body`));
  }

  return body;
}

// ---------------------------------------------------------------------------

export type ExploreSort = "NEWEST" | "PROGRESS" | "VOLUME" | "HOLDERS";
export type ExploreStatus = "PRE_GRAD" | "GRADUATED";

export interface ExploreQuery {
  readonly sort?: ExploreSort;
  readonly status?: ExploreStatus;
  readonly quoteAsset?: string;
  readonly limit?: number;
}

export function listMarkets(
  query: ExploreQuery = {},
  options?: RequestOptions,
): Promise<ApiResult<ExploreItem[]>> {
  const params = new URLSearchParams();
  if (query.sort !== undefined) params.set("sort", query.sort);
  if (query.status !== undefined) params.set("status", query.status);
  if (query.quoteAsset !== undefined) params.set("quoteAsset", query.quoteAsset);
  if (query.limit !== undefined) params.set("limit", String(query.limit));

  const qs = params.toString();
  return request<ExploreItem[]>(`/markets${qs === "" ? "" : `?${qs}`}`, options);
}

export function getMarket(
  token: string,
  options?: RequestOptions,
): Promise<ApiResult<MarketDetail>> {
  return request<MarketDetail>(`/markets/${token}`, options);
}

export function getTape(
  token: string,
  limit = 50,
  options?: RequestOptions,
): Promise<ApiResult<TapeItem[]>> {
  return request<TapeItem[]>(`/markets/${token}/trades?limit=${limit}`, options);
}

export function getStockback(
  token: string,
  account: string,
  options?: RequestOptions,
): Promise<ApiResult<StockbackResponse>> {
  return request<StockbackResponse>(`/markets/${token}/stockback/${account}`, options);
}

export function getHealth(options?: RequestOptions): Promise<ApiResult<HealthResponse>> {
  return request<HealthResponse>("/health", options);
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

  const parsed = (await response.json().catch(() => null)) as ApiResult<WireIntent> | null;
  if (parsed === null) {
    throw new ApiUnreachable(new Error(`${response.status} with no JSON body`));
  }

  return parsed;
}

/** Narrowing helper, so callers do not test `ok` by hand at every call site. */
export function isOk<T>(
  result: ApiResult<T>,
): result is Extract<ApiResult<T>, { ok: true }> {
  return result.ok;
}
