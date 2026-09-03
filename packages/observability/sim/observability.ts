/**
 * SENT — observability audit (§146, §437).
 *
 * Two things are being checked, and only one of them is about formatting.
 *
 * The formatting half is that the Prometheus output parses: a malformed scrape
 * is not a broken chart, it is an alert rule that silently never fires again.
 *
 * The other half is redaction. §437 ends with "no secrets/private keys in
 * logs", and that is the kind of rule that holds right up until someone logs a
 * config object in a hurry. So the guarantee has to be a property of the
 * logger, not of the call sites — and this is where that is proven.
 *
 * Run: pnpm sim:observability
 */

import { createLogger, redact, REDACTED } from "../src/logger.ts";
import { Registry, LATENCY_BUCKETS } from "../src/metrics.ts";

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

/** Captures lines instead of writing them, so they can be asserted on. */
function capture(): { lines: Record<string, unknown>[]; write: (line: string) => void } {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
  };
}

// ---------------------------------------------------------------------------

section("A log line is one JSON object with the §437 fields");

{
  const sink = capture();
  const log = createLogger({ service: "indexer", write: sink.write, now: () => 1_700_000_000_000 });

  log.info("indexed a range", {
    chainId: 999,
    blockNumber: 12_345n,
    marketAddress: "0x2222222222222222222222222222222222222222",
    epochId: 7n,
  });

  const line = sink.lines[0];

  check("the service is named", line?.service === "indexer");
  check("the level is named", line?.level === "info");
  check("the message is a field, not the whole line", line?.msg === "indexed a range");
  check("the timestamp is ISO 8601", typeof line?.ts === "string" && String(line.ts).endsWith("Z"));

  // BigInt has no JSON representation and `JSON.stringify` throws on it. A
  // logger that threw while logging would take down the thing it was observing.
  check("a BigInt block number survives as a string", line?.blockNumber === "12345");
  check("so does an epoch id", line?.epochId === "7");

  check("correlation fields keep their §437 names", line?.marketAddress !== undefined);
}

section("One line per entry, always");

{
  const raw: string[] = [];
  const log = createLogger({ service: "api", write: (l) => raw.push(l) });

  log.error("something broke", { detail: "a\nmulti\nline\nmessage" });

  // A multi-line entry is one every aggregator on earth splits into several,
  // and the tail arrives as an unparseable fragment with no service name on it.
  check("an embedded newline does not split the entry", raw.length === 1);
  check("and the entry itself has no raw newline", !raw[0]?.includes("\n"));
}

section("§437: no secrets, enforced rather than requested");

{
  const sink = capture();
  const log = createLogger({ service: "worker", write: sink.write });

  log.info("configured", {
    rpcUrl: "https://rpc.example",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    apiKey: "sk-live-1234",
    attestorSecret: "hunter2",
  });

  const line = sink.lines[0];

  check("a key named private is redacted", line?.privateKey === REDACTED);
  check("so is an api key", line?.apiKey === REDACTED);
  check("and anything named secret", line?.attestorSecret === REDACTED);
  check("an ordinary URL is left alone", line?.rpcUrl === "https://rpc.example");
}

{
  const sink = capture();
  const log = createLogger({ service: "worker", write: sink.write });

  // The failure this is written against: a config object logged whole, where
  // nobody checked what was in it.
  log.info("startup", {
    config: {
      chainId: 999,
      nested: { deployerKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
    },
  });

  const config = sink.lines[0]?.config as Record<string, unknown>;
  const nested = config?.nested as Record<string, unknown> | undefined;

  check("redaction reaches nested objects", nested?.deployerKey === REDACTED);
  check("and leaves their siblings intact", config?.chainId === 999);
}

{
  // A bare 32-byte hex could be a private key or a block hash. Under a name
  // that says which, it is kept; under one that does not, it goes. Guessing
  // wrong one way costs a debug line; the other way costs a wallet.
  check(
    "a 32-byte value under an unclear name is redacted",
    redact("value", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") ===
      REDACTED,
  );
  check(
    "the same value as a txHash is kept",
    redact("txHash", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") !==
      REDACTED,
  );
  check(
    "and as a merkle root",
    redact("merkleRoot", "0x" + "ab".repeat(32)) !== REDACTED,
  );

  // A 20-byte address is public and is most of what these logs are for.
  check(
    "an address is not a secret",
    redact("account", "0x3333333333333333333333333333333333333333") !==
      REDACTED,
  );
}

section("Levels and children");

{
  const sink = capture();
  const log = createLogger({ service: "api", level: "warn", write: sink.write });

  log.debug("noise");
  log.info("also noise");
  log.warn("kept");
  log.error("kept");

  check("below-threshold lines are dropped", sink.lines.length === 2);
  check("and the kept ones are the severe ones", sink.lines[0]?.level === "warn");
}

{
  const sink = capture();
  const log = createLogger({ service: "api", write: sink.write });

  const request = log.child({ requestId: "req-1", chainId: 999 });
  request.info("handling");
  request.info("done", { status: 200 });

  check("a child carries its context onto every line", sink.lines[0]?.requestId === "req-1");
  check("and merges per-call fields", sink.lines[1]?.status === 200);
  check("without losing the inherited ones", sink.lines[1]?.chainId === 999);
}

section("Metrics render as Prometheus text");

{
  const registry = new Registry();

  registry.counter("sent_trades_indexed_total", "Trades written to the projection.");
  registry.increment("sent_trades_indexed_total", { side: "BUY" });
  registry.increment("sent_trades_indexed_total", { side: "BUY" });
  registry.increment("sent_trades_indexed_total", { side: "SELL" });

  const out = registry.render();

  check("a counter carries HELP", out.includes("# HELP sent_trades_indexed_total"));
  check("and TYPE", out.includes("# TYPE sent_trades_indexed_total counter"));
  check("labelled series are separate", out.includes('sent_trades_indexed_total{side="BUY"} 2'));
  check("and independent", out.includes('sent_trades_indexed_total{side="SELL"} 1'));

  // Every non-comment line must be `name{labels} value`. A malformed scrape is
  // not a broken chart — it is an alert rule that silently never fires again.
  const bad = out
    .split("\n")
    .filter((l) => l !== "" && !l.startsWith("#"))
    .filter((l) => !/^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})? -?[0-9.eE+]+$/.test(l));

  check("every sample line parses", bad.length === 0);
}

{
  const registry = new Registry();
  registry.counter("sent_errors_total", "Errors.");

  // A counter with no observations still exports as zero. "No errors yet" and
  // "this metric does not exist" are different, and an alert rule has to be
  // able to tell them apart.
  check("an untouched counter still exports", registry.render().includes("sent_errors_total 0"));
}

section("A gauge is read at scrape time");

{
  const registry = new Registry();

  let lag = 5;
  registry.gauge("sent_indexer_lag_blocks", "Blocks behind the head.", () => lag);

  check("the gauge reports its current value", registry.render().includes("sent_indexer_lag_blocks 5"));

  lag = 900;

  // The whole point. A gauge holding a stored number needs something to
  // remember to refresh it, and a lag metric that quietly stopped updating
  // reports "no lag" — the exact failure it exists to catch.
  check("and the next scrape sees the new one", registry.render().includes("sent_indexer_lag_blocks 900"));
}

{
  const registry = new Registry();
  registry.gauge("sent_vault_balance", "Reward vault balance.", () => null);

  /*
   * Null means "cannot be determined right now" — a vault balance while RPC is
   * down. The series is omitted rather than reported as zero: a solvency gauge
   * reading zero during an outage is an alert about a problem that does not
   * exist, and one reporting its last known value is a missing alert about one
   * that does.
   */
  const out = registry.render();

  // Checked against the SAMPLE lines, not the whole document: the HELP and TYPE
  // comments mention the name too, and asserting on a raw substring would have
  // passed whether or not a sample was emitted.
  const samples = out.split("\n").filter((l) => l.startsWith("sent_vault_balance"));

  check("an unknown gauge exports no sample", samples.length === 0);
  check("but still declares itself", out.includes("# TYPE sent_vault_balance gauge"));
}

section("Latency is a histogram, not an average");

{
  const registry = new Registry();
  registry.histogram("sent_api_request_seconds", "API latency.");

  registry.observe("sent_api_request_seconds", 0.004, { route: "/markets" });
  registry.observe("sent_api_request_seconds", 0.4, { route: "/markets" });
  registry.observe("sent_api_request_seconds", 30, { route: "/markets" });

  const out = registry.render();

  check("buckets are cumulative", out.includes('le="0.005"'));

  // Labels render in sorted order, so `le` is not last. Matched by pattern
  // rather than by a hand-assembled label string, which would be asserting the
  // ordering rather than the value.
  check(
    "the +Inf bucket holds every observation",
    /le="\+Inf"[^\n]*\} 3/.test(out),
  );
  check("a sum", out.includes("sent_api_request_seconds_sum"));
  check("and a count", /sent_api_request_seconds_count\{route="\/markets"\} 3/.test(out));

  /*
   * The reason it is a histogram. The mean of 4ms, 400ms and 30s is ten
   * seconds, which describes none of the three requests — and the one that
   * mattered is the one a user waited thirty seconds for.
   */
  const fast = out.match(/le="0\.005"[^\n]*\} (\d+)/)?.[1];
  check("the fast request is visible in its own bucket", fast === "1");

  const largest = LATENCY_BUCKETS.at(-1);
  const slowIsOutside = !new RegExp(`le="${largest}"[^\\n]*\\} 3`).test(out);
  check("and the slow one falls outside every bucket but +Inf", slowIsOutside);
}

{
  const registry = new Registry();
  registry.histogram("sent_quote_seconds", "Quote latency.");

  await registry.time("sent_quote_seconds", { side: "BUY" }, async () => "quoted");

  await registry
    .time("sent_quote_seconds", { side: "SELL" }, async () => {
      throw new Error("rpc down");
    })
    .catch(() => undefined);

  const out = registry.render();

  check("a successful call is labelled ok", out.includes('outcome="ok"'));

  // Failures are timed too. A dependency that fails fast and one that hangs for
  // thirty seconds are very different incidents, and excluding errors from the
  // histogram hides the second kind entirely.
  check("and a failing one is timed, not dropped", out.includes('outcome="error"'));
}

section("Label values cannot break the scrape");

{
  const registry = new Registry();
  registry.counter("sent_failures_total", "Failures by reason.");
  registry.increment("sent_failures_total", { reason: 'he said "no"\nand left' });

  const out = registry.render();

  const sampleLines = out.split("\n").filter((l) => l.startsWith("sent_failures_total"));

  // An unescaped newline in a label makes every line after it unparseable, and
  // label values here can carry an error message straight from a dependency.
  check("a label with a newline stays on one line", sampleLines.length === 1);
  check("and its quotes are escaped", sampleLines[0]?.includes('\\"no\\"') === true);
}

console.log(
  failures === 0 ? "\nobservability: all checks passed" : `\nobservability: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
