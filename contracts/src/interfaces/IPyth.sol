// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

library PythStructs {
    /// @dev `value = price × 10^expo`. `expo` is negative in practice — equity
    ///      feeds on HyperEVM report -5, crypto feeds -8.
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }
}

/**
 * @notice The read surface of Pyth, declared narrowly.
 *
 * `updatePriceFeeds` is deliberately ABSENT. It is payable and changes state,
 * and nothing that reads an anchor should be able to reach it — the update
 * belongs in the transaction that needs the price, ahead of the read, paid for
 * by whoever is launching.
 *
 * Measured against the deployment at 0xe9d69CdD6Fe41e7B621B4A688C5D1a68cB5c8ADc
 * on HyperEVM: Pyth v1.4.6, `getValidTimePeriod()` = 60.
 */
interface IPyth {
    /**
     * @notice The price, or a revert if it is older than `age` seconds.
     *
     * @dev Reverting is the behaviour this codebase wants and the reason this
     *      function is used instead of `getPriceUnsafe`. On HyperEVM the equity
     *      feeds are present but abandoned — TSLA read 63 days stale — and
     *      `getPriceUnsafe` would return that number without complaint.
     */
    function getPriceNoOlderThan(bytes32 id, uint256 age)
        external
        view
        returns (PythStructs.Price memory price);

    /// @notice How old Pyth itself considers acceptable. 60 seconds on HyperEVM.
    function getValidTimePeriod() external view returns (uint256);
}
