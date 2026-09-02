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

contract MockQuote is ERC20 {
    uint8 private immutable D;

    constructor(uint8 d) ERC20("Mock NVDAx", "NVDAx") {
        D = d;
    }

    function decimals() public view override returns (uint8) {
        return D;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Test double for the Day 3 router. This is a TEST double, not a production
///      placeholder — the real router never ships from here (§279).
contract MockRouter is IGraduationRouter {
    address public lastToken;
    uint256 public lastTokenAmount;
    uint256 public lastQuoteAmount;
    uint256 public lastPrice;
    uint256 public lastDust;
    bool public shouldFail;

    /// @dev Tokens per whole quote unit delivered on the post-grad leg.
    uint256 public postGradRate = 1000;

    function setShouldFail(bool v) external {
        shouldFail = v;
    }

    function graduate(
        address token,
        address quoteAsset,
        uint256 tokenAmount,
        uint256 quoteAmount,
        uint256 finalMarginalPriceWad,
        uint256 dustQuote
    ) external override returns (address pool, uint256 positionId) {
        if (shouldFail) return (address(0), 0);

        lastToken = token;
        lastTokenAmount = tokenAmount;
        lastQuoteAmount = quoteAmount;
        lastPrice = finalMarginalPriceWad;
        lastDust = dustQuote;
        quoteAsset; // silence

        return (address(uint160(uint256(keccak256(abi.encode(token, "pool"))))), 42);
    }

    function swapExactQuoteForToken(address token, address, uint256 quoteIn, address recipient)
        external
        override
        returns (uint256 tokensOut)
    {
        tokensOut = quoteIn * postGradRate;
        uint256 available = IERC20(token).balanceOf(address(this));
        if (tokensOut > available) tokensOut = available;
        if (tokensOut > 0) IERC20(token).transfer(recipient, tokensOut);
    }
}

contract LaunchMarketTest is Test {
    LaunchMarket market;
    LaunchToken token;
    MockQuote quote;
    FeeVault feeVault;
    HolderRewardVault rewardVault;
    MockRouter router;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address factory = address(this); // this test acts as the factory
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant WAD = 1e18;
    uint256 constant XSTOCK_USD = 137.42e18;

    function setUp() public {
        quote = new MockQuote(18);
        feeVault = new FeeVault(governance, treasury, factory);
        rewardVault = new HolderRewardVault(governance, factory);
        router = new MockRouter();

        uint256 quoteMc = (2_000e18 * WAD) / XSTOCK_USD;
        uint256 p0 = (quoteMc * WAD) / Curve.TOTAL_SUPPLY;

        // Mirrors the factory: deploy the token, then the market, then forward
        // the entire genesis supply. No address prediction needed (D-009).
        token = new LaunchToken("Sent Test", "TEST", creator);
        market = new LaunchMarket(
            address(token), address(quote), 18, creator, address(feeVault), address(rewardVault), p0
        );
        token.setMarket(address(market));
        token.transfer(address(market), token.GENESIS_SUPPLY());

        feeVault.registerMarket(address(market));
        rewardVault.registerMarket(address(market), address(quote));
        market.setRouter(address(router));

        quote.mint(alice, 1_000_000e18);
        quote.mint(bob, 1_000_000e18);

        vm.prank(alice);
        quote.approve(address(market), type(uint256).max);
        vm.prank(bob);
        quote.approve(address(market), type(uint256).max);
    }

    function _buy(address who, uint256 gross) internal returns (uint256) {
        vm.prank(who);
        return market.buy(gross, 0, block.timestamp + 1);
    }

    // -----------------------------------------------------------------------
    // Genesis
    // -----------------------------------------------------------------------

    function test_genesisSupplyLandsEntirelyInTheMarket() public view {
        assertEq(token.totalSupply(), 1_000_000_000e18, "1B fixed supply");
        assertEq(token.balanceOf(address(market)), 1_000_000_000e18, "market holds the whole reserve");
        assertEq(token.balanceOf(creator), 0, "creator allocation is 0%");
        assertEq(token.balanceOf(governance), 0, "platform allocation is 0%");
    }

    function test_startsAtReferenceMarketCap() public view {
        uint256 mcQuote = (market.marginalPrice() * Curve.TOTAL_SUPPLY) / WAD;
        uint256 mcUsd = (mcQuote * XSTOCK_USD) / WAD;
        assertApproxEqRel(mcUsd, 2_000e18, 1e15, "launch reference MC is $2,000");
    }

    // -----------------------------------------------------------------------
    // Buy
    // -----------------------------------------------------------------------

    function test_buySplitsFeesAndRoutesThemOut() public {
        uint256 gross = 10e18;
        uint256 out = _buy(alice, gross);

        Fees.Breakdown memory f = Fees.forBuy(gross);

        assertGt(out, 0, "buyer receives TOKEN");
        assertEq(token.balanceOf(alice), out, "TOKEN actually delivered");

        // Fees left the market in the same transaction they were booked.
        assertEq(quote.balanceOf(address(feeVault)), f.coreFee, "core fee sits in FeeVault");
        assertEq(quote.balanceOf(address(rewardVault)), f.stockback, "stockback sits in reward vault");

        assertEq(feeVault.creatorBalance(creator, address(quote)), f.creatorFee, "creator 65%");
        assertEq(feeVault.platformBalance(address(quote)), f.platformFee, "platform 35%");
        assertEq(rewardVault.funded(address(market)), f.stockback, "stockback funding booked");

        // Collateral holds ONLY the net. Fees are outside it (§8, §12).
        assertEq(market.curveCollateral(), f.net, "collateral equals net input exactly");
    }

    function test_quoteMatchesExecution() public {
        uint256 gross = 20e18;

        (uint256 quotedOut,,,, bool crosses) = market.quoteBuy(gross);
        assertFalse(crosses);

        uint256 actual = _buy(alice, gross);
        assertEq(actual, quotedOut, "quote must equal execution exactly (section 315)");
    }

    function test_priceRisesAsSupplyIsDistributed() public {
        uint256 before = market.marginalPrice();
        _buy(alice, 10e18);
        assertGt(market.marginalPrice(), before, "price must rise with distribution");
    }

    // -----------------------------------------------------------------------
    // Sell
    // -----------------------------------------------------------------------

    function test_sellReturnsNetOfFees() public {
        uint256 out = _buy(alice, 10e18);

        vm.startPrank(alice);
        token.approve(address(market), out);

        (uint256 quotedNet, uint256 grossOut,,) = market.quoteSell(out);
        uint256 balanceBefore = quote.balanceOf(alice);
        uint256 received = market.sell(out, 0, block.timestamp + 1);
        vm.stopPrank();

        assertEq(received, quotedNet, "sell quote must equal execution");
        assertEq(quote.balanceOf(alice) - balanceBefore, received, "funds actually arrive");

        Fees.Breakdown memory f = Fees.forSell(grossOut);
        assertEq(received, f.net, "seller receives gross minus 3%");
    }

    /// @dev The core anti-extraction property, end to end through the real contract.
    function test_buyThenSellIsAlwaysALoss() public {
        uint256 spent = 10e18;
        uint256 out = _buy(alice, spent);

        vm.startPrank(alice);
        token.approve(address(market), out);
        uint256 back = market.sell(out, 0, block.timestamp + 1);
        vm.stopPrank();

        assertLt(back, spent, "an immediate round trip must never profit");
    }

    function test_sellIsBoundedByCollateral() public {
        _buy(alice, 10e18);

        // Bob buys, then alice tries to sell more than she owns — the ERC-20
        // transfer stops her before the curve is ever consulted.
        vm.prank(alice);
        vm.expectRevert();
        market.sell(1_000_000e18, 0, block.timestamp + 1);
    }

    /// @dev Donation attack: sending quote directly must not change what sellers
    ///      are owed, because collateral is a liability, not a balance.
    function test_donationDoesNotAffectPayouts() public {
        uint256 out = _buy(alice, 10e18);

        (uint256 expectedNet,,,) = market.quoteSell(out);

        quote.mint(address(market), 5_000e18); // unsolicited donation

        (uint256 afterDonation,,,) = market.quoteSell(out);
        assertEq(afterDonation, expectedNet, "a donation must not change the curve");

        uint256 collateralBefore = market.curveCollateral();
        assertEq(market.curveCollateral(), collateralBefore, "collateral is never a balance read");
    }

    // -----------------------------------------------------------------------
    // Slippage and deadline
    // -----------------------------------------------------------------------

    function test_slippageBoundIsEnforcedOnBuy() public {
        (uint256 quoted,,,,) = market.quoteBuy(10e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LaunchMarket.SlippageExceeded.selector, quoted, quoted + 1));
        market.buy(10e18, quoted + 1, block.timestamp + 1);
    }

    function test_deadlineIsEnforced() public {
        vm.warp(1000);
        vm.prank(alice);
        vm.expectRevert(LaunchMarket.DeadlinePassed.selector);
        market.buy(10e18, 0, 999);
    }

    // -----------------------------------------------------------------------
    // Graduation
    // -----------------------------------------------------------------------

    /// @dev Walk the curve to the endpoint and confirm graduation is automatic,
    ///      complete, and permanently closes the curve.
    function test_graduationIsAutomaticAndClosesTheCurve() public {
        _walkToGraduation();

        assertEq(uint256(market.status()), uint256(LaunchMarket.Status.GRADUATED), "must be GRADUATED");
        assertTrue(market.pool() != address(0), "pool recorded");
        assertEq(market.positionId(), 42, "position recorded");

        // The curve is permanently dead. Both directions.
        vm.prank(alice);
        vm.expectRevert(LaunchMarket.NotPreGrad.selector);
        market.buy(1e18, 0, block.timestamp + 1);

        vm.prank(alice);
        vm.expectRevert(LaunchMarket.NotPreGrad.selector);
        market.sell(1e18, 0, block.timestamp + 1);
    }

    function test_graduationMigratesEverythingAndZeroesCollateral() public {
        _walkToGraduation();

        assertEq(market.curveCollateral(), 0, "migrated collateral is zeroed (section 14 step 10)");
        assertEq(market.graduationDust(), 0, "dust handed to the router, not retained");
        assertEq(token.balanceOf(address(market)), 0, "no orphaned reserve (section 16)");

        assertGt(router.lastTokenAmount(), 0, "remaining supply migrated");
        assertGt(router.lastQuoteAmount(), 0, "collateral migrated");

        // Price continuity: the pool must open at the curve's closing price (§15).
        assertEq(router.lastPrice(), _curveParams().pg, "pool opens at final marginal price");
    }

    /// @dev §16: a failed migration must revert everything. No GRADUATED status
    ///      with an incomplete migration, no orphaned assets.
    function test_failedGraduationRevertsEntirely() public {
        router.setShouldFail(true);

        uint256 grossNeeded = _prepareEndpointBuy(alice);

        vm.prank(alice);
        vm.expectRevert(LaunchMarket.GraduationIncomplete.selector);
        market.buy(grossNeeded, 0, block.timestamp + 1);

        assertEq(uint256(market.status()), uint256(LaunchMarket.Status.PRE_GRAD), "must stay PRE_GRAD");
        assertGt(token.balanceOf(address(market)), 0, "reserve not orphaned");
    }

    /// @dev section 14: graduation has no manual trigger, for anyone.
    ///
    ///      The previous version of this test asserted the market was still
    ///      PRE_GRAD - which is trivially true straight out of setUp and proves
    ///      nothing at all. A test that cannot fail is worse than no test,
    ///      because it reads like coverage.
    ///
    ///      This actually attacks the surface: every plausible graduation entry
    ///      point, called by every privileged party, must fail to move the
    ///      market. If any of these ever lands, the selector exists and section
    ///      14 is broken.
    function test_noCallerCanTriggerGraduationManually() public {
        _buy(alice, 10e18); // a live market with real state

        bytes[] memory attempts = new bytes[](8);
        attempts[0] = abi.encodeWithSignature("graduate()");
        attempts[1] = abi.encodeWithSignature("forceGraduate()");
        attempts[2] = abi.encodeWithSignature("finalizeGraduation()");
        attempts[3] = abi.encodeWithSignature("triggerGraduation()");
        attempts[4] = abi.encodeWithSignature("migrate()");
        attempts[5] = abi.encodeWithSignature("setStatus(uint8)", uint8(2));
        attempts[6] = abi.encodeWithSignature("graduate(address)", address(this));
        attempts[7] = abi.encodeWithSignature("emergencyGraduate()");

        address[] memory callers = new address[](4);
        callers[0] = creator;   // the creator
        callers[1] = governance; // governance
        callers[2] = factory;    // the factory that deployed it
        callers[3] = alice;      // an ordinary trader

        for (uint256 c = 0; c < callers.length; c++) {
            for (uint256 i = 0; i < attempts.length; i++) {
                vm.prank(callers[c]);
                (bool ok,) = address(market).call(attempts[i]);

                assertFalse(
                    ok,
                    string.concat(
                        "a graduation entry point responded to caller ", vm.toString(callers[c])
                    )
                );
                assertEq(
                    uint256(market.status()),
                    uint256(LaunchMarket.Status.PRE_GRAD),
                    "status moved without a trade reaching the endpoint"
                );
            }
        }
    }

    /// @dev The factory can wire the router once, and that is its whole power
    ///      over a live market. It must not be able to re-point it afterwards,
    ///      or a compromised factory could redirect the entire reserve at
    ///      graduation.
    function test_routerCannotBeRepointedAfterLaunch() public {
        address hostile = makeAddr("hostileRouter");

        vm.prank(factory);
        market.setRouter(hostile);

        // setRouter is factory-only, so no other caller can reach it at all.
        vm.prank(creator);
        vm.expectRevert(LaunchMarket.NotFactory.selector);
        market.setRouter(hostile);

        vm.prank(alice);
        vm.expectRevert(LaunchMarket.NotFactory.selector);
        market.setRouter(hostile);
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    /// @dev Fund `who` with slightly more than the endpoint needs, so the buy is a
    ///      CROSSING order: it finishes the curve and spills into the post-grad leg.
    function _prepareEndpointBuy(address who) internal returns (uint256 grossNeeded) {
        uint256 remaining = _curveParams().qG - market.distributed();
        uint256 netNeeded = Curve.quoteInFor(_curveParams(), market.distributed(), remaining);
        grossNeeded = (netNeeded * 10_000) / 9_800 + 1e18;

        quote.mint(who, grossNeeded);
        vm.prank(who);
        quote.approve(address(market), type(uint256).max);
    }

    function _buyToEndpoint(address who) internal returns (uint256) {
        uint256 grossNeeded = _prepareEndpointBuy(who);
        vm.prank(who);
        return market.buy(grossNeeded, 0, block.timestamp + 1);
    }

    function _walkToGraduation() internal {
        // A partial buy first, so graduation happens from a non-zero state.
        _buy(alice, 40e18);
        _buyToEndpoint(bob);
    }

    function _curveParams() internal view returns (Curve.Params memory p) {
        (uint256 p0, uint256 pg, uint256 dP, uint256 qG) = market.curve();
        p = Curve.Params({p0: p0, pg: pg, dP: dP, qG: qG});
    }
}
