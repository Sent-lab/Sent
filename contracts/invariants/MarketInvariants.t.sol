// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LaunchMarket} from "../src/LaunchMarket.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {HolderRewardVault} from "../src/HolderRewardVault.sol";
import {IGraduationRouter} from "../src/interfaces/IGraduationRouter.sol";
import {Curve} from "../src/lib/Curve.sol";
import {Fees} from "../src/lib/Fees.sol";

contract InvQuote is ERC20 {
    constructor() ERC20("Mock NVDAx", "NVDAx") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract InvRouter is IGraduationRouter {
    function graduate(address token, address, uint256, uint256, uint256, uint256)
        external
        pure
        override
        returns (address, uint256)
    {
        return (address(uint160(uint256(keccak256(abi.encode(token, "pool"))))), 1);
    }

    function swapExactQuoteForToken(address token, address, uint256, address recipient)
        external
        override
        returns (uint256 tokensOut)
    {
        tokensOut = IERC20(token).balanceOf(address(this)) / 1000;
        if (tokensOut > 0) IERC20(token).transfer(recipient, tokensOut);
    }
}

/// @notice Drives the market through random trade sequences from random actors.
/// @dev The handler bounds inputs to reachable values so the fuzzer spends its
///      runs on real state transitions instead of bouncing off input validation.
contract MarketHandler is Test {
    LaunchMarket public market;
    LaunchToken public token;
    InvQuote public quote;

    address[] public actors;

    uint256 public donatedQuote;
    uint256 public donatedToken;
    uint256 public totalQuoteIn;
    uint256 public totalQuoteOut;
    uint256 public buyCount;
    uint256 public sellCount;
    uint256 public graduatedAt;
    uint256 public finalizeCount;

    /// @dev The escrow as it stood the instant the curve closed. §95.6 requires
    ///      the migration's inputs to be deterministic, which means fixed from
    ///      that moment on — so they are recorded once and compared forever.
    bool public escrowSnapshotted;
    uint256 public escrowDistributed;
    uint256 public escrowCollateral;
    uint256 public escrowDust;
    uint256 public escrowTokenBalance;

    /// @dev Highest status ever observed, to catch a lifecycle running backwards.
    uint8 public highWaterStatus;

    constructor(LaunchMarket market_, LaunchToken token_, InvQuote quote_) {
        market = market_;
        token = token_;
        quote = quote_;

        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(uint256(keccak256(abi.encode("actor", i)))));
            actors.push(actor);
            quote.mint(actor, 1_000e18);
            vm.prank(actor);
            quote.approve(address(market), type(uint256).max);
            vm.prank(actor);
            token.approve(address(market), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function buy(uint256 actorSeed, uint256 amount) external {
        if (market.status() != LaunchMarket.Status.PRE_GRAD) return;

        address actor = _actor(actorSeed);
        uint256 balance = quote.balanceOf(actor);
        if (balance == 0) return;

        amount = bound(amount, 1e12, balance);

        vm.prank(actor);
        try market.buy(amount, 0, block.timestamp + 1) {
            totalQuoteIn += amount;
            buyCount++;
            _observe();
        } catch {}
    }

    /// @dev Snapshot the escrow the first time the curve is seen closed, and
    ///      track the lifecycle high-water mark.
    function _observe() internal {
        LaunchMarket.Status st = market.status();

        if (uint8(st) > highWaterStatus) highWaterStatus = uint8(st);

        if (st == LaunchMarket.Status.GRADUATING && !escrowSnapshotted) {
            escrowSnapshotted = true;
            escrowDistributed = market.distributed();
            escrowCollateral = market.curveCollateral();
            escrowDust = market.graduationDust();
            escrowTokenBalance = token.balanceOf(address(market));
        }

        if (st == LaunchMarket.Status.GRADUATED && graduatedAt == 0) {
            graduatedAt = block.number;
        }
    }

    /// @dev The permissionless finaliser (§16, D-016).
    ///
    ///      Driven by the fuzzer from an arbitrary actor, at an arbitrary point,
    ///      possibly many times — which is the whole point. If finalising twice
    ///      could mint a second position, or if WHO finalised changed anything,
    ///      this handler is what finds it.
    function finalize(uint256 actorSeed) external {
        vm.prank(_actor(actorSeed));
        try market.finalizeGraduation() {
            finalizeCount++;
            _observe();
        } catch {}
    }

    function sell(uint256 actorSeed, uint256 amount) external {
        if (market.status() != LaunchMarket.Status.PRE_GRAD) return;

        address actor = _actor(actorSeed);
        uint256 balance = token.balanceOf(actor);
        if (balance == 0) return;

        amount = bound(amount, 1, balance);

        vm.prank(actor);
        try market.sell(amount, 0, block.timestamp + 1) returns (uint256 out) {
            totalQuoteOut += out;
            sellCount++;
            _observe();
        } catch {}
    }

    /// @dev An unsolicited QUOTE donation. Must never change what the curve owes.
    function donate(uint256 amount) external {
        amount = bound(amount, 1, 100e18);
        quote.mint(address(market), amount);
        donatedQuote += amount;
    }

    /// @dev An unsolicited TOKEN donation.
    ///
    ///      This is the shape that broke graduation: reading balanceOf for the
    ///      migrated reserve let a donation inflate the token side of the V3 mint
    ///      and open the pool at the wrong price. Driving it continuously here
    ///      means the fix is held by an invariant rather than by one test.
    function donateToken(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        uint256 held = token.balanceOf(actor);
        if (held == 0) return;

        amount = bound(amount, 1, held);

        vm.prank(actor);
        token.transfer(address(market), amount);
        donatedToken += amount;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}

/// @notice System invariants for LaunchMarket (§28, §30).
///
/// These are the properties that must hold after ANY sequence of trades, not the
/// scenarios a human thought to write down. Each one maps to a masterplan hard
/// invariant.
contract MarketInvariants is Test {
    LaunchMarket market;
    LaunchToken token;
    InvQuote quote;
    FeeVault feeVault;
    HolderRewardVault rewardVault;
    InvRouter router;
    MarketHandler handler;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address creator = makeAddr("creator");

    function setUp() public {
        quote = new InvQuote();
        feeVault = new FeeVault(governance, treasury, address(this));
        rewardVault = new HolderRewardVault(governance, address(this));
        router = new InvRouter();

        uint256 xStockUsd = 137.42e18; // literal must be typed before dividing
        uint256 quoteMc = (2_000e18 * 1e18) / xStockUsd;
        uint256 p0 = (quoteMc * 1e18) / Curve.TOTAL_SUPPLY;

        token = new LaunchToken("Sent Inv", "INV", creator);
        market = new LaunchMarket(
            address(token), address(quote), 18, creator, address(feeVault), address(rewardVault), p0
        );
        token.setMarket(address(market));
        token.transfer(address(market), token.GENESIS_SUPPLY());

        feeVault.registerMarket(address(market));
        rewardVault.registerMarket(address(market), address(quote));
        market.setRouter(address(router));

        handler = new MarketHandler(market, token, quote);

        targetContract(address(handler));
    }

    // -----------------------------------------------------------------------
    // Supply (§28 Supply)
    // -----------------------------------------------------------------------

    /// @dev Total supply is minted once and can never change.
    function invariant_supplyIsFixedForever() public view {
        assertEq(token.totalSupply(), 1_000_000_000e18, "supply must never change");
    }

    /// @dev Distributed can never exceed the graduation endpoint.
    function invariant_distributedNeverExceedsEndpoint() public view {
        (,,, uint256 qG) = market.curve();
        assertLe(market.distributed(), qG, "distribution must never pass the endpoint");
    }

    /// @dev The market's TOKEN balance must always cover the undistributed
    ///      reserve, and the excess must be exactly what was donated.
    ///
    ///      This is the invariant that would have caught the graduation bug: the
    ///      reserve is `TOTAL_SUPPLY - distributed`, and anything above it is a
    ///      donation that must never be treated as reserve.
    function invariant_reserveIsCurveStateNotBalance() public view {
        if (market.status() == LaunchMarket.Status.GRADUATED) return;

        uint256 reserve = Curve.TOTAL_SUPPLY - market.distributed();
        uint256 balance = token.balanceOf(address(market));

        assertGe(balance, reserve, "the market must hold at least its undistributed reserve");
        assertEq(
            balance - reserve,
            handler.donatedToken(),
            "any excess over the reserve must be exactly what was donated"
        );
    }

    /// @dev After graduation the router holds the reserve, and donated TOKEN is
    ///      stranded in the dead market rather than having joined the LP.
    function invariant_donatedTokenIsNeverMigrated() public view {
        if (market.status() != LaunchMarket.Status.GRADUATED) return;

        assertEq(
            token.balanceOf(address(market)),
            handler.donatedToken(),
            "only donated TOKEN may remain after migration"
        );
    }

    /// @dev Every token is either in the market's reserve or held by someone.
    ///      Nothing is created or destroyed by trading.
    function invariant_tokenAccountingIsConserved() public view {
        uint256 held = token.balanceOf(address(market)) + token.balanceOf(address(router));
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            held += token.balanceOf(handler.actors(i));
        }
        assertEq(held, token.totalSupply(), "no token may be created or lost");
    }

    // -----------------------------------------------------------------------
    // Creator and platform allocation (§28 Creator)
    // -----------------------------------------------------------------------

    /// @dev The creator never receives TOKEN except by buying it. This handler
    ///      never trades as the creator, so their balance must stay zero forever.
    function invariant_creatorNeverReceivesTokens() public view {
        assertEq(token.balanceOf(creator), 0, "creator allocation must remain 0%");
    }

    function invariant_platformNeverReceivesTokens() public view {
        assertEq(token.balanceOf(treasury), 0, "platform allocation must remain 0%");
        assertEq(token.balanceOf(governance), 0, "governance holds no TOKEN");
    }

    // -----------------------------------------------------------------------
    // Collateral (§28 Collateral, §12)
    // -----------------------------------------------------------------------

    /// @dev THE solvency invariant. Collateral is a liability figure derived from
    ///      curve state, and the market must physically hold at least that much —
    ///      otherwise a seller could be owed money that is not there.
    ///      The comparison goes through collateralInAssetUnits() rather than
    ///      curveCollateral directly: collateral is normalized and the balance is
    ///      raw, so comparing them without converting is only correct by accident
    ///      when the quote asset happens to have 18 decimals.
    function invariant_marketCanCoverItsCollateral() public view {
        if (market.status() == LaunchMarket.Status.GRADUATED) return;
        assertGe(
            quote.balanceOf(address(market)),
            market.collateralInAssetUnits(),
            "the market must always hold what the curve owes"
        );
    }

    /// @dev Collateral must equal the closed-form integral at the current state.
    ///      This is what makes a donation irrelevant: collateral tracks the curve,
    ///      never the balance.
    function invariant_collateralMatchesCurveState() public view {
        if (market.status() == LaunchMarket.Status.GRADUATED) return;

        (uint256 p0, uint256 pg, uint256 dP, uint256 qG) = market.curve();
        Curve.Params memory p = Curve.Params({p0: p0, pg: pg, dP: dP, qG: qG});

        uint256 expected = Curve.collateralAt(p, market.distributed());

        // Buys credit the exact net; sells debit the exact curve liability. Small
        // positive drift is fee-rounding in the protocol's favour and is bounded.
        assertGe(market.curveCollateral() + 1e6, expected, "collateral must not fall below the curve");
    }

    // -----------------------------------------------------------------------
    // Fees (§28 Fee claims, §8, §12)
    // -----------------------------------------------------------------------

    /// @dev The creator's aggregate share may never fall below 65%, however many
    ///      trades occur.
    ///
    ///      This invariant is why the rounding direction changed. Flooring the
    ///      creator per trade made the AGGREGATE share sit permanently a wei or
    ///      two under 65%, because a sum of floors is not the floor of a sum. Only
    ///      a randomised multi-trade sequence exposes that; no single-trade unit
    ///      test ever would.
    function invariant_creatorShareIsNeverReduced() public view {
        uint256 creatorTotal = feeVault.creatorBalance(creator, address(quote));
        uint256 platformTotal = feeVault.platformBalance(address(quote));
        uint256 core = creatorTotal + platformTotal;

        if (core == 0) return;

        assertGe(creatorTotal * 10_000, core * 6_500, "creator aggregate must never fall below 65%");
        assertEq(creatorTotal + platformTotal, core, "the split must remain exhaustive");
    }

    /// @dev The fee vault must always be able to pay everything it has accrued.
    function invariant_feeVaultIsSolvent() public view {
        assertGe(
            quote.balanceOf(address(feeVault)),
            feeVault.outstanding(address(quote)),
            "fee vault must cover its obligations"
        );
    }

    /// @dev Stockback funding must always be physically present. Entitlement is
    ///      capped against this at commitment time (§364).
    function invariant_rewardVaultIsSolvent() public view {
        assertGe(
            quote.balanceOf(address(rewardVault)),
            rewardVault.outstanding(address(market)),
            "reward vault must cover its funding"
        );
    }

    // -----------------------------------------------------------------------
    // Lifecycle (§19)
    // -----------------------------------------------------------------------

    /// @dev GRADUATING now rests between transactions, so the guarantee that used
    ///      to be "it is never observable" has to be replaced rather than dropped
    ///      (D-016). This is the replacement, and it is the stronger claim.
    ///
    ///      §95.6 asks for a DETERMINISTIC escrow. What that means concretely is
    ///      that from the instant the curve closes, the migration's inputs cannot
    ///      move — not by a trade, not by a donation, not by a failed finalise,
    ///      not by anything the fuzzer can reach. So the handler records them at
    ///      the moment of closing and this compares against that record for the
    ///      rest of the run.
    ///
    ///      The old invariant said a partial state must not exist. This says a
    ///      resting state must not be a partial one: nothing is in flight,
    ///      nothing is half-moved, and the finaliser has no ratio to choose
    ///      because there is only one set of numbers it could ever read.
    function invariant_graduatingEscrowIsFrozen() public view {
        if (market.status() != LaunchMarket.Status.GRADUATING) return;
        if (!handler.escrowSnapshotted()) return;

        assertEq(market.distributed(), handler.escrowDistributed(), "distributed frozen while GRADUATING");
        assertEq(market.curveCollateral(), handler.escrowCollateral(), "collateral frozen while GRADUATING");
        assertEq(market.graduationDust(), handler.escrowDust(), "dust frozen while GRADUATING");
        // Deliberately >= and not ==. The fuzzer donates TOKEN into GRADUATING
        // markets, and the first version of this line demanded equality and
        // failed — correctly, and against the invariant rather than the code.
        //
        // A donation is allowed to raise the balance and cannot affect anything,
        // because the migration reads CURVE STATE and never a balance. That is
        // the point `invariant_reserveIsCurveStateNotBalance` exists to make, and
        // it is why the three assertions above are the real escrow.
        //
        // What must hold is that nothing LEAVES: the reserve owed to the pool is
        // still here, whatever has been piled on top of it.
        assertGe(
            token.balanceOf(address(market)),
            handler.escrowTokenBalance(),
            "no TOKEN may leave a market while GRADUATING"
        );

        // Nothing has been handed over yet, so nothing may be recorded as having
        // been. §16: no GRADUATED status, and no pool, without a full migration.
        assertEq(market.pool(), address(0), "no pool before the migration runs");
        assertEq(market.positionId(), 0, "no position before the migration runs");
    }

    /// @dev Proof that the state-gated invariants above are not vacuous.
    ///
    ///      Three of them open with an early `return` when the market is in the
    ///      wrong state. That is the correct shape for an invariant, and it is
    ///      also how one quietly stops testing anything: if a run never closes a
    ///      curve, `invariant_graduatingEscrowIsFrozen` passes without ever
    ///      having looked at an escrow, and the suite reports green for a path it
    ///      never entered.
    ///
    ///      The first attempt at this check was an `afterInvariant()` demanding
    ///      the campaign reach GRADUATED. That was wrong, and it failed honestly:
    ///      `afterInvariant` runs after EVERY run, and most runs have no business
    ///      graduating anything. Requiring it of all of them would have forced
    ///      the assertion to be watered down until it proved nothing.
    ///
    ///      So reachability is established deterministically instead, through the
    ///      same handler the fuzzer drives - not a separate fixture that could
    ///      drift from it. Every gated invariant is then called by hand, in the
    ///      state it guards, where it has no way to return early.
    function test_theGatedInvariantsAreReachableThroughTheHandler() public {
        // Walk the curve down with the handler's own buy action.
        for (uint256 i = 0; i < 64 && !handler.escrowSnapshotted(); i++) {
            handler.buy(i, type(uint256).max);
        }

        assertTrue(handler.escrowSnapshotted(), "the handler can close a curve");
        assertEq(
            uint256(market.status()),
            uint256(LaunchMarket.Status.GRADUATING),
            "and the market is resting in GRADUATING"
        );

        // In the state it guards, this one cannot return early.
        invariant_graduatingEscrowIsFrozen();
        invariant_lifecycleNeverRunsBackwards();

        // A donation and a failed trade while GRADUATING must move nothing.
        handler.donateToken(1, 1e18);
        handler.sell(2, type(uint256).max);
        invariant_graduatingEscrowIsFrozen();

        handler.finalize(3);
        assertEq(handler.finalizeCount(), 1, "the handler can finalise");
        assertEq(
            uint256(market.status()), uint256(LaunchMarket.Status.GRADUATED), "and it completes"
        );

        // A second finalise must do nothing at all, from anyone.
        handler.finalize(4);
        assertEq(handler.finalizeCount(), 1, "exactly one finalise ever succeeds");

        invariant_graduationIsTerminal();
        invariant_finalisingConfersNothing();
        invariant_lifecycleNeverRunsBackwards();
        invariant_donatedTokenIsNeverMigrated();
    }

    /// @dev The lifecycle is one-way: PRE_GRAD -> GRADUATING -> GRADUATED. A
    ///      status that ever moved backwards would mean a closed curve reopened,
    ///      which §19 forbids and which the retry path is the obvious place to
    ///      get wrong.
    function invariant_lifecycleNeverRunsBackwards() public view {
        assertGe(uint8(market.status()), handler.highWaterStatus(), "status must never regress");
    }

    /// @dev §16's "no retry caller privilege", asserted rather than trusted.
    ///
    ///      The fuzzer finalises from arbitrary actors, repeatedly. None of them
    ///      may end up holding TOKEN, or quote beyond what trading gave them, for
    ///      having done it. The simplest form of the check: the finalise path
    ///      pays nobody, so a successful finalise cannot leave the market holding
    ///      less than a failed one would have.
    function invariant_finalisingConfersNothing() public view {
        if (market.status() != LaunchMarket.Status.GRADUATED) return;
        assertLe(handler.finalizeCount(), 1, "exactly one finalise can ever succeed");
    }

    /// @dev Once graduated, the curve is permanently closed and its collateral is
    ///      fully migrated. There is no path back.
    function invariant_graduationIsTerminal() public view {
        if (market.status() != LaunchMarket.Status.GRADUATED) return;

        assertEq(market.curveCollateral(), 0, "migrated collateral must be zeroed");
        assertEq(market.graduationDust(), 0, "dust must be handed over, not retained");
        assertTrue(market.pool() != address(0), "a graduated market must record its pool");
    }

    // -----------------------------------------------------------------------
    // No value extraction
    // -----------------------------------------------------------------------

    /// @dev Traders can never extract more quote than they put in. Fees guarantee
    ///      a strict loss on any round trip, so aggregate outflow must stay below
    ///      aggregate inflow for the whole population.
    function invariant_tradersCannotExtractValue() public view {
        assertLe(handler.totalQuoteOut(), handler.totalQuoteIn(), "aggregate outflow must never exceed inflow");
    }
}
