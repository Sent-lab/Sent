/**
 * SENT — database package.
 *
 * The schema lives in `migrations/` as SQL, because SQL is the source of truth
 * for a projection that must be rebuildable (§138, §424). A TypeScript
 * description of a table would be a second definition, and the two drift.
 *
 * This module exposes the client, the typed query layer, and the enums the
 * projection and API share.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export * from "./client.ts";
export * from "./repository.ts";
export * from "./jobs.ts";
export * from "./notify.ts";

/** Lifecycle status as stored in `market_state.status` (§19). */
export const MARKET_STATUS = {
  PRE_GRAD: 0,
  /**
   * Exists only inside a single transaction. A row persisted with this value
   * means the indexer captured a partial state, which must be impossible.
   */
  GRADUATING: 1,
  GRADUATED: 2,
} as const;

export type MarketStatusCode = (typeof MARKET_STATUS)[keyof typeof MARKET_STATUS];

export const TRADE_SIDE = { BUY: 0, SELL: 1 } as const;

export interface Migration {
  readonly name: string;
  readonly sql: string;
}

/**
 * Load migrations in lexical order.
 *
 * Filenames are numerically prefixed so ordering is explicit rather than
 * dependent on filesystem enumeration, which differs between platforms.
 */
export function loadMigrations(dir = join(import.meta.dirname, "..", "migrations")): Migration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}
