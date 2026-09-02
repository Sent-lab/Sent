// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title SENT graduation geometry
/// @notice Uniswap V3 concentrated-liquidity math for the graduation mint.
///
/// §416 is explicit that HyperSwap V3 minting uses tick/range liquidity math, not
/// a generic constant-product reserve deposit, and forbids "pretending V2
/// reserve-ratio math is exact V3 mint math."
///
/// This is the on-chain half of that requirement. It mirrors
/// `packages/economics/src/v3.ts`, which proved on Day 1 that the §8 endpoint
/// consumes both sides with 0 ppb dust across every enabled fee tier and both
/// token orderings — and the two are differential-tested against each other.
///
/// WHY THIS EXISTS SEPARATELY FROM THE ROUTER
/// ------------------------------------------
/// The router needs verified HyperSwap addresses (V-06) and a permanent-lock
/// primitive (V-09), neither of which is confirmed. The MATH needs neither, and
/// it is the part most likely to be wrong.
///
/// Separating them means the geometry can be proven now rather than waiting on
/// facts nobody has yet — and when the addresses land, what remains is wiring
/// rather than arithmetic.
///
/// THE STRUCTURAL RESULT (Day 1)
/// -----------------------------
/// A full-range position needs amount1/amount0 == P. §8 chose the endpoint so
/// that collateral == remaining × PG. Those are the same equation, so the
/// graduation assets already arrive at exactly the full-range deposit ratio.
///
/// A concentrated range does NOT work here: it strands one side as dust, because
/// nothing tops the position up — §8 forbids creator and treasury liquidity.
library GraduationMath {
    /// @dev Q96 = 2^96, the Uniswap V3 sqrt-price fixed point.
    uint256 internal constant Q96 = 0x1000000000000000000000000;

    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    uint256 internal constant WAD = 1e18;

    error PriceOutOfRange();
    error RangeInverted();
    error ZeroLiquidity();
    error TickSpacingZero();

    /// @notice The usable full range for a tick spacing.
    /// @dev Bounds are pulled INWARD to the nearest usable tick. Rounding outward
    ///      would produce ticks the pool rejects, and the failure would surface
    ///      inside the graduation transaction — the one place a revert is most
    ///      expensive, because it blocks a trade that already crossed the endpoint.
    function fullRange(int24 tickSpacing) internal pure returns (int24 lower, int24 upper) {
        if (tickSpacing <= 0) revert TickSpacingZero();

        lower = (MIN_TICK / tickSpacing) * tickSpacing;
        if (lower < MIN_TICK) lower += tickSpacing;

        upper = (MAX_TICK / tickSpacing) * tickSpacing;
        if (upper > MAX_TICK) upper -= tickSpacing;
    }

    /// @notice Liquidity supported by an amount of token0 over [current, upper].
    ///
    /// @dev L = amount0·sb·sp / ((sb − sp)·Q96), evaluated in two 512-bit steps.
    ///
    ///      The direct product overflows: at full range `sb` approaches 1.46e48
    ///      and a reserve of ~3.4e26 tokens puts `amount0·sb·sp` near 1e100. That
    ///      is the same class of failure that forced the curve to be rescaled, and
    ///      it appears here for the same reason — arbitrary-precision maths in the
    ///      reference implementation hides it until the port.
    ///
    ///      The two-step form is Uniswap's own, so the flooring behaviour is the
    ///      one the venue itself exhibits. The TypeScript mirror uses the same two
    ///      steps rather than one exact expression, or the two would disagree by a
    ///      wei and the differential test would be measuring the wrong thing.
    function liquidityForAmount0(uint160 sqrtP, uint160 sqrtB, uint256 amount0)
        internal
        pure
        returns (uint256)
    {
        if (sqrtB <= sqrtP) revert RangeInverted();
        uint256 intermediate = mulDiv(uint256(sqrtP), uint256(sqrtB), Q96);
        return mulDiv(amount0, intermediate, uint256(sqrtB) - uint256(sqrtP));
    }

    /// @notice Liquidity supported by an amount of token1 over [lower, current].
    /// @dev amount1 = L·(sp − sa) / Q96  ⟹  L = amount1·Q96 / (sp − sa)
    function liquidityForAmount1(uint160 sqrtA, uint160 sqrtP, uint256 amount1)
        internal
        pure
        returns (uint256)
    {
        if (sqrtP <= sqrtA) revert RangeInverted();
        return (amount1 * Q96) / (uint256(sqrtP) - uint256(sqrtA));
    }

    /// @notice token0 required to mint `liquidity` over [current, upper].
    /// @dev Uniswap's two-step form, for the same overflow reason as above.
    function amount0ForLiquidity(uint160 sqrtP, uint160 sqrtB, uint256 liquidity)
        internal
        pure
        returns (uint256)
    {
        if (sqrtB <= sqrtP) return 0;
        return mulDiv(liquidity << 96, uint256(sqrtB) - uint256(sqrtP), uint256(sqrtB)) / uint256(sqrtP);
    }

    /// @notice token1 required to mint `liquidity` over [lower, current].
    function amount1ForLiquidity(uint160 sqrtA, uint160 sqrtP, uint256 liquidity)
        internal
        pure
        returns (uint256)
    {
        if (sqrtP <= sqrtA) return 0;
        uint256 numerator = liquidity * (uint256(sqrtP) - uint256(sqrtA));
        return (numerator + Q96 - 1) / Q96;
    }

    struct MintPlan {
        uint256 liquidity;
        uint256 used0;
        uint256 used1;
        /// @dev Leftovers the mint could not absorb. §417 requires a deterministic
        ///      holder-neutral destination: added to locked liquidity where the
        ///      venue permits, otherwise a non-withdrawable account. Never credited
        ///      to creator or platform as a windfall.
        uint256 dust0;
        uint256 dust1;
    }

    /// @notice Plan the graduation mint from the assets actually available.
    /// @dev Liquidity is the largest BOTH sides support. Taking either side alone
    ///      would demand more of the other than the market holds, and the mint
    ///      would revert inside the graduating trade.
    function planMint(
        uint160 sqrtP,
        uint160 sqrtA,
        uint160 sqrtB,
        uint256 available0,
        uint256 available1
    ) internal pure returns (MintPlan memory plan) {
        if (sqrtP <= sqrtA || sqrtP >= sqrtB) revert PriceOutOfRange();

        uint256 l0 = liquidityForAmount0(sqrtP, sqrtB, available0);
        uint256 l1 = liquidityForAmount1(sqrtA, sqrtP, available1);

        plan.liquidity = l0 < l1 ? l0 : l1;
        if (plan.liquidity == 0) revert ZeroLiquidity();

        plan.used0 = amount0ForLiquidity(sqrtP, sqrtB, plan.liquidity);
        plan.used1 = amount1ForLiquidity(sqrtA, sqrtP, plan.liquidity);

        // A rounding-up on the used side can exceed the available amount by a
        // wei. Clamp rather than underflow: the mint takes what is there.
        if (plan.used0 > available0) plan.used0 = available0;
        if (plan.used1 > available1) plan.used1 = available1;

        plan.dust0 = available0 - plan.used0;
        plan.dust1 = available1 - plan.used1;
    }

    /// @notice sqrtPriceX96 for a wad price of token1 per token0, both 18 decimals.
    /// @dev sqrtPriceX96 = sqrt(priceWad / 1e18) · 2^96 = sqrt(priceWad · 2^192 / 1e18)
    function sqrtPriceX96FromWadPrice(uint256 priceWad) internal pure returns (uint160) {
        if (priceWad == 0) revert PriceOutOfRange();

        // priceWad · 2^192 overflows uint256 for large prices, so the shift is
        // split around the square root: sqrt(x · 2^192) == sqrt(x · 2^96) · 2^48.
        uint256 inner = mulDiv(priceWad, 1 << 96, WAD);
        uint256 root = sqrt(inner) << 48;

        if (root > type(uint160).max) revert PriceOutOfRange();
        return uint160(root);
    }

    /// @notice Recover the wad price implied by a sqrtPriceX96.
    /// @dev Used to prove spot-price continuity against the curve's closing price
    ///      (§15) rather than assuming the conversion round-trips.
    function wadPriceFromSqrtPriceX96(uint160 sqrtP) internal pure returns (uint256) {
        uint256 p = uint256(sqrtP);
        return mulDiv(p * p, WAD, Q96 * Q96);
    }

    /// @dev Floor integer square root. Guards x <= 3 for the same reason
    ///      `Curve.sqrt` does: the Babylonian seed equals x at x = 2, the descent
    ///      never runs, and the function returns its own input.
    function sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x <= 3) return x == 0 ? 0 : 1;

        z = x;
        uint256 y = (x >> 1) + 1;
        while (y < z) {
            z = y;
            y = (x / y + y) >> 1;
        }
    }

    /// @dev 512-bit multiply-divide. Needed because sqrt-price conversions
    ///      overflow 256 bits at realistic prices — the same class of problem that
    ///      forced the curve to be rescaled.
    function mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }

            if (prod1 == 0) {
                require(denominator > 0, "mulDiv: zero denominator");
                return prod0 / denominator;
            }

            require(denominator > prod1, "mulDiv: overflow");

            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;

            uint256 inv = (3 * denominator) ^ 2;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;

            result = prod0 * inv;
        }
    }
}
