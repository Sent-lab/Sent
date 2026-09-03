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
///   GRADUATING  curve permanently closed, HyperSwap position not yet minted;
///               NO state mutation of any kind is reachable in this state
///   GRADUATED   curve permanently dead; HyperSwap is the canonical venue
///
/// GRADUATING IS A REAL STATE, NOT A TRANSIENT ONE (D-016, V-20)
/// ------------------------------------------------------------
/// It was written as a single-transaction flicker, because §14 graduates inside
/// the buy that crosses the endpoint. That does not fit on this chain.
///
/// HyperEVM produces two block lanes. The default one caps at 3,000,000 gas and
/// runs at 99.8% of that ceiling in ordinary blocks; the opt-in one caps at
/// 30,000,000 and is produced roughly once in 120 blocks. A full graduation
/// measures 5,395,811 gas, of which HyperSwap's own `createPool` is 2,777,465 -
/// 92.6% of an entire default-lane block before this protocol does anything.
///
/// So a crossing buy could not be included at all for a buyer on the default
/// lane, which is essentially every buyer. The market would stall one wei short
/// of graduating, permanently, since every retry fails identically.
///
/// §16 and §95.6 prescribe the answer for exactly this case: "jika dependency
/// eksternal mengharuskan retryable workflow" - deterministic escrow, a
/// permissionless `finalizeGraduation()`, idempotent retry, and no privilege for
/// the caller who finalises. The block lane is that external dependency.
///
/// The escrow is deterministic because there is nothing left to determine. When
/// the curve closes, `distributed`, `curveCollateral` and `graduationDust` are
/// fixed by curve math, and every function that could move them is `onlyPreGrad`.
/// `finalizeGraduation` reads frozen state; it cannot be front-run into a
/// different migration ratio, because there is no other ratio to reach.
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

    /// @dev `refundedGross` is quote returned to the buyer unspent, in normalized
    ///      units. It is NOT a post-graduation fill: see `_executeCrossingBuy`.
    event CrossingBuy(uint256 preGradGross, uint256 refundedGross, uint256 totalTokensOut);

    /// @dev The curve closed and the migration is now owed. Emitted in the buy
    ///      that crosses; `Graduated` follows from `finalizeGraduation`. An
    ///      indexer seeing this without a matching `Graduated` is looking at a
    ///      market that needs a finaliser, which is exactly the alert (V-20).
    event GraduationPending(
        address indexed token, uint256 tokenAmount, uint256 quoteAmount, uint256 pg
    );
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
    error RouterAlreadySet();
    error GraduationIncomplete();
    error NotGraduating();
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

    /// @notice Wire the graduation router. Factory only, and ONCE.
    /// @dev The doc comment said "once" while the code allowed repeated calls.
    ///      Today nothing calls this after launch, so the market was safe by
    ///      absence of a caller rather than by structure - and the router
    ///      receives the entire remaining reserve and all curve collateral at
    ///      graduation, which is the last place to rely on nobody happening to
    ///      call something.
    ///
    ///      §559 forbids governance from redirecting user or creator assets. A
    ///      write-once router makes that structural.
    function setRouter(address router_) external {
        if (msg.sender != FACTORY) revert NotFactory();
        if (router_ == address(0)) revert ZeroAddress();
        if (address(router) != address(0)) revert RouterAlreadySet();
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

        // Close the curve. This is §14 step 3, and on this chain it is where the
        // user's transaction ends — the migration itself cannot fit in the block
        // lane an ordinary buyer sends to (V-20, D-016, and the note on the
        // GRADUATING state above).
        _enterGraduating();

        /*
         * The excess is REFUNDED, not swapped.
         *
         * §14's crossing order says public UX "boleh bablas" through graduation
         * — may, not must — and makes the blended bound a requirement only where
         * a blended execution exists. Here none does: at this instant the pool
         * has not been created, so there is no venue to route the remainder to
         * and no price at which to route it.
         *
         * Refunding is the honest settlement of that. The buyer paid the curve
         * for exactly what the curve sold them and gets the rest of their money
         * back in the same transaction — never a claim to chase later.
         *
         * It also closes V-19 rather than mitigating it. That row is open
         * because `minTokensOut` bounds the curve leg while the post-grad leg
         * rode along unprotected, so a user's slippage limit covered part of
         * their own trade. With no post-grad leg, the curve leg IS the trade and
         * the bound covers all of it. The weaker-than-§14 bound is not being
         * accepted as a risk; it stops existing.
         */
        uint256 refundGross = grossNormalized - preGradGross;

        if (refundGross > 0) {
            uint256 refundRaw = _denormalizeForPayout(refundGross);

            // `toRawForPayout` rounds down, so on a sub-18-decimal quote asset a
            // sliver smaller than one raw unit cannot be returned. It is booked
            // as dust and migrates into the LP, which is holder-neutral (§417).
            // Leaving it unbooked would strand it in a market that never trades
            // again — the one outcome nobody benefits from.
            graduationDust += refundGross - _normalize(refundRaw);

            if (refundRaw > 0) IERC20(QUOTE_ASSET).safeTransfer(buyer, refundRaw);
        }

        tokensOut = curveTokens;
        emit CrossingBuy(preGradGross, refundGross, tokensOut);
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

    // -----------------------------------------------------------------------
    // Post-graduation LP fees (§396, §397, §399, §418)
    // -----------------------------------------------------------------------

    /// @notice The lock that holds this market's LP position after graduation.
    /// @dev Set once, by the router, during the graduation transaction. The
    ///      market cannot know it earlier: the lock is told which market a
    ///      position belongs to at mint time, and the position does not exist
    ///      until then.
    address public liquidityLock;

    event PostGradFeesSettled(
        uint256 tokenFees, uint256 quoteFees, uint256 stockbackFunded
    );

    error NotTheRouter();
    error LockAlreadySet();
    error NotGraduated();

    /// @dev Called by the router inside `graduate`, once, forever.
    function setLiquidityLock(address lock) external {
        if (msg.sender != address(router)) revert NotTheRouter();
        if (liquidityLock != address(0)) revert LockAlreadySet();
        liquidityLock = lock;
    }

    /// @notice Collect this market's LP fees and split them (§399). Anyone may call.
    ///
    /// @dev PERMISSIONLESS, for the reason §414 gives: a permissioned collector
    ///      is a party who can stop paying the creator by doing nothing. There is
    ///      nothing to gain by calling it — every destination is fixed.
    ///
    /// TWO ASSETS, NEVER COLLAPSED (§400, §418)
    /// ----------------------------------------
    /// A V3 position earns fees in BOTH pool assets, and §418 forbids assuming
    /// otherwise. The two are settled separately and credited under their own
    /// asset in the vault, because §400 says not to collapse them into one
    /// nominal number — a creator's claim is in the assets actually collected.
    ///
    /// §397 forbids selling the TOKEN side to fund Stockback: that would be
    /// protocol-induced sell pressure on the market's own token, with MEV
    /// exposure, to simplify an accounting line.
    ///
    /// THE SPLIT (§396, FINAL LOCK)
    /// ----------------------------
    ///   TOKEN side:  65% creator, 35% platform
    ///   quote side:  65% creator, then the platform's 35% halved —
    ///                17.5% Stockback, 17.5% platform
    ///
    /// Stockback is funded only from the paired xStock, because that is the
    /// reward asset (§419). The same split applied to TOKEN fees would fund a
    /// reward denominated in something holders were never promised.
    function collectPostGradFees()
        external
        nonReentrant
        returns (uint256 tokenFees, uint256 quoteFees)
    {
        if (status != Status.GRADUATED) revert NotGraduated();
        if (liquidityLock == address(0)) revert NotGraduated();

        // Balances BEFORE, because the lock pays this contract directly and the
        // market may already hold quote it has not settled — reading a balance
        // after and calling it a fee would credit the curve's own dust as
        // revenue.
        uint256 tokenBefore = IERC20(TOKEN).balanceOf(address(this));
        uint256 quoteBefore = IERC20(QUOTE_ASSET).balanceOf(address(this));

        ILiquidityLock(liquidityLock).collect(positionId);

        tokenFees = IERC20(TOKEN).balanceOf(address(this)) - tokenBefore;
        quoteFees = IERC20(QUOTE_ASSET).balanceOf(address(this)) - quoteBefore;

        uint256 stockbackFunded;

        if (tokenFees > 0) {
            // §397: TOKEN-side platform revenue stays with the platform. It is
            // never converted, so no part of it reaches Stockback.
            (uint256 creatorToken, uint256 platformToken) = Fees.splitCore(tokenFees);
            IERC20(TOKEN).safeTransfer(address(FEE_VAULT), tokenFees);
            FEE_VAULT.accrue(CREATOR, TOKEN, creatorToken, platformToken);
        }

        if (quoteFees > 0) {
            (uint256 creatorQuote, uint256 platformQuote) = Fees.splitCore(quoteFees);

            /*
             * Half the platform's share, rounded DOWN to Stockback.
             *
             * Rounding the other way would take a wei from the platform on every
             * odd amount, which is harmless — but §327's principle is that dust
             * decisions are made deliberately and in one direction. Down keeps
             * the platform's retained share the residual, matching how every
             * other split in this contract resolves its remainder.
             */
            stockbackFunded = platformQuote / 2;
            uint256 platformRetained = platformQuote - stockbackFunded;

            if (stockbackFunded > 0) {
                IERC20(QUOTE_ASSET).safeTransfer(address(REWARD_VAULT), stockbackFunded);
                REWARD_VAULT.fund(stockbackFunded);
            }

            IERC20(QUOTE_ASSET).safeTransfer(
                address(FEE_VAULT), creatorQuote + platformRetained
            );
            FEE_VAULT.accrue(CREATOR, QUOTE_ASSET, creatorQuote, platformRetained);
        }

        emit PostGradFeesSettled(tokenFees, quoteFees, stockbackFunded);
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

    /// @dev §14 step 3. Closes the curve and nothing else — no external call, no
    ///      token movement, no room to fail.
    ///
    ///      The router is checked HERE, not in `finalizeGraduation`. A market
    ///      with no router that entered GRADUATING would be sealed: the curve is
    ///      shut and the migration has nowhere to go. Reverting the buy instead
    ///      leaves the market tradeable, which is the recoverable failure.
    function _enterGraduating() private {
        if (address(router) == address(0)) revert RouterNotSet();

        status = Status.GRADUATING;

        emit GraduationPending(
            TOKEN, Curve.TOTAL_SUPPLY - distributed, curveCollateral, curve.pg
        );
    }

    /// @notice Mint the permanent HyperSwap position and finish graduation.
    ///
    /// @dev PERMISSIONLESS, and deliberately so (§16, §95.6).
    ///
    ///      The caller pays ~4.5M gas and receives nothing for it: no collateral
    ///      ownership, no LP ownership, no creator rights, no fee share, no
    ///      economic privilege of any kind. §16 lists those four exclusions by
    ///      name and this function satisfies them by having no parameter and no
    ///      use of `msg.sender` — there is nothing to point at the caller.
    ///
    ///      Anyone may call it because a permissioned finaliser is a party who
    ///      can freeze a graduated market by doing nothing. Whoever gets there
    ///      first does the same thing, since every input is already frozen.
    ///
    ///      Retry is idempotent by state rather than by bookkeeping: the status
    ///      check admits exactly one success, and any failure reverts the whole
    ///      call, leaving GRADUATING intact for the next attempt. There is no
    ///      half-migrated state to reconcile, which is §16's "tidak boleh ada
    ///      TOKEN atau xStock orphaned akibat partial transition".
    ///
    ///      This needs HyperEVM's large block lane. That is a deployment fact,
    ///      not a contract one, and it is recorded in the recovery runbook.
    function finalizeGraduation() external nonReentrant returns (address pool_, uint256 positionId_) {
        if (status != Status.GRADUATING) revert NotGraduating();
        return _migrate();
    }

    function _migrate() private returns (address, uint256) {
        // The reserve is DERIVED FROM CURVE STATE, never read as a balance.
        //
        // This contract treats collateral as a liability rather than a balance
        // everywhere else, and reading balanceOf here was the one place that
        // broke the rule — at the single most consequential moment in the
        // protocol.
        //
        // With a balance read, anyone could send TOKEN to the market before it
        // graduated: the token side of the mint inflated while collateral stayed
        // fixed, so the pool opened at the wrong ratio. A test donating a normal
        // position doubled the migrated amount, which would have halved the
        // opening price. §15 makes spot price continuity a HARD invariant, and
        // the donor loses their tokens either way — so this was cheap griefing
        // against every graduating market, with nobody profiting from it.
        //
        // Donated tokens now stay stranded in the dead market instead, which is
        // the donor's own loss and harms nobody.
        uint256 tokenAmount = Curve.TOTAL_SUPPLY - distributed;
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

        return (pool_, positionId_);
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

/// @dev The one function the market calls on its lock.
///
///      Declared narrowly rather than importing `PermanentLiquidityLock`: with
///      the full contract in scope the market would compile against a type that
///      might later grow a function it should never call.
interface ILiquidityLock {
    function collect(uint256 tokenId) external returns (uint256 amount0, uint256 amount1);
}
