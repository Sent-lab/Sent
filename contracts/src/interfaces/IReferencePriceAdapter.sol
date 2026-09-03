// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title IReferencePriceAdapter
/// @notice The launch anchor's only source of truth (§20, §135, §402).
///
/// WHY THIS EXISTS AT ALL
/// ----------------------
/// `p0` is derived once, at launch, from the xStock's USD value, and it is
/// immutable for the market's entire life. Everything downstream inherits it:
/// `pg = 25 × p0`, the collateral the curve accumulates, and the real value of
/// the permanent LP that graduation creates.
///
/// Before this interface, `xStockUsdWad` was a plain calldata argument. Any
/// caller could pass any non-zero number, and the only check was that it was not
/// zero. A launch at a price a thousand times too low produces a `p0` a thousand
/// times too high and a market that can never realistically graduate; a price a
/// thousand times too high produces a market that graduates for almost nothing
/// and locks dust into a pool that is supposed to be permanent liquidity.
///
/// §402 is explicit that the anchor is "required once when creating a market"
/// and that "if invalid/stale, the launch is blocked". §135 adds stale
/// detection, invalid-price behaviour, and — the load-bearing one — **no
/// arbitrary manual override**.
///
/// THE PROVIDER IS NOT DECIDED; THE BOUNDARY IS
/// --------------------------------------------
/// V-11 is open: which feed provides the snapshot on HyperEVM is an engineering
/// validation still to be done (§253). That is exactly why an adapter exists —
/// the factory depends on this interface, and swapping the feed changes one
/// contract rather than the launch path.
///
/// A factory with no adapter cannot launch anything. That is the correct
/// failure, and it is the same shape as `IGraduationRouter`: no router, no
/// graduation. §279 forbids a placeholder standing in for an unverified
/// dependency, and a zero address is not a placeholder — it is a refusal.
///
/// NO CUSTODY, NO WRITES
/// ---------------------
/// Every function here is a view. §135's "no custody" is structural rather than
/// promised: there is nothing on this interface that could hold or move an
/// asset, and nothing that a governance key could use to set a price directly.
interface IReferencePriceAdapter {
    /// @notice The asset's USD value, normalised to wad (1e18 = $1.00).
    /// @dev MUST revert rather than return a sentinel when the price is stale,
    ///      non-positive, outside the sanity band, or unavailable. §402 blocks
    ///      the launch in those cases, and a caller that has to remember to
    ///      check a return value is a caller that will eventually forget.
    /// @param asset The xStock being priced.
    /// @return usdWad The price, wad-normalised, guaranteed fresh and positive.
    function usdPriceWad(address asset) external view returns (uint256 usdWad);

    /// @notice The same read, as a question rather than an assertion.
    /// @dev For UIs and previews, which need to SHOW that a launch is currently
    ///      blocked rather than discover it by reverting. Never used to make the
    ///      launch decision — that path calls `usdPriceWad` and lets it revert,
    ///      so there is exactly one place the rule is enforced.
    /// @return ok Whether a launch priced from this asset would succeed now.
    /// @return usdWad The price when `ok`, zero otherwise.
    /// @return updatedAt The feed's own timestamp, for display of staleness.
    function peekUsdPriceWad(address asset)
        external
        view
        returns (bool ok, uint256 usdWad, uint256 updatedAt);
}
