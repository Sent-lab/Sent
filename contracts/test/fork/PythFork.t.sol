// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {PythAggregatorShim} from "../../src/PythAggregatorShim.sol";
import {IPyth, PythStructs} from "../../src/interfaces/IPyth.sol";

/**
 * @notice V-11, against the Pyth that is actually deployed on HyperEVM.
 *
 * The launch anchor fixes a market's `p0` for its entire life (§402), so what
 * this suite is really checking is whether the only price source on this chain
 * can be trusted to say "I do not know" — because the alternative to a refusal
 * is a market permanently priced off a number from two months ago.
 *
 *   forge test --match-path 'test/fork/*' --fork-url https://rpc.hyperliquid.xyz/evm
 */
contract PythForkTest is Test {
    /// Measured, not assumed. Pyth v1.4.6 on HyperEVM.
    address constant PYTH = 0xe9d69CdD6Fe41e7B621B4A688C5D1a68cB5c8ADc;

    /// Feed ids from Pyth's own registry.
    bytes32 constant TSLA_US = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;
    bytes32 constant TSLA_247 = 0xe6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0;
    bytes32 constant HYPE_USD = 0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b;

    bool forked;

    function setUp() public {
        forked = PYTH.code.length > 0;
    }

    /// @dev The premise: Pyth is here, and it is a real deployment.
    function test_pythIsDeployedAndAnswers() public view {
        if (!forked) return;

        uint256 period = IPyth(PYTH).getValidTimePeriod();
        assertGt(period, 0, "a live valid-time period");
        assertLe(period, 600, "and a tight one");
    }

    /**
     * @dev A CRYPTO feed is maintained here, which proves the pipeline works.
     *
     *      Worth asserting separately from the equity case below, because the
     *      two together are what distinguish "Pyth is broken on this chain" from
     *      "nobody pays to publish equities on this chain". They are very
     *      different problems and only the second one is ours.
     */
    function test_aCryptoFeedIsLiveHere() public {
        if (!forked) return;

        PythAggregatorShim shim = new PythAggregatorShim(PYTH, HYPE_USD, 1 hours);

        (, int256 answer,, uint256 updatedAt,) = shim.latestRoundData();

        assertGt(answer, 0, "HYPE has a price");
        assertGt(updatedAt, block.timestamp - 1 hours, "and it is fresh");
    }

    /**
     * @dev THE FINDING, asserted so it cannot quietly stop being true.
     *
     *      Pyth's equity feeds exist on HyperEVM and are ABANDONED — TSLA read
     *      63 days stale, NVDA 71, SPY 561, when this was written. The 24/7
     *      variants have never been published at all.
     *
     *      A shim with a sane `maxAge` must therefore REFUSE, and that refusal
     *      is the whole reason `getPriceNoOlderThan` is used instead of
     *      `getPriceUnsafe`. The unsafe call would hand back a two-month-old
     *      number and a market would anchor to it forever.
     *
     *      If this test ever fails, somebody has started publishing equities
     *      here — which is good news, and V-11 should be re-read rather than
     *      the test relaxed.
     */
    function test_theEquityFeedsAreAbandonedAndTheShimRefuses() public {
        if (!forked) return;

        PythAggregatorShim shim = new PythAggregatorShim(PYTH, TSLA_US, 1 hours);

        vm.expectRevert();
        shim.latestRoundData();
    }

    /// @dev The 24/7 variant is not merely stale — it has never been published
    ///      to this chain, so even an absurd `maxAge` gets nothing.
    function test_theTwentyFourSevenFeedIsNotPublishedHere() public {
        if (!forked) return;

        PythAggregatorShim shim = new PythAggregatorShim(PYTH, TSLA_247, 3650 days);

        vm.expectRevert();
        shim.latestRoundData();
    }

    /**
     * @dev And the stale price IS there, which is what makes the refusal matter.
     *
     *      Read through Pyth directly rather than through the shim, to show the
     *      number the shim is declining to pass on. A reader who assumes "revert"
     *      means "no data" would conclude the feed is simply absent and go
     *      looking for a different one; it is present, and wrong.
     */
    function test_theRefusedPriceExistsAndIsOld() public view {
        if (!forked) return;

        // 100 years, so this cannot revert on age.
        PythStructs.Price memory p = IPyth(PYTH).getPriceNoOlderThan(TSLA_US, 36500 days);

        assertGt(p.price, 0, "there is a price behind the refusal");
        assertGt(
            block.timestamp - p.publishTime,
            7 days,
            "and it is old enough that anchoring to it would be indefensible"
        );
    }
}
