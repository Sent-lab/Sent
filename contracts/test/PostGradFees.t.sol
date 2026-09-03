// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {LaunchMarket} from "../src/LaunchMarket.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {HolderRewardVault} from "../src/HolderRewardVault.sol";
import {GraduationRouter} from "../src/GraduationRouter.sol";
import {PermanentLiquidityLock} from "../src/PermanentLiquidityLock.sol";
import {ReferencePriceAdapter} from "../src/ReferencePriceAdapter.sol";
import {Metadata} from "../src/lib/Metadata.sol";
import {Curve} from "../src/lib/Curve.sol";
import {MockV3Factory, MockPositionManager, MockSwapRouter} from "./mocks/MockUniswapV3.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

contract PQuote is ERC20 {
    constructor() ERC20("Mock NVDAx", "NVDAx") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice §396's FINAL LOCK, as arithmetic against real vault balances.
///
/// The split is easy to state and easy to get subtly wrong:
///
///   TOKEN side   65% creator / 35% platform, and NOTHING to Stockback
///   quote side   65% creator / 17.5% Stockback / 17.5% platform
///
/// The asymmetry is the point. §397 forbids converting TOKEN fees to fund a
/// reward denominated in xStock, because that is protocol-induced sell pressure
/// on the market's own token to simplify an accounting line.
contract PostGradFeesTest is Test {
    LaunchpadFactory factory;
    XStockRegistry registry;
    FeeVault feeVault;
    HolderRewardVault rewardVault;
    GraduationRouter router;
    PermanentLiquidityLock lock;
    ReferencePriceAdapter priceAdapter;
    MockAggregator feed;
    MockV3Factory v3Factory;
    MockPositionManager positionManager;
    MockSwapRouter swapRouter;
    PQuote quote;

    LaunchMarket market;
    address token;
    uint256 positionId;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address creator = makeAddr("creator");
    address trader = makeAddr("trader");

    uint256 constant XSTOCK_USD = 100e18;

    function setUp() public {
        registry = new XStockRegistry(governance);
        quote = new PQuote();

        factory = new LaunchpadFactory(governance, treasury, address(registry), 0);
        feeVault = factory.FEE_VAULT();
        rewardVault = factory.REWARD_VAULT();

        v3Factory = new MockV3Factory();
        positionManager = new MockPositionManager(address(v3Factory));
        swapRouter = new MockSwapRouter(address(v3Factory));

        address predictedRouter =
            vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        lock = new PermanentLiquidityLock(address(positionManager), predictedRouter);
        router = new GraduationRouter(
            address(factory),
            address(v3Factory),
            address(positionManager),
            address(swapRouter),
            address(lock)
        );

        feed = new MockAggregator(int256(XSTOCK_USD / 1e10), 8);
        priceAdapter = new ReferencePriceAdapter(governance);

        vm.startPrank(governance);
        factory.setRouter(address(router));
        priceAdapter.configure(address(quote), address(feed), 1 hours, 1e18, 100_000e18);
        factory.setReferencePrice(address(priceAdapter));

        registry.registerAsset(address(quote), 6, 1385, 0);
        registry.setGates(
            address(quote),
            XStockRegistry.Gates({
                canonicalRepresentation: true,
                transferBehaviour: true,
                multiplierBehaviour: true,
                priceSource: true,
                haltSource: true,
                hyperSwapCompatible: true,
                normalizedAccountingTested: true,
                legalReviewed: true
            })
        );
        registry.enableAsset(address(quote));
        vm.stopPrank();

        address marketAddress;

        vm.prank(creator);
        (token, marketAddress) = factory.launch(
            LaunchpadFactory.LaunchParams({
                name: "Post Grad",
                symbol: "PG",
                quoteAsset: address(quote),
                userSalt: bytes32(uint256(1)),
                launchIntentHash: keccak256("intent"),
                xStockUsdWad: XSTOCK_USD,
                expectedToken: address(0),
                metadata: Metadata.Content({
                    description: "",
                    imageCid: "",
                    links: new Metadata.Link[](0)
                })
            })
        );

        market = LaunchMarket(marketAddress);

        // Buy all the way through graduation in one order. §411's crossing
        // order: the part before the endpoint fills on the curve, the rest is
        // swapped on the pool that graduation just created — so the mock swap
        // router needs TOKEN to deliver.
        quote.mint(trader, 1_000_000e6);
        deal(token, address(swapRouter), 1e36);

        vm.startPrank(trader);
        quote.approve(address(market), type(uint256).max);
        market.buy(60_000e6, 0, block.timestamp + 1);
        vm.stopPrank();

        assertEq(uint256(market.status()), 2, "the market graduated");
        positionId = market.positionId();
    }

    /// @dev Credits fees on the position and funds the manager to pay them.
    function _accrueFees(uint128 tokenFees, uint128 quoteFees) internal {
        positionManager.creditFees(positionId, 0, 0);

        bool tokenIsToken0 = token < address(quote);
        positionManager.creditFees(
            positionId,
            tokenIsToken0 ? tokenFees : quoteFees,
            tokenIsToken0 ? quoteFees : tokenFees
        );

        // The mock pays from its own balance; a real manager pays from the pool.
        deal(token, address(positionManager), 1e30);
        quote.mint(address(positionManager), 1e18);
    }

    /// @dev Balances BEFORE a collection.
    ///
    ///      The market traded its way to graduation, so the creator and the
    ///      platform already hold pre-grad core fees. Asserting absolute
    ///      balances here would be asserting the sum of two different fee
    ///      regimes and calling it one — which is the §400 mistake, made by the
    ///      test instead of the contract.
    function _snapshot(address asset)
        internal
        view
        returns (uint256 creatorBefore, uint256 platformBefore, uint256 stockbackBefore)
    {
        creatorBefore = feeVault.creatorBalance(creator, asset);
        platformBefore = feeVault.platformBalance(asset);
        stockbackBefore = rewardVault.funded(address(market));
    }

    // -----------------------------------------------------------------------
    // §396 — the quote side
    // -----------------------------------------------------------------------

    function test_quoteFeesSplit65AndThenHalveThePlatformShare() public {
        _accrueFees(0, 10_000);

        (uint256 creatorBefore, uint256 platformBefore, uint256 stockbackBefore) =
            _snapshot(address(quote));

        market.collectPostGradFees();

        // 65% creator. §396 leaves creator economics untouched.
        assertEq(
            feeVault.creatorBalance(creator, address(quote)) - creatorBefore,
            6_500,
            "creator takes 65%"
        );

        // The platform's 35% halved: 17.5% each way.
        assertEq(
            rewardVault.funded(address(market)) - stockbackBefore,
            1_750,
            "half the platform share funds Stockback"
        );
        assertEq(
            feeVault.platformBalance(address(quote)) - platformBefore,
            1_750,
            "and half stays with the platform"
        );
    }

    /// @dev §396's own worked figures: 65 / 17.5 / 17.5, stated as a check
    ///      against the masterplan rather than against the implementation.
    function test_theThreeSharesMatchTheLockedPercentages() public {
        _accrueFees(0, 1_000_000);

        (uint256 creatorBefore, uint256 platformBefore, uint256 stockbackBefore) =
            _snapshot(address(quote));

        market.collectPostGradFees();

        uint256 creatorShare = feeVault.creatorBalance(creator, address(quote)) - creatorBefore;
        uint256 stockbackShare = rewardVault.funded(address(market)) - stockbackBefore;
        uint256 platformShare = feeVault.platformBalance(address(quote)) - platformBefore;

        assertEq(creatorShare, 650_000, "65.00%");
        assertEq(stockbackShare, 175_000, "17.50%");
        assertEq(platformShare, 175_000, "17.50%");

        // Nothing is created or lost in the split.
        assertEq(creatorShare + stockbackShare + platformShare, 1_000_000, "conserved");
    }

    // -----------------------------------------------------------------------
    // §397 — the TOKEN side, and what must NOT happen to it
    // -----------------------------------------------------------------------

    function test_tokenFeesNeverFundStockback() public {
        uint256 stockbackBefore = rewardVault.funded(address(market));

        _accrueFees(10_000, 0);
        market.collectPostGradFees();

        // §397 FINAL LOCK: TOKEN-side platform revenue stays with the platform.
        // Converting it would be protocol-induced sell pressure on the market's
        // own token, with MEV exposure, to simplify an accounting line.
        assertEq(
            rewardVault.funded(address(market)),
            stockbackBefore,
            "TOKEN fees fund no Stockback"
        );

        assertEq(feeVault.creatorBalance(creator, token), 6_500, "creator still takes 65%");
        assertEq(feeVault.platformBalance(token), 3_500, "and the platform keeps the whole 35%");
    }

    /// @dev §400: the two assets are accounted separately and never collapsed.
    ///      A creator's claim is in the assets actually collected (§418).
    function test_theTwoAssetsAreAccountedSeparately() public {
        _accrueFees(10_000, 20_000);

        (uint256 quoteBefore,,) = _snapshot(address(quote));
        market.collectPostGradFees();

        // TOKEN has no pre-grad balance: core fees are paid in the quote asset.
        assertEq(feeVault.creatorBalance(creator, token), 6_500, "TOKEN side");
        assertEq(
            feeVault.creatorBalance(creator, address(quote)) - quoteBefore, 13_000, "quote side"
        );

        // Different assets, different balances — not one nominal number.
        assertTrue(
            feeVault.creatorBalance(creator, token) != feeVault.creatorBalance(creator, address(quote)),
            "the two are distinct claims"
        );
    }

    // -----------------------------------------------------------------------
    // Behaviour
    // -----------------------------------------------------------------------

    /// @dev §414: a permissioned collector is a party who can stop paying the
    ///      creator by doing nothing.
    function test_anyoneMayTriggerCollection() public {
        _accrueFees(0, 10_000);

        vm.prank(makeAddr("a stranger"));
        market.collectPostGradFees();

        assertGt(feeVault.creatorBalance(creator, address(quote)), 0, "the creator was paid");
    }

    function test_collectingNothingIsHarmless() public {
        (uint256 tokenFees, uint256 quoteFees) = market.collectPostGradFees();
        assertEq(tokenFees + quoteFees, 0, "a quiet market collects nothing, and does not revert");
    }

    /// @dev Reading a balance AFTER the collect and calling the whole thing a
    ///      fee would credit the curve's own leftovers as revenue. The market
    ///      holds quote for reasons that are not fees.
    function test_onlyTheDeltaIsTreatedAsFees() public {
        // Put quote in the market that has nothing to do with LP fees.
        quote.mint(address(market), 500_000);

        _accrueFees(0, 10_000);

        (uint256 creatorBefore,,) = _snapshot(address(quote));
        (, uint256 quoteFees) = market.collectPostGradFees();

        assertEq(quoteFees, 10_000, "only what the collect delivered counts");
        assertEq(
            feeVault.creatorBalance(creator, address(quote)) - creatorBefore,
            6_500,
            "and only that is split"
        );
    }

    function test_aPreGradMarketHasNoFeesToCollect() public {
        vm.prank(creator);
        (, address market2) = factory.launch(
            LaunchpadFactory.LaunchParams({
                name: "Still Trading",
                symbol: "ST",
                quoteAsset: address(quote),
                userSalt: bytes32(uint256(2)),
                launchIntentHash: keccak256("intent2"),
                xStockUsdWad: XSTOCK_USD,
                expectedToken: address(0),
                metadata: Metadata.Content({
                    description: "",
                    imageCid: "",
                    links: new Metadata.Link[](0)
                })
            })
        );

        vm.expectRevert(LaunchMarket.NotGraduated.selector);
        LaunchMarket(market2).collectPostGradFees();
    }

    function test_onlyTheRouterCanSetTheLock() public {
        vm.expectRevert(LaunchMarket.NotTheRouter.selector);
        market.setLiquidityLock(address(this));
    }

    function test_theLockCannotBeReassigned() public {
        vm.prank(address(router));
        vm.expectRevert(LaunchMarket.LockAlreadySet.selector);
        market.setLiquidityLock(address(this));
    }
}
