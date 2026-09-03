/**
 * SENT — rate limiting (§425).
 *
 * WHY THIS SERVICE NEEDS ONE MORE THAN MOST
 * -----------------------------------------
 * Most routes here read a cached projection and cost almost nothing. Two do
 * not, and both are reachable without a wallet, a key, or a login:
 *
 *   POST /quote goes to the CHAIN. §423 requires it — a quote decides what a
 *   user signs, so it comes from the market's own `quoteBuy`/`quoteSell` — and
 *   that means every unauthenticated request consumes an RPC call. A loop
 *   against this endpoint exhausts the RPC provider's quota, and the failure
 *   lands on every OTHER user: quoting stops working for everyone.
 *
 *   GET /markets?q=… runs a trigram scan. Cheap per query, and not cheap at
 *   thousands per second.
 *
 * A LOCAL BUCKET, AND WHAT THAT DOES NOT DO
 * -----------------------------------------
 * This limits per replica, in memory. With four API replicas behind a load
 * balancer, a client gets four times the stated budget, and a restart forgets
 * everything.
 *
 * That is stated rather than hidden because it changes what this is FOR. It is
 * not a defence against a distributed attack — nothing at this layer is. It
 * bounds the damage one misbehaving client does to a shared dependency, which
 * is the failure that actually happens: a bot with a retry loop and no backoff.
 *
 * §425 puts the shared version in Redis, and that stays the right answer when
 * there is a reason to coordinate replicas. Adding it now would make the API
 * unable to answer at all when Redis is down, in exchange for a limit that is
 * four times tighter.
 *
 * A TOKEN BUCKET, NOT A FIXED WINDOW
 * ----------------------------------
 * A fixed window lets a client spend its whole budget in the last millisecond
 * of one window and again in the first of the next — twice the intended rate,
 * back to back, which is exactly the burst the RPC would feel. A bucket refills
 * continuously, so the sustained rate is the sustained rate.
 */

export interface BucketConfig {
  /** Sustained requests per second. */
  readonly refillPerSecond: number;
  /** Burst allowance — how far ahead of the sustained rate a client may run. */
  readonly capacity: number;
}

/**
 * Two budgets, because the costs are two orders of magnitude apart.
 *
 * Reads are generous: a terminal polling several endpoints while a user
 * watches a chart is normal behaviour and must never be throttled.
 *
 * Quotes are not: each one is an RPC call on a shared quota, and a person
 * cannot type faster than this.
 */
export const READ_LIMIT: BucketConfig = { refillPerSecond: 20, capacity: 60 };
export const QUOTE_LIMIT: BucketConfig = { refillPerSecond: 2, capacity: 10 };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface Decision {
  readonly allowed: boolean;
  /** Seconds until one token is available. Sent as Retry-After on a refusal. */
  readonly retryAfter: number;
  /** Whole tokens left, for the X-RateLimit-Remaining header. */
  readonly remaining: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly config: BucketConfig;
  private readonly limit: number;

  /**
   * `maxClients` bounds the bucket map itself.
   *
   * Without it the limiter is the memory-exhaustion vector it was added to
   * prevent: one bucket per source key, and the source key is attacker-chosen.
   * Eviction is the whole map at once, because evicting individually would
   * reset the budget of whichever client is evicted — which is what an attacker
   * would target.
   */
  constructor(config: BucketConfig, maxClients = 20_000) {
    this.config = config;
    this.limit = maxClients;
  }

  /**
   * Spend one token.
   *
   * `now` is milliseconds and injectable, so the refill behaviour can be tested
   * without sleeping — a rate limiter tested with real timers is a flaky test
   * that eventually gets deleted.
   */
  take(key: string, now: number = Date.now()): Decision {
    if (this.buckets.size >= this.limit) this.buckets.clear();

    const bucket = this.buckets.get(key) ?? {
      tokens: this.config.capacity,
      updatedAt: now,
    };

    // Continuous refill. Fractional tokens are kept: rounding down here would
    // make a client running at exactly the limit lose a little of it on every
    // request, and the effective rate would drift below what is advertised.
    const elapsed = Math.max(now - bucket.updatedAt, 0) / 1_000;
    bucket.tokens = Math.min(
      this.config.capacity,
      bucket.tokens + elapsed * this.config.refillPerSecond,
    );
    bucket.updatedAt = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return { allowed: true, retryAfter: 0, remaining: Math.floor(bucket.tokens) };
    }

    this.buckets.set(key, bucket);

    // Rounded UP, and never zero: a Retry-After of 0 invites an immediate
    // retry, which is the behaviour the refusal exists to stop.
    const wait = (1 - bucket.tokens) / this.config.refillPerSecond;
    return { allowed: false, retryAfter: Math.max(Math.ceil(wait), 1), remaining: 0 };
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * The identity a limit applies to.
 *
 * `X-Forwarded-For` is only trusted when the deployment says a proxy sets it.
 * Trusting it unconditionally makes the limiter useless — the header is
 * attacker-controlled, so every request can claim a fresh identity — and
 * ignoring it behind a load balancer makes every request share one bucket,
 * which throttles the whole world together. Neither default is safe, so it is
 * configured.
 */
export function clientKey(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && forwardedFor !== undefined) {
    // The left-most entry is the original client; everything after it was added
    // by intermediaries. Taking the last would bucket every request by the
    // nearest proxy, which is one bucket for everyone.
    const first = forwardedFor.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }

  return socketAddress ?? "unknown";
}
