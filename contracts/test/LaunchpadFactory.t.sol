// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {LaunchMarket} from "../src/LaunchMarket.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {HolderRewardVault} from "../src/HolderRewardVault.sol";
import {IGraduationRouter} from "../src/interfaces/IGraduationRouter.sol";
import {Curve} from "../src/lib/Curve.sol";
import {Metadata} from "../src/lib/Metadata.sol";
import {ReferencePriceAdapter} from "../src/ReferencePriceAdapter.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

contract FQuote is ERC20 {
    constructor() ERC20("Mock NVDAx", "NVDAx") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract StubRouter is IGraduationRouter {
    function graduate(address token, address, uint256, uint256, uint256, uint256)
        external
        pure
        override
        returns (address, uint256)
    {
        return (address(uint160(uint256(keccak256(abi.encode(token, "pool"))))), 1);
    }

    function swapExactQuoteForToken(address, address, uint256, address) external pure override returns (uint256) {
        return 0;
    }
}

contract LaunchpadFactoryTest is Test {
    LaunchpadFactory factory;
    XStockRegistry registry;
    FQuote quote;
    StubRouter router;
    ReferencePriceAdapter priceAdapter;
    MockAggregator feed;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");

    /// @dev The platform's deployer wallet. It deploys the factory and must NEVER
    ///      become the creator of a user's launch (§578 CRITICAL LOCK).
    address deployer = makeAddr("protocolDeployer");

    address creator = makeAddr("creator");
    address frontRunner = makeAddr("frontRunner");

    uint256 constant LAUNCH_FEE = 0.01 ether;
    uint256 constant XSTOCK_USD = 137.42e18;

    function setUp() public {
        registry = new XStockRegistry(governance, address(0));
        quote = new FQuote();
        router = new StubRouter();

        vm.prank(deployer);
        factory = new LaunchpadFactory(governance, treasury, address(registry), LAUNCH_FEE);

        vm.prank(governance);
        factory.setRouter(address(router));

        /*
         * The launch anchor now comes from a feed, not from calldata (§135).
         *
         * Eight decimals because that is what a Chainlink USD feed reports, and
         * the adapter reads it rather than assuming it — so a test that used
         * eighteen here would never exercise the normalisation.
         */
        feed = new MockAggregator(int256(XSTOCK_USD / 1e10), 8);
        priceAdapter = new ReferencePriceAdapter(governance);

        vm.startPrank(governance);
        priceAdapter.configure(address(quote), address(feed), 1 hours, 1e18, 100_000e18);
        factory.setReferencePrice(address(priceAdapter));
        vm.stopPrank();

        vm.startPrank(governance);
        registry.registerAsset(address(quote), 18, 1385, 0);
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

        vm.deal(creator, 10 ether);
        vm.deal(frontRunner, 10 ether);
    }

    /// @dev Minimal valid metadata. Bounds and revisions are covered in
    ///      `Metadata.t.sol`; these tests are about everything else.
    function _metadata() internal pure returns (Metadata.Content memory) {
        return Metadata.Content({
            description: "a market",
            imageCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
            links: new Metadata.Link[](0)
        });
    }

    function _params(bytes32 userSalt) internal view returns (LaunchpadFactory.LaunchParams memory) {
        return LaunchpadFactory.LaunchParams({
            name: "Sent Test",
            symbol: "TEST",
            quoteAsset: address(quote),
            userSalt: userSalt,
            launchIntentHash: keccak256("intent"),
            xStockUsdWad: XSTOCK_USD,
            expectedToken: address(0),
            metadata: _metadata()
        });
    }

    // -----------------------------------------------------------------------
    // Creator identity — §578 CRITICAL LOCK, §641 P0 test
    // -----------------------------------------------------------------------

    function test_creatorIsTheCallerNeverTheDeployer() public {
        vm.prank(creator);
        (address token, address market) = factory.launch{value: LAUNCH_FEE}(_params(bytes32(uint256(1))));

        assertEq(factory.creatorOf(token), creator, "creator is the caller");
        assertEq(LaunchToken(token).CREATOR(), creator, "token records the caller");
        assertEq(LaunchMarket(market).CREATOR(), creator, "market records the caller");

        assertTrue(factory.creatorOf(token) != deployer, "deployer must never be creator");
        assertEq(factory.launchesByCreator(deployer).length, 0, "deployer owns no launches");
    }

    function test_allocationsAreZeroAndSupplyIsInTheMarket() public {
        vm.prank(creator);
        (address token, address market) = factory.launch{value: LAUNCH_FEE}(_params(bytes32(uint256(1))));

        assertEq(IERC20(token).totalSupply(), 1_000_000_000e18, "1B fixed supply");
        assertEq(IERC20(token).balanceOf(market), 1_000_000_000e18, "whole reserve in the market");
        assertEq(IERC20(token).balanceOf(creator), 0, "creator allocation 0%");
        assertEq(IERC20(token).balanceOf(treasury), 0, "platform allocation 0%");
        assertEq(IERC20(token).balanceOf(address(factory)), 0, "factory keeps nothing");
        assertEq(IERC20(token).balanceOf(deployer), 0, "deployer keeps nothing");
    }

    // -----------------------------------------------------------------------
    // CREATE2 front-run resistance — §412
    // -----------------------------------------------------------------------

    /// @dev The attack §412 describes: a creator grinds a salt and broadcasts it;
    ///      an observer copies the whole calldata and submits it first.
    function test_frontRunnerCannotStealThePredictedAddress() public {
        bytes32 userSalt = bytes32(uint256(0xC0FFEE));
        LaunchpadFactory.LaunchParams memory p = _params(userSalt);

        // What the creator was shown in the preview.
        (address victimAddress,) = factory.previewLaunchAddress(
            creator, userSalt, address(quote), keccak256("intent"), "Sent Test", "TEST"
        );

        // The front-runner copies the identical calldata and lands first.
        vm.prank(frontRunner);
        (address stolen,) = factory.launch{value: LAUNCH_FEE}(p);

        assertTrue(stolen != victimAddress, "copied salt must not reach the victim's address");
        assertEq(factory.creatorOf(stolen), frontRunner, "the front-runner only ever creates their own");

        // The victim's address is still free, and still theirs.
        vm.prank(creator);
        (address token,) = factory.launch{value: LAUNCH_FEE}(p);

        assertEq(token, victimAddress, "the victim still gets the address they ground");
        assertEq(factory.creatorOf(token), creator, "and remains its creator");
    }

    function test_effectiveSaltDependsOnCreator() public view {
        bytes32 a = factory.computeEffectiveSalt(creator, bytes32(uint256(1)), address(quote), keccak256("i"));
        bytes32 b = factory.computeEffectiveSalt(frontRunner, bytes32(uint256(1)), address(quote), keccak256("i"));
        assertTrue(a != b, "identical parameters from different callers must diverge");
    }

    function test_saltCannotBeReplayedByTheSameCreator() public {
        LaunchpadFactory.LaunchParams memory p = _params(bytes32(uint256(7)));

        vm.prank(creator);
        factory.launch{value: LAUNCH_FEE}(p);

        bytes32 salt =
            factory.computeEffectiveSalt(creator, bytes32(uint256(7)), address(quote), keccak256("intent"));

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(LaunchpadFactory.SaltAlreadyUsed.selector, salt));
        factory.launch{value: LAUNCH_FEE}(p);
    }

    /// @dev The preview address the creator approved must be what deploys.
    function test_previewAddressIsEnforced() public {
        LaunchpadFactory.LaunchParams memory p = _params(bytes32(uint256(3)));

        (address predicted,) = factory.previewLaunchAddress(
            creator, bytes32(uint256(3)), address(quote), keccak256("intent"), "Sent Test", "TEST"
        );

        p.expectedToken = predicted;
        vm.prank(creator);
        (address token,) = factory.launch{value: LAUNCH_FEE}(p);
        assertEq(token, predicted, "deployed address matches the preview");
    }

    function test_wrongExpectedAddressAborts() public {
        LaunchpadFactory.LaunchParams memory p = _params(bytes32(uint256(4)));
        p.expectedToken = makeAddr("somethingElse");

        vm.prank(creator);
        vm.expectRevert();
        factory.launch{value: LAUNCH_FEE}(p);
    }

    /// @dev A changed intent must change the address, so a launch can never
    ///      silently deploy metadata the creator did not approve.
    function test_changedIntentChangesTheAddress() public view {
        (address a,) = factory.previewLaunchAddress(
            creator, bytes32(uint256(1)), address(quote), keccak256("intent A"), "Sent Test", "TEST"
        );
        (address b,) = factory.previewLaunchAddress(
            creator, bytes32(uint256(1)), address(quote), keccak256("intent B"), "Sent Test", "TEST"
        );
        assertTrue(a != b, "a different intent must produce a different address");
    }

    // -----------------------------------------------------------------------
    // Authenticity — §4, §138
    // -----------------------------------------------------------------------

    function test_authenticityComesFromTheRegistryNotTheAddress() public {
        vm.prank(creator);
        (address token,) = factory.launch{value: LAUNCH_FEE}(_params(bytes32(uint256(1))));

        assertTrue(factory.isAuthentic(token), "launched token is authentic");

        // An independently deployed token, however its address looks, is not.
        LaunchToken impostor = new LaunchToken("Sent Test", "TEST", creator);
        assertFalse(factory.isAuthentic(address(impostor)), "an identical-looking token is not authentic");
        assertEq(factory.creatorOf(address(impostor)), address(0), "and has no creator on record");
    }

    // -----------------------------------------------------------------------
    // §420 gate
    // -----------------------------------------------------------------------

    function test_cannotLaunchAgainstUnverifiedQuoteAsset() public {
        FQuote rogue = new FQuote();

        LaunchpadFactory.LaunchParams memory p = _params(bytes32(uint256(9)));
        p.quoteAsset = address(rogue);

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchpadFactory.QuoteAssetNotLaunchable.selector, address(rogue))
        );
        factory.launch{value: LAUNCH_FEE}(p);
    }

    function test_disablingAnAssetStopsNewLaunchesOnly() public {
        vm.prank(creator);
        (, address market) = factory.launch{value: LAUNCH_FEE}(_params(bytes32(uint256(1))));

        vm.prank(governance);
        registry.disableAsset(address(quote), "halted upstream");

        // New launches stop.
        vm.prank(creator);
        vm.expectRevert();
        factory.launch{value: LAUNCH_FEE}(_params(bytes32(uint256(2))));

        // The live market is untouched: its pair is fixed for life (§387, §388).
        quote.mint(creator, 100e18);
        vm.startPrank(creator);
        quote.approve(market, type(uint256).max);
        uint256 out = LaunchMarket(market).buy(10e18, 0, block.timestamp + 1);
        vm.stopPrank();

        assertGt(out, 0, "an existing market keeps trading after its asset is disabled");
    }

    // -----------------------------------------------------------------------
    // Launch fee and anchoring
    // -----------------------------------------------------------------------

    function test_launchFeeGoesToTreasury() public {
        uint256 before = treasury.balance;

        vm.prank(creator);
        factory.launch{value: LAUNCH_FEE}(_params(bytes32(uint256(1))));

        assertEq(treasury.balance - before, LAUNCH_FEE, "launch fee settles at the Treasury Safe");
        assertEq(address(factory).balance, 0, "factory retains nothing");
    }

    function test_insufficientFeeReverts() public {
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchpadFactory.InsufficientLaunchFee.selector, 0, LAUNCH_FEE)
        );
        factory.launch{value: 0}(_params(bytes32(uint256(1))));
    }

    function test_marketAnchorsAtTwoThousandReferenceMarketCap() public {
        vm.prank(creator);
        (, address market) = factory.launch{value: LAUNCH_FEE}(_params(bytes32(uint256(1))));

        uint256 mcQuote = (LaunchMarket(market).marginalPrice() * Curve.TOTAL_SUPPLY) / 1e18;
        uint256 mcUsd = (mcQuote * XSTOCK_USD) / 1e18;

        assertApproxEqRel(mcUsd, 2_000e18, 1e15, "every launch starts at $2,000 priceAdapter MC");
    }

    /// @dev The endpoint is a pure fraction of supply, so it must be identical
    ///      across wildly different quote-asset prices.
    /// @dev The price is varied on the FEED, not in calldata. `xStockUsdWad` is
    ///      no longer the anchor — it is the bound on how far the feed may have
    ///      moved since the creator's preview — so varying it here would be
    ///      fuzzing the tolerance check rather than the curve.
    function testFuzz_endpointIsIdenticalAcrossPrices(uint256 xStockUsdWad) public {
        xStockUsdWad = bound(xStockUsdWad, 1e18, 5_000e18);

        // Eight decimals, matching the feed. Rounded down there and back, so the
        // bound is exactly what the adapter will report rather than a value it
        // rounds away from.
        uint256 onFeed = (xStockUsdWad / 1e10) * 1e10;

        vm.prank(governance);
        feed.set(int256(onFeed / 1e10), block.timestamp);

        LaunchpadFactory.LaunchParams memory p = _params(bytes32(xStockUsdWad));
        p.xStockUsdWad = onFeed;

        vm.prank(creator);
        (, address market) = factory.launch{value: LAUNCH_FEE}(p);

        (,,, uint256 qG) = LaunchMarket(market).curve();
        assertEq(qG, (Curve.TOTAL_SUPPLY * 50) / 76, "endpoint must not vary with the pair");
    }

    // -----------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------

    function test_vaultsAreBoundToThisFactoryOnly() public view {
        assertEq(factory.FEE_VAULT().FACTORY(), address(factory), "fee vault bound to this factory");
        assertEq(factory.REWARD_VAULT().FACTORY(), address(factory), "reward vault bound to this factory");
    }

    function test_onlyGovernanceCanChangeParameters() public {
        vm.startPrank(frontRunner);

        vm.expectRevert(LaunchpadFactory.NotGovernance.selector);
        factory.setRouter(address(1));

        vm.expectRevert(LaunchpadFactory.NotGovernance.selector);
        factory.setLaunchFee(0);

        vm.expectRevert(LaunchpadFactory.NotGovernance.selector);
        factory.setTreasury(frontRunner);

        vm.stopPrank();
    }

    function test_marketInheritsRouterAtLaunch() public {
        vm.prank(creator);
        (, address market) = factory.launch{value: LAUNCH_FEE}(_params(bytes32(uint256(1))));
        assertEq(address(LaunchMarket(market).router()), address(router), "router wired at launch");
    }
}
