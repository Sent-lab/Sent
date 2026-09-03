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
  handlePendingGraduations,
  STALLED_AFTER_BLOCKS,
  type DataPort,
  type CandleBar,
  handleCandles,
  CANDLE_INTERVALS,
  type MarketRow,
  type TradeRow,
  type StockbackRow,
  type QuoteResult,
  type PendingGraduationRow,
  type CreatorRow,
  type AccountRow,
  type PlatformStatsRow,
  type EpochsRow,
  type PulseRow,
  handleCreator,
  handleEpochs,
  handleAccount,
  handlePlatformStats,
  handlePulse,
} from "../src/handlers.ts";
import { intentFingerprint, toNormalized, toRawForPayout } from "@sent/sdk";
import { computeFees } from "@sent/economics";

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
  // p0 = 10 quote wei per token. The price below is exactly 2× that, so the
  // reference market cap must come out at $4,000 — a value that can be checked
  // by hand rather than copied from the implementation.
  p0: 10_000_000_000n,
  pg: 250_000_000_000n,
  price: 20_000_000_000n,
  pool: null,
  holderCount: 42,
  tradeCount: 137,
  volume24h: 1_500_000n,
  trades24h: 9,
  metadata: {
    revision: 0n,
    description: "a market for something",
    imageCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    links: [
      { label: "website", url: "https://example.com" },
      // Refused at the render boundary, not on-chain. The chain stores bytes;
      // deciding what is a link is the job of whatever renders one.
      { label: "bad", url: "javascript:alert(1)" },
    ],
  },
  metadataVerified: true,
  launchedAt: 1_700_000_000,
  lastBlock: 900n,
  // Not graduated. The marker must be absent, not placed at zero.
  graduatedAt: null,
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

  now = 1_700_000_500;

  headBlock(): bigint {
    return this.head;
  }
  serverTime(): number {
    return this.now;
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
  candles: CandleBar[] = [
    { bucket: 1_699_999_800, open: 100n, high: 140n, low: 90n, close: 120n, volume: 500n, tradeCount: 3 },
    { bucket: 1_699_999_860, open: 120n, high: 130n, low: 110n, close: 115n, volume: 300n, tradeCount: 2 },
  ];

  listCandles(_market: string, _intervalSeconds: number, limit: number): readonly CandleBar[] {
    return this.candles.slice(0, limit);
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
  creator: CreatorRow | null = {
    launches: [baseMarket],
    feeVault: "0x6666666666666666666666666666666666666666",
    claimable: [
      { asset: "0x5555555555555555555555555555555555555555", symbol: "NVDAx", amount: 250n },
    ],
    accrued: [
      { asset: "0x5555555555555555555555555555555555555555", symbol: "NVDAx", amount: 900n },
    ],
    claims: [
      {
        asset: "0x5555555555555555555555555555555555555555",
        symbol: "NVDAx",
        amount: 650n,
        recipient: "0x4444444444444444444444444444444444444444",
        timestamp: 1_699_999_000,
        blockNumber: 870n,
      },
    ],
    stats: {
      launches: 3,
      graduated: 2,
      totalVolume: 4_200_000n,
      totalTrades: 411,
      totalHolders: 96,
      graduationRatePerMille: 667,
    },
  };
  getCreator(): CreatorRow | null {
    return this.creator;
  }

  account: AccountRow | null = {
    holdings: [
      {
        token: TOKEN,
        market: MARKET,
        name: "Sent Test",
        symbol: "TEST",
        quoteSymbol: "NVDAx",
        quoteDecimals: 6,
        status: "PRE_GRAD",
        balance: 5_000n * 10n ** 18n,
        price: 20_000_000_000n,
        value: 100_000_000_000_000n,
        lastBlock: 900n,
      },
    ],
    stockback: [
      {
        token: TOKEN,
        symbol: "TEST",
        rewardSymbol: "NVDAx",
        quoteDecimals: 6,
        claimable: 456n,
        lifetimeClaimed: 789n,
        merkleRoot: `0x${"ab".repeat(32)}`,
      },
    ],
    claims: [
      { token: TOKEN, symbol: "TEST", amount: 789n, timestamp: 1_700_000_200, blockNumber: 880n },
    ],
    launchCount: 1,
  };

  getAccount(): AccountRow | null {
    return this.account;
  }

  stats: PlatformStatsRow | null = {
    totalLaunches: 12,
    activePreGrad: 9,
    graduated: 3,
    totalVolume: 1_234_000_000_000_000_000_000n,
    windowVolume: 45_000_000_000_000_000_000n,
    creatorFeesEarned: 8_020_000_000_000_000_000n,
    stockbackDistributed: 4_400_000_000_000_000_000n,
    activeQuoteAssets: 5,
    launchableQuoteAssets: 4,
    uniqueTraders: 317,
    windowLaunches: 2,
    windowGraduations: 1,
    windowTrades: 88,
    asOfBlock: 1000n,
  };

  getPlatformStats(): PlatformStatsRow | null {
    return this.stats;
  }

  /** The fake listing holds one market, so a page is one long. */
  countMarkets(): number {
    return this.market ? 1 : 0;
  }

  epochs: EpochsRow | null = {
    epochs: [
      {
        epochSequence: 12n,
        epochId: 12n,
        startTime: 1_036_800,
        endTime: 1_123_200,
        pool: 1_000n,
        allocated: 995n,
        carryForward: 5n,
        eligibleHolders: 3,
        totalWeight: 10_000n,
        merkleRoot: `0x${"ab".repeat(32)}`,
        datasetHash: `0x${"cd".repeat(32)}`,
        totalCumulative: 995n,
        cumulativeRewardFunded: 1_000n,
        holderCount: 3,
        computedAt: 1_700_000_000,
        attested: true,
      },
      {
        epochSequence: 13n,
        epochId: 13n,
        startTime: 1_123_200,
        endTime: 1_209_600,
        pool: 500n,
        allocated: 500n,
        carryForward: 0n,
        eligibleHolders: 3,
        totalWeight: 9_000n,
        merkleRoot: `0x${"ef".repeat(32)}`,
        datasetHash: `0x${"12".repeat(32)}`,
        totalCumulative: 1_495n,
        cumulativeRewardFunded: 1_500n,
        holderCount: 3,
        computedAt: 1_700_086_400,
        attested: false,
      },
    ],
    status: {
      currentEpochId: 14n,
      lastFinalizedSequence: 13n,
      lastFinalizedAt: 1_700_086_400,
      finalizing: false,
      attestedSequence: 12n,
      totalFunded: 1_500n,
      totalClaimed: 400n,
      outstanding: 1_100n,
    },
  };

  getEpochs(): EpochsRow | null {
    return this.epochs;
  }

  pulse: PulseRow | null = {
    heat: [
      {
        quoteAsset: "0x5555555555555555555555555555555555555555",
        quoteSymbol: "NVDAx",
        volume: 900_000n,
        trades: 30,
        activeMarkets: 4,
        totalMarkets: 9,
        launches: 2,
        graduations: 1,
        nearGraduation: 3,
        buyPressureBps: 6_600,
        topMover: MARKET,
        topMoverGainBps: 1_250,
      },
      {
        quoteAsset: "0x7777777777777777777777777777777777777777",
        quoteSymbol: "SPYx",
        volume: 0n,
        trades: 0,
        activeMarkets: 0,
        totalMarkets: 2,
        launches: 0,
        graduations: 0,
        nearGraduation: 0,
        buyPressureBps: 5_000,
        topMover: null,
        topMoverGainBps: 0,
      },
    ],
    presence: {
      activeTraders: 128,
      liveMarkets: 34,
      nearGraduation: 7,
      graduatedInWindow: 2,
      tradesInWindow: 415,
      windowSeconds: 3_600,
    },
  };

  getPulse(): PulseRow | null {
    return this.pulse;
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
  listAwaitingFinalisation(): readonly PendingGraduationRow[] {
    return [];
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
console.log("\n--- 5b. The sell bound comes from canonical fee code ---------------------");

{
  // Regression guard. An earlier version computed the sell net as
  // `grossOut * 9700 / 10000` — a third implementation of the sell fee, after
  // the contract and the SDK, and the one deciding the on-chain minimum that
  // protects the user. A bound derived from a duplicated rate is not a bound.
  const port = new FakePort();
  const tokensIn = 5_000n * 10n ** 18n;

  const result = handleQuote(port, {
    token: TOKEN,
    side: "SELL",
    amount: tokensIn,
    slippageBps: 0n, // no tolerance, so the bound IS the quoted net
    deadline: 9_999_999_999n,
    chainId: 999,
  });

  if (!result.ok) throw new Error("expected success");

  const grossOut = port.quoteSell(MARKET, tokensIn)!.grossOut!;
  const expected = toRawForPayout(
    computeFees("SELL", toNormalized(grossOut, baseMarket.quoteDecimals)).net,
    baseMarket.quoteDecimals,
  );

  check(
    "the sell minimum equals the canonical fee computation exactly",
    result.data.review.minimumReceived === expected,
    `api ${result.data.review.minimumReceived} vs canonical ${expected}`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 5c. Timestamps are real, never zero ---------------------------------");

{
  // §279: a zero here would claim 1970, and a UI rendering "updated Xs ago"
  // would show 56 years rather than failing visibly.
  const port = new FakePort();

  const explore = handleExplore(port, {});
  const detail = handleMarket(port, TOKEN);
  const sb = handleStockback(port, TOKEN, ACCOUNT);

  check("the envelope carries a real server time", explore.freshness.serverTime === port.now);

  if (!detail.ok || !sb.ok) throw new Error("expected success");

  const allSourced = [
    detail.data.price,
    detail.data.distributed,
    detail.data.curveCollateral,
    detail.data.graduationProgressBps,
    detail.data.holderCount,
    sb.data.estimatedAccrued,
    sb.data.claimable,
    sb.data.lifetimeClaimed,
  ];

  check("every value carries the real server time", allSourced.every((v) => v.asOf === port.now));
  check("no value anywhere carries a zero timestamp", allSourced.every((v) => v.asOf > 0));
}


// ---------------------------------------------------------------------------
console.log("\n--- 5d. A crossing order is a complete quote, and says the curve closes --");

{
  // A crossing buy fills on the curve up to the endpoint, closes it, and returns
  // whatever the curve had no supply left to sell (D-016). So the output figure
  // is whole - and the input figure is not, which is the thing this checks: a
  // user who sends 1,000,000 and is charged 333,334 must see the 666,666 coming
  // back before they sign, not discover it in their balance afterwards.
  class CrossingPort extends FakePort {
    override quoteBuy(_m: string, amount: bigint): QuoteResult | null {
      return {
        tokensOut: amount * 10n ** 12n,
        crossesGraduation: true,
        // Two thirds of the input is more than the curve had left to sell.
        refundedQuote: (amount * 2n) / 3n,
        priceImpactBps: 900n,
      };
    }
  }

  const port = new CrossingPort();
  const result = handleQuote(port, {
    token: TOKEN,
    side: "BUY",
    amount: 1_000_000n,
    slippageBps: 100n,
    deadline: 9_999_999_999n,
    chainId: 999,
  });

  if (!result.ok) throw new Error("expected success");
  const review = result.data.review;

  check("a crossing order is flagged as such", review.crossesGraduation === true);

  /*
   * This block used to assert the opposite of what it asserts now, and the
   * change is worth stating rather than quietly rewriting.
   *
   * A crossing order used to fill on the curve and then on HyperSwap, and only
   * the first leg was quotable. So the review carried `estimateIsPartial`,
   * `boundCoversPartialRoute`, a "You receive (curve leg only)" row and a
   * "Slippage protection covers the curve leg only" warning. That was V-19:
   * mitigation, surfaced honestly, and genuinely weaker than §14 asks for.
   *
   * D-016 removed the second leg. The curve leg IS the trade, so the estimate is
   * whole and the bound covers all of it - and the caveats are gone rather than
   * left in place always-false. A warning that can never be true is one users
   * learn to click past, which costs them the warnings that are real.
   */
  check("the receive row is a whole figure, not a partial one", (() => {
    const row = review.rows.find((r) => r.label === "You receive");
    return row !== undefined && row.warning !== true;
  })());
  check(
    "no row hedges about a HyperSwap leg any more",
    review.rows.every((r) => !r.value.includes("HyperSwap leg")),
  );

  // What replaces them: the user is told what comes back, before they sign.
  check("the refund is carried on the review", review.refundedQuote === 666_666n);
  const refundRow = review.rows.find((r) => r.label === "Refunded");
  check("and is shown as its own row", refundRow !== undefined);
  check(
    "and the pay row does not present the whole input as spent",
    review.rows.find((r) => r.label === "You pay")?.value.startsWith("up to") === true,
  );

  // §14: the user must know the venue is about to change under them.
  check(
    "the review says the curve closes",
    review.rows.some((r) => r.value.includes("permanently closed")),
  );

  // A non-crossing order must NOT carry any of these caveats, or they become
  // noise that users learn to ignore.
  const plain = handleQuote(new FakePort(), {
    token: TOKEN,
    side: "BUY",
    amount: 1_000_000n,
    slippageBps: 100n,
    deadline: 9_999_999_999n,
    chainId: 999,
  });
  if (!plain.ok) throw new Error("expected success");

  check("an ordinary order carries no refund", plain.data.review.refundedQuote === undefined);
  check("an ordinary order is not flagged as crossing", plain.data.review.crossesGraduation !== true);
  check(
    "an ordinary order shows a plain receive row",
    plain.data.review.rows.find((r) => r.label === "You receive")?.warning !== true,
  );
  check(
    "and states its cost exactly rather than as an upper bound",
    plain.data.review.rows.find((r) => r.label === "You pay")?.value.startsWith("up to") === false,
  );
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
console.log("\n--- 8b. Graduation timestamp -------------------------------------------");

{
  const port = new FakePort();

  const pre = handleMarket(port, TOKEN);
  check("a pre-graduation market has no graduation timestamp", pre.ok && pre.data.graduatedAt === null);

  // Null and not zero: a chart placing a marker at epoch zero would draw it off
  // the left edge of every series, which reads as a rendering fault rather than
  // as a market that has not graduated.
  check("it is null rather than zero", pre.ok && pre.data.graduatedAt !== 0);

  port.market = { ...baseMarket, status: "GRADUATED", graduatedAt: 1_700_050_000 };

  const post = handleMarket(port, TOKEN);
  check("a graduated market carries the timestamp", post.ok && post.data.graduatedAt === 1_700_050_000);
  check("and reports the status", post.ok && post.data.status === "GRADUATED");
}

// ---------------------------------------------------------------------------
console.log("\n--- 9. Candles ----------------------------------------------------------");

{
  const port = new FakePort();

  const result = handleCandles(port, TOKEN, 60);
  check("a supported interval is served", result.ok);

  if (result.ok) {
    check("bars come back", result.data.candles.length === 2);
    check("oldest first", (result.data.candles[0]?.t ?? 0) < (result.data.candles[1]?.t ?? 0));

    // Every OHLCV value crosses as a decimal string. A JSON number here would be
    // a lossy double for any market priced above 2^53 raw units (§424).
    const bar = result.data.candles[0];
    check(
      "every price is a string, never a number",
      typeof bar?.o === "string" &&
        typeof bar?.h === "string" &&
        typeof bar?.l === "string" &&
        typeof bar?.c === "string" &&
        typeof bar?.v === "string",
    );

    // Without this a client cannot place the decimal point at all, and assuming
    // eighteen renders a six-decimal xStock a trillion times too small.
    check("quote decimals travel with the bars", result.data.quoteDecimals === 6);
    check("the interval is echoed back", result.data.intervalSeconds === 60);

    // A bar's high must bound its open and close, or the chart draws a wick
    // shorter than its own body.
    check(
      "each bar is internally consistent",
      result.data.candles.every(
        (c) =>
          BigInt(c.h) >= BigInt(c.o) &&
          BigInt(c.h) >= BigInt(c.c) &&
          BigInt(c.l) <= BigInt(c.o) &&
          BigInt(c.l) <= BigInt(c.c),
      ),
    );
  }

  // Refused rather than clamped: silently answering a 37-second request with a
  // minute bar would let a client bug ship.
  const odd = handleCandles(port, TOKEN, 37);
  check("an unsupported interval is refused", !odd.ok);
  check("and says so by name", !odd.ok && odd.code === "UNSUPPORTED_INTERVAL");

  const zero = handleCandles(port, TOKEN, 0);
  check("a zero interval is refused", !zero.ok);

  const missing = handleCandles(port, "0xdeadbeef", 60);
  check("an unknown market is not found", !missing.ok && missing.code === "MARKET_NOT_FOUND");

  const huge = handleCandles(port, TOKEN, 60, 100_000);
  check("an oversized limit does not error", huge.ok);

  check(
    "every advertised interval is accepted",
    CANDLE_INTERVALS.every((interval) => handleCandles(port, TOKEN, interval).ok),
  );

  // The envelope travels with candles like every other response (§87).
  check("candles carry their freshness", result.freshness !== undefined);
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
console.log("\n--- 10. §221: the creator cockpit --------------------------------------");

{
  const port = new FakePort();
  const result = handleCreator(port, "0x4444444444444444444444444444444444444444");

  if (!result.ok) throw new Error("expected success");

  check("a creator's launches are listed", result.data.launches.length === 1);
  check(
    "with graduation progress as a sourced value",
    result.data.launches[0]?.graduationProgressBps.value !== undefined,
  );

  /*
   * The reason there are two fee figures at all.
   *
   * `claimable` is what the vault will pay right now; `accrued` is everything
   * ever earned. They differ the moment a creator claims once, and collapsing
   * them into a single number would either hide earnings or put a claim button
   * over an amount the vault refuses to pay.
   */
  check(
    "claimable and accrued are separate figures",
    result.data.claimable[0]?.amount !== result.data.accrued[0]?.amount,
  );
  check("claimable is what the vault would pay", result.data.claimable[0]?.amount === "250");
  check("accrued is the lifetime figure", result.data.accrued[0]?.amount === "900");

  /*
   * The third figure, and the one that makes the other two legible.
   *
   * 900 earned, 250 claimable, 650 withdrawn — the three are consistent, and a
   * creator can see WHY nothing more is payable. Without the history they see
   * "earned 900, claimable 250" and cannot tell a past withdrawal from a
   * failure, which is not a state to leave someone in about their own money.
   */
  check("withdrawals are listed", result.data.claims.length === 1);
  check("with the amount that moved", result.data.claims[0]?.amount === "650");
  check("and where it went", result.data.claims[0]?.recipient !== undefined);
  check(
    "and the three figures reconcile",
    BigInt(result.data.claims[0]?.amount ?? "0") + BigInt(result.data.claimable[0]?.amount ?? "0") ===
      BigInt(result.data.accrued[0]?.amount ?? "0"),
  );

  // Quantities cross the wire as strings. A creator holding more than 2^53 wei
  // of fees is not exotic — that is under a hundredth of an ether.
  check(
    "amounts are serialised as strings",
    typeof result.data.claimable[0]?.amount === "string",
  );

  /*
   * §26's reputation layer: market-driven, with nothing an operator can set.
   *
   * The rate is per mille rather than a float. 2 of 3 as a float is
   * 0.6666666666666666, which every consumer then decides how to round —
   * differently — and §424 keeps ratio quantities out of JS floating point for
   * the same reason it keeps amounts out.
   */
  check("launches are counted", result.data.stats.launches === 3);
  check("graduations too", result.data.stats.graduated === 2);
  check("and the rate is an integer per mille", result.data.stats.graduationRatePerMille === 667);
  check("lifetime volume crosses the wire as a string", result.data.stats.totalVolume === "4200000");
}

{
  const port = new FakePort();
  port.creator = null;

  const empty = handleCreator(port, "0x9999999999999999999999999999999999999999");

  // Everyone starts with nothing. A 404 would make a new creator's first visit
  // look like the page is broken rather than empty.
  check("a creator with no launches is not an error", empty.ok);
  check("and gets an empty cockpit", empty.ok && empty.data.launches.length === 0);

  // Zero, not a division by zero and not "100%". A creator who has launched
  // nothing has not graduated nothing successfully, and either reading would be
  // a claim about a record that does not exist.
  check(
    "with a graduation rate of zero rather than a divide by zero",
    empty.ok && empty.data.stats.graduationRatePerMille === 0,
  );

  const bad = handleCreator(port, "0x123");
  check("a malformed address is refused by name", !bad.ok && bad.code === "INVALID_ADDRESS");
  check("and the refusal still carries freshness", bad.freshness !== undefined);
}

// ---------------------------------------------------------------------------
console.log("\n--- 11. \u00a764/\u00a7347: the account dashboard --------------------------------");

{
  const port = new FakePort();
  const result = handleAccount(port, ACCOUNT);

  if (!result.ok) throw new Error("expected success");

  check("holdings are listed", result.data.holdings.length === 1);
  check("with balances as strings", typeof result.data.holdings[0]?.balance === "string");

  /*
   * A mark, not a valuation, and the provenance says so.
   *
   * Selling the whole position walks DOWN the curve and returns less. CALCULATED
   * rather than INDEXED is the difference between "this is what the projection
   * holds" and "this is arithmetic over what the projection holds" — \u00a787 requires
   * that distinction to survive the wire, and this is the value where confusing
   * the two would cost a user money.
   */
  check(
    "portfolio value is CALCULATED, not INDEXED",
    result.data.portfolioValue.provenance === "CALCULATED",
  );
  check("and sums the holdings", result.data.portfolioValue.value === "100000000000000");

  // \u00a7293 again, one level up: the cross-market total must not include anything
  // unattested, or a "claim everything" button spends a number the vault refuses.
  check("the claimable total is the attested sum", result.data.totalClaimable === "456");
  check("lifetime claimed is separate from it", result.data.stockback[0]?.lifetimeClaimed === "789");
  check("the claim history is carried", result.data.claims.length === 1);
  check("launches are counted, not listed", result.data.launchCount === 1);
}

{
  const port = new FakePort();
  port.account = null;

  const empty = handleAccount(port, ACCOUNT);
  check("an account with nothing is not an error", empty.ok);
  check("and its portfolio value is zero, not absent", empty.ok && empty.data.portfolioValue.value === "0");

  const bad = handleAccount(port, "0xnope");
  check("a malformed address is refused by name", !bad.ok && bad.code === "INVALID_ADDRESS");
}

// ---------------------------------------------------------------------------
console.log("\n--- 12. \u00a7166/\u00a7168: platform stats ----------------------------------------");

{
  const port = new FakePort();
  const result = handlePlatformStats(port);

  if (!result.ok) throw new Error("expected success");

  check("launches are reported", result.data.totalLaunches.value === "12");

  /*
   * \u00a7168 forbids vanity metrics, and the first way a metric becomes vanity is
   * being shown without saying what produced it. A COUNT over indexed rows and a
   * SUM over those same rows are not the same kind of claim.
   */
  check("a count is INDEXED", result.data.totalLaunches.provenance === "INDEXED");
  check("a sum is CALCULATED", result.data.totalVolume.provenance === "CALCULATED");

  check("the window is stated rather than implied", result.data.windowSeconds === 86_400);
  check("volume crosses the wire as a string", typeof result.data.totalVolume.value === "string");

  // Distributed means PAID. Counting money still in the vault would be exactly
  // the flattering-but-false figure \u00a7168 rules out.
  check(
    "stockback distributed is what was paid out",
    result.data.stockbackDistributed.value === "4400000000000000000",
  );
}

{
  const port = new FakePort();
  port.stats = null;

  const down = handlePlatformStats(port);
  // A stats block that cannot be computed says so. Serving the last values as
  // if they were current is how a status page lies during an incident.
  check("unavailable stats are a named refusal", !down.ok && down.code === "STATS_UNAVAILABLE");
  check("and still carry freshness", down.freshness !== undefined);
}

// ---------------------------------------------------------------------------
console.log("\n--- 13. \u00a795.21: search and paging ---------------------------------------");

{
  const port = new FakePort();

  const page = handleExplore(port, { limit: 10 });
  if (!page.ok) throw new Error("expected success");

  check("a listing is a page, not a bare array", Array.isArray(page.data.items));
  check("carrying its total", page.data.total === 1);
  check("and its offset", page.data.offset === 0);

  // Stated rather than inferred from `items.length === limit`, which is wrong
  // exactly once: on the page that ends flush with the limit, where it promises
  // another page that does not exist.
  check("hasMore is false when the page holds everything", page.data.hasMore === false);

  const sorted = handleExplore(port, { sort: "TRENDING", limit: 10 });
  check("§50's trending sort is accepted", sorted.ok);

  const graduated = handleExplore(port, { sort: "RECENTLY_GRADUATED", limit: 10 });
  check("so is recently graduated", graduated.ok);

  const bogus = handleExplore(port, { sort: "MOONING" as never, limit: 10 });
  check("an unknown sort is refused by name", !bogus.ok && bogus.code === "UNSUPPORTED_SORT");

  /*
   * A near-address is refused rather than searched as text.
   *
   * A truncated paste matches nothing exactly and would fall through to a
   * trigram scan over names — quietly returning a DIFFERENT market, which is
   * the one wrong answer a search box must never give.
   */
  const truncated = handleExplore(port, { query: "0x1111111111111111111111111111111111111", limit: 10 });
  check("a truncated address is refused", !truncated.ok && truncated.code === "MALFORMED_ADDRESS");

  const text = handleExplore(port, { query: "TEST", limit: 10 });
  check("a ticker query is accepted", text.ok);
}

// ---------------------------------------------------------------------------
console.log("\n--- 14. \u00a7333/\u00a7367: distribution transparency -------------------------");

{
  const port = new FakePort();
  const result = handleEpochs(port, TOKEN);

  if (!result.ok) throw new Error("expected success");

  check("epochs are listed", result.data.epochs.length === 2);

  /*
   * \u00a7333's dataset exists so someone who does not trust this service can
   * re-derive the root. That needs the INPUTS, not just the root: the pool, the
   * eligible holder count and the total weight are what make the total
   * reproducible. A response carrying only a root is asking to be believed.
   */
  const newest = result.data.epochs[0];
  check("with the pool they were paid from", newest?.pool === "1000");
  check("the eligible holder count", newest?.eligibleHolders === 3);
  check("and the total weight", newest?.totalWeight === "10000");
  check("plus the dataset hash", newest?.datasetHash?.startsWith("0xcdcd") === true);

  // Dust is holder money the commitment deliberately does not pay out, so a
  // number that is withheld on purpose has to be visible (\u00a7327).
  check("carry-forward dust is shown", newest?.carryForward === "5");

  /*
   * The line \u00a7293 draws, one epoch at a time.
   *
   * The newer epoch is computed and unattested; the older one is active. Both
   * are real arithmetic and only one of them pays anything.
   */
  check("an attested epoch says so", newest?.attested === true);
  check("and an unattested one says so too", result.data.epochs[1]?.attested === false);

  // \u00a7367's three states, from two independent facts: whether a root is pending
  // and whether one is active.
  check("the status reports FINALIZED", result.data.status.state === "FINALIZED");
  check("naming the attested sequence", result.data.status.attestedSequence === "12");

  /*
   * The current epoch comes from the CLOCK. \u00a7329 makes it a fixed window that
   * exists whether or not anything happened in it — taking it from the newest
   * dataset would report the last epoch with activity as the current one, which
   * on a quiet market could be days ago.
   */
  check("the current epoch is ahead of the last finalized", result.data.status.currentEpochId === "14");

  // Owed, not payable. Money funded into an epoch nobody has attested belongs
  // to holders and can be claimed by no one; collapsing the two would report a
  // solvency problem that does not exist.
  check("outstanding is funded minus claimed", result.data.status.outstanding === "1100");
}

{
  const port = new FakePort();
  port.epochs = null;

  const first = handleEpochs(port, TOKEN);
  // Every market looks like this on its first day.
  check("a market with no finalized epoch is not an error", first.ok);
  check("and reports OPEN", first.ok && first.data.status.state === "OPEN");

  port.market = null;
  const missing = handleEpochs(port, TOKEN);
  check("an unknown market is still a named 404", !missing.ok && missing.code === "MARKET_NOT_FOUND");
}

{
  const port = new FakePort();
  port.epochs = {
    epochs: [],
    status: {
      currentEpochId: 14n,
      lastFinalizedSequence: 13n,
      lastFinalizedAt: 1_700_086_400,
      finalizing: true,
      attestedSequence: 12n,
      totalFunded: 1_500n,
      totalClaimed: 400n,
      outstanding: 1_100n,
    },
  };

  // A pending root outranks an active one in the state label: \u00a7334's delay is
  // running, and that is the fact a reader needs to see.
  const result = handleEpochs(port, TOKEN);
  check("a pending commitment reports FINALIZING", result.ok && result.data.status.state === "FINALIZING");
}

// ---------------------------------------------------------------------------
console.log("\n--- 15. §21/§403: what a bot and a terminal need ---------------------");

{
  const port = new FakePort();
  const detail = handleMarket(port, TOKEN);

  if (!detail.ok) throw new Error("expected success");

  /*
   * §21's marketState is meant to expose enough for a bot to price locally
   * between blocks. Without p0 and qG a caller can only ask this API for every
   * quote, which makes the API a dependency of something that should be able to
   * run without it.
   */
  check("the curve parameters are served", detail.data.curve.p0 === "10000000000");
  check("including the graduation price", detail.data.curve.pg === "250000000000");
  check("and the fixed supply", detail.data.curve.totalSupply === "1000000000000000000000000000");

  // §21 graduatedPool. Null before graduation rather than absent, so a client
  // does not have to tell "no pool yet" apart from "field not implemented".
  check("the pool is null before graduation", detail.data.pool === null);

  /*
   * §403's pair.
   *
   * price is exactly 2× p0, so the reference cap must be exactly 2× the $2,000
   * anchor. Checked by hand rather than against the implementation — that is the
   * difference between testing the number and restating it.
   */
  check(
    "reference market cap follows the launch anchor",
    detail.data.referenceMarketCapUsd.value === "4000000000000000000000",
  );
  check(
    "and is CALCULATED, since no oracle produced it",
    detail.data.referenceMarketCapUsd.provenance === "CALCULATED",
  );

  /*
   * ABSENT, not zero. The live figure needs the xStock/USD display feed, which
   * is unverified (V-11). §279 forbids a placeholder in its place, and a zero
   * renders as a market worth nothing rather than as a number nobody has.
   */
  check("the live USD cap is absent, not zero", detail.data.liveMarketCapUsd === undefined);

  check("24h volume is served", detail.data.volume24h.value === "1500000");
  check("with its trade count", detail.data.trades24h.value === "9");
}

// ---------------------------------------------------------------------------
console.log("\n--- 16. §52/§53: market heat and pulse -----------------------------------");

{
  const port = new FakePort();
  const result = handlePulse(port);

  if (!result.ok) throw new Error("expected success");

  check("ecosystems are listed", result.data.ecosystems.length === 2);
  check("with the verified symbol, not the token's own", result.data.ecosystems[0]?.quoteSymbol === "NVDAx");

  /*
   * Buy pressure is by NOTIONAL, not by count.
   *
   * One large sell against fifty dust buys is selling pressure, and a count
   * would render it as the opposite — a heat map that says the market is
   * climbing while it falls.
   */
  check("buy pressure is in basis points of volume", result.data.ecosystems[0]?.buyPressureBps === 6_600);

  /*
   * 5000, not 0, for an ecosystem with no volume.
   *
   * Zero reads as "everything was a sell", which is a claim about a period in
   * which nothing happened at all.
   */
  check("a silent ecosystem is balanced, not bearish", result.data.ecosystems[1]?.buyPressureBps === 5_000);
  check("and has no top mover rather than a zero one", result.data.ecosystems[1]?.topMover === null);

  /*
   * Nothing is normalised to a 0-1 heat value.
   *
   * Ecosystems differ by orders of magnitude, so any normalisation is a
   * presentation choice, and §52's warning about a noisy colour heatmap is a
   * warning about that mapping. Raw comparable figures go out; the view decides
   * what hot looks like, visibly.
   */
  check("volume is raw, not scaled", result.data.ecosystems[0]?.volume === "900000");

  // §53: honest about the metric. These are traders who TRADED in the window,
  // not open sockets — counting connections would be a different number wearing
  // the same label, moved by any bot with a reconnect loop.
  check("presence counts traders", result.data.presence.activeTraders === 128);
  check(
    "and states its window so nothing reads as 'right now'",
    result.data.presence.windowSeconds === 3_600,
  );

  // The two windows differ on purpose, and both are returned.
  check("heat covers a longer window than presence", result.data.heatWindowSeconds > result.data.presence.windowSeconds);
}

{
  const port = new FakePort();
  port.pulse = null;

  const down = handlePulse(port);
  // A pulse that cannot be computed says so rather than rendering an empty,
  // confident-looking screen that claims the platform is dead.
  check("an unavailable pulse is a named refusal", !down.ok && down.code === "PULSE_UNAVAILABLE");
  check("and still carries freshness", down.freshness !== undefined);
}

// ---------------------------------------------------------------------------
console.log("\n--- 17. §95.20: on-chain metadata ----------------------------------------");

{
  const port = new FakePort();
  const detail = handleMarket(port, TOKEN);

  if (!detail.ok) throw new Error("expected success");

  const md = detail.data.metadata;
  check("metadata is served", md !== null);
  check("with the description as written", md?.description === "a market for something");
  check("and the image CID, not a gateway URL", md?.imageCid.startsWith("bafy") === true);

  /*
   * The scheme filter, at the render boundary.
   *
   * The chain deliberately does not validate URLs — a `javascript:` URL is
   * inert in calldata and dangerous only where something renders it, and
   * on-chain validation would charge every creator gas for a guarantee the
   * client still has to enforce. So this is where it happens.
   */
  check("an unsafe scheme is filtered out", md?.links.length === 1);
  check("and the drop is counted, not hidden", md?.unsafeLinksRemoved === 1);
  check("the safe link survives", md?.links[0]?.url === "https://example.com");

  // §412: the commitment was always in the address; the content is what was
  // missing. Publishing it is what makes the check possible at all.
  check("the launch content is verified against the address", md?.verified === true);
}

{
  const port = new FakePort();

  /*
   * Null, not false.
   *
   * "We have not checked" and "this does not match" are opposite claims about a
   * creator. A UI rendering the first as the second would accuse people who did
   * nothing wrong — which is worse than showing no badge at all.
   */
  port.market = { ...baseMarket, metadataVerified: null };

  const detail = handleMarket(port, TOKEN);
  check("an unverifiable commitment is null, not false", detail.ok && detail.data.metadata?.verified === null);
}

{
  const port = new FakePort();
  port.market = { ...baseMarket, metadata: null, metadataVerified: null };

  const detail = handleMarket(port, TOKEN);

  // A market launched before metadata existed, and one launched with a blank
  // description, are different things. Only the second should render an empty
  // description field.
  check("a market with no metadata reports null", detail.ok && detail.data.metadata === null);
}

{
  const port = new FakePort();
  const page = handleExplore(port, { limit: 10 });

  if (!page.ok) throw new Error("expected success");

  // A card is mostly an image and a line of text. Fetching them per card would
  // be twenty-five extra requests on one explore page.
  check("explore cards carry metadata too", page.data.items[0]?.metadata !== null);
  check("filtered the same way", page.data.items[0]?.metadata?.unsafeLinksRemoved === 1);
}

// ---------------------------------------------------------------------------
console.log("\n--- 18. A market between its two graduation transactions ----------------");

{
  /*
   * D-016 introduced a state where a market has NO venue: the curve is closed
   * and the pool does not exist. Everything an API says about such a market has
   * to account for that, and the failure mode is a refusal that sounds helpful
   * while sending the user somewhere that is not there.
   */
  class PendingPort extends FakePort {
    override getMarket(token: string): MarketRow | null {
      const row = super.getMarket(token);
      return row === null ? null : { ...row, status: "GRADUATING" };
    }
    override listAwaitingFinalisation(): readonly PendingGraduationRow[] {
      return [
        {
          market: MARKET,
          token: TOKEN,
          symbol: "TEST",
          graduatingAtBlock: 1_000n,
          waitingBlocks: 12n,
        },
        {
          market: MARKET,
          token: TOKEN,
          symbol: "STUCK",
          graduatingAtBlock: 10n,
          waitingBlocks: STALLED_AFTER_BLOCKS + 1n,
        },
      ];
    }
  }

  const port = new PendingPort();

  const quoted = handleQuote(port, {
    token: TOKEN,
    side: "BUY",
    amount: 1_000_000n,
    slippageBps: 100n,
    deadline: 9_999_999_999n,
    chainId: 999,
  });

  check("a quote against a closed curve is refused", quoted.ok === false);

  if (!quoted.ok) {
    /*
     * Its own code, and this is the point of the test. Falling through to
     * MARKET_GRADUATED would tell the user to trade on a HyperSwap pool that
     * has not been created - a refusal that names a venue which is not there is
     * worse than one that says nothing, because the user goes looking for it.
     */
    check(
      "with its own code, not MARKET_GRADUATED",
      quoted.code === "MARKET_AWAITING_FINALISATION",
    );
    check("marked retryable, because it genuinely will be", quoted.retryable === true);
    check(
      "and the message does not send the user to a pool that does not exist",
      !quoted.message.includes("HyperSwap pool"),
    );
  }

  const pending = handlePendingGraduations(port);
  if (!pending.ok) throw new Error("expected success");

  check("the pending list is served", pending.data.pending.length === 2);
  check(
    "with the wait in blocks, which is what a threshold is set against",
    pending.data.pending[0]?.waitingBlocks === "12",
  );
  check("and one of them is flagged as stalled", pending.data.stalled === true);

  // An empty list is the healthy answer, not an absence. A keeper that saw a
  // 404 would treat a routing mistake and a quiet protocol identically.
  const quiet = handlePendingGraduations(new FakePort());
  if (!quiet.ok) throw new Error("expected success");
  check("nothing pending still answers", quiet.data.pending.length === 0);
  check("and is not stalled", quiet.data.stalled === false);
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
