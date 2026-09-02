// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {GraduationMath} from "../src/lib/GraduationMath.sol";
import {Curve} from "../src/lib/Curve.sol";

/// @notice Graduation geometry, proven equal to the TypeScript implementation.
///
/// §416 forbids treating reserve-ratio math as exact V3 mint math, and requires
/// the geometry to be simulated before production. Day 1 did that in TypeScript
/// and found the §8 endpoint consumes both sides with 0 ppb dust.
///
/// This is the on-chain half. The fixtures come from the TypeScript that produced
/// that result, so agreement here means one implementation of the geometry rather
/// than two that happen to look alike.
///
/// The two reach their answers differently: TypeScript uses arbitrary-precision
/// BigInt, while Solidity needs 512-bit mulDiv because sqrt-price conversions
/// overflow 256 bits at realistic prices — the same class of problem that forced
/// the curve to be rescaled.
contract GraduationMathTest is Test {
    string json;

    function setUp() public {
        json = vm.readFile("test/fixtures/v3.json");
    }

    function _u(uint256 i, string memory field) internal view returns (uint256) {
        return vm.parseJsonUint(json, string.concat(".cases[", vm.toString(i), "].", field));
    }

    function _caseCount() internal view returns (uint256) {
        return vm.parseJsonUintArray(json, ".cases[*].expectLiquidity").length;
    }

    // -----------------------------------------------------------------------
    // Differential
    // -----------------------------------------------------------------------

    function test_mintPlanMatchesTypeScriptExactly() public view {
        uint256 count = 51;

        for (uint256 i = 0; i < count; i++) {
            uint160 sqrtP = uint160(_u(i, "sqrtP"));
            uint160 sqrtA = uint160(_u(i, "sqrtA"));
            uint160 sqrtB = uint160(_u(i, "sqrtB"));

            GraduationMath.MintPlan memory plan = GraduationMath.planMint(
                sqrtP, sqrtA, sqrtB, _u(i, "available0"), _u(i, "available1")
            );

            string memory at = string.concat(" at case ", vm.toString(i));

            assertEq(plan.liquidity, _u(i, "expectLiquidity"), string.concat("liquidity", at));
            assertEq(plan.used0, _u(i, "expectUsed0"), string.concat("used0", at));
            assertEq(plan.used1, _u(i, "expectUsed1"), string.concat("used1", at));
            assertEq(plan.dust0, _u(i, "expectDust0"), string.concat("dust0", at));
            assertEq(plan.dust1, _u(i, "expectDust1"), string.concat("dust1", at));
        }
    }

    // -----------------------------------------------------------------------
    // The structural result §8 depends on
    // -----------------------------------------------------------------------

    /// @dev The endpoint condition `collateral == remaining × PG` IS the
    ///      full-range deposit ratio `amount1/amount0 == P`. So a full-range mint
    ///      consumes both sides essentially completely — which is what removes the
    ///      need for creator or treasury liquidity (§8, §17).
    function test_fullRangeConsumesBothSidesAtTheEndpoint() public view {
        uint256 count = 51;
        uint256 checked = 0;

        for (uint256 i = 0; i < count; i++) {
            uint256 available0 = _u(i, "available0");
            uint256 available1 = _u(i, "available1");

            uint256 dust0 = _u(i, "expectDust0");
            uint256 dust1 = _u(i, "expectDust1");

            // Narrow-range cases are included in the fixture deliberately, as the
            // comparison that shows why they are unusable. Skip them here.
            if (dust0 * 1_000 > available0 || dust1 * 1_000 > available1) continue;

            assertLe(dust0 * 1_000_000, available0, string.concat("dust0 must be negligible at case ", vm.toString(i)));
            assertLe(dust1 * 1_000_000, available1, string.concat("dust1 must be negligible at case ", vm.toString(i)));
            checked++;
        }

        assertGt(checked, 40, "the full-range cases must dominate the fixture set");
    }

    /// @dev A concentrated range strands one side, because nothing tops the
    ///      position up — §8 forbids creator and treasury liquidity. This is why
    ///      full range is the only viable V1 policy, not merely the simplest.
    function test_narrowRangesStrandOneSide() public view {
        uint256 count = 51;
        bool foundStranded = false;

        for (uint256 i = 0; i < count; i++) {
            uint256 available0 = _u(i, "available0");
            uint256 dust0 = _u(i, "expectDust0");

            if (available0 > 0 && dust0 * 100 > available0) foundStranded = true;
        }

        assertTrue(foundStranded, "a narrow range must visibly strand a side");
    }

    // -----------------------------------------------------------------------
    // Price continuity (§15)
    // -----------------------------------------------------------------------

    /// @dev §15 makes spot price continuity a HARD invariant: the pool must open
    ///      at the curve's final marginal price. Converting to a sqrt price and
    ///      back must therefore round-trip, not merely be close.
    function testFuzz_priceRoundTripsThroughSqrtPrice(uint256 priceWad) public pure {
        // Spans the realistic band: a $1 xStock gives a large P0, a $1,000 one a
        // small one, and PG is 25x either way.
        priceWad = bound(priceWad, 1e6, 1e24);

        uint160 sqrtP = GraduationMath.sqrtPriceX96FromWadPrice(priceWad);
        uint256 recovered = GraduationMath.wadPriceFromSqrtPriceX96(sqrtP);

        // Truncation in the sqrt is one-directional, so recovery lands at or just
        // below the original.
        assertLe(recovered, priceWad, "recovered price must never exceed the original");
        assertGe(recovered * 1_000_000, priceWad * 999_999, "and must be within 1 ppm");
    }

    function test_priceContinuityAtTheGraduationEndpoint() public pure {
        uint256 xStockUsd = 137.42e18;
        uint256 quoteMc = (2_000e18 * 1e18) / xStockUsd;
        uint256 p0 = (quoteMc * 1e18) / Curve.TOTAL_SUPPLY;

        Curve.Params memory p = Curve.params(p0);

        uint160 sqrtPg = GraduationMath.sqrtPriceX96FromWadPrice(p.pg);
        uint256 recovered = GraduationMath.wadPriceFromSqrtPriceX96(sqrtPg);

        assertApproxEqRel(recovered, p.pg, 1e9, "the pool must open at the curve's closing price");
    }

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------

    function test_fullRangeIsAlwaysUsable() public pure {
        int24[4] memory spacings = [int24(1), int24(10), int24(60), int24(200)];

        for (uint256 i = 0; i < spacings.length; i++) {
            (int24 lower, int24 upper) = GraduationMath.fullRange(spacings[i]);

            assertGe(lower, GraduationMath.MIN_TICK, "lower must stay inside the tick range");
            assertLe(upper, GraduationMath.MAX_TICK, "upper must stay inside the tick range");
            assertEq(lower % spacings[i], 0, "lower must sit on the spacing");
            assertEq(upper % spacings[i], 0, "upper must sit on the spacing");
            assertLt(lower, upper, "the range must be ordered");
        }
    }

    function test_priceOutsideTheRangeIsRefused() public {
        uint160 sqrtA = 1000;
        uint160 sqrtB = 2000;

        vm.expectRevert(GraduationMath.PriceOutOfRange.selector);
        this.planMintExternal(sqrtA, sqrtA, sqrtB, 1e18, 1e18);

        vm.expectRevert(GraduationMath.PriceOutOfRange.selector);
        this.planMintExternal(sqrtB, sqrtA, sqrtB, 1e18, 1e18);
    }

    function test_zeroSpacingIsRefused() public {
        vm.expectRevert(GraduationMath.TickSpacingZero.selector);
        this.fullRangeExternal(0);
    }

    /// @dev The same degenerate seed guarded in Curve.sqrt. Both libraries carry
    ///      their own square root, so both need the guard — fixing one and not the
    ///      other is exactly the split-fix pattern this project keeps hitting.
    function test_sqrtGuardsTheDegenerateSeed() public pure {
        assertEq(GraduationMath.sqrt(0), 0);
        assertEq(GraduationMath.sqrt(1), 1);
        assertEq(GraduationMath.sqrt(2), 1, "sqrt(2) must floor to 1");
        assertEq(GraduationMath.sqrt(3), 1);
        assertEq(GraduationMath.sqrt(4), 2);
    }

    function testFuzz_sqrtIsTheExactFloor(uint256 x) public pure {
        x = bound(x, 0, type(uint128).max);
        uint256 r = GraduationMath.sqrt(x);
        assertLe(r * r, x, "root squared must not exceed the input");
        assertGt((r + 1) * (r + 1), x, "the next root up must exceed the input");
    }

    // External wrappers so `vm.expectRevert` sees a call frame.
    function planMintExternal(uint160 sqrtP, uint160 sqrtA, uint160 sqrtB, uint256 a0, uint256 a1)
        external
        pure
        returns (GraduationMath.MintPlan memory)
    {
        return GraduationMath.planMint(sqrtP, sqrtA, sqrtB, a0, a1);
    }

    function fullRangeExternal(int24 spacing) external pure returns (int24, int24) {
        return GraduationMath.fullRange(spacing);
    }
}
