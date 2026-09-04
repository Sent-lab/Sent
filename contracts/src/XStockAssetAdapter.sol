// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title SENT XStockAssetAdapter
/// @notice Normalises xStock quote amounts to a single 18-decimal representation
///         before they reach curve, fee or Stockback math (§399, §400).
///
/// WHY THIS EXISTS
/// ---------------
/// Curve and fee math must never see raw asset units. Different xStocks may carry
/// different decimals, and the HyperCore↔HyperEVM link adds its own wei-decimal
/// offset. If any of that leaks into the economics layer, every downstream number
/// is silently wrong in a way that fuzzing against a single asset will not catch.
///
/// So there is exactly one boundary — this contract — and everything past it is
/// 18-decimal "normalized quote wei".
///
/// ROUNDING (D-003)
/// ----------------
/// Scaling down loses precision by construction: an 18-decimal normalized amount
/// is not always representable in an asset with fewer decimals. The direction is
/// therefore never left to chance:
///
///   - amounts the protocol PAYS OUT round DOWN  (never overpay)
///   - amounts the protocol CHARGES round UP     (never undercharge)
///
/// Callers must state which they mean. There is no ambiguous default.
///
/// MULTIPLIER / SHARE SEMANTICS — DELIBERATELY NOT IMPLEMENTED
/// -----------------------------------------------------------
/// §421 lists "wrapper/multiplier/share semantics" as VERIFY-before-production and
/// forbids guessing. V-03 is still open. §279 forbids a mock or placeholder from
/// reaching a production build.
///
/// Writing a plausible-looking multiplier path now would be exactly the silent
/// approximation §421 prohibits — and a wrong multiplier does not fail loudly, it
/// mis-prices every trade forever. So an asset flagged as having multiplier
/// semantics REVERTS here until a verified implementation replaces this.
/// Loud absence beats a confident guess.
library XStockAssetAdapter {
    uint8 internal constant NORMALIZED_DECIMALS = 18;

    /// @dev Guards against absurd decimals from a malformed or hostile token. A
    ///      real asset far outside this range fails the §420 gates anyway.
    uint8 internal constant MAX_DECIMALS = 36;

    error DecimalsOutOfRange(uint8 decimals);
    error MultiplierSemanticsUnverified(address asset);

    struct AssetConfig {
        address asset;
        uint8 decimals;
        /// @dev True when the asset's value per unit is not constant — a rebasing
        ///      wrapper, a share-based accounting token, or one subject to a
        ///      corporate-action multiplier.
        ///
        ///      Refused permanently, not pending V-03. That row closed on Day 8
        ///      and the answer was that EVERY xStock has these semantics, so
        ///      markets pair against a non-rebasing wrapper instead (D-017). A
        ///      wrapper's balance is constant, so it sets this false honestly;
        ///      the raw asset is refused here and again at the registry by
        ///      `RebaseDetector`, which checks the chain rather than a flag.
        bool hasMultiplierSemantics;
    }

    /// @notice Raw asset units -> normalized 18-decimal quote wei.
    /// @dev Used for amounts ARRIVING (a buy's input, a Stockback contribution).
    ///      Scaling up is exact; scaling down floors, which under-credits the payer
    ///      by sub-unit dust rather than crediting value that was never received.
    function toNormalized(AssetConfig memory config, uint256 rawAmount) internal pure returns (uint256) {
        _validate(config);

        if (config.decimals == NORMALIZED_DECIMALS) return rawAmount;

        if (config.decimals < NORMALIZED_DECIMALS) {
            return rawAmount * (10 ** (NORMALIZED_DECIMALS - config.decimals));
        }

        return rawAmount / (10 ** (config.decimals - NORMALIZED_DECIMALS));
    }

    /// @notice Normalized 18-decimal quote wei -> raw asset units, for a PAYOUT.
    /// @dev Rounds DOWN. The protocol never pays more than it owes.
    function toRawForPayout(AssetConfig memory config, uint256 normalizedAmount) internal pure returns (uint256) {
        _validate(config);

        if (config.decimals == NORMALIZED_DECIMALS) return normalizedAmount;

        if (config.decimals < NORMALIZED_DECIMALS) {
            return normalizedAmount / (10 ** (NORMALIZED_DECIMALS - config.decimals));
        }

        return normalizedAmount * (10 ** (config.decimals - NORMALIZED_DECIMALS));
    }

    /// @notice Normalized 18-decimal quote wei -> raw asset units, for a CHARGE.
    /// @dev Rounds UP. The protocol never undercharges.
    function toRawForCharge(AssetConfig memory config, uint256 normalizedAmount) internal pure returns (uint256) {
        _validate(config);

        if (config.decimals == NORMALIZED_DECIMALS) return normalizedAmount;

        if (config.decimals < NORMALIZED_DECIMALS) {
            uint256 scale = 10 ** (NORMALIZED_DECIMALS - config.decimals);
            return (normalizedAmount + scale - 1) / scale;
        }

        return normalizedAmount * (10 ** (config.decimals - NORMALIZED_DECIMALS));
    }

    /// @notice Normalized value that a raw payout of `rawAmount` actually settles.
    /// @dev Round-tripping is lossy when decimals < 18. A market must book what it
    ///      REALLY transferred, not what it intended to transfer, or its collateral
    ///      accounting drifts from its balance one dust unit at a time.
    function settledNormalized(AssetConfig memory config, uint256 rawAmount) internal pure returns (uint256) {
        return toNormalized(config, rawAmount);
    }

    /// @notice Smallest normalized amount representable in the asset.
    /// @dev Anything below this rounds to zero on payout. Surfaces the dust floor
    ///      explicitly so §327-style dust handling can be reasoned about instead of
    ///      discovered in production.
    function dustFloor(AssetConfig memory config) internal pure returns (uint256) {
        _validate(config);
        if (config.decimals >= NORMALIZED_DECIMALS) return 1;
        return 10 ** (NORMALIZED_DECIMALS - config.decimals);
    }

    function _validate(AssetConfig memory config) private pure {
        if (config.decimals > MAX_DECIMALS) revert DecimalsOutOfRange(config.decimals);
        if (config.hasMultiplierSemantics) revert MultiplierSemanticsUnverified(config.asset);
    }
}
