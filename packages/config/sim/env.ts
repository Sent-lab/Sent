/**
 * SENT — configuration simulation.
 *
 * `env.ts` claims to reject things `Number()` would happily accept. That claim is
 * the whole reason the module exists, so it is tested rather than asserted.
 *
 * The failure it prevents is quiet: `Number("8O80")` is NaN, `Number("0x10")` is
 * 16, `Number("")` is 0. A port, a confirmation depth or a start block parsed
 * that way produces a service that runs and is wrong, which is strictly worse
 * than one that refuses to start.
 */

import {
  ConfigError,
  chainEnv,
  databaseEnv,
  apiEnv,
  realtimeEnv,
  loadAll,
} from "../src/env.ts";
import { assertProductionConfigReady, XSTOCK_ALLOWLIST } from "../src/chain.ts";

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

/** Runs `fn`, returning the ConfigError message or null if it did not throw. */
function refusal(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof ConfigError ? error.message : `WRONG ERROR TYPE: ${String(error)}`;
  }
}

const VALID_CHAIN = {
  RPC_URL: "https://rpc.hyperliquid.xyz/evm",
  CHAIN_ID: "999",
  FACTORY_ADDRESS: "0x1111111111111111111111111111111111111111",
  REWARD_VAULT_ADDRESS: "0x2222222222222222222222222222222222222222",
  START_BLOCK: "1000",
  CONFIRMATIONS: "20",
};

// ---------------------------------------------------------------------------

section("Required values have no defaults");

{
  check("a missing DATABASE_URL is refused", refusal(() => databaseEnv({})) !== null);
  check(
    "and the message names the variable",
    (refusal(() => databaseEnv({})) ?? "").includes("DATABASE_URL"),
  );

  // Whitespace is not a value. A variable set to " " in a compose file looks
  // present to `!== undefined` and is not.
  check(
    "whitespace does not count as set",
    refusal(() => databaseEnv({ DATABASE_URL: "   " })) !== null,
  );

  check("a missing RPC_URL is refused", refusal(() => chainEnv({ ...VALID_CHAIN, RPC_URL: "" })) !== null);
  check(
    "a missing FACTORY_ADDRESS is refused",
    refusal(() => chainEnv({ ...VALID_CHAIN, FACTORY_ADDRESS: undefined })) !== null,
  );
}

section("Numbers Number() would accept and should not");

{
  const cases: [string, string][] = [
    ["hex", "0x10"],
    ["exponent", "1e3"],
    ["decimal", "20.5"],
    ["letter-for-digit typo", "8O80"],
    ["trailing junk", "20abc"],
    ["infinity", "Infinity"],
  ];

  for (const [label, value] of cases) {
    check(
      `CONFIRMATIONS rejects ${label} ("${value}")`,
      refusal(() => chainEnv({ ...VALID_CHAIN, CONFIRMATIONS: value })) !== null,
    );
  }

  // Surrounding whitespace IS tolerated — it is a formatting artefact of env
  // files, not a different value.
  check(
    "a padded integer is accepted",
    chainEnv({ ...VALID_CHAIN, CONFIRMATIONS: " 20 " }).confirmations === 20,
  );

  check(
    "an unset integer falls back to its default",
    chainEnv({ ...VALID_CHAIN, CONFIRMATIONS: undefined }).confirmations === 20,
  );
}

section("Bounds that protect settlement");

{
  // Zero confirmations would let the finalizer treat the chain head as settled,
  // and a reorg under a signed distribution has no remedy (§335).
  check(
    "zero confirmations is refused",
    refusal(() => chainEnv({ ...VALID_CHAIN, CONFIRMATIONS: "0" })) !== null,
  );

  check(
    "negative confirmations is refused",
    refusal(() => chainEnv({ ...VALID_CHAIN, CONFIRMATIONS: "-1" })) !== null,
  );

  check(
    "a negative start block is refused",
    refusal(() => chainEnv({ ...VALID_CHAIN, START_BLOCK: "-1" })) !== null,
  );

  check(
    "the start block is a bigint, not a number",
    typeof chainEnv(VALID_CHAIN).startBlock === "bigint",
  );
}

section("Addresses are shaped, not merely present");

{
  const bad: [string, string][] = [
    ["no 0x prefix", "1111111111111111111111111111111111111111"],
    ["too short", "0x111111111111111111111111111111111111111"],
    ["too long", "0x11111111111111111111111111111111111111111"],
    ["non-hex", "0x111111111111111111111111111111111111111g"],
    ["a transaction hash", "0x" + "1".repeat(64)],
  ];

  for (const [label, value] of bad) {
    check(
      `FACTORY_ADDRESS rejects ${label}`,
      refusal(() => chainEnv({ ...VALID_CHAIN, FACTORY_ADDRESS: value })) !== null,
    );
  }

  check(
    "a checksummed address is normalised to lower case",
    chainEnv({ ...VALID_CHAIN, FACTORY_ADDRESS: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01" })
      .factory === "0xabcdef0123456789abcdef0123456789abcdef01",
  );
}

section("URLs are parsed");

{
  check(
    "a bare hostname is refused",
    refusal(() => chainEnv({ ...VALID_CHAIN, RPC_URL: "rpc.hyperliquid.xyz" })) !== null,
  );

  check("a full URL is accepted", chainEnv(VALID_CHAIN).rpcUrl === VALID_CHAIN.RPC_URL);
}

section("Every problem is reported at once");

{
  const message = refusal(() =>
    loadAll({
      db: () => databaseEnv({}),
      chain: () => chainEnv({}),
      api: () => apiEnv({ API_PORT: "80x80" }),
    }),
  );

  check("the combined load fails", message !== null);
  check("it names the database problem", (message ?? "").includes("DATABASE_URL"));
  check("and the chain problem", (message ?? "").includes("RPC_URL"));
  check("and the port problem", (message ?? "").includes("API_PORT"));

  // One variable per restart turns configuration into a guessing game played
  // one round at a time.
  check(
    "at least three problems in one message",
    (message ?? "").split("\n  - ").length >= 4,
  );
}

section("Defaults exist only where they are safe");

{
  const api = apiEnv({});
  check("the API has a default port", api.port === 8080);
  check("the API binds all interfaces by default", api.host === "0.0.0.0");

  const realtime = realtimeEnv({});
  check("realtime has a default port", realtime.port === 8081);
  check("realtime and API defaults do not collide", realtime.port !== api.port);

  const db = databaseEnv({ DATABASE_URL: "postgres://localhost/sent" });
  check("connection limits have defaults", db.maxConnections === 10);
  check("statements time out by default", db.statementTimeoutMs === 15_000);
}

section("CORS origins are parsed strictly");

{
  check("unset means no browser origin is allowed", apiEnv({}).allowedOrigins.length === 0);

  check(
    "a single origin parses",
    apiEnv({ API_ALLOWED_ORIGINS: "https://sent.xyz" }).allowedOrigins[0] === "https://sent.xyz",
  );

  check(
    "a list parses",
    apiEnv({ API_ALLOWED_ORIGINS: "https://sent.xyz, http://localhost:3000" })
      .allowedOrigins.length === 2,
  );

  check(
    "a port is part of the origin",
    apiEnv({ API_ALLOWED_ORIGINS: "http://localhost:3100" }).allowedOrigins[0] ===
      "http://localhost:3100",
  );

  // A trailing slash never matches the Origin header a browser sends, and the
  // resulting failure looks like missing configuration rather than a typo.
  check(
    "a trailing slash is refused",
    refusal(() => apiEnv({ API_ALLOWED_ORIGINS: "https://sent.xyz/" })) !== null,
  );

  check(
    "a path is refused",
    refusal(() => apiEnv({ API_ALLOWED_ORIGINS: "https://sent.xyz/app" })) !== null,
  );

  check(
    "a bare hostname is refused",
    refusal(() => apiEnv({ API_ALLOWED_ORIGINS: "sent.xyz" })) !== null,
  );

  // A wildcard is not a valid URL, so it cannot be configured by accident.
  check("a wildcard is refused", refusal(() => apiEnv({ API_ALLOWED_ORIGINS: "*" })) !== null);
}

section("Production readiness is still gated (§279)");

{
  // This must FAIL today. V-02/V-03/V-05/V-06/C-08 are open, and a guard that
  // started passing while they are open would mean someone filled the constants
  // in without recording the evidence.
  let refused = false;
  try {
    assertProductionConfigReady();
  } catch (error) {
    refused = error instanceof Error && error.message.includes("not ready");
  }

  check("mainnet config is not yet ready, and says so", refused);
  check("the xStock allowlist is still empty", XSTOCK_ALLOWLIST.length === 0);
}

console.log(failures === 0 ? "\nconfig: all checks passed" : `\nconfig: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
