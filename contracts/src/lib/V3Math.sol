// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title V3Math
/// @notice Turning the curve's closing price into a Uniswap V3 pool price (§15, §415, §416).
///
/// WHY THIS IS ITS OWN FILE
/// ------------------------
/// §15 makes spot price continuity a HARD invariant: the pool must open at the
/// price the curve closed at. §416 forbids "pretending V2 reserve-ratio math is
/// exact V3 mint math", which is the shortcut that makes this look easy.
///
/// Three things have to be right at once, and each is a silent failure:
///
///   The DECIMALS. The curve prices in normalized 18-decimal quote; the pool
///   prices in raw token units. A six-decimal xStock differs by 10^12, and a
///   pool opened at the wrong power of ten is arbitrage waiting for the first
///   block.
///
///   The ORDERING. V3 sorts by address, so whether `price` means quote-per-token
///   or token-per-quote is decided by two addresses nobody chose. Getting it
///   backwards opens the pool at the reciprocal, which for a $50,000 market is a
///   price wrong by a factor of 10^38.
///
///   The SQUARE ROOT. V3 stores sqrt(price) in Q64.96. Precision lost here shows
///   up as a pool that opens a few ticks away from the curve, which is a real
///   loss to the first trader and a §15 violation nobody would notice.
///
/// So it is a pure library, and it is fuzzed against the inverse.
library V3Math {
    /// @dev V3's tick bounds. Constants rather than derived: they come from the
    ///      protocol, and re-deriving them would be inventing a second source.
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    /// @dev The sqrt price bounds V3 itself enforces. A value outside them is
    ///      rejected by the pool, so it is rejected here — where the error can
    ///      still say what happened.
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    error PriceOutOfRange(uint256 sqrtPriceX96);
    error ZeroPrice();
    error DecimalsTooLarge(uint8 decimals);

    /// @notice The full range, aligned to a pool's tick spacing (§415).
    ///
    /// @dev §415 locks V1 to the widest supported range that includes the
    ///      opening price, and the reasoning is the part worth keeping: LP
    ///      principal is permanently locked, so nobody can reposition it. A
    ///      concentrated range that the price leaves is liquidity stranded
    ///      forever, on a market whose whole promise is that its liquidity
    ///      cannot be pulled.
    ///
    ///      Truncation toward zero is what makes this correct in both
    ///      directions: Solidity's `/` rounds toward zero, so the negative bound
    ///      moves UP to a usable tick and the positive bound moves DOWN. Both
    ///      land inside the legal range, which is the direction that cannot
    ///      revert.
    function fullRange(int24 tickSpacing) internal pure returns (int24 lower, int24 upper) {
        lower = (MIN_TICK / tickSpacing) * tickSpacing;
        upper = (MAX_TICK / tickSpacing) * tickSpacing;
    }

    /// @notice The pool's initial sqrt price, from the curve's closing price.
    ///
    /// @param priceWad Normalized quote per whole TOKEN, 18 decimals — the
    ///        curve's own unit, and `curve.pg` at graduation.
    /// @param quoteDecimals The quote asset's real decimals, from the REGISTRY.
    /// @param tokenIsToken0 Whether the launched TOKEN sorts below the quote
    ///        asset. Decided by address, never by preference.
    ///
    /// @dev The conversion, written out because every step of it is a place to
    ///      be wrong by a power of ten:
    ///
    ///        1 TOKEN            = 1e18 token wei
    ///        1 TOKEN            = `priceWad` normalized quote wei (18 dec)
    ///        normalized -> raw  = × 10^quoteDecimals / 1e18
    ///
    ///      so, per single token wei:
    ///
    ///        rawQuote / rawToken = priceWad × 10^quoteDecimals / 1e36
    ///
    ///      V3's `price` is token1 per token0, so that fraction is used as-is
    ///      when TOKEN is token0 and inverted when it is not.
    ///
    ///      `sqrt(P) × 2^96` is computed as `sqrt(P × 2^192)` in one step. Taking
    ///      the square root first and scaling afterwards would throw away half
    ///      the significant digits before they were needed.
    function initialSqrtPriceX96(uint256 priceWad, uint8 quoteDecimals, bool tokenIsToken0)
        internal
        pure
        returns (uint160)
    {
        if (priceWad == 0) revert ZeroPrice();

        // 10^decimals must not overflow, and no real ERC-20 is near this.
        if (quoteDecimals > 36) revert DecimalsTooLarge(quoteDecimals);

        uint256 rawNumerator = priceWad * (10 ** quoteDecimals);
        uint256 rawDenominator = 1e36;

        (uint256 numerator, uint256 denominator) =
            tokenIsToken0 ? (rawNumerator, rawDenominator) : (rawDenominator, rawNumerator);

        /*
         * TWO PATHS, BECAUSE ONE SHIFT DOES NOT COVER THE RANGE.
         *
         * The natural form is `sqrt(P × 2^192)`, which keeps every bit of
         * precision. But `P × 2^192` needs P below 2^64 to fit in a uint256, and
         * an inverted price — TOKEN as token1, which half of all markets will be
         * — pushes P far above that. The fuzz found it immediately.
         *
         * The other natural form, `sqrt(P × 2^96) << 48`, never overflows but
         * throws away half the input's bits. For a small P that is not a rounding
         * difference: at P ≈ 7.6e-28 it is a TEN PERCENT error in the opening
         * price, which §15 would call a violation and a trader would call a loss.
         *
         * So the shift is chosen by magnitude. Above 2^64 the square root itself
         * is at least 2^32, so the halved shift still leaves eighty bits of
         * precision; below it the full shift fits. Neither branch is a fallback —
         * each is exact in its own half of the domain.
         */
        uint256 sqrtPriceX96;

        if (numerator <= denominator << 64) {
            sqrtPriceX96 = Math.sqrt(Math.mulDiv(numerator, 1 << 192, denominator));
        } else {
            sqrtPriceX96 = Math.sqrt(Math.mulDiv(numerator, 1 << 96, denominator)) << 48;
        }

        if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO) {
            revert PriceOutOfRange(sqrtPriceX96);
        }

        return uint160(sqrtPriceX96);
    }

    /// @notice Recover the normalized price from a sqrt price. Testing only.
    ///
    /// @dev Not used in production, and deliberately kept beside the function it
    ///      inverts: a round-trip fuzz is the only check that catches an error
    ///      shared by a forward implementation and its expectation. Written
    ///      against the same three facts — decimals, ordering, Q64.96 — so a
    ///      mistake in the reasoning would have to be made twice, in opposite
    ///      directions, to cancel.
    function priceWadFromSqrt(uint160 sqrtPriceX96, uint8 quoteDecimals, bool tokenIsToken0)
        internal
        pure
        returns (uint256)
    {
        if (quoteDecimals > 36) revert DecimalsTooLarge(quoteDecimals);

        /*
         * `sqrtPriceX96 * sqrtPriceX96` OVERFLOWS, and the fuzz found it.
         *
         * MAX_SQRT_RATIO is about 1.46e48 — roughly 2^160 — so its square is
         * near 2^320 and does not fit in a uint256. The obvious one-line inverse
         * is wrong for every price in the upper half of V3's own range.
         *
         * Squaring through `mulDiv` keeps the 512-bit intermediate and divides
         * back down in the same step, so `q` here is P × 2^96 and stays bounded.
         */
        /*
         * `1e36 / 10^decimals` is exactly `10^(36 - decimals)`, so the scaling
         * is one multiplication rather than a division that would lose the low
         * digits.
         */
        uint256 scale = 10 ** (36 - quoteDecimals);

        /*
         * THE SCALE IS APPLIED FIRST, AND THAT IS THE WHOLE TRICK.
         *
         * Squaring before scaling means computing `P × 2^96` as an intermediate,
         * and for a small P that lands on a single-digit integer — at
         * P ≈ 1e-28 it is literally the number 7, and everything after it is
         * noise. The fuzz reported it as a hundred-fold error on a value of a
         * million.
         *
         * Multiplying by the scale between the two halves of the square keeps
         * both intermediates large, so neither truncation bites.
         */
        return tokenIsToken0
            ? Math.mulDiv(Math.mulDiv(sqrtPriceX96, scale, 1 << 96), sqrtPriceX96, 1 << 96)
            : Math.mulDiv(Math.mulDiv(1 << 96, scale, sqrtPriceX96), 1 << 96, sqrtPriceX96);
    }
}
