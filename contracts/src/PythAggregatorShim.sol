// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IPyth, PythStructs} from "./interfaces/IPyth.sol";

/**
 * @title PythAggregatorShim
 * @notice One Pyth price feed, speaking Chainlink's `latestRoundData`.
 *
 * WHY A SHIM AND NOT A SECOND ADAPTER
 * -----------------------------------
 * `ReferencePriceAdapter` is the launch anchor, and it already refuses a stale
 * answer, a zero, a negative, one outside its configured band, one from a feed
 * that will not answer at all, and one whose decimals it cannot read. Those
 * refusals are §135's, they are tested, and they are the reason a launch is
 * blocked rather than mispriced.
 *
 * Writing a Pyth-native adapter would mean writing all of that again against a
 * different interface, and the second copy is the one that gets a check wrong.
 * So this translates instead: Pyth in, `latestRoundData` out, and every existing
 * refusal applies unchanged.
 *
 * WHY PYTH AT ALL (V-11)
 * ----------------------
 * Measured on HyperEVM rather than assumed:
 *
 *   - Pyth is deployed at 0xe9d69CdD6Fe41e7B621B4A688C5D1a68cB5c8ADc, v1.4.6,
 *     with a 60-second valid time period.
 *   - Its crypto feeds are actively maintained there (HYPE was 183 seconds old,
 *     BTC 2101 seconds, when this was written).
 *   - Its EQUITY feeds are present but abandoned: TSLA read 63 days stale, NVDA
 *     71 days, SPY 561 days. The 24/7 equity variants have never been pushed at
 *     all and revert.
 *
 * Nothing else on this chain prices an xStock. There is no HyperSwap pool for
 * any of them (V-22) and no HyperCore spot market, because they are EVM-native
 * and were never HIP-1 linked (V-02). Pyth is the only source that exists.
 *
 * THE STALENESS IS THE WHOLE POINT, NOT A PROBLEM TO ROUTE AROUND
 * ---------------------------------------------------------------
 * Pyth is pull-based by design. A price is on-chain only because somebody paid
 * to put it there, and "63 days stale" means nobody has, not that the feed is
 * broken. The intended pattern is that the transaction needing a price carries
 * the signed update with it: `updatePriceFeeds` then read, in one call.
 *
 * This contract does NOT do that, deliberately. It is a view, and a view that
 * could push an update would be a view that costs money and changes state. The
 * update belongs in the launch transaction, ahead of the read.
 *
 * What this contract does instead is REFUSE a stale price rather than return
 * one. `maxAge` is immutable, and `getPriceNoOlderThan` reverts rather than
 * answering — so a launch against an abandoned feed fails loudly at the
 * adapter, which is §135's own preference and the reason the anchor is read
 * from a feed rather than supplied by the caller.
 */
contract PythAggregatorShim {
    /// @notice The Pyth contract on this chain.
    IPyth public immutable PYTH;

    /// @notice The feed this shim speaks for. One shim, one feed, immutable.
    /// @dev A shim that could be repointed is an admin path to changing what a
    ///      market's anchor means, on a contract the adapter trusts by address.
    bytes32 public immutable PRICE_ID;

    /**
     * @notice How old a price may be before this refuses to report it.
     *
     * @dev Immutable, and it is the security parameter.
     *
     *      `ReferencePriceAdapter` has its own staleness bound and would catch a
     *      stale answer anyway. This one exists because the two are checking
     *      different things: the adapter bounds how old an ANSWER may be, and
     *      this bounds what Pyth is willing to call a price at all. Pyth's own
     *      valid period on HyperEVM is 60 seconds, and a shim that quietly
     *      reported something older would be laundering a stale reading into a
     *      well-formed round.
     */
    uint256 public immutable MAX_AGE;

    /// @notice Chainlink-style decimals. Fixed at 8, and converted to.
    /// @dev Pyth reports a per-feed exponent that can differ between feeds and
    ///      can in principle change. Reporting it raw would make this shim's
    ///      decimals a moving target for a consumer that reads them once.
    uint8 public constant DECIMALS = 8;

    error ZeroAddress();
    error PriceOutOfRange(int64 price, int32 expo);

    constructor(address pyth, bytes32 priceId, uint256 maxAge) {
        if (pyth == address(0)) revert ZeroAddress();
        if (priceId == bytes32(0)) revert ZeroAddress();
        if (maxAge == 0) revert ZeroAddress();

        PYTH = IPyth(pyth);
        PRICE_ID = priceId;
        MAX_AGE = maxAge;
    }

    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    /**
     * @notice The latest price, as a Chainlink round.
     *
     * @dev Reverts when the price is older than `MAX_AGE`, because
     *      `getPriceNoOlderThan` does. That propagates to the adapter as an
     *      unreadable feed, which it already treats as a refusal to launch.
     *
     *      `roundId` and `answeredInRound` are the publish time. Pyth has no
     *      round concept, and inventing a counter would let a consumer believe
     *      it could compare rounds for ordering. The publish time is the only
     *      monotonic thing here and is what those fields honestly are.
     */
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        PythStructs.Price memory p = PYTH.getPriceNoOlderThan(PRICE_ID, MAX_AGE);

        answer = _toFixed8(p.price, p.expo);
        updatedAt = p.publishTime;
        startedAt = p.publishTime;
        roundId = uint80(p.publishTime);
        answeredInRound = roundId;
    }

    /// @notice The confidence interval, in the same 8-decimal scale.
    /// @dev Not part of the Chainlink shape, so the adapter cannot see it. It is
    ///      exposed because a wide confidence band is exactly the condition an
    ///      operator would want to look at before enabling an asset, and it
    ///      would otherwise be invisible from on-chain.
    function latestConfidence() external view returns (uint256) {
        PythStructs.Price memory p = PYTH.getPriceNoOlderThan(PRICE_ID, MAX_AGE);
        return uint256(_toFixed8(int64(p.conf), p.expo));
    }

    /**
     * @dev Pyth's exponent to a fixed 8 decimals.
     *
     *      Pyth reports `price × 10^expo`, with `expo` almost always negative.
     *      Equity feeds read -5 on this chain and crypto feeds -8, so both
     *      directions are live and both are handled — a shim that only handled
     *      the common one would be correct until the first equity feed.
     *
     *      Reverts rather than truncating when the conversion cannot be
     *      represented. A silently rounded anchor fixes a market's price for
     *      its entire life, which is the one place a wrong number must not be
     *      quietly accepted.
     */
    function _toFixed8(int64 price, int32 expo) private pure returns (int256) {
        if (price <= 0) revert PriceOutOfRange(price, expo);

        int256 value = int256(price);

        if (expo <= -128 || expo >= 128) revert PriceOutOfRange(price, expo);

        int32 shift = expo + 8;

        if (shift == 0) return value;

        if (shift > 0) {
            if (shift > 60) revert PriceOutOfRange(price, expo);
            return value * int256(10 ** uint32(shift));
        }

        uint32 down = uint32(-shift);
        if (down > 60) revert PriceOutOfRange(price, expo);

        int256 divisor = int256(10 ** down);
        int256 scaled = value / divisor;

        // A price that rounds to zero is not a price. Returning it would hand
        // the adapter a zero, which it refuses anyway — but refusing here says
        // which feed did it.
        if (scaled == 0) revert PriceOutOfRange(price, expo);

        return scaled;
    }
}
