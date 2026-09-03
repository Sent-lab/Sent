/**
 * SENT — environment configuration.
 *
 * Every service reads its configuration through this module, and every value is
 * validated at startup rather than at first use.
 *
 * WHY VALIDATE EAGERLY
 * --------------------
 * A missing RPC URL discovered on the first request is an outage that looks like
 * a bug. A malformed contract address discovered on the first launch is worse:
 * it becomes an event filter matching nothing, and the service reports itself
 * healthy while indexing an empty stream forever.
 *
 * So a process either has a complete, well-formed configuration before it
 * accepts work, or it refuses to start and says exactly which variable is wrong.
 *
 * NOTHING SECRET HAS A DEFAULT
 * ----------------------------
 * Connection strings, private keys and RPC credentials are required and
 * unset-by-default. A default database URL is how a service quietly connects to
 * the wrong database; a default private key is how one gets committed.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(`${key} is required and was not set`);
  }
  return value.trim();
}

function optional(env: Env, key: string, fallback: string): string {
  const value = env[key];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

/**
 * Read an integer.
 *
 * Rejects anything that is not a whole decimal number, including the values
 * `Number()` accepts and should not: "" is 0, "0x10" is 16, "1e3" is 1000, and
 * " 12 " is 12. A port silently parsed from "8O80" would bind somewhere
 * unexpected rather than fail.
 */
function integer(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = raw.trim();
  if (!/^-?\d+$/.test(value)) {
    throw new ConfigError(`${key} must be a whole number, got "${raw}"`);
  }
  return Number(value);
}

/** Read a 20-byte address, normalised to lower case. */
function address(env: Env, key: string): `0x${string}` {
  const value = required(env, key);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ConfigError(`${key} must be a 20-byte hex address, got "${value}"`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function url(env: Env, key: string, fallback?: string): string {
  const value = fallback === undefined ? required(env, key) : optional(env, key, fallback);

  try {
    new URL(value);
  } catch {
    throw new ConfigError(`${key} must be a URL, got "${value}"`);
  }
  return value;
}

// ---------------------------------------------------------------------------

export interface DatabaseEnv {
  readonly connectionString: string;
  readonly maxConnections: number;
  readonly statementTimeoutMs: number;
}

export interface ChainEnv {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly factory: `0x${string}`;
  readonly rewardVault: `0x${string}`;
  readonly startBlock: bigint;
  readonly confirmations: number;
}

export function databaseEnv(env: Env = process.env): DatabaseEnv {
  return {
    connectionString: required(env, "DATABASE_URL"),
    maxConnections: integer(env, "DATABASE_MAX_CONNECTIONS", 10),
    statementTimeoutMs: integer(env, "DATABASE_STATEMENT_TIMEOUT_MS", 15_000),
  };
}

export function chainEnv(env: Env = process.env): ChainEnv {
  const chainId = integer(env, "CHAIN_ID", 999);
  const startBlock = integer(env, "START_BLOCK", 0);

  if (startBlock < 0) throw new ConfigError(`START_BLOCK must not be negative, got ${startBlock}`);

  const confirmations = integer(env, "CONFIRMATIONS", 20);

  // Zero confirmations would let the finalizer treat the chain head as settled,
  // and a reorg beneath a signed distribution has no remedy (§335).
  if (confirmations < 1) {
    throw new ConfigError(`CONFIRMATIONS must be at least 1, got ${confirmations}`);
  }

  return {
    rpcUrl: url(env, "RPC_URL"),
    chainId,
    factory: address(env, "FACTORY_ADDRESS"),
    rewardVault: address(env, "REWARD_VAULT_ADDRESS"),
    startBlock: BigInt(startBlock),
    confirmations,
  };
}

export interface ApiEnv {
  readonly port: number;
  readonly host: string;
  readonly refreshIntervalMs: number;
  readonly allowedOrigins: readonly string[];
}

export function apiEnv(env: Env = process.env): ApiEnv {
  return {
    port: integer(env, "API_PORT", 8080),
    host: optional(env, "API_HOST", "0.0.0.0"),
    refreshIntervalMs: integer(env, "API_REFRESH_INTERVAL_MS", 2_000),
    allowedOrigins: origins(env, "API_ALLOWED_ORIGINS"),
  };
}

/**
 * Parse a comma-separated origin list.
 *
 * Each entry must be a bare origin — scheme, host and optional port, with no
 * path. A trailing slash makes the string fail to match the `Origin` header a
 * browser actually sends, which produces a CORS failure that looks like a
 * missing configuration rather than a typo.
 *
 * An unset value means no browser origin is allowed, which is the right default
 * for an API that also serves bots.
 */
function origins(env: Env, key: string): readonly string[] {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return [];

  return raw.split(",").map((entry) => {
    const value = entry.trim();

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ConfigError(`${key} entry "${value}" is not a URL`);
    }

    if (parsed.origin !== value) {
      throw new ConfigError(
        `${key} entry "${value}" must be a bare origin like "${parsed.origin}" — no path or trailing slash`,
      );
    }

    return value;
  });
}

export interface RealtimeEnv {
  readonly port: number;
  readonly host: string;
  readonly replayCapacity: number;
  readonly heartbeatMs: number;
  readonly flushMs: number;
}

export function realtimeEnv(env: Env = process.env): RealtimeEnv {
  return {
    port: integer(env, "REALTIME_PORT", 8081),
    host: optional(env, "REALTIME_HOST", "0.0.0.0"),
    replayCapacity: integer(env, "REALTIME_REPLAY_CAPACITY", 8_192),
    heartbeatMs: integer(env, "REALTIME_HEARTBEAT_MS", 30_000),
    flushMs: integer(env, "REALTIME_FLUSH_MS", 50),
  };
}

/**
 * Load everything a process needs, and fail with ALL the problems at once.
 *
 * Reporting one missing variable per restart turns configuring a service into a
 * guessing game played one round at a time.
 */
export function loadAll<T extends Record<string, () => unknown>>(
  loaders: T,
): { [K in keyof T]: ReturnType<T[K]> } {
  const result: Record<string, unknown> = {};
  const problems: string[] = [];

  for (const [name, load] of Object.entries(loaders)) {
    try {
      result[name] = load();
    } catch (error) {
      problems.push(error instanceof ConfigError ? error.message : String(error));
    }
  }

  if (problems.length > 0) {
    throw new ConfigError(
      `configuration is incomplete:\n  - ${problems.join("\n  - ")}`,
    );
  }

  return result as { [K in keyof T]: ReturnType<T[K]> };
}
