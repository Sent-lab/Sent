// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title SENT pre-graduation bonding curve
/// @notice Canonical on-chain curve math. Mirrors `packages/economics/src/curve.ts`
///         and is differential-tested against it — neither may drift (Masterplan §1064).
///
/// LOCKED (§8):
///
///   S    = 1_000_000_000 TOKEN                fixed supply
///   P(q) = P0 + k*q                           linear in the xStock quote unit
///   PG   = 25 * P0                            graduation marginal price
///   qG   = (2*PG*S) / (P0 + 3*PG) = 50/76 * S
///
/// The endpoint is chosen so that curve collateral exactly equals the value of the
/// remaining supply at PG, which is what lets the HyperSwap V3 position be seeded
/// with no creator or treasury top-up.
///
/// ---------------------------------------------------------------------------
/// WHY THIS IS NOT THE TEXTBOOK QUADRATIC
/// ---------------------------------------------------------------------------
/// The closed form for "TOKEN out given quote in" is
///
///     Δ = (sqrt(B² + 2*dP*netIn*qG*WAD) - B) / dP,   B = P0*qG + dP*q
///
/// `B²` does not fit in uint256 for realistic markets. B is maximised at
/// graduation, where B = 25*P0*qG, and P0 scales inversely with the xStock price:
///
///     xStock $200  ->  B² = 2.7e76   fits
///     xStock $100  ->  B² = 1.1e77   fits, at 93% of uint256 max
///     xStock  $50  ->  B² = 4.3e77   OVERFLOWS
///     xStock  $10  ->  B² = 1.1e79   OVERFLOWS
///
/// A naive port would therefore revert on any market whose quote asset trades
/// below roughly $93 — which is most of them. Instead this library:
///
///   1. divides the quadratic through by `dP` before squaring, which caps every
///      intermediate around 1e54 with enormous headroom; then
///   2. corrects the result to be exact using `quoteInFor`, the forward function,
///      which is itself overflow-safe with ~9 orders of magnitude to spare.
///
/// The rescaling introduces at most a few units of error from two floor divisions,
/// so the correction loop is tightly bounded and its convergence is asserted.
///
/// ---------------------------------------------------------------------------
/// EXACT SPECIFICATION (shared with the TypeScript implementation)
/// ---------------------------------------------------------------------------
///     tokensOutFor(q, netIn) = max { Δ : quoteInFor(q, Δ) <= netIn }
///
/// This is a definition, not an approximation, so both implementations can be
/// proven to agree rather than merely observed to agree.
///
/// ROUNDING (D-003): always favours protocol solvency, never the trader.
library Curve {
    uint256 internal constant WAD = 1e18;

    /// @dev Fixed supply, 18 decimals. LOCKED (§2).
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000e18;

    /// @dev Graduation price multiple. LOCKED (§0).
    uint256 internal constant GRADUATION_MULTIPLE = 25;

    /// @dev qG/S = 50/76. P0 cancels out of the endpoint formula, so the split is
    ///      a pure fraction of supply and is identical for every xStock pair.
    uint256 internal constant QG_NUMERATOR = 50;
    uint256 internal constant QG_DENOMINATOR = 76;

    /// @dev Maximum correction steps. The rescaled guess is within a couple of
    ///      units; anything beyond this means an invariant is broken.
    uint256 private constant MAX_CORRECTION_STEPS = 16;

    error CurveInvalidP0();
    error CurvePastEndpoint();
    error CurveInsufficientDistributed();
    error CurveCorrectionFailed();

    struct Params {
        /// @dev Starting marginal price, wad quote per TOKEN. Fixed at launch.
        uint256 p0;
        /// @dev Graduation marginal price = 25 * p0.
        uint256 pg;
        /// @dev dP = pg - p0 = 24 * p0. Exact numerator of k*qG; k is never stored.
        uint256 dP;
        /// @dev Graduation endpoint, token wei.
        uint256 qG;
    }

    /// @notice Build curve parameters from the launch-time starting price.
    /// @param p0 Derived by the market from the $2,000 reference market cap and the
    ///           launch-time xStock/USD reference snapshot (§8, §402). Immutable after launch.
    function params(uint256 p0) internal pure returns (Params memory p) {
        if (p0 == 0) revert CurveInvalidP0();
        p.p0 = p0;
        p.pg = p0 * GRADUATION_MULTIPLE;
        p.dP = p.pg - p0;
        // Floored: graduation triggers a hair early, keeping the LP seed fully funded.
        p.qG = (TOTAL_SUPPLY * QG_NUMERATOR) / QG_DENOMINATOR;
    }

    /// @notice Marginal price at distributed amount `q`: P(q) = p0 + dP*q/qG.
    function marginalPrice(Params memory p, uint256 q) internal pure returns (uint256) {
        if (q > p.qG) revert CurvePastEndpoint();
        return p.p0 + (p.dP * q) / p.qG;
    }

    /// @notice Collateral held by the curve once `q` TOKEN have been distributed.
    /// @dev ∫₀^q P(x) dx = [p0*q + dP*q²/(2*qG)] / WAD, floored — the curve never
    ///      claims collateral it does not hold.
    function collateralAt(Params memory p, uint256 q) internal pure returns (uint256) {
        if (q > p.qG) revert CurvePastEndpoint();
        // Max ~6e67 for the cheapest realistic quote asset; uint256 max is 1.16e77.
        uint256 numerator = 2 * p.p0 * p.qG * q + p.dP * q * q;
        return numerator / (2 * p.qG * WAD);
    }

    /// @notice Exact net quote input required to move the curve by `delta` TOKEN.
    /// @dev The forward function, and the definition against which `tokensOutFor` is
    ///      specified. Rounded UP so the trader is never undercharged.
    function quoteInFor(Params memory p, uint256 q, uint256 delta) internal pure returns (uint256) {
        if (q + delta > p.qG) revert CurvePastEndpoint();
        if (delta == 0) return 0;

        uint256 numerator = 2 * p.p0 * p.qG * delta + p.dP * (2 * q * delta + delta * delta);
        uint256 denominator = 2 * p.qG * WAD;
        return (numerator + denominator - 1) / denominator;
    }

    /// @notice Gross quote output for returning `delta` TOKEN to the curve.
    /// @dev Amount BEFORE the core fee and Stockback contribution are deducted
    ///      (§10 steps 1-4). Floored — the curve never pays more than it owes.
    function grossOutFor(Params memory p, uint256 q, uint256 delta) internal pure returns (uint256) {
        if (delta > q) revert CurveInsufficientDistributed();
        if (q > p.qG) revert CurvePastEndpoint();
        if (delta == 0) return 0;

        uint256 numerator = 2 * p.p0 * p.qG * delta + p.dP * (2 * q * delta - delta * delta);
        return numerator / (2 * p.qG * WAD);
    }

    /// @notice TOKEN out for a given NET quote input.
    /// @param netIn Amount reaching the curve AFTER the core fee and Stockback
    ///        contribution have been removed (§9 steps 2-5). Fees never enter
    ///        collateral, so this function must never be handed gross input.
    /// @return delta The largest Δ with quoteInFor(q, Δ) <= netIn, capped at the
    ///         graduation endpoint. A graduation-crossing order is segmented by the
    ///         market (§411-A); the curve itself never steps past qG.
    function tokensOutFor(Params memory p, uint256 q, uint256 netIn) internal pure returns (uint256 delta) {
        if (q > p.qG) revert CurvePastEndpoint();
        if (netIn == 0) return 0;

        uint256 remaining = p.qG - q;
        if (remaining == 0) return 0;

        // Clamp before the guess, not after. `_initialGuess` multiplies netIn by
        // 2*qG*WAD (~1.3e45) before dividing by dP, and an unbounded netIn
        // overflows that product even though the mathematical answer is simply
        // "all of it". Capping at the cost of the entire remaining reserve keeps
        // netIn inside the realistic band the rescaling was sized for, and is
        // also the correct answer: nobody can buy more than the reserve holds.
        uint256 maxIn = quoteInFor(p, q, remaining);
        if (netIn >= maxIn) return remaining;

        delta = _initialGuess(p, q, netIn);
        if (delta > remaining) delta = remaining;

        // Correct to the exact floor. The guess errs by at most a couple of units
        // from the two floor divisions in the rescaling.
        uint256 steps = 0;

        // forge-lint: disable-next-line(require-revert-in-loop)
        // The revert IS the point: the loop is a bounded correction, and failing
        // to converge means an invariant is broken, so halting is correct.
        while (delta > 0 && quoteInFor(p, q, delta) > netIn) {
            unchecked {
                --delta;
                ++steps;
            }
            if (steps > MAX_CORRECTION_STEPS) revert CurveCorrectionFailed();
        }

        // forge-lint: disable-next-line(require-revert-in-loop)
        while (delta < remaining && quoteInFor(p, q, delta + 1) <= netIn) {
            unchecked {
                ++delta;
                ++steps;
            }
            if (steps > MAX_CORRECTION_STEPS) revert CurveCorrectionFailed();
        }
    }

    /// @dev Rescaled closed form. Dividing the quadratic by `dP` before squaring is
    ///      what keeps every intermediate inside uint256:
    ///
    ///          Δ² + b*Δ - c = 0,   b = 2B/dP,  c = 2*qG*WAD*netIn/dP
    ///          Δ = (sqrt(b² + 4c) - b) / 2
    ///
    ///      Peak intermediate is b² + 4c ~ 1e54 versus a uint256 ceiling of 1.16e77.
    function _initialGuess(Params memory p, uint256 q, uint256 netIn) private pure returns (uint256) {
        uint256 b = (2 * (p.p0 * p.qG + p.dP * q)) / p.dP;
        uint256 c = (2 * p.qG * WAD * netIn) / p.dP;

        // forge-lint: disable-next-line(divide-before-multiply)
        // Deliberate. Dividing by dP BEFORE squaring is the entire reason this
        // function does not overflow (see the header). The precision lost here is
        // recovered exactly by the correction loop in `tokensOutFor`, which uses
        // the overflow-safe forward function as ground truth.
        uint256 root = _sqrt(b * b + 4 * c);
        return root > b ? (root - b) / 2 : 0;
    }

    /// @dev Floor integer square root (Babylonian). Flooring is the conservative
    ///      direction: a smaller root yields fewer TOKEN out.
    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;

        // Seed with a power of two above sqrt(x) so the iteration descends.
        z = x;
        uint256 y = (x >> 1) + 1;
        while (y < z) {
            z = y;
            y = (x / y + y) >> 1;
        }
    }

    /// @notice True once the curve has reached the graduation endpoint (§13).
    function reachedGraduation(Params memory p, uint256 q) internal pure returns (bool) {
        return q >= p.qG;
    }

    /// @notice Supply left undistributed at the endpoint — seeds the V3 position.
    function remainingAtGraduation(Params memory p) internal pure returns (uint256) {
        return TOTAL_SUPPLY - p.qG;
    }
}
