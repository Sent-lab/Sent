// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {LaunchMarket} from "../src/LaunchMarket.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {HolderRewardVault} from "../src/HolderRewardVault.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";
import {IGraduationRouter} from "../src/interfaces/IGraduationRouter.sol";
import {Curve} from "../src/lib/Curve.sol";

contract GuardQuote is ERC20 {
    uint8 private d;
    bool public breakDecimals;

    constructor(uint8 d_) ERC20("Mock NVDAx", "NVDAx") {
        d = d_;
    }

    function decimals() public view override returns (uint8) {
        if (breakDecimals) revert("no decimals");
        return d;
    }

    function setDecimals(uint8 d_) external {
        d = d_;
    }

    function setBreakDecimals(bool v) external {
        breakDecimals = v;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract GuardRouter is IGraduationRouter {
    function graduate(address t, address, uint256, uint256, uint256, uint256)
        external
        pure
        override
        returns (address, uint256)
    {
        return (address(uint160(uint256(keccak256(abi.encode(t, "pool"))))), 1);
    }

    function swapExactQuoteForToken(address, address, uint256, address) external pure override returns (uint256) {
        return 0;
    }
}

/// @notice Every guard that is supposed to stop something, exercised.
///
/// An audit of custom errors found that most revert paths in these contracts had
/// never been reached by a test. That matters more than it sounds: an untested
/// guard might be unreachable, might throw the wrong error, or might have been
/// written against a condition that cannot occur — and all three look identical
/// to a passing test suite that never tries.
///
/// One of the guards here is a fix made during that same audit
/// (DecimalsDriftedFromRegistry), which had been added without a test of its own.
contract GuardPathsTest is Test {
    XStockRegistry registry;
    LaunchpadFactory factory;
    GuardQuote quote;
    GuardRouter router;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address deployer = makeAddr("protocolDeployer");
    address creator = makeAddr("creator");
    address stranger = makeAddr("stranger");

    uint256 constant FEE = 0.01 ether;
    uint256 constant XSTOCK_USD = 137.42e18;

    function setUp() public {
        registry = new XStockRegistry(governance);
        quote = new GuardQuote(18);
        router = new GuardRouter();

        vm.prank(deployer);
        factory = new LaunchpadFactory(governance, treasury, address(registry), FEE);

        vm.prank(governance);
        factory.setRouter(address(router));

        vm.startPrank(governance);
        registry.registerAsset(address(quote), 18, 1385, 0);
        registry.setGates(address(quote), _allGates());
        registry.enableAsset(address(quote));
        vm.stopPrank();

        vm.deal(creator, 10 ether);
    }

    function _allGates() internal pure returns (XStockRegistry.Gates memory) {
        return XStockRegistry.Gates(true, true, true, true, true, true, true, true);
    }

    function _params(bytes32 salt) internal view returns (LaunchpadFactory.LaunchParams memory) {
        return LaunchpadFactory.LaunchParams({
            name: "Sent Guard",
            symbol: "GRD",
            quoteAsset: address(quote),
            userSalt: salt,
            launchIntentHash: keccak256("intent"),
            xStockUsdWad: XSTOCK_USD,
            expectedToken: address(0)
        });
    }

    // -----------------------------------------------------------------------
    // Factory — decimals drift (added during the audit, previously untested)
    // -----------------------------------------------------------------------

    /// @dev The registry is the verified source for decimals. If the asset's own
    ///      decimals() disagrees, the verified record is stale and the launch must
    ///      stop rather than proceed on either value — a wrong decimals figure
    ///      does not fail loudly, it mis-scales every amount by a power of ten.
    function test_launchStopsWhenTheAssetDecimalsDriftFromTheRegistry() public {
        quote.setDecimals(6); // the registry says 18

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchpadFactory.DecimalsDriftedFromRegistry.selector, 18, 6)
        );
        factory.launch{value: FEE}(_params(bytes32(uint256(1))));
    }

    /// @dev An asset that cannot report decimals could not have passed the §420
    ///      gates, so an absent value is treated as drift rather than defaulted.
    function test_launchStopsWhenTheAssetCannotReportDecimals() public {
        quote.setBreakDecimals(true);

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchpadFactory.DecimalsUnavailable.selector, address(quote))
        );
        factory.launch{value: FEE}(_params(bytes32(uint256(1))));
    }

    function test_launchStopsWithoutARouter() public {
        XStockRegistry r2 = new XStockRegistry(governance);
        vm.prank(deployer);
        LaunchpadFactory bare = new LaunchpadFactory(governance, treasury, address(r2), FEE);

        vm.prank(creator);
        vm.expectRevert(LaunchpadFactory.RouterNotSet.selector);
        bare.launch{value: FEE}(_params(bytes32(uint256(1))));
    }

    function test_launchStopsOnAnInvalidReferencePrice() public {
        LaunchpadFactory.LaunchParams memory p = _params(bytes32(uint256(1)));
        p.xStockUsdWad = 0;

        vm.prank(creator);
        vm.expectRevert(LaunchpadFactory.InvalidReferencePrice.selector);
        factory.launch{value: FEE}(p);
    }

    function test_factoryRejectsZeroAddressesAtConstruction() public {
        vm.expectRevert(LaunchpadFactory.ZeroAddress.selector);
        new LaunchpadFactory(address(0), treasury, address(registry), FEE);

        vm.expectRevert(LaunchpadFactory.ZeroAddress.selector);
        new LaunchpadFactory(governance, address(0), address(registry), FEE);

        vm.expectRevert(LaunchpadFactory.ZeroAddress.selector);
        new LaunchpadFactory(governance, treasury, address(0), FEE);
    }

    // -----------------------------------------------------------------------
    // Token
    // -----------------------------------------------------------------------

    function test_tokenRejectsAZeroCreator() public {
        vm.expectRevert(LaunchToken.ZeroAddress.selector);
        new LaunchToken("x", "x", address(0));
    }

    function test_tokenMarketIsWriteOnce() public {
        LaunchToken t = new LaunchToken("x", "x", creator);
        t.setMarket(address(0xBEEF));

        vm.expectRevert(LaunchToken.MarketAlreadySet.selector);
        t.setMarket(address(0xCAFE));

        vm.prank(stranger);
        vm.expectRevert(LaunchToken.NotFactory.selector);
        t.setMarket(address(0xCAFE));
    }

    // -----------------------------------------------------------------------
    // Registry
    // -----------------------------------------------------------------------

    function test_registryGuards() public {
        address unknown = makeAddr("unknownAsset");

        vm.startPrank(governance);

        vm.expectRevert(XStockRegistry.ZeroAddress.selector);
        registry.registerAsset(address(0), 18, 1, 0);

        vm.expectRevert(XStockRegistry.AlreadyRegistered.selector);
        registry.registerAsset(address(quote), 18, 1385, 0);

        vm.expectRevert(XStockRegistry.UnknownAsset.selector);
        registry.setGates(unknown, _allGates());

        vm.expectRevert(XStockRegistry.AlreadyEnabled.selector);
        registry.enableAsset(address(quote));

        registry.disableAsset(address(quote), "halted");

        vm.expectRevert(XStockRegistry.NotEnabled.selector);
        registry.disableAsset(address(quote), "again");

        vm.stopPrank();
    }

    function test_registryUnknownAssetReadReverts() public {
        vm.expectRevert(XStockRegistry.UnknownAsset.selector);
        registry.getAsset(makeAddr("nothing"));
    }

    // -----------------------------------------------------------------------
    // Vaults
    // -----------------------------------------------------------------------

    function test_vaultsRejectZeroAddressesAndDoubleRegistration() public {
        vm.expectRevert(FeeVault.ZeroAddress.selector);
        new FeeVault(address(0), treasury, address(this));

        vm.expectRevert(HolderRewardVault.ZeroAddress.selector);
        new HolderRewardVault(address(0), address(this));

        FeeVault fv = new FeeVault(governance, treasury, address(this));
        fv.registerMarket(address(0xAAA));
        vm.expectRevert(FeeVault.AlreadyRegistered.selector);
        fv.registerMarket(address(0xAAA));

        HolderRewardVault rv = new HolderRewardVault(governance, address(this));
        rv.registerMarket(address(0xAAA), address(quote));
        vm.expectRevert(HolderRewardVault.AlreadyRegistered.selector);
        rv.registerMarket(address(0xAAA), address(quote));

        vm.expectRevert(HolderRewardVault.ZeroAddress.selector);
        rv.registerMarket(address(0xBBB), address(0));
    }

    /// @dev A quorum of zero would accept a commitment nobody signed.
    function test_aZeroQuorumRejectsEverything() public {
        HolderRewardVault rv = new HolderRewardVault(governance, address(this));
        rv.registerMarket(address(0xAAA), address(quote));

        vm.prank(governance);
        vm.expectRevert(HolderRewardVault.QuorumZero.selector);
        rv.setQuorum(0);

        // With quorum still unset, no commitment can be accepted at all.
        HolderRewardVault.Commitment memory c = HolderRewardVault.Commitment({
            market: address(0xAAA),
            token: address(0xBEEF),
            rewardAsset: address(quote),
            distributionVersion: 1,
            epochSequence: 1,
            totalCumulative: 0,
            merkleRoot: keccak256("root"),
            datasetHash: keccak256("data")
        });

        vm.expectRevert(HolderRewardVault.QuorumZero.selector);
        rv.submitCommitment(c, new bytes[](0));
    }

    function test_moreSignaturesThanAttestorsIsRejected() public {
        HolderRewardVault rv = new HolderRewardVault(governance, address(this));
        rv.registerMarket(address(0xAAA), address(quote));

        vm.startPrank(governance);
        rv.addAttestor(vm.addr(1));
        rv.addAttestor(vm.addr(2));
        rv.setQuorum(2);
        vm.stopPrank();

        HolderRewardVault.Commitment memory c = HolderRewardVault.Commitment({
            market: address(0xAAA),
            token: address(0xBEEF),
            rewardAsset: address(quote),
            distributionVersion: 1,
            epochSequence: 1,
            totalCumulative: 0,
            merkleRoot: keccak256("root"),
            datasetHash: keccak256("data")
        });

        bytes[] memory tooMany = new bytes[](3);
        vm.expectRevert(abi.encodeWithSelector(HolderRewardVault.TooManySignatures.selector, 3, 2));
        rv.submitCommitment(c, tooMany);
    }

    function test_guardianGuards() public {
        HolderRewardVault rv = new HolderRewardVault(governance, address(this));

        // No guardian set: nobody can pause.
        vm.prank(stranger);
        vm.expectRevert(HolderRewardVault.NotGuardian.selector);
        rv.pauseClaims("nope");

        // Unpausing when not paused is refused rather than silently succeeding.
        vm.prank(governance);
        vm.expectRevert(HolderRewardVault.NotPaused.selector);
        rv.unpauseClaims();
    }

    function test_activationBeforeTheDelayIsRefused() public {
        HolderRewardVault rv = new HolderRewardVault(governance, address(this));
        rv.registerMarket(address(0xAAA), address(quote));

        vm.startPrank(governance);
        rv.addAttestor(vm.addr(1));
        rv.setQuorum(1);
        vm.stopPrank();

        HolderRewardVault.Commitment memory c = HolderRewardVault.Commitment({
            market: address(0xAAA),
            token: address(0xBEEF),
            rewardAsset: address(quote),
            distributionVersion: 1,
            epochSequence: 1,
            totalCumulative: 0,
            merkleRoot: keccak256("root"),
            datasetHash: keccak256("data")
        });

        bytes32 digest = rv.hashCommitment(c);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(1, digest);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = abi.encodePacked(r, s, v);

        rv.submitCommitment(c, sigs);

        vm.expectRevert(
            abi.encodeWithSelector(
                HolderRewardVault.NotYetActive.selector, block.timestamp + rv.ACTIVATION_DELAY()
            )
        );
        rv.activate(address(0xAAA));
    }

    // -----------------------------------------------------------------------
    // Market
    // -----------------------------------------------------------------------

    function test_marketRejectsZeroAddressesAndZeroAmounts() public {
        vm.expectRevert(LaunchMarket.ZeroAddress.selector);
        new LaunchMarket(address(0), address(quote), 18, creator, address(1), address(2), 1e10);

        vm.prank(creator);
        (address token, address market) = factory.launch{value: FEE}(_params(bytes32(uint256(1))));
        token;

        vm.expectRevert(LaunchMarket.ZeroAmount.selector);
        LaunchMarket(market).buy(0, 0, block.timestamp + 1);

        vm.expectRevert(LaunchMarket.ZeroAmount.selector);
        LaunchMarket(market).sell(0, 0, block.timestamp + 1);
    }

    /// @dev A market with no router cannot graduate. §16 forbids a GRADUATED
    ///      status without a complete migration, so refusing is the correct
    ///      outcome — not a fallback that half-migrates.
    function test_aMarketWithoutARouterCannotGraduate() public {
        LaunchToken t = new LaunchToken("x", "x", creator);
        uint256 quoteMc = (2_000e18 * 1e18) / XSTOCK_USD;
        uint256 p0 = (quoteMc * 1e18) / Curve.TOTAL_SUPPLY;

        FeeVault fv = new FeeVault(governance, treasury, address(this));
        HolderRewardVault rv = new HolderRewardVault(governance, address(this));

        LaunchMarket m = new LaunchMarket(
            address(t), address(quote), 18, creator, address(fv), address(rv), p0
        );
        t.setMarket(address(m));
        t.transfer(address(m), t.GENESIS_SUPPLY());
        fv.registerMarket(address(m));
        rv.registerMarket(address(m), address(quote));
        // Deliberately no setRouter.

        quote.mint(creator, 10_000e18);
        vm.startPrank(creator);
        quote.approve(address(m), type(uint256).max);

        vm.expectRevert(LaunchMarket.RouterNotSet.selector);
        m.buy(200e18, 0, block.timestamp + 1); // large enough to cross the endpoint
        vm.stopPrank();
    }
}
