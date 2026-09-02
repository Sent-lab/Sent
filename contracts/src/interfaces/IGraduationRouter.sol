// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title IGraduationRouter
/// @notice The boundary between the curve and HyperSwap (§20, §646).
///
/// The router owns everything §416/§417 requires: exact V3 mint geometry, spot
/// price continuity, permanent LP lock, fee-right delegation, and the deterministic
/// destination for unavoidable mint dust. `LaunchMarket` deliberately knows none of
/// it — the market's job ends at "here are the assets and the price they must open
/// at".
///
/// V-06 and V-09 are still open, so the concrete implementation lands on Day 3
/// against verified HyperSwap addresses. Until then this interface is the contract
/// between the two halves, and a market with no router simply cannot graduate —
/// which is the correct failure (§16: no GRADUATED status without a complete
/// migration).
interface IGraduationRouter {
    /// @notice Migrate a market's remaining reserve and collateral into a
    ///         permanently locked HyperSwap V3 position.
    /// @param token The LaunchToken. Its address never changes (§2).
    /// @param quoteAsset The market's official paired xStock.
    /// @param tokenAmount Remaining undistributed supply.
    /// @param quoteAmount Curve collateral being migrated.
    /// @param finalMarginalPriceWad The curve's closing marginal price. The pool
    ///        MUST open here, within the documented tick tolerance (§15).
    /// @param dustQuote Sub-wei accounting surplus from the final segment. Must be
    ///        holder-neutral: added to locked liquidity where the venue permits,
    ///        otherwise retained in a non-withdrawable account. Never credited to
    ///        creator or platform (§417).
    /// @return pool The HyperSwap pool now serving as canonical venue.
    /// @return positionId The permanently locked LP position.
    function graduate(
        address token,
        address quoteAsset,
        uint256 tokenAmount,
        uint256 quoteAmount,
        uint256 finalMarginalPriceWad,
        uint256 dustQuote
    ) external returns (address pool, uint256 positionId);

    /// @notice Execute the post-graduation leg of a crossing buy (§411).
    /// @dev Charged at HyperSwap's own fee, never at PRE_GRAD rates — §411 forbids
    ///      charging pre-grad fees on notional that executes post-graduation.
    /// @param quoteIn Quote already transferred to the router for this leg.
    /// @return tokensOut TOKEN delivered to `recipient`.
    function swapExactQuoteForToken(address token, address quoteAsset, uint256 quoteIn, address recipient)
        external
        returns (uint256 tokensOut);
}
