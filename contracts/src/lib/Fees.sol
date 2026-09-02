// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title SENT pre-graduation fee waterfall
/// @notice Canonical on-chain fee math. Mirrors `packages/economics/src/fees.ts`
///         and is differential-tested against it (Masterplan §1064).
///
/// LOCKED RATES (§0, §11, §314, §407) — an implementation may not tune these.
/// §9/§10 state that economic simulation is a validation GATE, not an
/// authorisation to retune. A failing rate is a BLOCKED escalation.
///
///   core trading fee     1.00% of notional
///     creator            65% of the core fee
///     platform           35% of the core fee
///   stockback BUY        1.00% of notional
///   stockback SELL       2.00% of notional
///   effective BUY 2.00%   effective SELL 3.00%
///
/// CONVENTION (FREEZE F1, docs/ECONOMICS-CONVENTIONS.md)
///
///   BUY  — notional is the GROSS QUOTE INPUT. Fees are removed first (§9 steps
///          2-5) and only the remainder reaches the curve.
///   SELL — notional is the GROSS QUOTE OUTPUT from the curve. The curve runs
///          first (§10 step 1), then fees come off its output.
///
/// This is fixed by the step ordering in §9/§10, not chosen. Both readings
/// reproduce the §315 worked examples exactly.
///
/// Neither fee ever enters curve collateral (§8, §12).
library Fees {
    uint256 internal constant BPS = 10_000;

    /// @dev Core trading fee: 1.00%. LOCKED.
    uint256 internal constant CORE_FEE_BPS = 100;

    /// @dev Creator share OF THE CORE FEE: 65%. LOCKED — never reduced by Stockback.
    uint256 internal constant CREATOR_SHARE_BPS = 6_500;

    /// @dev Platform share of the core fee: 35%. LOCKED.
    uint256 internal constant PLATFORM_SHARE_BPS = 3_500;

    /// @dev Stockback contribution on BUY: 1.00% of notional. LOCKED.
    uint256 internal constant STOCKBACK_BUY_BPS = 100;

    /// @dev Stockback contribution on SELL: 2.00% of notional. LOCKED.
    uint256 internal constant STOCKBACK_SELL_BPS = 200;

    /// @dev Post-grad: share of the platform's paired-xStock revenue that funds
    ///      Stockback. 50%, giving net 65 / 17.5 / 17.5 (§396-B, §407).
    uint256 internal constant POST_GRAD_PLATFORM_STOCKBACK_BPS = 5_000;

    struct Breakdown {
        /// @dev BUY: gross quote in. SELL: gross curve output.
        uint256 notional;
        uint256 coreFee;
        uint256 creatorFee;
        uint256 platformFee;
        uint256 stockback;
        uint256 totalFee;
        /// @dev BUY: amount reaching the curve. SELL: amount reaching the seller.
        uint256 net;
    }

    /// @notice Fee waterfall for a BUY. `notional` is the gross quote input.
    function forBuy(uint256 notional) internal pure returns (Breakdown memory) {
        return _compute(notional, STOCKBACK_BUY_BPS);
    }

    /// @notice Fee waterfall for a SELL. `notional` is the curve's gross output.
    function forSell(uint256 notional) internal pure returns (Breakdown memory) {
        return _compute(notional, STOCKBACK_SELL_BPS);
    }

    function _compute(uint256 notional, uint256 stockbackBps) private pure returns (Breakdown memory b) {
        b.notional = notional;
        b.coreFee = (notional * CORE_FEE_BPS) / BPS;

        // Creator rounds UP, platform absorbs the remainder (D-003, revised).
        //
        // Direction matters here. Rounding the creator DOWN made the aggregate
        // creator share sit permanently a wei or two below 65%, because a sum of
        // floors is not the floor of a sum. Sub-wei, but section 314.2 is explicit
        // that the creator's share may never be reduced, so the dust must land on
        // the platform - the party that agreed to the split - never on the
        // creator, who is the protected party. Found by an invariant, not by
        // inspection.
        b.creatorFee = (b.coreFee * CREATOR_SHARE_BPS + BPS - 1) / BPS;
        if (b.creatorFee > b.coreFee) b.creatorFee = b.coreFee;
        b.platformFee = b.coreFee - b.creatorFee;

        b.stockback = (notional * stockbackBps) / BPS;
        b.totalFee = b.coreFee + b.stockback;
        b.net = notional - b.totalFee;
    }

    /// @notice Post-graduation split of creator-eligible LP fee revenue.
    /// @param assetIsPairedXStock True when the fee arrives in the market's official
    ///        paired xStock. TOKEN-denominated revenue is 100% platform with NO
    ///        automatic conversion — the protocol never sells TOKEN to fund
    ///        rewards (§397, §407).
    function splitPostGrad(uint256 revenue, bool assetIsPairedXStock)
        internal
        pure
        returns (uint256 creator, uint256 stockback, uint256 platform)
    {
        creator = (revenue * CREATOR_SHARE_BPS) / BPS;
        uint256 platformSide = revenue - creator;

        if (!assetIsPairedXStock) {
            return (creator, 0, platformSide);
        }

        stockback = (platformSide * POST_GRAD_PLATFORM_STOCKBACK_BPS) / BPS;
        platform = platformSide - stockback;
    }
}
