// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {V3Math} from "../src/lib/V3Math.sol";
import {Curve} from "../src/lib/Curve.sol";

/// @notice §15's price continuity, as arithmetic.
///
/// Three things can be wrong here and none of them fails loudly: the decimal
/// conversion, the token ordering, and the Q64.96 square root. Each produces a
/// pool that opens at a plausible-looking wrong price — and the first trader
/// pays for it.
contract V3MathTest is Test {
    /// The graduation price for a $100 xStock: p0 = 20e9, pg = 25 × p0.
    uint256 constant PG = 500_000_000_000;

    function test_fullRangeIsAlignedAndWithinBounds() public pure {
        (int24 lower, int24 upper) = V3Math.fullRange(200);

        assertEq(lower % 200, 0, "lower is a multiple of the spacing");
        assertEq(upper % 200, 0, "upper is a multiple of the spacing");

        // Truncation toward zero must move both bounds INWARD. Either landing
        // outside V3's own range is a mint the pool rejects.
        assertGe(lower, V3Math.MIN_TICK, "lower stays inside V3's range");
        assertLe(upper, V3Math.MAX_TICK, "upper stays inside V3's range");

        assertEq(lower, -887200, "the widest aligned tick below MIN");
        assertEq(upper, 887200, "and above MAX");
    }

    function test_fullRangeWorksForEveryVerifiedSpacing() public pure {
        int24[3] memory spacings = [int24(10), int24(60), int24(200)];

        for (uint256 i = 0; i < 3; i++) {
            (int24 lower, int24 upper) = V3Math.fullRange(spacings[i]);
            assertEq(lower % spacings[i], 0, "aligned");
            assertEq(upper % spacings[i], 0, "aligned");
            assertGe(lower, V3Math.MIN_TICK, "in range");
            assertLe(upper, V3Math.MAX_TICK, "in range");
        }
    }

    // -----------------------------------------------------------------------
    // The round trip
    // -----------------------------------------------------------------------

    /// @dev The only check that catches a mistake shared by the conversion and
    ///      its expectation: go there and come back.
    function testFuzz_priceSurvivesTheRoundTrip(uint256 priceWad, uint8 decimals, bool tokenIsToken0)
        public
        pure
    {
        // A range spanning a $0.01 xStock to a $100,000 one, at both extremes of
        // token supply. Below this the price rounds to nothing in Q64.96;
        // above it no equity trades.
        priceWad = bound(priceWad, 1e6, 1e24);
        decimals = uint8(bound(decimals, 2, 18));

        uint160 sqrtPriceX96 = V3Math.initialSqrtPriceX96(priceWad, decimals, tokenIsToken0);
        uint256 recovered = V3Math.priceWadFromSqrt(sqrtPriceX96, decimals, tokenIsToken0);

        // Q64.96 is finite, so exact equality is not available. One part in a
        // million is far inside a tick — 0.01% — so a pool opening here is
        // indistinguishable from one opening exactly on the curve.
        uint256 tolerance = priceWad / 1_000_000 + 1;

        assertApproxEqAbs(recovered, priceWad, tolerance, "price survives the conversion");
    }

    /// @dev Six decimals specifically, because that is what an xStock is and it
    ///      is where the 10^12 error lives. This is the exact scale mistake that
    ///      already shipped once in the indexer.
    function test_sixDecimalQuoteIsNotOffByATrillion() public pure {
        uint160 sqrt6 = V3Math.initialSqrtPriceX96(PG, 6, true);
        uint160 sqrt18 = V3Math.initialSqrtPriceX96(PG, 18, true);

        // 12 decimal places is 10^12 in price, which is 10^6 in sqrt price.
        // Asserting the RATIO rather than either value is what makes this a test
        // of the conversion rather than of a constant somebody typed.
        assertApproxEqRel(
            uint256(sqrt18) / uint256(sqrt6), 1_000_000, 0.001e18, "decimals scale the sqrt by 10^6"
        );
    }

    /// @dev Ordering is decided by two addresses nobody chose. Backwards, the
    ///      pool opens at the reciprocal — for a $50,000 market that is a price
    ///      wrong by roughly 10^38, and every unit test that only ever passed
    ///      `true` would still be green.
    function test_orderingInvertsThePrice() public pure {
        uint160 asToken0 = V3Math.initialSqrtPriceX96(PG, 6, true);
        uint160 asToken1 = V3Math.initialSqrtPriceX96(PG, 6, false);

        assertTrue(asToken0 != asToken1, "ordering changes the answer");

        // sqrt(P) × sqrt(1/P) = 1, so the two sqrt prices multiply to 2^192.
        uint256 product = uint256(asToken0) * uint256(asToken1);
        assertApproxEqRel(product, 1 << 192, 0.0001e18, "they are exact reciprocals");
    }

    // -----------------------------------------------------------------------
    // §8's endpoint, at the price it was derived for
    // -----------------------------------------------------------------------

    /// @dev The economic claim §416 rests on: at `pg`, the supply left over is
    ///      worth the collateral that came with it. If that were not true, a
    ///      full-range mint would strand one side and §417's "dust" would be a
    ///      material amount of somebody's money.
    function test_theEndpointBalancesBothSidesOfTheMint() public pure {
        Curve.Params memory c = Curve.params(20_000_000_000);

        uint256 remainingSupply = Curve.TOTAL_SUPPLY - c.qG;
        uint256 collateral = Curve.collateralAt(c, c.qG);

        // Value of the remaining supply at the closing price, in normalized quote.
        uint256 remainingValue = (remainingSupply * c.pg) / 1e18;

        // Within a tenth of a percent. Not exact — qG is floored — and the
        // remainder is exactly the dust §417 sends to the lock.
        assertApproxEqRel(
            remainingValue, collateral, 0.001e18, "the endpoint balances the V3 mint"
        );
    }

    // -----------------------------------------------------------------------
    // Refusals
    // -----------------------------------------------------------------------

    V3MathHarness harness = new V3MathHarness();

    function test_aZeroPriceIsRefused() public {
        vm.expectRevert(V3Math.ZeroPrice.selector);
        harness.sqrtPrice(0, 6, true);
    }

    /// @dev The range guard is defence in depth, and this says so honestly
    ///      rather than testing a case that cannot occur.
    ///
    ///      With `priceWad` a positive integer and decimals at most 36, the
    ///      derived price stays between roughly 1e-36 and 1e36 — comfortably
    ///      inside V3's own bounds at both ends. There is no input in the
    ///      domain that trips it.
    ///
    ///      Asserting that across the extremes is worth more than a contrived
    ///      revert: it says the guard cannot fire for a real market, so if it
    ///      ever does, something upstream is wrong rather than the price being
    ///      unusual.
    function testFuzz_everyRealisticPriceIsInsideV3sRange(
        uint256 priceWad,
        uint8 decimals,
        bool tokenIsToken0
    ) public view {
        priceWad = bound(priceWad, 1, 1e30);
        decimals = uint8(bound(decimals, 0, 24));

        uint160 sqrtPriceX96 = harness.sqrtPrice(priceWad, decimals, tokenIsToken0);

        assertGe(sqrtPriceX96, V3Math.MIN_SQRT_RATIO, "above V3's floor");
        assertLe(sqrtPriceX96, V3Math.MAX_SQRT_RATIO, "below V3's ceiling");
    }

    function test_absurdDecimalsAreRefused() public {
        vm.expectRevert(abi.encodeWithSelector(V3Math.DecimalsTooLarge.selector, uint8(77)));
        harness.sqrtPrice(PG, 77, true);
    }
}

/// @notice An external wrapper, so `expectRevert` has a call frame to catch.
///
/// @dev `V3Math` is an internal library, so its functions are inlined into the
///      caller — a revert then happens at the cheatcode's own depth, which
///      Foundry refuses to match. Testing the refusals at all requires a real
///      external call.
contract V3MathHarness {
    function sqrtPrice(uint256 priceWad, uint8 decimals, bool tokenIsToken0)
        external
        pure
        returns (uint160)
    {
        return V3Math.initialSqrtPriceX96(priceWad, decimals, tokenIsToken0);
    }
}
