/**
 * SENT — shared realtime contract.
 *
 * One schema, consumed by the indexer that produces events, the WebSocket
 * gateway that fans them out, the API that serves snapshots, and the frontend
 * that renders them. §1064 allows exactly one definition of an event shape, and
 * this is it.
 *
 * FRESHNESS IS PART OF THE DATA, NOT METADATA (§87, §211)
 * -------------------------------------------------------
 * §87 requires the UI to distinguish on-chain live, indexed, calculated,
 * estimated, reference and delayed values — and warns that two metrics with
 * different freshness must never look like they updated together.
 *
 * A payload that carries only a number makes that impossible to honour: by the
 * time it reaches a component, where it came from and how old it is are gone. So
 * every value that can be stale carries its own provenance and timestamp, and the
 * types make omitting them a compile error rather than an oversight.
 *
 * The distinction that matters most is `INDEXED` versus `ESTIMATED`. §293 requires
 * estimated Stockback accrual and claimable entitlement to be visibly different
 * things — one is a projection, the other is money the vault will actually pay.
 * Rendering them identically would be the misleading financial UI state §451
 * lists as a release blocker.
 */

/** Where a value came from. Determines how much a user may rely on it. */
export type Provenance =
  /** Read from the chain this moment. The only fully authoritative source (§138). */
  | "ON_CHAIN"
  /** Derived from indexed events. Correct as of `asOfBlock`, never newer. */
  | "INDEXED"
  /** Computed from indexed data by canonical code, e.g. a curve quote. */
  | "CALCULATED"
  /** A projection that is not yet an entitlement — accruing Stockback (§293). */
  | "ESTIMATED"
  /** A launch-time anchor, deliberately not live (§402). */
  | "REFERENCE"
  /** Known to lag: an external price feed with its own cadence. */
  | "DELAYED";

/** Connection and sync state, rendered contextually near the data (§211). */
export type FreshnessState = "LIVE" | "SYNCING" | "DELAYED" | "RECONNECTING" | "STALE";

/**
 * A value plus everything needed to render it honestly.
 *
 * Amounts are strings because they are uint256: JSON numbers lose precision above
 * 2^53, and a silently truncated balance is worse than no balance at all.
 */
export interface Sourced<T = string> {
  readonly value: T;
  readonly provenance: Provenance;
  /** Chain block this reflects. Absent for values with no block basis. */
  readonly asOfBlock?: string;
  /** Unix seconds. When the underlying data was true, not when it was sent. */
  readonly asOf: number;
}

export interface FreshnessEnvelope {
  readonly state: FreshnessState;
  /** Head block the producer knows about. */
  readonly headBlock: string;
  /** Blocks the projection is behind the head. Zero when fully caught up. */
  readonly lagBlocks: number;
  /**
   * Deepest block treated as settled (§335). Stockback finalization reads only
   * below this line, because a reorg above it could invalidate an attested
   * distribution after the attestors have already signed.
   */
  readonly finalizedBlock?: string;
  readonly serverTime: number;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export type Channel =
  | { readonly kind: "market"; readonly market: string }
  | { readonly kind: "explore" }
  | { readonly kind: "account"; readonly account: string }
  | { readonly kind: "platform" };

export function channelKey(channel: Channel): string {
  switch (channel.kind) {
    case "market":
      return `market:${channel.market.toLowerCase()}`;
    case "account":
      return `account:${channel.account.toLowerCase()}`;
    case "explore":
      return "explore";
    case "platform":
      return "platform";
  }
}

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | HelloMessage
  | TradeMessage
  | MarketStateMessage
  | GraduationPendingMessage
  | GraduationMessage
  | StockbackMessage
  | StockbackFundedMessage
  | StockbackEpochClosedMessage
  | StockbackFinalizingMessage
  | StockbackFinalizedMessage
  | StockbackClaimedMessage
  | FreshnessMessage
  | ErrorMessage;

export interface HelloMessage {
  readonly type: "hello";
  readonly sessionId: string;
  readonly chainId: number;
  readonly freshness: FreshnessEnvelope;
  /** Protocol version. A client that does not recognise it must not guess. */
  readonly protocol: 1;
}

export interface TradeMessage {
  readonly type: "trade";
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly trader: string;
  readonly txHash: string;
  readonly blockNumber: string;

  /** Fee basis: gross in for a buy, gross curve out for a sell (§9, §10). */
  readonly notional: string;
  readonly tokens: string;

  /**
   * The full split. §316 forbids aggregating this into one "fee" figure, because
   * doing so hides which part funds the creator and which part returns to
   * holders — and the tape is where most users form that impression.
   */
  readonly coreFee: string;
  readonly creatorFee: string;
  readonly platformFee: string;
  readonly stockback: string;

  readonly priceAfter: string;
  readonly distributedAfter: string;
  readonly timestamp: number;
}

export interface MarketStateMessage {
  readonly type: "market_state";
  readonly market: string;
  readonly status: "PRE_GRAD" | "GRADUATING" | "GRADUATED";
  readonly price: Sourced;
  readonly distributed: Sourced;
  readonly curveCollateral: Sourced;
  readonly graduationProgressBps: Sourced;
  readonly holderCount: Sourced;
  /**
   * Live USD valuation, from the display feed — NOT the launch anchor. §402
   * splits those roles precisely so a display feed can never move a market's
   * economics, and §403 requires the UI to distinguish reference MC from live.
   */
  readonly liveMarketCapUsd?: Sourced;
  readonly referenceMarketCapUsd: Sourced;
}

/**
 * The curve closed; the HyperSwap position is not minted yet (D-016).
 *
 * A separate message rather than a flag on `GraduationMessage`, because the two
 * say opposite things to a UI. This one means STOP — trading here is dead in
 * both directions and every quote is now stale. `GraduationMessage` means GO,
 * to a pool that exists.
 *
 * Folding them into one type with a nullable `pool` would make "is there a venue
 * right now" a field every consumer has to remember to check, on a message whose
 * name says the answer is yes.
 */
export interface GraduationPendingMessage {
  readonly type: "graduation_pending";
  readonly market: string;
  readonly tokenAmount: string;
  readonly quoteAmount: string;
  /** Final curve marginal price; the pool will open here (§15). */
  readonly pg: string;
  readonly blockNumber: string;
  readonly timestamp: number;
}

export interface GraduationMessage {
  readonly type: "graduation";
  readonly market: string;
  readonly pool: string;
  readonly positionId: string;
  readonly tokenAmount: string;
  readonly quoteAmount: string;
  readonly blockNumber: string;
  readonly timestamp: number;
}

export interface StockbackMessage {
  readonly type: "stockback";
  readonly market: string;
  readonly account?: string;
  /** Accruing this epoch. A projection, never a promise (§293). */
  readonly estimatedAccrued?: Sourced;
  /** Committed and activated. This is what the vault will actually pay. */
  readonly claimable?: Sourced;
  readonly epochSequence: string;
  readonly epochEndsAt: number;
}

/*
 * The §368 Stockback stream.
 *
 *   stockback_funded        a trade contributed to the pool
 *   stockback_epoch_closed  an epoch's window ended and was computed
 *   stockback_finalizing    a commitment is on-chain, waiting out §334's delay
 *   stockback_finalized     the root activated; entitlements are now payable
 *   stockback_claimed       the vault paid somebody
 *
 * FIVE TYPES, NOT ONE WITH A STATUS FIELD
 * ---------------------------------------
 * They carry genuinely different payloads and a client reacts to each
 * differently — funding moves a running total, finalizing starts a countdown,
 * finalized turns a button on, claimed removes an amount from the same button.
 * A single message with a `status` discriminant would make every consumer
 * re-derive which fields are populated, and the compiler could not help.
 *
 * `stockback_finalizing` and `stockback_finalized` are separate for the reason
 * §334's delay exists: between them a root is on-chain and pays nothing. A UI
 * that treated submission as finality would show a claim button six hours
 * before the vault honours it.
 */

export interface StockbackFundedMessage {
  readonly type: "stockback_funded";
  readonly market: string;
  /** Contributed by this trade, in the reward asset's normalized units. */
  readonly amount: string;
  readonly totalFunded: string;
  readonly blockNumber: string;
  readonly timestamp: number;
}

export interface StockbackEpochClosedMessage {
  readonly type: "stockback_epoch_closed";
  readonly market: string;
  readonly epochSequence: string;
  /** What the epoch generated, before any attestor has seen it. */
  readonly allocated: string;
  /** Rounding dust rolled into the next epoch (§327). */
  readonly carryForward: string;
  readonly eligibleHolders: number;
  readonly timestamp: number;
}

export interface StockbackFinalizingMessage {
  readonly type: "stockback_finalizing";
  readonly market: string;
  readonly merkleRoot: string;
  readonly totalCumulative: string;
  /** Unix seconds after which activation is permitted (§334). */
  readonly activeAt: number;
  readonly submitter: string;
  readonly blockNumber: string;
  readonly timestamp: number;
}

export interface StockbackFinalizedMessage {
  readonly type: "stockback_finalized";
  readonly market: string;
  readonly merkleRoot: string;
  readonly totalCumulative: string;
  readonly blockNumber: string;
  readonly timestamp: number;
}

export interface StockbackClaimedMessage {
  readonly type: "stockback_claimed";
  readonly market: string;
  readonly account: string;
  /** Transferred by this claim. */
  readonly amount: string;
  /** The account's running total at the vault after it (§336). */
  readonly cumulative: string;
  readonly blockNumber: string;
  readonly timestamp: number;
}

export interface FreshnessMessage {
  readonly type: "freshness";
  readonly freshness: FreshnessEnvelope;
}

export interface ErrorMessage {
  readonly type: "error";
  readonly code: string;
  readonly message: string;
  /** True when the client may retry unchanged. */
  readonly retryable: boolean;
}

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

export interface SubscribeMessage {
  readonly type: "subscribe";
  readonly channels: readonly Channel[];
  /**
   * Last block the client already has. The server replays from here so a
   * reconnect does not silently drop the gap (§239, §63 session resilience).
   * A client that reconnects and simply resumes is a client showing a hole.
   */
  readonly sinceBlock?: string;
}

export interface UnsubscribeMessage {
  readonly type: "unsubscribe";
  readonly channels: readonly Channel[];
}

export interface PingMessage {
  readonly type: "ping";
  readonly nonce: number;
}

// ---------------------------------------------------------------------------
// Freshness derivation
// ---------------------------------------------------------------------------

/** Thresholds in blocks. Tuned once HyperEVM block time is measured (V-15). */
export interface FreshnessThresholds {
  readonly syncingAbove: number;
  readonly delayedAbove: number;
  readonly staleAbove: number;
}

export const DEFAULT_THRESHOLDS: FreshnessThresholds = {
  syncingAbove: 2,
  delayedAbove: 10,
  staleAbove: 60,
};

/**
 * Classify how far behind the projection is.
 *
 * Deliberately errs pessimistic: a system that is unsure reports the WORSE state.
 * Showing DELAYED during a healthy blip costs a user nothing; showing LIVE while
 * serving minute-old prices is the misleading financial UI state §451 blocks a
 * release for.
 */
export function classifyFreshness(
  lagBlocks: number,
  connected: boolean,
  thresholds: FreshnessThresholds = DEFAULT_THRESHOLDS,
): FreshnessState {
  if (!connected) return "RECONNECTING";
  if (lagBlocks > thresholds.staleAbove) return "STALE";
  if (lagBlocks > thresholds.delayedAbove) return "DELAYED";
  if (lagBlocks > thresholds.syncingAbove) return "SYNCING";
  return "LIVE";
}

/**
 * True when two values may be presented as belonging to the same instant.
 *
 * §87: "If two metrics have different freshness, the UI must avoid implying they
 * updated at the same timestamp if that is not true." A shared header timestamp
 * over a mixed-provenance panel is exactly that implication, and this is the
 * check that makes it refusable in code rather than in review.
 */
export function shareTimestamp(a: Sourced<unknown>, b: Sourced<unknown>): boolean {
  if (a.provenance !== b.provenance) return false;
  if (a.asOfBlock !== b.asOfBlock) return false;
  return a.asOf === b.asOf;
}

/**
 * Values a user must never see rendered as equivalent.
 *
 * ESTIMATED accrual is a projection; a claimable entitlement is money the vault
 * will pay (§293). REFERENCE is a launch-time anchor and is not a live price
 * (§402, §403). Both pairs have burned real products.
 */
export function mustBeVisuallyDistinct(a: Provenance, b: Provenance): boolean {
  const pairs: ReadonlyArray<readonly [Provenance, Provenance]> = [
    ["ESTIMATED", "ON_CHAIN"],
    ["ESTIMATED", "INDEXED"],
    ["REFERENCE", "ON_CHAIN"],
    ["REFERENCE", "DELAYED"],
  ];
  return pairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}
