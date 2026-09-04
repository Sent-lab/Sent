// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {PythAggregatorShim} from "../src/PythAggregatorShim.sol";
import {IPyth, PythStructs} from "../src/interfaces/IPyth.sol";
import {ReferencePriceAdapter} from "../src/ReferencePriceAdapter.sol";

/// @dev Pyth's shape, including the part that matters most: `getPriceNoOlderThan`
///      REVERTS on a stale price rather than returning it.
contract MockPyth is IPyth {
    PythStructs.Price private _price;
    uint256 private _validPeriod = 60;

    error StalePrice();

    function set(int64 price, uint64 conf, int32 expo, uint256 publishTime) external {
        _price = PythStructs.Price(price, conf, expo, publishTime);
    }

    function getPriceNoOlderThan(bytes32, uint256 age)
        external
        view
        override
        returns (PythStructs.Price memory)
    {
        if (block.timestamp - _price.publishTime > age) revert StalePrice();
        return _price;
    }

    function getValidTimePeriod() external view override returns (uint256) {
        return _validPeriod;
    }
}

contract PythAggregatorShimTest is Test {
    MockPyth pyth;
    PythAggregatorShim shim;

    /// The real TSLA/USD 24/7 feed id from Pyth's registry.
    bytes32 constant TSLA = 0xe6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0;

    function setUp() public {
        vm.warp(1_800_000_000);
        pyth = new MockPyth();
        shim = new PythAggregatorShim(address(pyth), TSLA, 60);
    }

    // -----------------------------------------------------------------------
    // The conversion, in both directions
    // -----------------------------------------------------------------------

    /// @dev Equity feeds on HyperEVM report expo -5. TSLA read 390.6066.
    function test_anEquityExponentIsScaledUp() public {
        pyth.set(39_060_660, 1000, -5, block.timestamp);

        (, int256 answer,,,) = shim.latestRoundData();

        // 390.6066 × 10^8. Written out rather than computed in the assertion,
        // because the first version of this line did the arithmetic wrong and
        // the test failed against correct code.
        assertEq(answer, 39_060_660_000, "390.6066 at 8 decimals");
        assertEq(shim.decimals(), 8);
    }

    /// @dev Crypto feeds report expo -8, which needs no shift at all.
    function test_aCryptoExponentPassesThrough() public {
        pyth.set(8_452_810_000, 5000, -8, block.timestamp);

        (, int256 answer,,,) = shim.latestRoundData();
        assertEq(answer, 8_452_810_000, "84.5281 at 8 decimals, unchanged");
    }

    /// @dev And an exponent finer than 8 decimals is scaled DOWN. A shim that
    ///      only handled the common direction would be correct until the first
    ///      feed that did not use it.
    function test_aFinerExponentIsScaledDown() public {
        pyth.set(390_606_600_000, 1000, -9, block.timestamp);

        (, int256 answer,,,) = shim.latestRoundData();
        assertEq(answer, 39_060_660_000, "same price, coarser scale");
    }

    // -----------------------------------------------------------------------
    // Refusals
    // -----------------------------------------------------------------------

    /// @dev THE ONE THIS CONTRACT EXISTS FOR.
    ///
    ///      Pyth's equity feeds on HyperEVM are present but abandoned — TSLA read
    ///      63 days stale when this was written. `getPriceUnsafe` would return
    ///      that number without complaint, and a launch would anchor to a price
    ///      from two months ago for the market's entire life.
    function test_anAbandonedFeedRevertsRatherThanAnswering() public {
        pyth.set(39_060_660, 1000, -5, block.timestamp - 63 days);

        vm.expectRevert(MockPyth.StalePrice.selector);
        shim.latestRoundData();
    }

    function test_aPriceExactlyAtTheBoundIsStillAccepted() public {
        pyth.set(39_060_660, 1000, -5, block.timestamp - 60);

        (, int256 answer,,,) = shim.latestRoundData();
        assertGt(answer, 0, "60s is not older than 60s");
    }

    function test_aNegativeOrZeroPriceIsRefused() public {
        pyth.set(-1, 1000, -5, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(PythAggregatorShim.PriceOutOfRange.selector, int64(-1), int32(-5)));
        shim.latestRoundData();

        pyth.set(0, 1000, -5, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(PythAggregatorShim.PriceOutOfRange.selector, int64(0), int32(-5)));
        shim.latestRoundData();
    }

    /// @dev A price so small it rounds to nothing is not a price. The adapter
    ///      would refuse a zero anyway; refusing here says which feed produced it.
    function test_aPriceThatRoundsToZeroIsRefused() public {
        pyth.set(1, 1, -30, block.timestamp);

        vm.expectRevert();
        shim.latestRoundData();
    }

    function test_anAbsurdExponentIsRefused() public {
        pyth.set(1, 1, 120, block.timestamp);
        vm.expectRevert();
        shim.latestRoundData();
    }

    // -----------------------------------------------------------------------
    // No keys
    // -----------------------------------------------------------------------

    /// @dev The shim is what the adapter trusts by address. If it could be
    ///      repointed, that would be an admin path to changing what a market's
    ///      anchor means — on a number that is fixed for the market's life.
    function test_thereIsNoWayToRepointIt() public {
        string[8] memory forbidden = [
            "owner()",
            "setPriceId(bytes32)",
            "setPyth(address)",
            "setMaxAge(uint256)",
            "transferOwnership(address)",
            "initialize(address)",
            "upgradeTo(address)",
            "pause()"
        ];

        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = address(shim).call(abi.encodeWithSignature(forbidden[i]));
            assertFalse(ok, forbidden[i]);
        }

        assertEq(shim.PRICE_ID(), TSLA, "and the feed it speaks for never moved");
        assertEq(shim.MAX_AGE(), 60);
    }

    function test_theConstructorRefusesNonsense() public {
        vm.expectRevert(PythAggregatorShim.ZeroAddress.selector);
        new PythAggregatorShim(address(0), TSLA, 60);

        vm.expectRevert(PythAggregatorShim.ZeroAddress.selector);
        new PythAggregatorShim(address(pyth), bytes32(0), 60);

        // A zero max age would make every read revert, which looks like a broken
        // feed rather than a misconfigured shim.
        vm.expectRevert(PythAggregatorShim.ZeroAddress.selector);
        new PythAggregatorShim(address(pyth), TSLA, 0);
    }

    // -----------------------------------------------------------------------
    // Through the real adapter, which is the point of the shape
    // -----------------------------------------------------------------------

    /// @dev The reason this is a shim rather than a second adapter: every §135
    ///      refusal `ReferencePriceAdapter` already implements applies to a Pyth
    ///      feed unchanged, with nothing rewritten and nothing to get wrong twice.
    function test_theExistingAdapterConsumesItUnchanged() public {
        address governance = makeAddr("governanceSafe");
        address asset = makeAddr("wTSLAx");

        ReferencePriceAdapter adapter = new ReferencePriceAdapter(governance);

        pyth.set(39_060_660, 1000, -5, block.timestamp);

        vm.prank(governance);
        adapter.configure(asset, address(shim), 3600, 1e18, 10_000e18);

        uint256 wad = adapter.usdPriceWad(asset);
        assertEq(wad, 390_606_600_000_000_000_000, "390.6066 as a wad");
    }

    /// @dev And the adapter's band still bites, on a Pyth-sourced price.
    function test_theAdaptersBandStillRefusesAnOutlier() public {
        address governance = makeAddr("governanceSafe");
        address asset = makeAddr("wTSLAx");

        ReferencePriceAdapter adapter = new ReferencePriceAdapter(governance);

        vm.prank(governance);
        adapter.configure(asset, address(shim), 3600, 100e18, 1000e18);

        // Ten times the top of the band.
        pyth.set(1_000_000_000, 1000, -5, block.timestamp);

        vm.expectRevert();
        adapter.usdPriceWad(asset);
    }
}
