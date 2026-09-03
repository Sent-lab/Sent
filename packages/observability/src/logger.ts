/**
 * SENT — structured logging (§437).
 *
 * §437 lists structured logs as a requirement and names the fields every log
 * line should be correlatable on: requestId, chainId, blockNumber, txHash,
 * logIndex, tokenAddress, marketAddress, epochId, and account where
 * appropriate. This file exists so those names are spelled one way.
 *
 * WHY NOT A LOGGING LIBRARY
 * -------------------------
 * The requirement is a JSON line on stdout with stable field names. Pino and
 * Winston are excellent and both bring transports, serialisers, child-logger
 * lifecycles and a plugin surface this project has no use for. What it does
 * need — redaction that cannot be forgotten — is a property of the call site,
 * not of the library, and a dependency would not supply it.
 *
 * NO SECRETS, ENFORCED RATHER THAN REQUESTED
 * ------------------------------------------
 * §437 ends with "no secrets/private keys in logs". A rule stated in a comment
 * is a rule that holds until someone in a hurry logs a config object. So every
 * value passes through `redact` on its way out: keys whose name looks like a
 * secret are replaced, and any string that looks like a 32-byte private key is
 * replaced wherever it appears.
 *
 * The check is deliberately crude and deliberately eager. A false positive
 * costs a redacted debug line; a false negative puts a key in a log aggregator
 * that many people can read and that keeps data for months.
 */

export type Level = "debug" | "info" | "warn" | "error";

/**
 * The §437 correlation fields.
 *
 * All optional — a log line from the indexer has a blockNumber and no
 * requestId; one from the API has the reverse. Naming them here is what makes
 * the two joinable when something spans both.
 */
export interface LogContext {
  /*
   * Every field is explicitly `| undefined`.
   *
   * The repo runs with `exactOptionalPropertyTypes`, under which `a?: string`
   * refuses an explicit undefined — and a caller passing a value that may be
   * absent is the normal case at a logging site. Forcing each one to be
   * conditionally spread would make logging the most awkward call in the file
   * it appears in, which is how logging stops being added.
   */
  readonly requestId?: string | undefined;
  readonly chainId?: number | undefined;
  readonly blockNumber?: bigint | number | string | undefined;
  readonly txHash?: string | undefined;
  readonly logIndex?: number | undefined;
  readonly tokenAddress?: string | undefined;
  readonly marketAddress?: string | undefined;
  readonly epochId?: bigint | number | string | undefined;
  /**
   * "Where safe/appropriate" (§437).
   *
   * A wallet address is public on-chain, so this is not a secret. It is still
   * personal data in aggregate, so it is logged only where an operator would
   * genuinely need it to trace one user's failed action.
   */
  readonly account?: string | undefined;
  readonly [key: string]: unknown;
}

/** Field names whose VALUE is never safe to print, whatever it contains. */
const SECRET_KEYS =
  /(private|secret|password|passphrase|mnemonic|seed|token|apikey|api_key|auth|credential|signature)/i;

/**
 * A bare 32-byte hex string.
 *
 * The shape of an EVM private key. It is also the shape of a transaction hash,
 * a merkle root and a block hash — all of which are public and useful in logs.
 * Those travel in NAMED fields (`txHash`, `merkleRoot`), which are allowed
 * through; this pattern only fires on a loose string that arrived without a
 * name saying what it is.
 */
const BARE_32_BYTES = /\b0x[0-9a-fA-F]{64}\b/;

/** Named fields whose 32-byte value is public and worth keeping. */
const PUBLIC_HASH_KEYS = /^(txHash|merkleRoot|datasetHash|blockHash|parentHash|hash|root)$/;

export const REDACTED = "[redacted]";

/**
 * Strip anything that must not reach a log aggregator.
 *
 * Applied to every value on every line rather than at chosen call sites,
 * because the call site that forgets is the one that matters.
 */
export function redact(key: string, value: unknown): unknown {
  if (SECRET_KEYS.test(key)) return REDACTED;

  if (typeof value === "bigint") return value.toString();

  if (typeof value === "string") {
    // A 32-byte hex under a name that does not say what it is. Could be a hash;
    // could be a key. The cost of guessing wrong in one direction is a less
    // useful debug line, and in the other it is a compromised wallet.
    if (BARE_32_BYTES.test(value) && !PUBLIC_HASH_KEYS.test(key)) return REDACTED;
    return value;
  }

  if (Array.isArray(value)) return value.map((v, i) => redact(String(i), v));

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(k, v);
    }
    return out;
  }

  return value;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** A logger that carries these fields on every line it writes. */
  child(context: LogContext): Logger;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  /** Service name, so lines from four processes stay distinguishable. */
  readonly service: string;
  readonly level?: Level;
  /** Overridable for tests. Defaults to a JSON line on stdout/stderr. */
  readonly write?: (line: string, level: Level) => void;
  readonly now?: () => number;
}

/**
 * One JSON object per line.
 *
 * Not pretty-printed, ever. A multi-line log entry is a log entry that every
 * aggregator on earth will split into several, and the tail of a stack trace
 * arrives as an unparseable fragment with no service name on it.
 */
export function createLogger(options: LoggerOptions): Logger {
  const threshold = ORDER[options.level ?? "info"];
  const now = options.now ?? Date.now;

  const write =
    options.write ??
    ((line: string, level: Level): void => {
      // Errors and warnings to stderr so a container's log routing can split
      // them without parsing.
      if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
    });

  const emit = (level: Level, message: string, base: LogContext, extra?: LogContext): void => {
    if (ORDER[level] < threshold) return;

    const merged = { ...base, ...extra };
    const fields: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined) continue;
      fields[k] = redact(k, v);
    }

    write(
      JSON.stringify({
        ts: new Date(now()).toISOString(),
        level,
        service: options.service,
        msg: message,
        ...fields,
      }),
      level,
    );
  };

  const make = (base: LogContext): Logger => ({
    debug: (m, c) => emit("debug", m, base, c),
    info: (m, c) => emit("info", m, base, c),
    warn: (m, c) => emit("warn", m, base, c),
    error: (m, c) => emit("error", m, base, c),
    child: (c) => make({ ...base, ...c }),
  });

  return make({});
}
