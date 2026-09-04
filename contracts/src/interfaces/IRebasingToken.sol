// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/**
 * @notice The rebase surface of a Backed xStock.
 *
 * Declared narrowly rather than importing a full token type: this interface is
 * used to CALL the underlying, and a wider one would let a mistake here reach
 * functions a wrapper has no business calling on the asset it custodies.
 *
 * Measured against `SP500 xStock` at 0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48
 * on HyperEVM, whose implementation is Backed Finance's "Backed Token
 * Implementation". Every xStock on that chain runs byte-identical code.
 */
interface IRebasingToken {
    /**
     * @notice The rebase-invariant unit. `balanceOf = sharesOf × multiplier / 1e18`.
     *
     * @dev This is the quantity a corporate action does NOT change. A dividend
     *      or a split moves the multiplier; shares stay where they are. That is
     *      the whole reason a wrapper can exist.
     */
    function sharesOf(address account) external view returns (uint256);

    /**
     * @notice The rebase factor, 1e18-scaled.
     *
     * @dev Rises on dividends, and would fall on a reverse split. Observed
     *      values on HyperEVM ranged from 1.0 to 1.0808929977 — every one of
     *      them above parity, because dividends are what has happened so far.
     */
    function multiplier() external view returns (uint256);
}
