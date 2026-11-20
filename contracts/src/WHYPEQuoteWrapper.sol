// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SENT WHYPE quote wrapper
/// @notice A permissionless, exact 1:1 receipt for canonical HyperEVM WHYPE.
/// @dev The deployed registry's rebasing-interface probe is incompatible with
///      WHYPE's system-token implementation. This ordinary ERC-20 receipt lets
///      the immutable registry inspect a standard token while preserving a
///      verifiable 1:1 claim on WHYPE. It has no owner, fee, pause or upgrade.
contract WHYPEQuoteWrapper is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant UNDERLYING = 0x5555555555555555555555555555555555555555;

    error ZeroAmount();
    error UnexpectedTransferAmount(uint256 expected, uint256 received);

    constructor() ERC20("SENT Wrapped HYPE", "sWHYPE") {}

    /// @notice Deposit WHYPE and mint the same number of sWHYPE.
    function wrap(uint256 amount) external nonReentrant returns (uint256 minted) {
        if (amount == 0) revert ZeroAmount();

        IERC20 underlying = IERC20(UNDERLYING);
        uint256 beforeBalance = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = underlying.balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert UnexpectedTransferAmount(amount, received);

        _mint(msg.sender, received);
        return received;
    }

    /// @notice Burn sWHYPE and return the same number of WHYPE.
    function unwrap(uint256 amount) external nonReentrant returns (uint256 returned) {
        if (amount == 0) revert ZeroAmount();

        _burn(msg.sender, amount);
        IERC20(UNDERLYING).safeTransfer(msg.sender, amount);
        return amount;
    }

    /// @notice Exact 1:1 preview used by SENT's wrap panel.
    function previewWrap(uint256 amount) external pure returns (uint256) {
        return amount;
    }

    /// @notice Exact 1:1 redemption quote used by SENT's wrap panel.
    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }
}
