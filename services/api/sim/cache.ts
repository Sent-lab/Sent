/**
 * SENT — bounded cache audit (§425).
 *
 * The port held nine plain Maps with no eviction, all keyed by something a
 * caller controls. The quote cache is keyed on the amount, so a slider produces
 * a key per keystroke and anyone with curl can produce as many as they like:
 * the process grows until it is killed, and the symptom is an API that gets
 * slower for a day and then dies.
 *
 * What is checked here is the bound and the ORDER. A bounded FIFO would fix the
 * leak and quietly ruin the cache — a token read a thousand times a minute
 * would be evicted on the same schedule as one read once — so the recency
 * behaviour is asserted rather than assumed from the class name.
 *
 * Run: pnpm sim:cache
 */

import { BoundedCache, CACHE_LIMITS } from "../src/cache.ts";

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

section("The bound holds");

{
  const cache = new BoundedCache<number>(3);

  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  check("it holds up to its limit", cache.size === 3);

  cache.set("d", 4);
  check("and never exceeds it", cache.size === 3);
  check("evicting the oldest", cache.get("a") === undefined);
  check("and keeping the rest", cache.get("b") === 2 && cache.get("d") === 4);
}

{
  // The actual failure: a key space a caller controls, entered ten thousand
  // times. Before the bound this was ten thousand permanent entries.
  const cache = new BoundedCache<string>(100);

  for (let i = 0; i < 10_000; i++) cache.set(`buy:0xmarket:${i}`, "quote");

  check("ten thousand distinct keys leave a hundred entries", cache.size === 100);
  check("the newest survives", cache.get("buy:0xmarket:9999") === "quote");
  check("and the oldest is long gone", cache.get("buy:0xmarket:0") === undefined);
}

section("Eviction is by recency, not by age");

{
  const cache = new BoundedCache<number>(3);

  cache.set("hot", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  // Read it, then push past the limit. Under FIFO "hot" would be evicted here
  // because it was inserted first — which is how a bounded cache fixes a leak
  // and destroys its own hit rate at the same time.
  cache.get("hot");
  cache.set("d", 4);

  check("a key that was read recently survives", cache.get("hot") === 1);
  check("and the least recently used goes instead", cache.get("b") === undefined);
}

{
  const cache = new BoundedCache<number>(2);

  cache.set("a", 1);
  cache.set("b", 2);

  // An overwrite has to refresh the position too. Without it, re-setting the
  // oldest key leaves it oldest, and the next insert evicts the value that was
  // just written.
  cache.set("a", 10);
  cache.set("c", 3);

  check("an overwrite refreshes recency", cache.get("a") === 10);
  check("so the stale key is the one evicted", cache.get("b") === undefined);
}

section("Edges");

{
  const cache = new BoundedCache<number>(1);

  cache.set("a", 1);
  cache.set("b", 2);

  check("a limit of one holds exactly one", cache.size === 1);
  check("and it is the newest", cache.get("b") === 2);

  let refused = false;
  try {
    new BoundedCache<number>(0);
  } catch {
    refused = true;
  }

  // A limit of zero would evict every write immediately: a cache that silently
  // never caches, which is far harder to notice than one that refuses to exist.
  check("a limit of zero is refused", refused);
}

{
  const cache = new BoundedCache<number>(4);
  check("a missing key is undefined, not an error", cache.get("nothing") === undefined);

  cache.set("a", 0);
  // Zero is a legitimate cached value — a market with no trades in the window.
  // A cache that treats it as absent re-queries forever for the quietest rows.
  check("a falsy value is still a hit", cache.get("a") === 0);
}

section("Every cache in the port is bounded");

{
  const limits = Object.values(CACHE_LIMITS);

  check("all ten caches have a limit", limits.length === 10);
  check("and every limit is positive", limits.every((n) => n > 0));

  /*
   * A ceiling on the ceilings.
   *
   * These bound MEMORY, not just growth. Entries hold arrays of trades and
   * candles, so a limit large enough to feel generous is a limit that has not
   * been thought about — and the whole point of this file is that an unbounded
   * cache was not noticed for months.
   */
  check("and none is large enough to be a leak by another name", limits.every((n) => n <= 8_192));
}

console.log(failures === 0 ? "\ncache: all checks passed" : `\ncache: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
