/**
 * SENT — rate limiter audit (§425).
 *
 * The endpoint this protects is `POST /quote`, which §423 requires to go to the
 * CHAIN — so every unauthenticated request spends an RPC call on a shared
 * provider quota. A bot with a retry loop and no backoff exhausts it, and the
 * failure lands on everyone else: quoting stops working platform-wide.
 *
 * Time is injected throughout. A rate limiter tested with real timers is a
 * flaky test that eventually gets deleted, and then the limiter is untested.
 *
 * Run: pnpm sim:ratelimit
 */

import {
  RateLimiter,
  clientKey,
  READ_LIMIT,
  QUOTE_LIMIT,
} from "../src/ratelimit.ts";

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------

section("A burst is allowed, then the rate is the rate");

{
  const limiter = new RateLimiter({ refillPerSecond: 2, capacity: 10 });
  const t = 1_000_000;

  let allowed = 0;
  for (let i = 0; i < 10; i++) if (limiter.take("a", t).allowed) allowed += 1;

  check("the full burst goes through", allowed === 10);

  const refused = limiter.take("a", t);
  check("and the eleventh is refused", !refused.allowed);

  // Never zero. A Retry-After of 0 invites an immediate retry, which is the
  // behaviour the refusal exists to stop.
  check("with a Retry-After of at least a second", refused.retryAfter >= 1);
  check("and nothing remaining", refused.remaining === 0);
}

{
  const limiter = new RateLimiter({ refillPerSecond: 2, capacity: 10 });
  const t = 1_000_000;

  for (let i = 0; i < 10; i++) limiter.take("a", t);

  // Half a second at two per second is one token.
  check("half a second buys one token", limiter.take("a", t + 500).allowed);
  check("and not two", !limiter.take("a", t + 500).allowed);

  check("five seconds refills the whole burst", limiter.take("a", t + 5_500).allowed);
}

section("Refill is continuous, not a window");

{
  /*
   * The failure a fixed window has: a client spends its whole budget in the
   * last millisecond of one window and again in the first of the next — twice
   * the intended rate, back to back, which is precisely the burst the RPC feels.
   *
   * Across two nominal "windows" here, a bucket must allow the burst plus the
   * refill and no more.
   */
  const limiter = new RateLimiter({ refillPerSecond: 2, capacity: 10 });
  const t = 1_000_000;

  let allowed = 0;
  for (let i = 0; i < 10; i++) if (limiter.take("a", t).allowed) allowed += 1;

  // One second later: the bucket has earned exactly two.
  for (let i = 0; i < 10; i++) if (limiter.take("a", t + 1_000).allowed) allowed += 1;

  check("a second later buys exactly the refill", allowed === 12);
}

{
  const limiter = new RateLimiter({ refillPerSecond: 1, capacity: 5 });
  const t = 1_000_000;

  for (let i = 0; i < 5; i++) limiter.take("a", t);

  // Fractional tokens are kept. Rounding down on every request would make a
  // client running at exactly the limit lose a little each time, and the
  // effective rate would drift below the advertised one.
  check("a tenth of a second is not yet a token", !limiter.take("a", t + 100).allowed);
  check("nor is another tenth", !limiter.take("a", t + 200).allowed);

  // Ten tenths is one whole token, even though it was asked for in pieces.
  check("but ten of them are", limiter.take("a", t + 1_000).allowed);
}

section("Capacity never exceeds the burst");

{
  const limiter = new RateLimiter({ refillPerSecond: 100, capacity: 3 });
  const t = 1_000_000;

  limiter.take("a", t);

  // An hour of idling must not bank an hour of requests. Without the clamp a
  // client that connects once a day arrives with an unlimited burst.
  let allowed = 0;
  for (let i = 0; i < 20; i++) if (limiter.take("a", t + 3_600_000).allowed) allowed += 1;

  check("idle time does not bank an unbounded burst", allowed === 3);
}

section("Clients are independent");

{
  const limiter = new RateLimiter({ refillPerSecond: 1, capacity: 2 });
  const t = 1_000_000;

  limiter.take("a", t);
  limiter.take("a", t);

  check("one client exhausts its own budget", !limiter.take("a", t).allowed);
  check("and another is unaffected", limiter.take("b", t).allowed);
}

{
  /*
   * The bucket map is itself attacker-controlled: one entry per source key.
   * Without a bound the limiter becomes the memory-exhaustion vector it was
   * added to prevent.
   *
   * Eviction is the whole map at once, deliberately. Evicting individually
   * would reset the budget of whichever client is chosen — which is exactly
   * what an attacker would aim for.
   */
  const limiter = new RateLimiter({ refillPerSecond: 1, capacity: 1 }, 100);
  const t = 1_000_000;

  for (let i = 0; i < 5_000; i++) limiter.take(`client-${i}`, t);

  check("the bucket map stays bounded", limiter.size <= 100);
}

section("The client key is the one thing that must not be guessed");

{
  // Trusting the header without a proxy makes the limiter useless: it is
  // attacker-controlled, so every request can claim a fresh identity.
  check(
    "an untrusted forwarded header is ignored",
    clientKey("10.0.0.1", "1.2.3.4", false) === "10.0.0.1",
  );

  // Ignoring it BEHIND a proxy is the opposite failure: every request shares
  // one bucket, and the whole world is throttled together.
  check(
    "a trusted one is used",
    clientKey("10.0.0.1", "1.2.3.4", true) === "1.2.3.4",
  );

  // Left-most is the original client. Taking the last would bucket every
  // request by the nearest proxy — one bucket for everyone, again.
  check(
    "the left-most entry wins in a chain",
    clientKey("10.0.0.1", "1.2.3.4, 10.0.0.5, 10.0.0.6", true) === "1.2.3.4",
  );

  check(
    "a trusted but empty header falls back to the socket",
    clientKey("10.0.0.1", "", true) === "10.0.0.1",
  );

  // A socket with no address is possible (a unix socket, a test injection).
  // Bucketing them together is correct: they are indistinguishable.
  check("an unknown source still gets a key", clientKey(undefined, undefined, false) === "unknown");
}

section("The two budgets are sized for their costs");

{
  /*
   * A quote is an RPC call on a shared quota; a read is a cached projection
   * lookup. Sizing them the same would either throttle a terminal that is
   * behaving normally, or leave the RPC unprotected.
   */
  check("reads are more generous than quotes", READ_LIMIT.refillPerSecond > QUOTE_LIMIT.refillPerSecond);
  check("and burst higher", READ_LIMIT.capacity > QUOTE_LIMIT.capacity);

  // A person cannot type faster than this, and a terminal polling several
  // endpoints while someone watches a chart must never be throttled.
  check("a quote budget still allows a burst of typing", QUOTE_LIMIT.capacity >= 5);
  check("and a read budget allows a polling terminal", READ_LIMIT.refillPerSecond >= 10);
}

console.log(failures === 0 ? "\nratelimit: all checks passed" : `\nratelimit: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
