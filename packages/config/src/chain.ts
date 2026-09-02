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
 * Wrapped native gas token (WHYPE).
 * VERIFIED Day 1 (V-01, PRIMARY: read as WETH9() from the HyperSwap V3 router).
 */
export const WHYPE_ADDRESS = "0x5555555555555555555555555555555555555555" as const;

/**
 * Public RPC. Redundant independent providers are required before production:
 * §406 needs independently deployed indexer instances, and §542 warns about
 * official-RPC limitations. Rate/range limits are still unmeasured (V-15).
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
 * factory: PRIMARY read (router.factory()), but first-party confirmation that
 * this is the canonical HyperSwap deployment is still outstanding (V-06), so it
 * stays behind the `verified` flag and may not be used for a mainnet deploy yet.
 */
export const HYPERSWAP_V3 = {
  /** V-06 PARTIAL — primary-read, awaiting first-party confirmation. */
  factory: "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3",
  /** V-06 PARTIAL — surfaced by a secondary source, behaves as a UniV3 router. */
  swapRouter: "0x4e2960a8cd19b467b82d26d83facb0fae26b094d",
  /** V-06 OPEN — required for graduation minting. */
  positionManager: null,
  /** V-06 OPEN. */
  quoter: null,
  /** True only when every field above is VERIFIED and first-party confirmed. */
  verified: false,
} as const;

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
 * V-02/V-03/V-05 are open. Populating this list before they are VERIFIED would
 * be exactly the guess §421 forbids.
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

/** Platform accounts (§555). All open pending the key ceremony (C-08, V-13). */
export const PLATFORM_ACCOUNTS = {
  governanceSafe: null,
  treasurySafe: null,
  founderProfitSafe: null,
  guardianSafe: null,
  deployer: null,
  opsRelayer: null,
} as const;

/**
 * Guard used by production entry points. Fails loudly rather than degrading to a
 * default — §279 (no placeholders in production) and §699 (address integrity).
 */
export function assertProductionConfigReady(): void {
  const problems: string[] = [];

  if (!HYPERSWAP_V3.verified) problems.push("HyperSwap V3 addresses unverified (V-06)");
  if (HYPERSWAP_V3.positionManager === null) problems.push("position manager missing (V-06)");
  if (XSTOCK_ALLOWLIST.length === 0) problems.push("xStock allowlist empty (V-02/V-03/V-05)");
  if (PLATFORM_ACCOUNTS.governanceSafe === null) problems.push("platform accounts unset (C-08)");

  if (problems.length > 0) {
    throw new Error(
      `SENT production config is not ready:\n  - ${problems.join("\n  - ")}\n` +
        "See docs/VERIFY-LEDGER.md. Per Masterplan §421 these may not be guessed.",
    );
  }
}
