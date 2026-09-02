/**
 * SENT — PostgreSQL client and typed query layer.
 *
 * §424 is specific about the shape this must take: SQL stays visible, migrations
 * stay explicit, and no opaque ORM sits between a financial query and the plan it
 * produces. So this is the `pg` driver with hand-written SQL, not a query builder
 * that generates something nobody reads.
 *
 * THE RULE THAT DECIDES EVERY TYPE HERE (§424)
 * ---------------------------------------------
 * "Financial/token quantities must never pass through JavaScript floating point."
 *
 * A uint256 does not fit in a JS number, and the failure is silent: 2^53 + 1
 * rounds to 2^53 without an error, so a balance comes back subtly wrong and every
 * downstream number inherits it.
 *
 * Two defences, both enforced at the boundary rather than by discipline:
 *
 *   - `pg` is configured to hand back NUMERIC and INT8 as STRINGS, never numbers.
 *     Node-postgres parses INT8 to a JS number by default, which is exactly the
 *     silent truncation above.
 *   - every read of a quantity goes through `big()`, which rejects anything that
 *     is not an integer string.
 *
 * §423 sets the authority boundary: if this database disagrees with the chain,
 * the database is wrong and gets rebuilt. Nothing here writes back to a
 * conclusion the chain reached.
 */

import pg from "pg";

const { Pool, types } = pg;

// ---------------------------------------------------------------------------
// Type parsers — applied before any query runs
// ---------------------------------------------------------------------------

/** PostgreSQL OIDs for the types that must never become JS numbers. */
const OID_INT8 = 20;
const OID_NUMERIC = 1700;

// node-postgres parses INT8 into a JS number by default. Above 2^53 that
// silently loses precision, and a block number or a token amount is exactly the
// kind of value that gets there. Both come back as strings instead.
types.setTypeParser(OID_INT8, (value: string) => value);
types.setTypeParser(OID_NUMERIC, (value: string) => value);

/**
 * Parse a database value into a bigint.
 *
 * Rejects anything that is not an integer string. A `number` arriving here means
 * a type parser was bypassed somewhere, and silently accepting it would hide the
 * precision loss this whole module exists to prevent.
 */
export function big(value: unknown, field = "value"): bigint {
  if (typeof value === "bigint") return value;

  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value)) {
      throw new TypeError(`${field}: expected an integer string, got ${JSON.stringify(value)}`);
    }
    return BigInt(value);
  }

  if (typeof value === "number") {
    throw new TypeError(
      `${field}: received a JS number (${value}). Quantities must never pass through ` +
        "floating point (§424) — a type parser is missing.",
    );
  }

  throw new TypeError(`${field}: cannot read ${typeof value} as an integer`);
}

/** Nullable variant, for columns that are legitimately absent. */
export function bigOrNull(value: unknown, field = "value"): bigint | null {
  return value === null || value === undefined ? null : big(value, field);
}

/** BYTEA -> lower-case 0x string, any length. For hashes and roots. */
export function hexBytes(value: unknown, field = "value"): `0x${string}` {
  if (value instanceof Uint8Array) {
    return `0x${Buffer.from(value).toString("hex")}` as `0x${string}`;
  }
  if (typeof value === "string") {
    return (value.startsWith("0x") ? value.toLowerCase() : `0x${value}`) as `0x${string}`;
  }
  throw new TypeError(`${field}: cannot read ${typeof value} as hex`);
}

/**
 * BYTEA -> lower-case 0x address, length-checked.
 *
 * The check is the point. Every identifier in this schema is a BYTEA, so an
 * address column and a hash column are indistinguishable to the driver: reading
 * `tx_hash` where `market` was meant produces a plausible-looking 0x string that
 * silently matches nothing. Twenty bytes or it is not an address.
 */
export function addr(value: unknown, field = "address"): `0x${string}` {
  const hex = hexBytes(value, field);
  if (hex.length !== 42) {
    throw new TypeError(`${field}: expected a 20-byte address, got ${(hex.length - 2) / 2} bytes`);
  }
  return hex;
}

/** 0x string -> Buffer, for BYTEA parameters. */
export function toBytes(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new TypeError(`toBytes: ${hex} is not valid hex`);
  }
  return Buffer.from(clean, "hex");
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export interface DbConfig {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
}

export class Database {
  private readonly pool: pg.Pool;

  constructor(config: DbConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.maxConnections ?? 10,
      // A query that runs forever holds a connection an API request is waiting
      // on. Bounding it turns a slow query into one failed request rather than a
      // stalled service.
      statement_timeout: config.statementTimeoutMs ?? 15_000,
    });
  }

  /** Run a query. SQL is passed literally; parameters are always bound. */
  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, params as unknown[]);
    return result.rows;
  }

  /** Run a query expecting at most one row. */
  async queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /**
   * Run a function inside a transaction.
   *
   * The indexer needs this: a block's events and the cursor advance must land
   * together, or a crash between them leaves the cursor claiming work that was
   * never persisted.
   */
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new Transaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class Transaction {
  private readonly client: pg.PoolClient;

  constructor(client: pg.PoolClient) {
    this.client = client;
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.client.query<T>(text, params as unknown[]);
    return result.rows;
  }

  async queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * Apply pending migrations.
 *
 * §424 wants migrations explicit. Each file runs once, inside a transaction, and
 * is recorded — so a partially applied migration rolls back rather than leaving
 * the schema in a state nobody can name.
 */
export async function migrate(db: Database, migrations: readonly { name: string; sql: string }[]) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set(
    (await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name),
  );

  const ran: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    await db.transaction(async (tx) => {
      await tx.query(migration.sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
    });

    ran.push(migration.name);
  }

  return ran;
}
