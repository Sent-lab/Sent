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
import {
  assertProductionConfigReady,
  XSTOCK_ALLOWLIST,
  REFERENCE_PRICE_FEEDS,
  GRADUATION_ROUTER,
  WRAPPER_FACTORY,
  PLATFORM_ACCOUNTS,
} from "../src/chain.ts";

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

  /*
   * The launch anchor, checked here rather than left to the contract's own
   * revert.
   *
   * `ReferencePriceNotSet` arrives when a creator tries to launch, which is
   * after the deployment looked successful. This is the same fact discovered at
   * startup, where it is an operator's problem rather than a user's — and `p0`
   * is immutable for the life of every market it prices, so there is no version
   * of "we will fix it after the first launch".
   */
  check("no launch-anchor feed is configured yet (V-11)", REFERENCE_PRICE_FEEDS.length === 0);

  let namesTheAnchor = false;
  try {
    assertProductionConfigReady();
  } catch (error) {
    namesTheAnchor = error instanceof Error && error.message.includes("V-11");
  }

  // The guard must SAY which dependency is missing. A refusal that lists four
  // problems and omits the fifth is one an operator resolves and then meets
  // again.
  check("and the refusal names it", namesTheAnchor);

  /*
   * §180 requires "Graduation + permanent LP path proven".
   *
   * The router and the lock are written and tested; what is missing is three
   * HyperSwap addresses, two of which are immutable in the router's
   * constructor. Guessing them produces a router that looks configured and
   * mints a market's entire liquidity into a contract nobody verified.
   */
  check("no graduation router is deployed yet (V-06, V-09)", GRADUATION_ROUTER === null);

  let namesGraduation = false;
  try {
    assertProductionConfigReady();
  } catch (error) {
    namesGraduation = error instanceof Error && error.message.includes("graduation router");
  }

  // Named separately from the HyperSwap addresses, because it is fixed by a
  // different action: those are a research task, this is a deployment that
  // cannot happen until they land.
  check("and the refusal says markets cannot graduate", namesGraduation);

  /*
   * The wrapper factory (D-017).
   *
   * Worth its own check because an empty allowlist and a missing factory look
   * identical from outside — nothing launches either way — and are fixed by
   * different people. Every xStock on HyperEVM rebases (V-03), and the registry
   * refuses those structurally, so without a factory there is nothing
   * governance COULD list. The refusal has to say that rather than leaving an
   * operator to conclude the allowlist is merely unfinished.
   */
  /*
   * The wrapper factory IS deployed now, and this check used to assert the
   * opposite — correctly, until Day 9.
   *
   * Rewritten rather than deleted, because "the factory exists" is worth
   * pinning: it is bound immutably into the registry, so a config that names a
   * different one is a config describing a registry that does not exist.
   */
  check("the wrapper factory is deployed (D-017)", WRAPPER_FACTORY !== null);
  check(
    "and it is the one the registry is bound to",
    WRAPPER_FACTORY === "0xc7b674f6Ec9de46852A25897305292a3d1E18d63",
  );

  /*
   * The guardian is the one that replaced it as a blocker, and it is a heavier
   * one than it looks. `addAttestor` and `setQuorum` are both onlyGovernance,
   * so a compromised governance key can make itself the sole Stockback attestor
   * and drain the reward vault after ACTIVATION_DELAY. The guardian's cancel is
   * the only brake, and governance can also set the guardian — so an absent
   * guardian is not a missing formality, it is an unopposed path to user money.
   */
  check("no guardian Safe yet (C-08, §588)", PLATFORM_ACCOUNTS.guardianSafe === null);

  let namesGuardian = false;
  try {
    assertProductionConfigReady();
  } catch (error) {
    namesGuardian = error instanceof Error && error.message.includes("guardian Safe");
  }

  check("and the refusal names it", namesGuardian);

  // Governance and treasury are live and verified on-chain. Asserted because
  // the whole point of the deployment guard was that these are not placeholders.
  check("governance is recorded", PLATFORM_ACCOUNTS.governanceSafe !== null);
  check("treasury is recorded", PLATFORM_ACCOUNTS.treasurySafe !== null);
  check(
    "and the deployer is deliberately NOT recorded",
    PLATFORM_ACCOUNTS.deployer === null,
  );
}

console.log(failures === 0 ? "\nconfig: all checks passed" : `\nconfig: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
