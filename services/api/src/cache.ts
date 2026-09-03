/**
 * SENT — bounded caches for the API's per-request loads (§425).
 *
 * THE BUG THIS FIXES
 * ------------------
 * The port held nine plain `Map`s and nothing ever removed from them. Each one
 * is keyed by something a caller controls:
 *
 *   quotes    `buy:0xmarket:12345`  — a new key for every distinct amount
 *   accounts  one per address ever asked about
 *   creators  the same
 *   markets   one per (sort, status, quoteAsset, query, offset, limit)
 *
 * The quote cache is the worst of them: an ordinary user moving a slider
 * creates a key per keystroke, and anyone with curl can create as many as they
 * like. The process grows until it is killed, and the symptom is an API that
 * gets slower for a day and then dies — which reads as a memory leak somewhere
 * else entirely.
 *
 * WHY NOT REDIS
 * -------------
 * §425 recommends Redis for exactly these — hot explore queries, short-lived
 * quote caches — and that remains the right answer at the scale it is written
 * for. It is not the answer to THIS defect: an unbounded local map is a bug in
 * the map, and replacing it with a network dependency would fix the leak by
 * adding a service that has to be running for the API to answer at all.
 *
 * So: bounded here, and Redis stays available as a later CHOOSE decision when
 * there is more than one replica whose caches would benefit from being shared.
 *
 * INSERTION ORDER IS THE EVICTION ORDER
 * -------------------------------------
 * A JavaScript `Map` iterates in insertion order, which makes the oldest key
 * exactly `keys().next().value`. Reading a key re-inserts it, so this is a true
 * LRU rather than a FIFO — the difference matters for the market cache, where
 * one popular token is read constantly and would otherwise be evicted on a
 * schedule by a stream of one-off lookups.
 */

export class BoundedCache<V> {
  private readonly entries = new Map<string, V>();
  private readonly limit: number;

  constructor(limit: number) {
    if (limit < 1) throw new RangeError("BoundedCache: limit must be at least 1");
    this.limit = limit;
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;

    // Re-insert to move it to the end. This is what makes eviction LRU rather
    // than FIFO: without it, a token read a thousand times a minute is evicted
    // on the same schedule as one read once.
    this.entries.delete(key);
    this.entries.set(key, value);

    return value;
  }

  set(key: string, value: V): void {
    // Delete first so an overwrite also refreshes the position, rather than
    // leaving the entry where it was and evicting a hot key instead.
    this.entries.delete(key);
    this.entries.set(key, value);

    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * How many entries each cache holds.
 *
 * Sized by what the key space actually is, not by a single round number:
 *
 *   Quotes are the largest key space by far and the shortest-lived — a slider
 *   produces a key per keystroke — so this is a working set, not a cache with
 *   a meaningful hit rate.
 *
 *   Markets, accounts and creators are keyed by an identity a real person is
 *   looking at. A few thousand covers every market and every wallet actively
 *   trading; beyond that the cost of a miss is one query.
 *
 *   Epochs and candles hold arrays, so their entries are much larger. They are
 *   bounded lower for memory rather than for hit rate.
 */
export const CACHE_LIMITS = {
  markets: 512,
  byToken: 2_048,
  trades: 512,
  candles: 512,
  stockback: 4_096,
  quotes: 4_096,
  creators: 2_048,
  accounts: 4_096,
  counts: 512,
  epochs: 512,
} as const;
