// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Curve} from "../src/lib/Curve.sol";
import {Fees} from "../src/lib/Fees.sol";

/// @dev External wrapper. `Curve` functions are `internal` and inline into the
///      caller, so they never create a call frame and `vm.expectRevert` cannot
///      observe their reverts. Routing through a real external call fixes that.
contract CurveHarness {
    function quoteInFor(Curve.Params memory p, uint256 q, uint256 delta) external pure returns (uint256) {
        return Curve.quoteInFor(p, q, delta);
    }

    function grossOutFor(Curve.Params memory p, uint256 q, uint256 delta) external pure returns (uint256) {
        return Curve.grossOutFor(p, q, delta);
    }

    function marginalPrice(Curve.Params memory p, uint256 q) external pure returns (uint256) {
        return Curve.marginalPrice(p, q);
    }
}

/// @notice Curve and fee correctness, including the overflow regime that a naive
///         port of the closed form would fail in.
contract CurveTest is Test {
    uint256 constant WAD = 1e18;
    uint256 constant REFERENCE_MC_USD = 2_000e18;

    /// @dev Derive p0 the way a market does: from the $2,000 reference market cap
    ///      and the launch-time xStock/USD snapshot (§8, §402).
    function _p0(uint256 xStockUsdWad) internal pure returns (uint256) {
        uint256 quoteMc = (REFERENCE_MC_USD * WAD) / xStockUsdWad;
        return (quoteMc * WAD) / Curve.TOTAL_SUPPLY;
    }

    function _curve(uint256 xStockUsdWad) internal pure returns (Curve.Params memory) {
        return Curve.params(_p0(xStockUsdWad));
    }

    // -----------------------------------------------------------------------
    // Locked parameters
    // -----------------------------------------------------------------------

    function test_supplyIsExactlyOneBillion() public pure {
        assertEq(Curve.TOTAL_SUPPLY, 1_000_000_000e18, "LOCKED supply changed");
    }

    function test_graduationIsExactly25x() public pure {
        Curve.Params memory p = _curve(137.42e18);
        assertEq(p.pg, p.p0 * 25, "PG must be 25x P0");
        assertEq(p.dP, p.p0 * 24, "dP must be 24x P0");
    }

    /// @dev qG/S = 50/76 regardless of the pair, because P0 cancels out.
    function testFuzz_endpointIsPairIndependent(uint256 xStockUsdWad) public pure {
        xStockUsdWad = bound(xStockUsdWad, 0.01e18, 100_000e18);
        uint256 p0 = _p0(xStockUsdWad);
        vm.assume(p0 > 0);

        Curve.Params memory p = Curve.params(p0);
        assertEq(p.qG, (Curve.TOTAL_SUPPLY * 50) / 76, "endpoint must not depend on the pair");
    }

    // -----------------------------------------------------------------------
    // §8 reference outcomes, on-chain
    // -----------------------------------------------------------------------

    function test_referenceOutcomesMatchMasterplan() public pure {
        Curve.Params memory p = _curve(137.42e18);

        uint256 distributed = p.qG;
        uint256 remaining = Curve.remainingAtGraduation(p);
        uint256 collateral = Curve.collateralAt(p, p.qG);

        assertEq(distributed / WAD, 657_894_736, "supply distributed (~657.895M)");
        assertEq(remaining / WAD, 342_105_263, "supply remaining (~342.105M)");

        // The defining endpoint property: collateral == remaining valued at PG.
        // This is what removes the need for any liquidity top-up (§8, §17).
        uint256 remainingValue = (remaining * p.pg) / WAD;
        assertApproxEqRel(collateral, remainingValue, 1e9, "collateral must equal remaining @ PG");

        assertEq(Curve.marginalPrice(p, p.qG), p.pg, "final marginal price must be PG");
    }

    // -----------------------------------------------------------------------
    // THE OVERFLOW REGIME
    //
    // B = 25*P0*qG at graduation, and P0 scales inversely with the xStock price.
    // A naive `sqrt(B*B + ...)` overflows uint256 below roughly $93/xStock, which
    // covers most real equities. These cases must all work.
    // -----------------------------------------------------------------------

    function test_worksBelowTheNaiveOverflowThreshold() public pure {
        // $50, $20, $10, $1 all overflow B*B in uint256.
        uint256[4] memory prices = [uint256(50e18), 20e18, 10e18, 1e18];

        for (uint256 i = 0; i < prices.length; i++) {
            Curve.Params memory p = _curve(prices[i]);

            uint256 netIn = Curve.quoteInFor(p, 0, p.qG / 2);
            uint256 out = Curve.tokensOutFor(p, 0, netIn);

            assertGt(out, 0, "must produce output below the naive overflow threshold");
            assertLe(Curve.quoteInFor(p, 0, out), netIn, "must not overcharge");

            // `quoteInFor` rounds UP, so paying that quoted amount buys at least
            // the size it was quoted for — and possibly a shade more, since the
            // ceil'd wei of quote buys real tokens. At $1/xStock one wei of quote
            // is worth ~5e5 token wei, so the excess is bounded by price, not by a
            // small absolute constant. Assert the property that actually matters:
            // never less than quoted, never more than paid for.
            assertGe(out, p.qG / 2, "must never deliver less than the quoted size");
            assertGt(Curve.quoteInFor(p, 0, out + 1), netIn, "must be the exact floor");
        }
    }

    /// @dev Walking the entire curve at the cheapest realistic quote asset is the
    ///      worst case for every intermediate in the library.
    function test_fullWalkAtExtremePrice() public pure {
        Curve.Params memory p = _curve(1e18);

        uint256 q = 0;
        uint256 collateral = 0;
        for (uint256 i = 0; i < 64; i++) {
            uint256 target = (p.qG * (i + 1)) / 64;
            collateral += Curve.quoteInFor(p, q, target - q);
            q = target;
        }

        assertEq(q, p.qG, "walk must land exactly on the endpoint");
        assertGe(collateral, Curve.collateralAt(p, p.qG), "stepwise must round in protocol's favour");
        assertApproxEqRel(collateral, Curve.collateralAt(p, p.qG), 1e12, "walk must match closed form");
    }

    // -----------------------------------------------------------------------
    // The exact specification: tokensOutFor is a floor, provably
    // -----------------------------------------------------------------------

    function testFuzz_tokensOutIsTheExactFloor(uint256 xStockUsdWad, uint256 q, uint256 netIn) public pure {
        xStockUsdWad = bound(xStockUsdWad, 1e18, 2_000e18);
        Curve.Params memory p = _curve(xStockUsdWad);

        q = bound(q, 0, p.qG - 1);
        uint256 maxIn = Curve.quoteInFor(p, q, p.qG - q);
        netIn = bound(netIn, 1, maxIn);

        uint256 delta = Curve.tokensOutFor(p, q, netIn);

        // Lower bound: what the user receives never costs more than they paid.
        assertLe(Curve.quoteInFor(p, q, delta), netIn, "delta must be affordable");

        // Upper bound: one more token would have cost more than they paid, so the
        // floor is tight — the protocol is not silently withholding output.
        if (q + delta < p.qG) {
            assertGt(Curve.quoteInFor(p, q, delta + 1), netIn, "delta must be maximal");
        }
    }

    /// @dev No rounding-extraction: buying then immediately selling the same amount
    ///      can never return more than was paid, before fees.
    function testFuzz_noRoundTripProfit(uint256 xStockUsdWad, uint256 q, uint256 netIn) public pure {
        xStockUsdWad = bound(xStockUsdWad, 1e18, 2_000e18);
        Curve.Params memory p = _curve(xStockUsdWad);

        q = bound(q, 0, p.qG - 1);
        uint256 maxIn = Curve.quoteInFor(p, q, p.qG - q);
        netIn = bound(netIn, 1, maxIn);

        uint256 delta = Curve.tokensOutFor(p, q, netIn);
        vm.assume(delta > 0);

        uint256 back = Curve.grossOutFor(p, q + delta, delta);
        assertLe(back, netIn, "round trip must never be profitable");
    }

    function testFuzz_priceIsMonotonic(uint256 xStockUsdWad, uint256 a, uint256 b) public pure {
        xStockUsdWad = bound(xStockUsdWad, 1e18, 2_000e18);
        Curve.Params memory p = _curve(xStockUsdWad);

        a = bound(a, 0, p.qG);
        b = bound(b, a, p.qG);

        assertGe(Curve.marginalPrice(p, b), Curve.marginalPrice(p, a), "price must never fall as q rises");
    }

    function test_cannotStepPastEndpoint() public {
        Curve.Params memory p = _curve(137.42e18);

        // Even an absurd input stops exactly at the endpoint; the market segments a
        // graduation-crossing order rather than letting the curve overrun (§411-A).
        uint256 out = Curve.tokensOutFor(p, 0, type(uint128).max);
        assertEq(out, p.qG, "must clamp to the endpoint");

        CurveHarness h = new CurveHarness();

        vm.expectRevert(Curve.CurvePastEndpoint.selector);
        h.quoteInFor(p, p.qG, 1);

        vm.expectRevert(Curve.CurveInsufficientDistributed.selector);
        h.grossOutFor(p, 100e18, 200e18);

        vm.expectRevert(Curve.CurvePastEndpoint.selector);
        h.marginalPrice(p, p.qG + 1);
    }

    // -----------------------------------------------------------------------
    // Fees — §315 worked examples, exactly
    // -----------------------------------------------------------------------

    function test_buyFeesMatchMasterplanExample() public pure {
        Fees.Breakdown memory f = Fees.forBuy(100e18);

        assertEq(f.coreFee, 1e18, "core fee 1.00");
        assertEq(f.creatorFee, 0.65e18, "creator 0.65");
        assertEq(f.platformFee, 0.35e18, "platform 0.35");
        assertEq(f.stockback, 1e18, "stockback 1.00");
        assertEq(f.net, 98e18, "net to curve 98.00");
    }

    function test_sellFeesMatchMasterplanExample() public pure {
        Fees.Breakdown memory f = Fees.forSell(100e18);

        assertEq(f.coreFee, 1e18, "core fee 1.00");
        assertEq(f.creatorFee, 0.65e18, "creator 0.65");
        assertEq(f.platformFee, 0.35e18, "platform 0.35");
        assertEq(f.stockback, 2e18, "stockback 2.00");
        assertEq(f.net, 97e18, "net to seller 97.00");
    }

    function testFuzz_feeSplitIsExhaustive(uint256 notional) public pure {
        notional = bound(notional, 0, 1e40);

        Fees.Breakdown memory buy = Fees.forBuy(notional);
        assertEq(buy.creatorFee + buy.platformFee, buy.coreFee, "split must be exhaustive");
        assertEq(buy.net + buy.coreFee + buy.stockback, notional, "waterfall must be exhaustive");

        Fees.Breakdown memory sell = Fees.forSell(notional);
        assertEq(sell.creatorFee + sell.platformFee, sell.coreFee, "split must be exhaustive");
        assertEq(sell.net + sell.coreFee + sell.stockback, notional, "waterfall must be exhaustive");

        // The creator's share is never reduced by Stockback (§314.2).
        assertEq(buy.creatorFee, sell.creatorFee, "creator share must not depend on side");
    }

    /// @dev section 314.2: the creator's share may never be REDUCED. Rounding
    ///      therefore favours the creator, and the platform absorbs the dust.
    function testFuzz_creatorIsNeverShortChanged(uint256 notional) public pure {
        notional = bound(notional, 0, 1e40);
        Fees.Breakdown memory f = Fees.forBuy(notional);

        assertGe(f.creatorFee * 10_000, f.coreFee * 6_500, "creator must never receive less than 65%");
        // And never more than one indivisible unit above it.
        assertLe(f.creatorFee * 10_000, f.coreFee * 6_500 + 10_000, "excess is bounded to rounding");
        assertEq(f.creatorFee + f.platformFee, f.coreFee, "split stays exhaustive");
    }

    function test_postGradSplit() public pure {
        (uint256 creator, uint256 stockback, uint256 platform) = Fees.splitPostGrad(1_000e18, true);
        assertEq(creator, 650e18, "creator 65%");
        assertEq(stockback, 175e18, "stockback 17.5%");
        assertEq(platform, 175e18, "platform 17.5%");

        (uint256 c2, uint256 s2, uint256 p2) = Fees.splitPostGrad(1_000e18, false);
        assertEq(c2, 650e18, "creator undiluted on TOKEN side");
        assertEq(s2, 0, "no automatic TOKEN conversion");
        assertEq(p2, 350e18, "platform keeps the whole 35% on TOKEN side");
    }

    // -----------------------------------------------------------------------
    // Fees never enter collateral (§8, §12)
    // -----------------------------------------------------------------------

    function testFuzz_feesStayOutOfCollateral(uint256 xStockUsdWad, uint256 grossIn) public pure {
        xStockUsdWad = bound(xStockUsdWad, 1e18, 2_000e18);
        Curve.Params memory p = _curve(xStockUsdWad);

        uint256 maxIn = Curve.quoteInFor(p, 0, p.qG);
        grossIn = bound(grossIn, 1e6, maxIn);

        Fees.Breakdown memory f = Fees.forBuy(grossIn);
        uint256 delta = Curve.tokensOutFor(p, 0, f.net);
        uint256 collateral = Curve.collateralAt(p, delta);

        assertLe(collateral, f.net, "collateral must never exceed the net input");
        assertGe(grossIn - collateral, f.totalFee, "fees must remain outside collateral");
    }
}
