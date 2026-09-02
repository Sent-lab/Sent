/**
 * SENT — API handler audit.
 *
 * The API is the layer users actually meet, so its failures are the ones they
 * experience as lies: a stale price served as current, a projection rendered as
 * an entitlement, a quote whose numbers do not match the transaction.
 *
 * Run: pnpm sim:api
 */

import {
  handleExplore,
  handleMarket,
  handleTape,
  handleQuote,
  handleStockback,
  handleHealth,
  type DataPort,
  type MarketRow,
  type TradeRow,
  type StockbackRow,
  type QuoteResult,
} from "../src/handlers.ts";
import { intentFingerprint } from "../../../packages/sdk/src/intent.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TOKEN = "0x1111111111111111111111111111111111111111";
const MARKET = "0x2222222222222222222222222222222222222222";
const ACCOUNT = "0x3333333333333333333333333333333333333333";

const baseMarket: MarketRow = {
  token: TOKEN,
  market: MARKET,
  creator: "0x4444444444444444444444444444444444444444",
  quoteAsset: "0x5555555555555555555555555555555555555555",
  quoteDecimals: 6,
  quoteSymbol: "NVDAx",
  name: "Sent Test",
  symbol: "TEST",
  status: "PRE_GRAD",
  distributed: 100_000_000n * 10n ** 18n,
  curveCollateral: 50n * 10n ** 18n,
  qG: (1_000_000_000n * 10n ** 18n * 50n) / 76n,
  price: 20_000_000_000n,
  holderCount: 42,
  tradeCount: 137,
  launchedAt: 1_700_000_000,
  lastBlock: 900n,
};

class FakePort implements DataPort {
  head = 1000n;
  indexed = 1000n;
  connected = true;
  market: MarketRow | null = baseMarket;
  stockback: StockbackRow | null = {
    estimatedAccrued: 123n,
    claimable: 456n,
    lifetimeClaimed: 789n,
    epochSequence: 12n,
    epochEndsAt: 1_700_086_400,
  };

  headBlock(): bigint {
    return this.head;
  }
  indexedBlock(): bigint {
    return this.indexed;
  }
  finalizedBlock(): bigint | undefined {
    return this.indexed - 20n;
  }
  chainConnected(): boolean {
    return this.connected;
  }
  listMarkets(): readonly MarketRow[] {
    return this.market ? [this.market] : [];
  }
  getMarket(token: string): MarketRow | null {
    return this.market && this.market.token.toLowerCase() === token ? this.market : null;
  }
  listTrades(): readonly TradeRow[] {
    return [
      {
        txHash: "0xabc",
        blockNumber: 900n,
        side: "BUY",
        trader: ACCOUNT,
        notional: 1_000_000n,
        tokens: 5_000n * 10n ** 18n,
        coreFee: 10_000n,
        creatorFee: 6_500n,
        platformFee: 3_500n,
        stockback: 10_000n,
        priceAfter: 20_000_000_000n,
        timestamp: 1_700_000_100,
      },
    ];
  }
  getStockback(): StockbackRow | null {
    return this.stockback;
  }
  quoteBuy(_m: string, amount: bigint): QuoteResult | null {
    return {
      tokensOut: amount * 10n ** 12n,
      crossesGraduation: false,
      priceImpactBps: 42n,
    };
  }
  quoteSell(_m: string, tokensIn: bigint): QuoteResult | null {
    return {
      grossOut: tokensIn / 10n ** 12n,
      crossesGraduation: false,
      priceImpactBps: 17n,
    };
  }
}

console.log("\nSENT — API Handler Audit (§87, §293, §316, §694)");
console.log("=".repeat(74));

// ---------------------------------------------------------------------------
console.log("\n--- 1. Every response carries its freshness ----------------------------");

{
  const port = new FakePort();

  const explore = handleExplore(port, {});
  const market = handleMarket(port, TOKEN);
  const tape = handleTape(port, TOKEN);
  const health = handleHealth(port);

  check(
    "every response carries a freshness envelope",
    [explore, market, tape, health].every((r) => r.freshness !== undefined),
  );
  check("a caught-up service reports LIVE", explore.freshness.state === "LIVE");

  port.indexed = 900n; // fall 100 blocks behind
  check("a lagging service does not report LIVE", handleExplore(port, {}).freshness.state !== "LIVE");

  port.connected = false;
  check(
    "a disconnected service reports RECONNECTING",
    handleExplore(port, {}).freshness.state === "RECONNECTING",
  );
}

{
  const port = new FakePort();
  port.market = null;

  const missing = handleMarket(port, TOKEN);
  check("an error response still carries freshness", missing.freshness !== undefined);
  check(
    "a missing market is a named error, not an empty success",
    !missing.ok && missing.code === "MARKET_NOT_FOUND",
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 2. §87: provenance survives the wire -------------------------------");

{
  const port = new FakePort();
  const detail = handleMarket(port, TOKEN);

  if (!detail.ok) throw new Error("expected success");

  check("an indexed value is labelled INDEXED", detail.data.price.provenance === "INDEXED");
  check(
    "a derived value is labelled CALCULATED, not INDEXED",
    detail.data.graduationProgressBps.provenance === "CALCULATED",
  );
  check("values carry the block they reflect", detail.data.price.asOfBlock === "900");
}

// ---------------------------------------------------------------------------
console.log("\n--- 3. §293: an estimate is never an entitlement -------------------------");

{
  const port = new FakePort();
  const sb = handleStockback(port, TOKEN, ACCOUNT);

  if (!sb.ok) throw new Error("expected success");

  check("estimated accrual is a separate field", sb.data.estimatedAccrued !== undefined);
  check("claimable is a separate field", sb.data.claimable !== undefined);

  // The distinction that matters: one is a projection, the other is money the
  // vault will actually pay. Merged into one number, a user cannot tell.
  check(
    "estimated accrual is labelled ESTIMATED",
    sb.data.estimatedAccrued.provenance === "ESTIMATED",
  );
  check("claimable is NOT labelled ESTIMATED", sb.data.claimable.provenance !== "ESTIMATED");
  check(
    "the two carry different provenance",
    sb.data.estimatedAccrued.provenance !== sb.data.claimable.provenance,
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 4. §316: the fee split is served in full ----------------------------");

{
  const port = new FakePort();
  const tape = handleTape(port, TOKEN);

  if (!tape.ok) throw new Error("expected success");
  const row = tape.data[0]!;

  check("the core fee is present", row.coreFee === "10000");
  check("the creator share is present", row.creatorFee === "6500");
  check("the platform share is present", row.platformFee === "3500");
  check("the Stockback contribution is present", row.stockback === "10000");

  // Aggregation is what hides who is paid what, and the tape is where most users
  // form that impression.
  check(
    "creator and platform are not collapsed into the core fee alone",
    row.creatorFee !== row.coreFee && row.platformFee !== row.coreFee,
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 5. §694: a quote is a signable intent, not a number ------------------");

{
  const port = new FakePort();

  const result = handleQuote(port, {
    token: TOKEN,
    side: "BUY",
    amount: 1_000_000n,
    slippageBps: 100n,
    deadline: 9_999_999_999n,
    chainId: 999,
  });

  if (!result.ok) throw new Error("expected success");
  const intent = result.data;

  check("the quote returns a complete intent", intent.kind === "BUY" && intent.data.length > 2);
  check("it targets the market contract", intent.to === MARKET);
  check("it carries the chain id", intent.chainId === 999);
  check("it carries a deadline", intent.deadline === 9_999_999_999n);
  check("it carries a review the UI can render", intent.review.rows.length > 0);
  check("the review shows the fee breakdown", intent.review.fees !== undefined);
  check("a minimum is bound into the review", intent.review.minimumReceived !== undefined);

  // Slippage must actually reduce the bound, not merely be echoed back.
  const tighter = handleQuote(port, {
    token: TOKEN,
    side: "BUY",
    amount: 1_000_000n,
    slippageBps: 10n,
    deadline: 9_999_999_999n,
    chainId: 999,
  });
  if (!tighter.ok) throw new Error("expected success");

  check(
    "a tighter slippage produces a higher minimum",
    (tighter.data.review.minimumReceived ?? 0n) > (intent.review.minimumReceived ?? 0n),
  );
  check(
    "and a different fingerprint, so the change is detectable",
    intentFingerprint(tighter.data) !== intentFingerprint(intent),
  );
}

{
  const port = new FakePort();

  const sell = handleQuote(port, {
    token: TOKEN,
    side: "SELL",
    amount: 5_000n * 10n ** 18n,
    slippageBps: 100n,
    deadline: 9_999_999_999n,
    chainId: 999,
  });

  if (!sell.ok) throw new Error("expected success");
  check("a sell quote returns a SELL intent", sell.data.kind === "SELL");

  // The sell fee basis is the curve's gross output (§10). A review quoting the
  // 2% buy rate on a sell would understate the cost by a third.
  const stockbackRow = sell.data.review.rows.find((r) => r.label.startsWith("Stockback"));
  check("the sell review quotes the 2% Stockback rate", stockbackRow?.label.includes("2%") === true);
}

// ---------------------------------------------------------------------------
console.log("\n--- 6. Refusals are explicit -------------------------------------------");

{
  const port = new FakePort();

  const zero = handleQuote(port, {
    token: TOKEN,
    side: "BUY",
    amount: 0n,
    slippageBps: 100n,
    deadline: 1n,
    chainId: 999,
  });
  check("a zero amount is refused", !zero.ok && zero.code === "INVALID_AMOUNT");

  const wildSlippage = handleQuote(port, {
    token: TOKEN,
    side: "BUY",
    amount: 1_000n,
    slippageBps: 9_999n,
    deadline: 1n,
    chainId: 999,
  });
  check("an absurd slippage is refused", !wildSlippage.ok && wildSlippage.code === "INVALID_SLIPPAGE");

  // §19: after graduation the curve is permanently closed. Quoting it would offer
  // a trade that cannot execute.
  port.market = { ...baseMarket, status: "GRADUATED" };
  const graduated = handleQuote(port, {
    token: TOKEN,
    side: "BUY",
    amount: 1_000n,
    slippageBps: 100n,
    deadline: 1n,
    chainId: 999,
  });
  check(
    "a graduated market refuses a curve quote and says where to trade",
    !graduated.ok && graduated.code === "MARKET_GRADUATED",
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 7. Health tells the truth about itself ------------------------------");

{
  const port = new FakePort();
  const healthy = handleHealth(port);
  check("a caught-up service reports itself serving", healthy.data.serving);

  port.indexed = 500n; // 500 blocks behind
  const stale = handleHealth(port);
  check("a badly lagging service reports NOT serving", !stale.data.serving);
  check("and still answers rather than failing", stale.ok);
  check("the lag is reported numerically", stale.data.lagBlocks === 500);

  port.connected = false;
  check("a disconnected service reports NOT serving", !handleHealth(port).data.serving);
}

// ---------------------------------------------------------------------------
console.log("\n--- 8. Pagination is bounded --------------------------------------------");

{
  const port = new FakePort();
  const huge = handleExplore(port, { limit: 100_000 });
  check("an oversized limit does not error", huge.ok);

  const tape = handleTape(port, TOKEN, 100_000);
  check("an oversized tape limit does not error", tape.ok);

  const zero = handleExplore(port, { limit: 0 });
  check("a zero limit does not error", zero.ok);
}

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(74));
if (failures.length === 0) {
  console.log(`API AUDIT: PASS — ${passed} checks green.`);
  console.log("");
  console.log("A quote is a signable intent, not a number: the numbers a user reads");
  console.log("and the calldata they sign come from the same call.");
} else {
  console.log(`API AUDIT: FAIL — ${failures.length} of ${passed + failures.length} failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
console.log("");
