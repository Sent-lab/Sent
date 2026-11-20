/**
 * SENT — canonical chain and address configuration.
 *
 * Masterplan §140 (configuration registry), §699/§700 (frontend contract address
 * integrity, config artifact integrity), §1064 (production address config has
 * exactly one canonical source — this package).
 *
 * HARD RULE (§421 DO NOT GUESS): an address only appears in this file once its
 * VERIFY-ledger row is VERIFIED with primary evidence. Unverified values are
 * `null` and every consumer must fail loudly rather than fall back to a default.
 * A mock or placeholder must never reach a production build (§279).
 */

/** HyperEVM mainnet. VERIFIED Day 1 (V-01, PRIMARY: eth_chainId -> 0x3e7). */
export const HYPEREVM_CHAIN_ID = 999 as const;

/**
 * SPYx and NVDAx quote-route candidates verified on HyperEVM (xStocks API +
 * live reads, V-02/V-03). The V2 wrappers are official Core-linked ERC-20s;
 * each raw issuer token is the underlying for SENT's immutable
 * WrappedXStock implementation. These constants do not mean either route has
 * passed SENT's registry gates or is enabled for launches.
 */
export const SPYX_RAW_ASSET = "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48" as const;
export const SPYX_V2_WRAPPER = "0xe7e553cd128f0011777323a0b44a7b96ea1cb540" as const;
/** NVIDIA xStock issuer token and official HyperEVM V2 wrapper (V-02). */
export const NVDAX_RAW_ASSET = "0xc845b2894dbddd03858fd2d643b4ef725fe0849d" as const;
export const NVDAX_V2_WRAPPER = "0xa8ddb5cd96b5222afe198316e9a57caa642850d5" as const;

/** Issuer-listed Chainlink v10 streams for the supported HyperEVM xStocks. */
export const TOKENIZED_ASSET_V10_FEEDS = {
  spyx: {
    underlying: SPYX_RAW_ASSET,
    feedId: "0x000ac6ba1b453a15c1fe9dcd82265ca47bcd04e7b3667de1623617c45cef2a77",
  },
  nvdax: {
    underlying: NVDAX_RAW_ASSET,
    feedId: "0x000a37a55df2ef907d8fa06af6632bc16da58a62b68be2e1994efaa037a0918a",
  },
} as const;

/**
 * Wrapped native gas token (WHYPE).
 * VERIFIED Day 1 (V-01, PRIMARY: read as WETH9() from the HyperSwap V3 router).
 */
export const WHYPE_ADDRESS = "0x5555555555555555555555555555555555555555" as const;

/**
 * MVP quote asset: HyperEVM's canonical wrapped native token. Markets still
 * hold an ERC-20 quote asset, so users wrap HYPE to WHYPE before trading.
 * Verified by live HyperEVM reads (symbol=WHYPE, decimals=18, code present).
 */
export const BASE_QUOTE_ASSETS = [
  {
    symbol: "WHYPE",
    erc20: WHYPE_ADDRESS,
    decimals: 18,
    nativeSymbol: "HYPE",
    verified: true,
  },
] as const;

/**
 * Public RPC (light-use only: 100 JSON-RPC requests/minute per IP, 50-block
 * eth_getLogs ranges, no historical state). Redundant independent providers
 * are required before production:
 * §406 needs independently deployed indexer instances, and §542 warns about
 * official-RPC limitations. Archive depth and sustained workload remain open (V-15).
 */
export const HYPEREVM_PUBLIC_RPC = "https://rpc.hyperliquid.xyz/evm" as const;

/**
 * HyperCore <-> HyperEVM system address derivation (OFFICIAL, V-03).
 *
 * First byte 0x20, remaining bytes zero except the HIP-1 token index, big-endian.
 * HYPE is special-cased at 0x2222...2222.
 *
 * This is a routing fact, NOT an authenticity guarantee: the Hyperliquid docs
 * state there are currently no checks that the system address holds sufficient
 * supply or that the linked contract is a valid ERC-20. SENT's XStockRegistry
 * must verify the asset itself (§420) and must never treat "it is linked" as
 * proof of anything.
 */
export function coreSystemAddress(tokenIndex: number): `0x${string}` {
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0) {
    throw new RangeError("coreSystemAddress: token index must be a non-negative integer");
  }
  return `0x20${tokenIndex.toString(16).padStart(38, "0")}` as `0x${string}`;
}

export const HYPE_SYSTEM_ADDRESS =
  "0x2222222222222222222222222222222222222222" as const;

/**
 * HyperSwap V3 — post-graduation venue (LOCKED §17).
 *
 * The addresses below are listed by HyperSwap's first-party deployment docs and
 * independently read from live HyperEVM contracts (V-06, 2026-11-18).
 */
export const HYPERSWAP_V3 = {
  /** Official V3 deployment docs + live factory/child-contract reads (V-06). */
  factory: "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3",
  /** Official V3 deployment docs; .factory() matches `factory` (V-06). */
  swapRouter: "0x4e2960a8cd19b467b82d26d83facb0fae26b094d",
  /** Official V3 deployment docs; .factory() matches `factory` (V-06). */
  positionManager: "0x6eDA206207c09e5428F281761DdC0D300851fBC8",
  /** QuoterV2, official V3 deployment docs; .factory() matches `factory`. */
  quoter: "0x03A918028f22D9E1473B7959C927AD7425A45C7C",
  /** Every configured address has first-party documentation and live code. */
  verified: true,
} as const;

/**
 * The graduation fee tier (§416, V-07).
 *
 * 1% — the widest standard tier, and the one V-07 confirmed is enabled on
 * HyperSwap with a tick spacing of 200. It is the right choice for a pool one
 * day old: a new launch is volatile and thinly traded, and 0.05% or 0.3% would
 * price that risk like a stablecoin pair's — for an LP that can never withdraw.
 *
 * Mirrors `GraduationRouter.FEE_TIER`. The contract is the authority; this is
 * here so an indexer and a UI can read the pool without a chain call.
 */
export const GRADUATION_FEE_TIER = 10_000;
export const GRADUATION_TICK_SPACING = 200;

/**
 * The deployed graduation router, once its router and lock have been deployed
 * and read back from chain. V-06's HyperSwap address verification is complete.
 *
 * Null, and the launch flow already behaves correctly without it: a factory
 * with no router refuses to launch, because §16 forbids a GRADUATED status
 * without a complete migration and a market that could never graduate should
 * never have been created.
 */
export const GRADUATION_ROUTER: `0x${string}` | null = null;

/** The permanent LP lock that holds every graduated position (§17, V-09). */
export const LIQUIDITY_LOCK: `0x${string}` | null = null;

/**
 * The `WrappedXStockFactory` every listed quote asset must come from (D-017).
 *
 * Markets are quoted in a non-rebasing wrapper rather than in an xStock
 * directly, because a Uniswap V3 position cannot hold a rebasing token and
 * graduation locks one forever. This is the factory whose provenance the
 * registry checks.
 *
 * It is bound IMMUTABLY into the registry at deployment, so this constant is a
 * record of what was bound rather than something the runtime configures. A
 * mismatch between the two is a deployment error, and `assertProductionConfigReady`
 * cannot detect it — only reading `XStockRegistry.WRAPPER_FACTORY()` can.
 */
export const WRAPPER_FACTORY: `0x${string}` | null =
  "0xc7b674f6Ec9de46852A25897305292a3d1E18d63";

/**
 * The deployed core, on HyperEVM mainnet.
 *
 * Deployed Day 9. Every address below was read BACK from the chain rather than
 * copied from the deployment log — a log records what a script believed it did,
 * and the two have no reason to agree if anything went wrong in between.
 *
 * Verified at deployment:
 *
 *   registry.governance()        the governance Safe
 *   registry.WRAPPER_FACTORY()   WRAPPER_FACTORY above, bound immutably
 *   factory.REGISTRY()           REGISTRY below
 *   factory.governance()         the governance Safe
 *   factory.treasury()           the treasury Safe
 *   factory.launchFee()          40000000000000000  (0.04 HYPE)
 *
 * `router` and `referencePrice` on the factory are still zero, and the
 * allowlist is still empty. That is the state the deployment log describes as
 * NOT DONE, and a launch is refused until it changes — see
 * `assertProductionConfigReady`.
 */
export const XSTOCK_REGISTRY: `0x${string}` = "0xA54BC1b31d17a6B9F76d6De1BE43B8efb8843c2B";
export const LAUNCHPAD_FACTORY: `0x${string}` = "0xcEa3AcF9b70cE9807a99bcBdF0F93A437518Eaeb";
export const FEE_VAULT: `0x${string}` = "0xDB4cF53967e29AB3dc38cbDc47C6ceDB4d862020";
export const HOLDER_REWARD_VAULT: `0x${string}` = "0xF7dce0CC413D6d7F855A742A02545253Bbb0cB92";
export const REFERENCE_PRICE_ADAPTER: `0x${string}` =
  "0x772AEDd551E38de727248e2925F53aAc80BE2b32";

/**
 * Fee tiers enabled on the HyperSwap V3 factory.
 * VERIFIED Day 1 (V-07, PRIMARY: factory.feeAmountTickSpacing per tier).
 *
 * Tier selection for graduation is a §254 decision that feeds the §416 geometry
 * proof (V-08). It is deliberately NOT made here yet.
 */
export const HYPERSWAP_V3_FEE_TIERS = {
  100: { tickSpacing: 1, enabled: true },
  500: { tickSpacing: 10, enabled: true },
  2500: { tickSpacing: 0, enabled: false },
  3000: { tickSpacing: 60, enabled: true },
  10000: { tickSpacing: 200, enabled: true },
  20000: { tickSpacing: 0, enabled: false },
} as const;

/**
 * Official xStock quote-asset allowlist (§420).
 *
 * EMPTY BY DESIGN. §420 requires a per-deployment allowlist where each asset has
 * passed all eight gates (canonical representation, transfer behaviour,
 * multiplier/share behaviour, price source, halt source, HyperSwap
 * compatibility, normalized accounting tests, legal review).
 *
 * V-02 confirmed the issuer deployments, but no specific quote asset has passed
 * all eight registry gates for SENT. The selected wrapper, its price/multiplier
 * conversion, halt behavior and normalized accounting still need asset-specific
 * evidence. Populating this list before those gates are VERIFIED would be
 * exactly the guess §421 forbids.
 */
export const XSTOCK_ALLOWLIST: readonly XStockEntry[] = [];

export interface XStockEntry {
  readonly symbol: string;
  readonly erc20: `0x${string}`;
  readonly coreTokenIndex: number;
  readonly evmDecimals: number;
  /** Core<->EVM wei-decimal offset. Non-divisible remainders burn (V-03). */
  readonly evmExtraWeiDecimals: number;
  /** Every §420 gate passed, with evidence recorded in the VERIFY ledger. */
  readonly verified: boolean;
}

/**
 * Platform accounts (§555).
 *
 * Governance and Treasury exist and are verified on-chain. The rest of the
 * six-account structure does not, and each absence blocks something specific
 * rather than being a formality:
 *
 *   guardianSafe    the ONLY brake on governance reaching the reward vault.
 *                   `addAttestor` and `setQuorum` are both `onlyGovernance`, so
 *                   without an independent guardian the 6-hour ACTIVATION_DELAY
 *                   has nobody to act inside it. §601 forbids it sharing
 *                   governance's signers, and that is the point of it.
 *
 *   opsRelayer      the graduation keeper. Needs the large block lane, like the
 *                   deployer did.
 *
 *   founderProfit   founder revenue. Blocks nothing technical.
 *
 * `deployer` is deliberately still null. It signed the deployment and holds no
 * authority afterwards — recording it here would suggest it is part of the
 * running system, and it is not.
 */
export const PLATFORM_ACCOUNTS = {
  governanceSafe: "0x791fb66Ac5ff91eE7D3F1697f85c4D8b646D1e22",
  treasurySafe: "0xEd7709178EF1De028E965B4107f56b5AecBE92A2",
  founderProfitSafe: null,
  guardianSafe: null,
  deployer: null,
  opsRelayer: null,
} as const;

/**
 * The launch anchor's price feeds (§135, §402, V-11).
 *
 * The MVP has one verified HYPE/USD source for WHYPE. Equity feeds remain
 * separately gated because xStocks need source entitlement and wrapper-aware
 * price semantics. `p0` is derived once from this price and is immutable for the
 * market's entire life, so a guessed feed is a permanently mis-priced market.
 *
 * The xStocks API identifies a Chainlink v10 stream candidate for SPYx, and
 * Chainlink's supported-network source lists HyperEVM Mainnet. Signed-report
 * access for SENT, asset accounting and adapter semantics are not yet
 * production-verified. The criteria in §253 still govern: manipulation
 * resistance first, then freshness and precision. A DEX spot price is
 * disqualified on the first — the anchor would be settable by whoever is willing
 * to move the pool for one block.
 *
 * Each entry needs a staleness bound and a sanity band alongside the address,
 * and none of the three may be guessed: `maxAge` too loose accepts a price from
 * a halted market, and a band too wide accepts a feed that is returning
 * garbage.
 */
export const REFERENCE_PRICE_FEEDS: readonly ReferencePriceFeed[] = [
  {
    // Chainlink HyperEVM HYPE/USD standard proxy. The official address table
    // lists a 24-hour heartbeat and marks the feed unrated; the adapter refuses
    // answers older than one heartbeat. This is an MVP launch anchor, not a
    // high-frequency price or a claim of an independent security rating.
    asset: WHYPE_ADDRESS,
    aggregator: "0x2b25bc41d55de29f3a2e163f8eebf63966b25b57",
    maxAgeSeconds: 86_400,
    minUsdWad: 10n ** 17n,
    maxUsdWad: 10_000n * 10n ** 18n,
    verified: true,
  },
];

export interface ReferencePriceFeed {
  /** The quote asset this feed prices. Must also be an enabled quote asset. */
  readonly asset: `0x${string}`;
  /** The aggregator. V-11 — first-party confirmed only. */
  readonly aggregator: `0x${string}`;
  /** Seconds after which an answer is refused. Per asset, per §135. */
  readonly maxAgeSeconds: number;
  /** Inclusive sanity band in USD wad. Outside it the launch is blocked. */
  readonly minUsdWad: bigint;
  readonly maxUsdWad: bigint;
  readonly verified: boolean;
}

/**
 * Guard used by production entry points. Fails loudly rather than degrading to a
 * default — §279 (no placeholders in production) and §699 (address integrity).
 */
export function assertProductionConfigReady(): void {
  const problems: string[] = [];
  const hasBaseQuoteAsset = BASE_QUOTE_ASSETS.some((asset) => asset.verified);
  const hasVerifiedXStock = XSTOCK_ALLOWLIST.some((asset) => asset.verified);

  if (!HYPERSWAP_V3.verified) problems.push("HyperSwap V3 addresses unverified (V-06)");
  if (HYPERSWAP_V3.positionManager === null) problems.push("position manager missing (V-06)");

  /*
   * HyperSwap addresses are verified; SENT's own graduation router and
   * permanent lock remain undeployed. Keep this separate because resolving the
   * deployment requirement still leaves the asset and oracle gates below.
   */
  if (GRADUATION_ROUTER === null) {
    problems.push("no SENT graduation router deployed (V-09) — markets cannot graduate");
  }
  if (!hasVerifiedXStock && !hasBaseQuoteAsset) {
    problems.push("no quote assets configured for launch (V-02/V-03/V-05)");
  }

  /*
   * The wrapper factory, checked separately from the allowlist above.
   *
   * An empty allowlist and a missing factory look the same from the outside —
   * nothing is launchable either way — and are fixed by different people doing
   * different things. Without the factory there is nothing governance COULD
   * list, because every xStock rebases and the registry refuses those
   * structurally (D-017, V-03).
   */
  if (WRAPPER_FACTORY === null && hasVerifiedXStock) {
    problems.push(
      "no wrapper factory deployed (D-017) — every xStock rebases, so nothing can be listed",
    );
  }

  /*
   * The guardian, checked separately from the other platform accounts.
   *
   * It is the only thing standing between a compromised governance Safe and the
   * reward vault: `addAttestor` and `setQuorum` are both `onlyGovernance`, so
   * the holder of that key can make itself the sole attestor and claim the vault
   * after ACTIVATION_DELAY. The guardian's cancel is the brake, and it is not a
   * brake at all if governance can also set the guardian to itself.
   */
  if (PLATFORM_ACCOUNTS.guardianSafe === null) {
    problems.push(
      "no guardian Safe (C-08, §588) — nothing can cancel a bad Stockback commitment",
    );
  }
  if (PLATFORM_ACCOUNTS.governanceSafe === null) problems.push("platform accounts unset (C-08)");

  /*
   * The launch anchor.
   *
   * Checked here rather than left to the contract's own `ReferencePriceNotSet`,
   * because that revert arrives when a creator tries to launch — which is after
   * the deployment looked successful. This fails at startup, where it is an
   * operator's problem rather than a user's.
   */
  if (REFERENCE_PRICE_FEEDS.length === 0) {
    problems.push("no launch-anchor price feed configured (V-11)");
  }

  const unverifiedFeeds = REFERENCE_PRICE_FEEDS.filter((f) => !f.verified).map((f) => f.asset);
  if (unverifiedFeeds.length > 0) {
    problems.push(`unverified price feeds (V-11): ${unverifiedFeeds.join(", ")}`);
  }

  const configuredAssets = new Set([
    ...BASE_QUOTE_ASSETS.map((asset) => asset.erc20.toLowerCase()),
    ...XSTOCK_ALLOWLIST.filter((asset) => asset.verified).map((asset) => asset.erc20.toLowerCase()),
  ]);
  const unpriceableAssets = [...configuredAssets].filter(
    (asset) => !REFERENCE_PRICE_FEEDS.some((feed) => feed.asset.toLowerCase() === asset),
  );
  if (unpriceableAssets.length > 0) {
    problems.push(`quote assets lack a configured launch price source: ${unpriceableAssets.join(", ")}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `SENT production config is not ready:\n  - ${problems.join("\n  - ")}\n` +
        "See docs/VERIFY-LEDGER.md. Per Masterplan §421 these may not be guessed.",
    );
  }
}
