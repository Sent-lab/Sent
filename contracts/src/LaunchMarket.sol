// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Curve} from "./lib/Curve.sol";
import {Fees} from "./lib/Fees.sol";
import {XStockAssetAdapter} from "./XStockAssetAdapter.sol";
import {FeeVault} from "./FeeVault.sol";
import {HolderRewardVault} from "./HolderRewardVault.sol";
import {IGraduationRouter} from "./interfaces/IGraduationRouter.sol";

/// @title SENT LaunchMarket
/// @notice The pre-graduation venue: two-way curve trading against an official
///         xStock, automatic graduation, and the accounting that keeps both honest.
///
/// LIFECYCLE (§19) — exactly one canonical venue per state:
///
///   PRE_GRAD    curve is the canonical venue; buy and sell both live
///   GRADUATING  transient, single-transaction; no competing state mutation
///   GRADUATED   curve permanently dead; HyperSwap is the canonical venue
///
/// The masterplan is honest that a freely transferable ERC-20 cannot stop third
/// parties from opening unofficial pools. The invariant is about PROTOCOL-canonical
/// liquidity and routing, and this contract enforces its half: once GRADUATED,
/// `buy` and `sell` here are dead forever.
///
/// COLLATERAL IS A LIABILITY, NOT A BALANCE (§10 step 5, §12)
/// ---------------------------------------------------------
/// `curveCollateral` tracks what the curve OWES, derived from curve math. It is
/// never read from `balanceOf(this)`. That separation is what makes the market
/// immune to a donation attack: sending tokens to this contract changes its balance
/// and changes nothing about what any seller is owed.
///
/// FEES NEVER ENTER COLLATERAL (§8, §12)
/// -------------------------------------
/// The 1% core fee leaves for FeeVault and the Stockback contribution leaves for
/// HolderRewardVault in the same transaction that books them. Neither is ever part
/// of what backs a sell.
///
/// GRADUATION IS AUTOMATIC AND ATOMIC (§14, §16)
/// ---------------------------------------------
/// There is no manual trigger, for anyone — not creator, not governance, not an
/// operator. It happens inside the buy that reaches the endpoint. If any critical
/// migration step fails, the whole transaction reverts: there is no path to a
/// GRADUATED status with an incomplete migration, and no orphaned reserve.
contract LaunchMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Curve for Curve.Params;

    enum Status {
        PRE_GRAD,
        GRADUATING,
        GRADUATED
    }

    // -----------------------------------------------------------------------
    // Immutable wiring
    // -----------------------------------------------------------------------

    address public immutable TOKEN;
    address public immutable QUOTE_ASSET;

    /// @notice Canonical creator identity (§579). The wallet that launched, never
    ///         the platform deployer (§578).
    address public immutable CREATOR;

    address public immutable FACTORY;
    FeeVault public immutable FEE_VAULT;
    HolderRewardVault public immutable REWARD_VAULT;

    uint8 public immutable QUOTE_DECIMALS;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    Status public status;

    /// @dev Curve parameters, fixed at launch. `p0` is anchored to the $2,000
    ///      reference market cap using the launch-time xStock/USD snapshot and is
    ///      never re-anchored by the live feed (§402).
    Curve.Params public curve;

    /// @dev TOKEN distributed along the curve so far, token wei.
    uint256 public distributed;

    /// @dev What the curve OWES, in normalized quote wei. Never a balance read.
    uint256 public curveCollateral;

    /// @dev Holder-neutral surplus from final-segment rounding, handed to the
    ///      router at graduation (§417). Never creator or platform revenue.
    uint256 public graduationDust;

    /// @notice Set by the factory. A market with no router cannot graduate, which
    ///         is the correct failure rather than a half-migration (§16).
    IGraduationRouter public router;

    /// @notice Post-graduation venue metadata (§14 step 9).
    address public pool;
    uint256 public positionId;

    // -----------------------------------------------------------------------
    // Events — the indexer's canonical source (§423)
    // -----------------------------------------------------------------------

    event Bought(
        address indexed buyer,
        uint256 grossQuoteIn,
        uint256 netToCurve,
        uint256 tokensOut,
        uint256 coreFee,
        uint256 stockback,
        uint256 newDistributed,
        uint256 newCollateral
    );

    event Sold(
        address indexed seller,
        uint256 tokensIn,
        uint256 grossQuoteOut,
        uint256 netQuoteOut,
        uint256 coreFee,
        uint256 stockback,
        uint256 newDistributed,
        uint256 newCollateral
    );

    event Graduated(
        address indexed token, address indexed pool, uint256 positionId, uint256 tokenAmount, uint256 quoteAmount
    );

    event CrossingBuy(uint256 preGradGross, uint256 postGradGross, uint256 totalTokensOut);
    event RouterSet(address indexed router);
    event MarketInitialised(
        address indexed token,
        address indexed quoteAsset,
        address indexed creator,
        uint8 quoteDecimals,
        uint256 p0,
        uint256 pg,
        uint256 qG
    );

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error NotFactory();
    error NotPreGrad();
    error DeadlinePassed();
    error ZeroAmount();
    error SlippageExceeded(uint256 got, uint256 minimum);
    error InsufficientCollateral();
    error RouterNotSet();
    error GraduationIncomplete();
    error ZeroAddress();
    error FeeSearchFailed(uint256 gross, uint256 targetNet);
    error CrossingUnderCollateralised(uint256 net, uint256 required);
    error TradeTooSmallToSettleFees();
    error PayoutRoundsToZero();

    /// @dev Bound on the fee-inversion search. The estimate lands within a couple
    ///      of units; anything beyond this means an assumption is broken.
    uint256 private constant MAX_FEE_SEARCH_STEPS = 16;

    modifier onlyPreGrad() {
        if (status != Status.PRE_GRAD) revert NotPreGrad();
        _;
    }

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlinePassed();
        _;
    }

    constructor(
        address token_,
        address quoteAsset_,
        uint8 quoteDecimals_,
        address creator_,
        address feeVault_,
        address rewardVault_,
        uint256 p0_
    ) {
        if (
            token_ == address(0) || quoteAsset_ == address(0) || creator_ == address(0) || feeVault_ == address(0)
                || rewardVault_ == address(0)
        ) revert ZeroAddress();

        TOKEN = token_;
        QUOTE_ASSET = quoteAsset_;
        QUOTE_DECIMALS = quoteDecimals_;
        CREATOR = creator_;
        FACTORY = msg.sender;
        FEE_VAULT = FeeVault(feeVault_);
        REWARD_VAULT = HolderRewardVault(rewardVault_);

        curve = Curve.params(p0_);
        status = Status.PRE_GRAD;

        emit MarketInitialised(
            token_, quoteAsset_, creator_, quoteDecimals_, curve.p0, curve.pg, curve.qG
        );
    }

    /// @notice Wire the graduation router. Factory only, once.
    function setRouter(address router_) external {
        if (msg.sender != FACTORY) revert NotFactory();
        if (router_ == address(0)) revert ZeroAddress();
        router = IGraduationRouter(router_);
        emit RouterSet(router_);
    }

    // -----------------------------------------------------------------------
    // BUY (§9)
    // -----------------------------------------------------------------------

    /// @notice Buy TOKEN with the market's official paired xStock.
    /// @param grossQuoteIn Gross amount in RAW asset units. Fees come off this
    ///        first (§9 steps 2-5); only the remainder reaches the curve.
    /// @param minTokensOut A single user-wide bound. For a crossing order it spans
    ///        both the final curve segment and the post-grad leg (§14, §411), so a
    ///        blended route can never deliver less than the user accepted.
    function buy(uint256 grossQuoteIn, uint256 minTokensOut, uint256 deadline)
        external
        nonReentrant
        onlyPreGrad
        beforeDeadline(deadline)
        returns (uint256 tokensOut)
    {
        if (grossQuoteIn == 0) revert ZeroAmount();

        IERC20(QUOTE_ASSET).safeTransferFrom(msg.sender, address(this), grossQuoteIn);

        uint256 grossNormalized = _normalize(grossQuoteIn);
        uint256 remainingSupply = curve.qG - distributed;

        // Net the whole input would deliver to the curve.
        Fees.Breakdown memory whole = Fees.forBuy(grossNormalized);

        // Net required to reach the endpoint exactly.
        uint256 netToEndpoint = Curve.quoteInFor(curve, distributed, remainingSupply);

        if (whole.net < netToEndpoint) {
            // Ordinary buy: does not reach graduation.
            tokensOut = _executePreGradBuy(msg.sender, grossNormalized, whole);
            if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);
            return tokensOut;
        }

        // Crossing order (§411). Segment the input so PRE_GRAD fees apply only to
        // the notional that actually executes on the curve.
        tokensOut = _executeCrossingBuy(msg.sender, grossNormalized, netToEndpoint, remainingSupply);
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);
    }

    function _executePreGradBuy(address buyer, uint256 grossNormalized, Fees.Breakdown memory f)
        private
        returns (uint256 tokensOut)
    {
        tokensOut = Curve.tokensOutFor(curve, distributed, f.net);
        if (tokensOut == 0) revert ZeroAmount();

        // Effects before any external interaction.
        distributed += tokensOut;
        curveCollateral += f.net;

        _settleFees(f);

        IERC20(TOKEN).safeTransfer(buyer, tokensOut);

        emit Bought(
            buyer, grossNormalized, f.net, tokensOut, f.coreFee, f.stockback, distributed, curveCollateral
        );
    }

    function _executeCrossingBuy(
        address buyer,
        uint256 grossNormalized,
        uint256 netToEndpoint,
        uint256 remainingSupply
    ) private returns (uint256 tokensOut) {
        // Smallest gross whose post-fee net covers the endpoint exactly.
        uint256 preGradGross = _grossForNet(netToEndpoint);
        if (preGradGross > grossNormalized) preGradGross = grossNormalized;

        Fees.Breakdown memory f = Fees.forBuy(preGradGross);

        // Defence in depth. `_grossForNet` already asserts this, but the clamp
        // above can only lower `preGradGross`, so the guarantee is re-checked
        // where the credit actually happens. Booking netToEndpoint against a
        // smaller receipt would under-collateralise the curve.
        if (f.net < netToEndpoint) revert CrossingUnderCollateralised(f.net, netToEndpoint);

        // The curve consumes exactly what the endpoint costs. Any excess from
        // fee-rounding is holder-neutral dust, not revenue (§417).
        uint256 excess = f.net - netToEndpoint;

        distributed += remainingSupply;
        curveCollateral += netToEndpoint;
        graduationDust += excess;

        _settleFees(f);

        uint256 curveTokens = remainingSupply;
        IERC20(TOKEN).safeTransfer(buyer, curveTokens);

        emit Bought(
            buyer, preGradGross, netToEndpoint, curveTokens, f.coreFee, f.stockback, distributed, curveCollateral
        );

        // Graduate atomically. Any failure here reverts the entire user action —
        // there is no GRADUATED status without a complete migration (§16).
        _graduate();

        uint256 postGradGross = grossNormalized - preGradGross;
        uint256 postGradTokens = 0;

        if (postGradGross > 0) {
            // Post-grad notional pays HyperSwap's fee, never PRE_GRAD rates (§411).
            uint256 raw = _denormalizeForPayout(postGradGross);
            if (raw > 0) {
                IERC20(QUOTE_ASSET).safeTransfer(address(router), raw);
                postGradTokens = router.swapExactQuoteForToken(TOKEN, QUOTE_ASSET, raw, buyer);
            }
        }

        tokensOut = curveTokens + postGradTokens;
        emit CrossingBuy(preGradGross, postGradGross, tokensOut);
    }

    // -----------------------------------------------------------------------
    // SELL (§10)
    // -----------------------------------------------------------------------

    /// @notice Sell TOKEN back to the curve. Available only while PRE_GRAD; after
    ///         graduation the curve is permanently closed and HyperSwap is the venue.
    function sell(uint256 tokensIn, uint256 minQuoteOut, uint256 deadline)
        external
        nonReentrant
        onlyPreGrad
        beforeDeadline(deadline)
        returns (uint256 netOutRaw)
    {
        if (tokensIn == 0) revert ZeroAmount();

        IERC20(TOKEN).safeTransferFrom(msg.sender, address(this), tokensIn);

        // The curve runs FIRST, then fees come off its output (§10 steps 1-4).
        uint256 grossOut = Curve.grossOutFor(curve, distributed, tokensIn);
        Fees.Breakdown memory f = Fees.forSell(grossOut);

        // Collateral is reduced by the curve LIABILITY, not by a balance read.
        if (grossOut > curveCollateral) revert InsufficientCollateral();

        distributed -= tokensIn;
        curveCollateral -= grossOut;

        _settleFees(f);

        netOutRaw = _denormalizeForPayout(f.net);

        // A sell that pays nothing would still consume the seller's TOKEN. The
        // curve is not harmed by it, but the seller is, so it is rejected rather
        // than executed for zero.
        if (netOutRaw == 0) revert PayoutRoundsToZero();
        if (netOutRaw < minQuoteOut) revert SlippageExceeded(netOutRaw, minQuoteOut);

        IERC20(QUOTE_ASSET).safeTransfer(msg.sender, netOutRaw);

        emit Sold(
            msg.sender, tokensIn, grossOut, f.net, f.coreFee, f.stockback, distributed, curveCollateral
        );
    }

    // -----------------------------------------------------------------------
    // Fee settlement — money leaves in the same transaction it is booked
    // -----------------------------------------------------------------------

    /// @dev Settlement happens in RAW asset units, because that is what the vaults
    ///      hold and pay out in.
    ///
    ///      Booking the NORMALIZED figures here was a fund-blocking bug: at 18
    ///      decimals raw and normalized coincide, so it looked correct, but for a
    ///      6-decimal quote asset the vault was credited 10^12 times what it
    ///      actually held and the first creator claim reverted on an insufficient
    ///      balance. Every market test used an 18-decimal asset, which hid it
    ///      completely.
    ///
    ///      The 65/35 split is therefore re-derived from the RAW core fee through
    ///      `Fees.splitCore`, so creator + platform equals exactly what was
    ///      transferred, with no unit mixing anywhere.
    function _settleFees(Fees.Breakdown memory f) private {
        if (f.coreFee > 0) {
            uint256 coreRaw = _denormalizeForPayout(f.coreFee);

            // A trade whose fee rounds away to nothing must be REJECTED, not
            // waved through.
            //
            // Skipping settlement when the raw fee is zero looked harmless and was
            // not: it made every trade below the fee dust floor completely free.
            // For a 6-decimal quote asset that band runs to ~0.0001 xStock, so an
            // order could be split into micro-fills that pay no core fee and fund
            // no Stockback at all. Section 314.2 says the creator's share may
            // never be reduced, and silently losing it to rounding reduces it.
            //
            // Rejecting instead of skipping also makes the minimum trade size
            // emergent and exact: the smallest trade that can pay its own fee.
            if (coreRaw == 0) revert TradeTooSmallToSettleFees();

            (uint256 creatorRaw, uint256 platformRaw) = Fees.splitCore(coreRaw);
            IERC20(QUOTE_ASSET).safeTransfer(address(FEE_VAULT), coreRaw);
            FEE_VAULT.accrue(CREATOR, QUOTE_ASSET, creatorRaw, platformRaw);
        }

        if (f.stockback > 0) {
            uint256 sbRaw = _denormalizeForPayout(f.stockback);
            if (sbRaw == 0) revert TradeTooSmallToSettleFees();

            IERC20(QUOTE_ASSET).safeTransfer(address(REWARD_VAULT), sbRaw);
            REWARD_VAULT.fund(sbRaw);
        }
    }

    /// @notice Curve liability expressed in RAW asset units.
    /// @dev `curveCollateral` is normalized. Any solvency comparison against this
    ///      contract's balance must go through here, or it is only correct by
    ///      accident at 18 decimals.
    function collateralInAssetUnits() external view returns (uint256) {
        return _denormalizeForPayout(curveCollateral);
    }

    // -----------------------------------------------------------------------
    // Graduation (§14, §15, §16)
    // -----------------------------------------------------------------------

    function _graduate() private {
        if (address(router) == address(0)) revert RouterNotSet();

        status = Status.GRADUATING;

        uint256 tokenAmount = IERC20(TOKEN).balanceOf(address(this));
        uint256 quoteAmount = curveCollateral;
        uint256 dust = graduationDust;

        // Migrated collateral is zeroed per accounting (§14 step 10): it is no
        // longer a curve liability, it is now locked LP principal.
        curveCollateral = 0;
        graduationDust = 0;

        uint256 tokenRaw = tokenAmount;
        uint256 quoteRaw = _denormalizeForPayout(quoteAmount);
        uint256 dustRaw = _denormalizeForPayout(dust);

        IERC20(TOKEN).safeTransfer(address(router), tokenRaw);
        IERC20(QUOTE_ASSET).safeTransfer(address(router), quoteRaw + dustRaw);

        // The pool must open at the curve's closing marginal price (§15). The
        // caller cannot choose a migration ratio; it is derived from market state.
        (address pool_, uint256 positionId_) = router.graduate(
            TOKEN, QUOTE_ASSET, tokenRaw, quoteRaw, curve.pg, dustRaw
        );

        if (pool_ == address(0)) revert GraduationIncomplete();

        pool = pool_;
        positionId = positionId_;
        status = Status.GRADUATED;

        emit Graduated(TOKEN, pool_, positionId_, tokenRaw, quoteRaw);
    }

    // -----------------------------------------------------------------------
    // Quoting — the SAME path execution uses (§315 quote-equals-execute law)
    // -----------------------------------------------------------------------

    /// @notice Quote a buy. Calls the identical fee and curve functions execution
    ///         does, so a quote can never disagree with a fill.
    function quoteBuy(uint256 grossQuoteIn)
        external
        view
        returns (uint256 tokensOut, uint256 coreFee, uint256 stockback, uint256 netToCurve, bool crosses)
    {
        uint256 grossNormalized = _normalize(grossQuoteIn);
        Fees.Breakdown memory f = Fees.forBuy(grossNormalized);

        uint256 remainingSupply = curve.qG - distributed;
        uint256 netToEndpoint = Curve.quoteInFor(curve, distributed, remainingSupply);

        crosses = f.net >= netToEndpoint;

        if (crosses) {
            // Only the curve leg is quotable here; the post-grad leg depends on
            // live HyperSwap state and is quoted by the router.
            return (remainingSupply, f.coreFee, f.stockback, netToEndpoint, true);
        }

        return (Curve.tokensOutFor(curve, distributed, f.net), f.coreFee, f.stockback, f.net, false);
    }

    /// @notice Quote a sell, using the same functions execution uses.
    function quoteSell(uint256 tokensIn)
        external
        view
        returns (uint256 netOutRaw, uint256 grossOut, uint256 coreFee, uint256 stockback)
    {
        grossOut = Curve.grossOutFor(curve, distributed, tokensIn);
        Fees.Breakdown memory f = Fees.forSell(grossOut);
        return (_denormalizeForPayout(f.net), grossOut, f.coreFee, f.stockback);
    }

    /// @notice Current marginal price, wad quote per TOKEN.
    function marginalPrice() external view returns (uint256) {
        return Curve.marginalPrice(curve, distributed);
    }

    /// @notice Progress toward graduation in basis points of the endpoint.
    function graduationProgressBps() external view returns (uint256) {
        return (distributed * 10_000) / curve.qG;
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    /// @dev Smallest gross whose post-fee net is at least `targetNet`.
    ///
    ///      net(g) = g - floor(g/100) - floor(g/100) for a BUY. This is NOT
    ///      monotonic: at g = 99 -> 100 the net actually falls from 99 to 98,
    ///      because both floors step at once. So it cannot be inverted by a single
    ///      division, and a search cannot assume monotonicity either.
    ///
    ///      The estimate is corrected against the real fee function, then the
    ///      result is ASSERTED. An earlier version broke out of the loop on
    ///      non-convergence, which would have credited `netToEndpoint` to
    ///      collateral while the market had actually received less — a silent
    ///      under-collateralisation. Failing loudly is the only acceptable
    ///      outcome here.
    function _grossForNet(uint256 targetNet) private pure returns (uint256 gross) {
        if (targetNet == 0) return 0;

        // net ~= gross * 98%, so gross ~= net / 0.98.
        gross = (targetNet * 10_000 + 9_799) / 9_800;

        // Walk up until the net covers the target.
        for (uint256 i = 0; i < MAX_FEE_SEARCH_STEPS; i++) {
            if (Fees.forBuy(gross).net >= targetNet) break;
            unchecked {
                ++gross;
            }
        }

        // Then walk back down to the smallest gross that still covers it.
        for (uint256 i = 0; i < MAX_FEE_SEARCH_STEPS; i++) {
            if (gross == 0 || Fees.forBuy(gross - 1).net < targetNet) break;
            unchecked {
                --gross;
            }
        }

        // The whole crossing path depends on this holding. If it does not, the
        // market would book collateral it never received.
        if (Fees.forBuy(gross).net < targetNet) revert FeeSearchFailed(gross, targetNet);
    }

    function _adapterConfig() private view returns (XStockAssetAdapter.AssetConfig memory) {
        return XStockAssetAdapter.AssetConfig({
            asset: QUOTE_ASSET,
            decimals: QUOTE_DECIMALS,
            // An asset with multiplier semantics cannot pass the §420 gates until
            // V-03 closes, so a market can never be constructed against one.
            hasMultiplierSemantics: false
        });
    }

    function _normalize(uint256 raw) private view returns (uint256) {
        return XStockAssetAdapter.toNormalized(_adapterConfig(), raw);
    }

    function _denormalizeForPayout(uint256 normalized) private view returns (uint256) {
        return XStockAssetAdapter.toRawForPayout(_adapterConfig(), normalized);
    }
}
