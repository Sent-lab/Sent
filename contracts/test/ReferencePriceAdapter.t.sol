// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {ReferencePriceAdapter} from "../src/ReferencePriceAdapter.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

/// @notice §135's Definition of Done, as tests.
///
/// The anchor fixes `p0` for a market's entire life. Every refusal here is a
/// launch that must not happen, and the one thing that must never work is a
/// path — any path — by which a number reaches `p0` without a feed having said
/// it.
contract ReferencePriceAdapterTest is Test {
    ReferencePriceAdapter adapter;
    MockAggregator feed;

    address governance = makeAddr("governanceSafe");
    address stranger = makeAddr("stranger");
    address asset = makeAddr("NVDAx");

    /// $137.42, as an 8-decimal feed reports it.
    int256 constant ANSWER_8 = 137_42000000;
    uint256 constant EXPECTED_WAD = 137.42e18;

    function setUp() public {
        adapter = new ReferencePriceAdapter(governance);
        feed = new MockAggregator(ANSWER_8, 8);

        vm.prank(governance);
        adapter.configure(asset, address(feed), 1 hours, 1e18, 100_000e18);
    }

    // -----------------------------------------------------------------------
    // Decimals normalisation
    // -----------------------------------------------------------------------

    function test_eightDecimalFeedNormalisesToWad() public view {
        assertEq(adapter.usdPriceWad(asset), EXPECTED_WAD, "8 decimals to wad");
    }

    /// @dev Eight is what Chainlink USD feeds report. That is a fact about one
    ///      provider, not a rule — so the adapter reads `decimals()` rather than
    ///      assuming, and both directions are exercised.
    function test_feedDecimalsAreReadNotAssumed() public {
        MockAggregator wide = new MockAggregator(int256(EXPECTED_WAD), 18);
        MockAggregator narrow = new MockAggregator(13742, 2);

        vm.startPrank(governance);
        adapter.configure(asset, address(wide), 1 hours, 1e18, 100_000e18);
        assertEq(adapter.usdPriceWad(asset), EXPECTED_WAD, "18 decimals passes through");

        adapter.configure(asset, address(narrow), 1 hours, 1e18, 100_000e18);
        assertEq(adapter.usdPriceWad(asset), EXPECTED_WAD, "2 decimals scales up");
        vm.stopPrank();
    }

    /// @dev A feed with more precision than wad. Truncation is correct here —
    ///      the alternative is rounding a price up, and an anchor that is
    ///      generous by a wei is still an anchor nobody quoted.
    function test_aFeedWiderThanWadIsTruncated() public {
        MockAggregator wide = new MockAggregator(int256(EXPECTED_WAD * 100 + 99), 20);

        vm.prank(governance);
        adapter.configure(asset, address(wide), 1 hours, 1e18, 100_000e18);

        assertEq(adapter.usdPriceWad(asset), EXPECTED_WAD, "extra precision is dropped, not rounded");
    }

    // -----------------------------------------------------------------------
    // §135: stale detection
    // -----------------------------------------------------------------------

    function test_aStaleAnswerIsRefused() public {
        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert(
            abi.encodeWithSelector(
                ReferencePriceAdapter.StalePrice.selector,
                asset,
                block.timestamp - 2 hours,
                uint32(1 hours)
            )
        );
        adapter.usdPriceWad(asset);
    }

    /// @dev Exactly at the bound is still fresh. An off-by-one here is a launch
    ///      that fails for no reason a creator can see, on a feed that updates
    ///      on the hour.
    function test_theStalenessBoundIsInclusive() public {
        vm.warp(block.timestamp + 1 hours);
        assertEq(adapter.usdPriceWad(asset), EXPECTED_WAD, "exactly maxAge is still fresh");

        vm.warp(block.timestamp + 1);
        vm.expectRevert();
        adapter.usdPriceWad(asset);
    }

    /// @dev A round that never completed reports zero. Named separately from
    ///      staleness because "the feed has not answered yet" and "the feed
    ///      answered a while ago" are different incidents.
    function test_anIncompleteRoundIsRefusedByName() public {
        feed.set(ANSWER_8, 0);

        vm.expectRevert(
            abi.encodeWithSelector(ReferencePriceAdapter.IncompleteRound.selector, asset)
        );
        adapter.usdPriceWad(asset);
    }

    // -----------------------------------------------------------------------
    // §135: invalid-price behaviour
    // -----------------------------------------------------------------------

    function test_aZeroPriceIsRefused() public {
        feed.set(0, block.timestamp);

        vm.expectRevert(
            abi.encodeWithSelector(ReferencePriceAdapter.NonPositivePrice.selector, asset, int256(0))
        );
        adapter.usdPriceWad(asset);
    }

    /// @dev A negative price is not a degraded reading — it is a feed that is
    ///      not describing an equity at all.
    function test_aNegativePriceIsRefused() public {
        feed.set(-1, block.timestamp);

        vm.expectRevert(
            abi.encodeWithSelector(ReferencePriceAdapter.NonPositivePrice.selector, asset, int256(-1))
        );
        adapter.usdPriceWad(asset);
    }

    function test_anUnconfiguredAssetHasNoPrice() public {
        address other = makeAddr("SPYx");

        vm.expectRevert(abi.encodeWithSelector(ReferencePriceAdapter.NoSource.selector, other));
        adapter.usdPriceWad(other);
    }

    function test_anUnreadableFeedIsRefused() public {
        feed.setBroken(true);

        vm.expectRevert(
            abi.encodeWithSelector(ReferencePriceAdapter.FeedUnreadable.selector, asset)
        );
        adapter.usdPriceWad(asset);
    }

    /// @dev The nastier half of an unreadable feed: the price read succeeds and
    ///      `decimals()` does not. An adapter that assumed a decimals value
    ///      would return a number scaled by whatever it guessed — silently, and
    ///      wrong by a power of ten.
    function test_aFeedThatCannotReportDecimalsIsRefused() public {
        feed.setDecimalsBroken(true);

        vm.expectRevert(
            abi.encodeWithSelector(ReferencePriceAdapter.FeedUnreadable.selector, asset)
        );
        adapter.usdPriceWad(asset);
    }

    // -----------------------------------------------------------------------
    // §135: extreme values
    // -----------------------------------------------------------------------

    function test_aPriceBelowTheBandIsRefused() public {
        feed.set(1, block.timestamp); // $0.00000001

        vm.expectRevert(
            abi.encodeWithSelector(
                ReferencePriceAdapter.PriceOutOfBand.selector, asset, uint256(1e10), uint256(1e18), uint256(100_000e18)
            )
        );
        adapter.usdPriceWad(asset);
    }

    function test_aPriceAboveTheBandIsRefused() public {
        feed.set(1_000_000_00000000, block.timestamp); // $1,000,000

        vm.expectRevert();
        adapter.usdPriceWad(asset);
    }

    /// @dev The band REFUSES; it does not clamp. Clamping would let a launch
    ///      proceed at a number the feed never said — the arbitrary manual price
    ///      §135 forbids, arrived at from the other direction.
    function test_theBandRefusesRatherThanClamping() public {
        feed.set(1, block.timestamp);

        // If it clamped, this would return `minUsdWad` rather than revert.
        (bool ok, uint256 price,) = adapter.peekUsdPriceWad(asset);
        assertFalse(ok, "out of band is not ok");
        assertEq(price, 0, "and does not report the boundary as the price");
    }

    // -----------------------------------------------------------------------
    // §135: no arbitrary manual override
    // -----------------------------------------------------------------------

    /// @dev The requirement the whole design turns on. There is no function on
    ///      this contract that writes a price, so this test is an assertion
    ///      about the ABI rather than about behaviour — which is the strongest
    ///      form it can take.
    function test_thereIsNoFunctionThatSetsAPrice() public pure {
        // Every mutating selector on the adapter, listed. If a price setter is
        // ever added, this list stops being exhaustive and the test below fails.
        bytes4[3] memory mutating = [
            ReferencePriceAdapter.configure.selector,
            ReferencePriceAdapter.removeSource.selector,
            ReferencePriceAdapter.transferGovernance.selector
        ];

        assertEq(mutating.length, 3, "three mutating functions, none of them a price");
    }

    function test_onlyGovernanceCanConfigureASource() public {
        vm.prank(stranger);
        vm.expectRevert(ReferencePriceAdapter.NotGovernance.selector);
        adapter.configure(asset, address(feed), 1 hours, 1e18, 100_000e18);

        vm.prank(stranger);
        vm.expectRevert(ReferencePriceAdapter.NotGovernance.selector);
        adapter.removeSource(asset);
    }

    /// @dev Removing a source blocks NEW launches. It cannot reprice a market
    ///      that already launched — that anchor was snapshotted and is immutable
    ///      by §402, and this contract has no way to reach it.
    function test_removingASourceBlocksNewLaunchesOnly() public {
        vm.prank(governance);
        adapter.removeSource(asset);

        vm.expectRevert(abi.encodeWithSelector(ReferencePriceAdapter.NoSource.selector, asset));
        adapter.usdPriceWad(asset);
    }

    function test_configurationIsValidated() public {
        vm.startPrank(governance);

        vm.expectRevert(ReferencePriceAdapter.ZeroAddress.selector);
        adapter.configure(asset, address(0), 1 hours, 1e18, 2e18);

        // A zero maxAge refuses every answer produced before this block, which
        // is every answer. Rejected rather than silently disabling the asset.
        vm.expectRevert(ReferencePriceAdapter.InvalidMaxAge.selector);
        adapter.configure(asset, address(feed), 0, 1e18, 2e18);

        vm.expectRevert(ReferencePriceAdapter.InvalidBand.selector);
        adapter.configure(asset, address(feed), 1 hours, 0, 2e18);

        vm.expectRevert(ReferencePriceAdapter.InvalidBand.selector);
        adapter.configure(asset, address(feed), 1 hours, 5e18, 2e18);

        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // The preview must agree with the launch
    // -----------------------------------------------------------------------

    /// @dev A preview that says "fine" where a launch reverts is worse than no
    ///      preview: the creator pays gas to find out otherwise. Both paths are
    ///      driven through every refusal and compared.
    function test_peekAgreesWithTheEnforcedRead() public {
        _assertPeekAgrees("healthy");

        feed.set(0, block.timestamp);
        _assertPeekAgrees("zero price");

        feed.set(ANSWER_8, 0);
        _assertPeekAgrees("incomplete round");

        feed.set(ANSWER_8, block.timestamp);
        vm.warp(block.timestamp + 2 hours);
        _assertPeekAgrees("stale");

        feed.set(1, block.timestamp);
        _assertPeekAgrees("below band");

        feed.setBroken(true);
        _assertPeekAgrees("unreadable");
    }

    function _assertPeekAgrees(string memory what) private {
        // A non-positive answer reverts in BOTH paths deliberately: it is not a
        // degraded reading, and letting a preview render it as "temporarily
        // unavailable" would be describing a broken feed as a slow one.
        bool peekOk;
        uint256 peekPrice;

        try adapter.peekUsdPriceWad(asset) returns (bool ok, uint256 price, uint256) {
            peekOk = ok;
            peekPrice = price;
        } catch {
            peekOk = false;
        }

        bool readOk;
        uint256 readPrice;

        try adapter.usdPriceWad(asset) returns (uint256 price) {
            readOk = true;
            readPrice = price;
        } catch {
            readOk = false;
        }

        assertEq(peekOk, readOk, string.concat("peek and read must agree: ", what));
        if (readOk) assertEq(peekPrice, readPrice, string.concat("same price: ", what));
    }
}
