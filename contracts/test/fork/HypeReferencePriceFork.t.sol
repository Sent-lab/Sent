// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {ReferencePriceAdapter} from "../../src/ReferencePriceAdapter.sol";

/// @notice Rechecks the chosen low-cost WHYPE launch anchor against live
///         HyperEVM contracts. This is read-only fork evidence; it does not
///         change mainnet state or imply that SENT's factory is configured.
contract HypeReferencePriceForkTest is Test {
    address internal constant WHYPE = 0x5555555555555555555555555555555555555555;
    address internal constant HYPE_USD = 0x2b25BC41D55de29F3A2e163F8Eebf63966B25b57;
    uint32 internal constant MAX_AGE = 86_400;
    uint128 internal constant MIN_USD_WAD = 1e17;
    uint128 internal constant MAX_USD_WAD = 10_000e18;

    ReferencePriceAdapter internal adapter;
    bool internal forked;

    function setUp() public {
        forked = WHYPE.code.length > 0 && HYPE_USD.code.length > 0;
        if (!forked) return;

        adapter = new ReferencePriceAdapter(address(this));
        adapter.configure(WHYPE, HYPE_USD, MAX_AGE, MIN_USD_WAD, MAX_USD_WAD);
    }

    function test_whypeAndItsHypeUsdFeedAreLiveAndReadable() public view {
        if (!forked) return;

        assertEq(IERC20Metadata(WHYPE).symbol(), "WHYPE");
        assertEq(IERC20Metadata(WHYPE).decimals(), 18);

        (bool ok, uint256 priceWad, uint256 updatedAt) = adapter.peekUsdPriceWad(WHYPE);
        assertTrue(ok, "configured HYPE/USD answer must satisfy the launch guards");
        assertGt(priceWad, MIN_USD_WAD, "the feed must return a positive, useful price");
        assertLe(priceWad, MAX_USD_WAD, "the feed must remain inside the explicit MVP band");
        assertLe(block.timestamp - updatedAt, MAX_AGE, "the feed must be no older than its heartbeat");
        assertEq(adapter.usdPriceWad(WHYPE), priceWad, "preview and launch read must agree");
    }

    function test_whypeLaunchAnchorFailsClosedAfterItsHeartbeat() public {
        if (!forked) return;

        (, , uint256 updatedAt) = adapter.peekUsdPriceWad(WHYPE);
        vm.warp(updatedAt + MAX_AGE + 1);

        (bool ok, uint256 priceWad, uint256 stillReportedAt) = adapter.peekUsdPriceWad(WHYPE);
        assertFalse(ok, "a price older than one heartbeat must disable new launches");
        assertEq(priceWad, 0, "a stale quote must never leak through as a usable anchor");
        assertEq(stillReportedAt, updatedAt, "the stale timestamp remains observable");
    }
}
