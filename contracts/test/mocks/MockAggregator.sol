// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @notice A Chainlink-shaped feed, controllable from a test.
/// @dev Deliberately able to misbehave in every way the adapter must refuse:
///      stale, non-positive, incomplete, unreadable, and wrong-decimals. An
///      adapter tested only against a well-behaved feed is an adapter whose
///      refusals have never run.
contract MockAggregator {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public feedDecimals;

    /// @dev When true, both reads revert — a feed that is deployed but broken,
    ///      which is different from one that is merely stale.
    bool public broken;

    /// @dev When true, `decimals()` alone reverts. A real hazard: the price read
    ///      succeeds and the normalisation cannot happen, so an adapter that
    ///      assumed a decimals value would silently mis-scale rather than fail.
    bool public decimalsBroken;

    constructor(int256 answer_, uint8 decimals_) {
        answer = answer_;
        feedDecimals = decimals_;
        updatedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function setBroken(bool value) external {
        broken = value;
    }

    function setDecimalsBroken(bool value) external {
        decimalsBroken = value;
    }

    function decimals() external view returns (uint8) {
        if (broken || decimalsBroken) revert("feed down");
        return feedDecimals;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        if (broken) revert("feed down");
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
