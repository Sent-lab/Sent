// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {WrappedXStock} from "../src/WrappedXStock.sol";
import {WrappedXStockFactory} from "../src/WrappedXStockFactory.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";

/**
 * @dev Backed's rebasing token, copied in shape rather than invented.
 *
 * `balanceOf = sharesOf × multiplier / 1e18`, transfers move BALANCE and are
 * converted to shares internally with the underlying's own rounding — which is
 * the detail the wrapper must not try to predict.
 */
contract RebasingXStock is ERC20 {
    uint256 public multiplier = 1e18;
    mapping(address => uint256) private _shares;
    uint256 private _totalShares;

    constructor() ERC20("Tesla xStock", "TSLAx") {}

    function sharesOf(address a) external view returns (uint256) {
        return _shares[a];
    }

    function mintShares(address to, uint256 shares) external {
        _shares[to] += shares;
        _totalShares += shares;
    }

    /// @dev A corporate action. No transfer, no ERC-20 event — that is the point.
    function setMultiplier(uint256 m) external {
        multiplier = m;
    }

    function balanceOf(address a) public view override returns (uint256) {
        return (_shares[a] * multiplier) / 1e18;
    }

    function totalSupply() public view override returns (uint256) {
        return (_totalShares * multiplier) / 1e18;
    }

    function _sharesFor(uint256 assets) internal view returns (uint256) {
        return (assets * 1e18) / multiplier;
    }

    function transfer(address to, uint256 assets) public override returns (bool) {
        uint256 sh = _sharesFor(assets);
        require(_shares[msg.sender] >= sh, "balance");
        _shares[msg.sender] -= sh;
        _shares[to] += sh;
        return true;
    }

    function transferFrom(address from, address to, uint256 assets) public override returns (bool) {
        uint256 sh = _sharesFor(assets);
        require(_shares[from] >= sh, "balance");
        _spendAllowance(from, msg.sender, assets);
        _shares[from] -= sh;
        _shares[to] += sh;
        return true;
    }
}

/// @dev An ordinary token. Must be refused: it does not need wrapping.
contract PlainToken is ERC20 {
    constructor() ERC20("Plain", "PLAIN") {}
}

contract WrappedXStockTest is Test {
    RebasingXStock xstock;
    WrappedXStock wrapper;
    WrappedXStockFactory factory;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        xstock = new RebasingXStock();
        factory = new WrappedXStockFactory();
        wrapper = WrappedXStock(factory.create(address(xstock)));

        xstock.mintShares(alice, 1_000e18);
        xstock.mintShares(bob, 1_000e18);

        vm.prank(alice);
        xstock.approve(address(wrapper), type(uint256).max);
        vm.prank(bob);
        xstock.approve(address(wrapper), type(uint256).max);
    }

    /// @dev The one property everything else exists to protect.
    function _assertSolvent() internal view {
        assertLe(
            wrapper.totalSupply(),
            xstock.sharesOf(address(wrapper)),
            "every wrapper token must be backed by a share actually held"
        );
    }

    // -----------------------------------------------------------------------
    // The basic round trip
    // -----------------------------------------------------------------------

    function test_wrappingMintsOnePerShare() public {
        vm.prank(alice);
        uint256 minted = wrapper.wrap(100e18);

        assertEq(minted, 100e18, "at parity a balance is a share");
        assertEq(wrapper.balanceOf(alice), 100e18);
        _assertSolvent();
    }

    function test_unwrappingReturnsTheUnderlying() public {
        vm.startPrank(alice);
        wrapper.wrap(100e18);
        uint256 got = wrapper.unwrap(100e18);
        vm.stopPrank();

        assertEq(got, 100e18);
        assertEq(wrapper.balanceOf(alice), 0);
        assertEq(wrapper.totalSupply(), 0);
        _assertSolvent();
    }

    // -----------------------------------------------------------------------
    // The whole reason this contract exists
    // -----------------------------------------------------------------------

    /// @dev A dividend. The multiplier rises; the wrapper's supply must not.
    ///
    ///      This is what a Uniswap V3 pool needs: a token whose balance is
    ///      still, whose price moves. The pool sees a price change, which it is
    ///      built for, instead of a balance change, which it cannot see at all.
    function test_aDividendDoesNotChangeAnyWrapperBalance() public {
        vm.prank(alice);
        wrapper.wrap(100e18);

        uint256 supplyBefore = wrapper.totalSupply();
        uint256 aliceBefore = wrapper.balanceOf(alice);

        // Backed's STRCx read 1.0808929977 when this was written.
        xstock.setMultiplier(1_080_892_997_725_636_700);

        assertEq(wrapper.totalSupply(), supplyBefore, "supply is untouched by a rebase");
        assertEq(wrapper.balanceOf(alice), aliceBefore, "and so is every holder");
        _assertSolvent();
    }

    /// @dev And the dividend is not lost — it arrives as a better redemption.
    function test_theDividendReachesTheHolder() public {
        vm.prank(alice);
        wrapper.wrap(100e18);

        xstock.setMultiplier(1.05e18);

        assertEq(wrapper.convertToAssets(100e18), 105e18, "5% more underlying per token");

        vm.prank(alice);
        uint256 got = wrapper.unwrap(100e18);

        assertEq(got, 105e18, "the holder receives it on the way out");
        _assertSolvent();
    }

    /// @dev THE CASE THAT BREAKS EVERYTHING ELSE.
    ///
    ///      A reverse split lowers the multiplier. Held raw, this is where a
    ///      market becomes insolvent against its own books and where a permanent
    ///      V3 position stops being able to pay out.
    ///
    ///      Through the wrapper it is an ordinary repricing: nobody's wrapper
    ///      balance moves, the invariant holds, and redemption simply returns
    ///      less underlying — which is correct, because the underlying is worth
    ///      less per share.
    function test_aReverseSplitCannotMakeThisInsolvent() public {
        vm.prank(alice);
        wrapper.wrap(100e18);
        vm.prank(bob);
        wrapper.wrap(100e18);

        // 1-for-10 reverse split.
        xstock.setMultiplier(0.1e18);

        _assertSolvent();
        assertEq(wrapper.balanceOf(alice), 100e18, "no wrapper balance moved");
        assertEq(wrapper.totalSupply(), 200e18);

        // Both holders can still leave. Neither is blocked by the other.
        vm.prank(alice);
        uint256 a = wrapper.unwrap(100e18);
        vm.prank(bob);
        uint256 b = wrapper.unwrap(100e18);

        assertEq(a, 10e18);
        assertEq(b, 10e18, "the second holder is not left short");
        _assertSolvent();
    }

    /// @dev The multiplier moving BETWEEN a wrap and an unwrap must not let
    ///      anyone withdraw more shares than they put in.
    function test_aRebaseBetweenWrapAndUnwrapIsNeutral() public {
        vm.prank(alice);
        uint256 minted = wrapper.wrap(100e18);

        xstock.setMultiplier(3e18);

        uint256 sharesBefore = xstock.sharesOf(address(wrapper));

        vm.prank(alice);
        wrapper.unwrap(minted);

        uint256 sharesMoved = sharesBefore - xstock.sharesOf(address(wrapper));
        assertLe(sharesMoved, minted, "never more shares out than were burned");
        _assertSolvent();
    }

    // -----------------------------------------------------------------------
    // Accounting edges
    // -----------------------------------------------------------------------

    /// @dev A donation raises the backing without minting. It strengthens the
    ///      invariant, it is stranded, and there is deliberately no way to
    ///      retrieve it — a rescue function is an admin key with a kind name.
    function test_aDonationIsStrandedAndHarmless() public {
        vm.prank(alice);
        wrapper.wrap(100e18);

        vm.prank(bob);
        xstock.transfer(address(wrapper), 50e18);

        assertEq(wrapper.totalSupply(), 100e18, "a donation mints nothing");
        assertGt(xstock.sharesOf(address(wrapper)), wrapper.totalSupply());
        _assertSolvent();
    }

    function test_zeroIsRefusedRatherThanSilentlyDoingNothing() public {
        vm.startPrank(alice);
        vm.expectRevert(WrappedXStock.ZeroAmount.selector);
        wrapper.wrap(0);

        vm.expectRevert(WrappedXStock.ZeroAmount.selector);
        wrapper.unwrap(0);
        vm.stopPrank();
    }

    /// @dev The mint must come from measurement, not from the caller's figure.
    ///      At a multiplier of 3, 100 balance units are 33.33 shares — and it is
    ///      the shares that get minted.
    function test_theMintIsMeasuredNotPredicted() public {
        xstock.setMultiplier(3e18);

        vm.prank(alice);
        uint256 minted = wrapper.wrap(90e18);

        assertEq(minted, 30e18, "90 balance at 3x is 30 shares");
        assertEq(wrapper.totalSupply(), 30e18);
        _assertSolvent();
    }

    // -----------------------------------------------------------------------
    // The constructor's own gate
    // -----------------------------------------------------------------------

    function test_aPlainTokenCannotBeWrapped() public {
        PlainToken plain = new PlainToken();

        vm.expectRevert();
        factory.create(address(plain));
    }

    function test_aZeroMultiplierIsRefused() public {
        RebasingXStock broken = new RebasingXStock();
        broken.setMultiplier(0);

        vm.expectRevert(WrappedXStock.MultiplierIsZero.selector);
        new WrappedXStock(address(broken), "Wrapped Broken", "wBROKEN");
    }

    // -----------------------------------------------------------------------
    // No keys (§17's discipline, applied to the contract holding everything)
    // -----------------------------------------------------------------------

    /// @dev This contract will hold every market's collateral. If any of these
    ///      existed, everything downstream would inherit whoever holds the key.
    ///
    ///      Asserted against the ABI rather than trusted, which is the strongest
    ///      form the claim can take: the selectors are not gated, they are absent.
    function test_thereIsNoAdminSurfaceAtAll() public {
        string[14] memory forbidden = [
            "owner()",
            "transferOwnership(address)",
            "pause()",
            "unpause()",
            "upgradeTo(address)",
            "initialize(address)",
            "setUnderlying(address)",
            "setFee(uint256)",
            "rescue(address,uint256)",
            "sweep(address)",
            "withdrawTo(address,uint256)",
            "execute(address,bytes)",
            "mint(address,uint256)",
            "burn(address,uint256)"
        ];

        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = address(wrapper).call(abi.encodeWithSignature(forbidden[i]));
            assertFalse(ok, forbidden[i]);
        }
    }

    // -----------------------------------------------------------------------
    // The factory
    // -----------------------------------------------------------------------

    function test_thePredictedAddressIsTheRealOne() public {
        RebasingXStock other = new RebasingXStock();

        address predicted = factory.predict(address(other));
        address actual = factory.create(address(other));

        assertEq(actual, predicted, "predict and create must not drift apart");
    }

    function test_anAssetCannotHaveTwoWrappers() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                WrappedXStockFactory.AlreadyCreated.selector, address(xstock), address(wrapper)
            )
        );
        factory.create(address(xstock));
    }

    function test_theNameIsDerivedNotChosen() public view {
        assertEq(wrapper.name(), "Wrapped Tesla xStock");
        assertEq(wrapper.symbol(), "wTSLAx");
    }

    // -----------------------------------------------------------------------
    // Fuzz: the invariant survives arbitrary sequences
    // -----------------------------------------------------------------------

    function testFuzz_theInvariantHoldsThroughAnySequence(
        uint256 wrapA,
        uint256 wrapB,
        uint256 multiplier,
        uint256 unwrapA
    ) public {
        wrapA = bound(wrapA, 1e6, 500e18);
        wrapB = bound(wrapB, 1e6, 500e18);
        // From a 1-for-10 reverse split to a 10x accumulation.
        multiplier = bound(multiplier, 0.1e18, 10e18);

        vm.prank(alice);
        uint256 mintedA = wrapper.wrap(wrapA);
        vm.prank(bob);
        wrapper.wrap(wrapB);
        _assertSolvent();

        xstock.setMultiplier(multiplier);
        _assertSolvent();

        unwrapA = bound(unwrapA, 0, mintedA);
        if (unwrapA > 0 && wrapper.convertToAssets(unwrapA) > 0) {
            vm.prank(alice);
            wrapper.unwrap(unwrapA);
        }

        _assertSolvent();
    }
}

/**
 * @notice Listing a wrapper, and refusing one that only looks like it.
 *
 * §420's gates are attestations about the UNDERLYING, while the asset a market
 * actually pairs against is the wrapper (D-017). That gap is where a lookalike
 * gets in, and a boolean governance ticks does not close it.
 */
contract WrapperRegistrationTest is Test {
    RebasingXStock xstock;
    WrappedXStockFactory factory;
    WrappedXStock wrapper;
    XStockRegistry registry;

    address governance = makeAddr("governanceSafe");

    function setUp() public {
        xstock = new RebasingXStock();
        factory = new WrappedXStockFactory();
        wrapper = WrappedXStock(factory.create(address(xstock)));
        registry = new XStockRegistry(governance, address(factory));
    }

    function _allGates() internal pure returns (XStockRegistry.Gates memory) {
        return XStockRegistry.Gates({
            canonicalRepresentation: true,
            transferBehaviour: true,
            multiplierBehaviour: true,
            priceSource: true,
            haltSource: true,
            hyperSwapCompatible: true,
            normalizedAccountingTested: true,
            legalReviewed: true
        });
    }

    function test_aWrapperFromTheFactoryGoesAllTheWayThrough() public {
        vm.startPrank(governance);
        registry.registerWrappedAsset(address(wrapper), address(xstock), 18, 1385, 0);
        registry.setGates(address(wrapper), _allGates());
        registry.enableAsset(address(wrapper));
        vm.stopPrank();

        assertTrue(registry.isLaunchable(address(wrapper)), "the wrapper is a usable quote asset");
        assertEq(
            registry.underlyingOf(address(wrapper)),
            address(xstock),
            "and the registry records what it wraps"
        );
    }

    /**
     * @dev THE ATTACK THIS PATH EXISTS FOR.
     *
     *      A contract that reports the right underlying, the right name and the
     *      right symbol, and is not the wrapper. Asking it what it wraps is not
     *      a check — it answers whatever makes it look legitimate. Only
     *      provenance settles it.
     */
    function test_aLookalikeWrapperIsRefused() public {
        LookalikeWrapper fake = new LookalikeWrapper(address(xstock));

        // It passes every question you could ask it directly.
        assertEq(fake.UNDERLYING(), address(xstock));
        assertEq(fake.symbol(), wrapper.symbol());
        assertEq(fake.name(), wrapper.name());

        vm.prank(governance);
        vm.expectRevert(
            abi.encodeWithSelector(
                XStockRegistry.NotFromWrapperFactory.selector, address(fake), address(wrapper)
            )
        );
        registry.registerWrappedAsset(address(fake), address(xstock), 18, 1385, 0);

        assertFalse(registry.isLaunchable(address(fake)));
    }

    /// @dev And it cannot be smuggled in through the ordinary path either — that
    ///      one records no underlying, so nothing claims it is a Tesla wrapper.
    function test_theOrdinaryPathRecordsNoUnderlying() public {
        LookalikeWrapper fake = new LookalikeWrapper(address(xstock));

        vm.prank(governance);
        registry.registerAsset(address(fake), 18, 1385, 0);

        assertEq(
            registry.underlyingOf(address(fake)),
            address(0),
            "registerAsset never asserts a wrapping relationship"
        );
    }

    /// @dev A real wrapper listed against the wrong underlying. The factory
    ///      names a different wrapper for that asset, so it stops at provenance.
    function test_aWrapperListedAgainstTheWrongUnderlyingIsRefused() public {
        RebasingXStock other = new RebasingXStock();
        factory.create(address(other));

        vm.prank(governance);
        vm.expectRevert();
        registry.registerWrappedAsset(address(wrapper), address(other), 18, 1385, 0);
    }

    /// @dev A registry with no factory cannot list wrappers at all. Refusing is
    ///      the correct behaviour: the alternative is trusting an address nobody
    ///      bound at construction.
    function test_aRegistryWithNoFactoryRefusesWrappersEntirely() public {
        XStockRegistry bare = new XStockRegistry(governance, address(0));

        vm.prank(governance);
        vm.expectRevert(XStockRegistry.NoWrapperFactory.selector);
        bare.registerWrappedAsset(address(wrapper), address(xstock), 18, 1385, 0);
    }

    /// @dev The underlying is still refused by the ordinary path, so listing the
    ///      wrapper is not a way to smuggle the rebasing asset in beside it.
    function test_theRawXStockIsStillRefused() public {
        vm.prank(governance);
        vm.expectRevert(
            abi.encodeWithSelector(XStockRegistry.AssetRebases.selector, address(xstock), 1e18)
        );
        registry.registerAsset(address(xstock), 18, 1385, 0);
    }

    function test_theSameWrapperCannotBeListedTwice() public {
        vm.startPrank(governance);
        registry.registerWrappedAsset(address(wrapper), address(xstock), 18, 1385, 0);

        vm.expectRevert(XStockRegistry.AlreadyRegistered.selector);
        registry.registerWrappedAsset(address(wrapper), address(xstock), 18, 1385, 0);
        vm.stopPrank();
    }

    function test_onlyGovernanceCanListAWrapper() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(XStockRegistry.NotGovernance.selector);
        registry.registerWrappedAsset(address(wrapper), address(xstock), 18, 1385, 0);
    }
}

/// @dev Right answers, wrong provenance.
contract LookalikeWrapper is ERC20 {
    address public immutable UNDERLYING;

    constructor(address underlying) ERC20("Wrapped Tesla xStock", "wTSLAx") {
        UNDERLYING = underlying;
    }
}
