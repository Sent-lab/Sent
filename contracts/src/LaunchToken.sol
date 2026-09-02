// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title SENT LaunchToken
/// @notice The token every SENT market issues. Deliberately, aggressively boring.
///
/// LOCKED (§5, §421) — this contract must have NONE of the following, ever:
///
///   - a mint path after genesis          - a transfer tax
///   - a blacklist                        - a max-wallet rule
///   - an owner                           - a pause
///   - an upgrade proxy                   - a creator trading toggle
///   - a rebase                           - a fee-on-transfer hook
///
/// §129 (Definition of Done — LaunchToken) and §391 (No Silent Transfer-Tax
/// Upgrade) both turn on this being a vanilla ERC-20 with a fixed supply. The
/// entire curve-solvency and Stockback-accounting model assumes balances move
/// 1:1 and that `totalSupply` is immutable. Adding any hook here silently breaks
/// invariants three layers away.
///
/// SUPPLY (§2, §5)
///   1,000,000,000 TOKEN, 18 decimals, minted exactly once in the constructor to
///   the market. Creator allocation 0%. Platform allocation 0%. No premine of any
///   kind exists, so the creator must buy on the open market like anyone else
///   (§325) — which is also why the creator is neither privileged nor excluded
///   from Stockback.
///
/// IDENTITY (§4, §138)
///   The contract address is the canonical token identity. Name and ticker are
///   free and may duplicate. The CREATE2 vanity suffix is BRANDING ONLY —
///   authenticity comes from the factory registry and the TokenLaunched event,
///   never from the address pattern.
contract LaunchToken is ERC20 {
    /// @dev Fixed supply. LOCKED at 1B, 18 decimals.
    uint256 public constant GENESIS_SUPPLY = 1_000_000_000e18;

    /// @notice The market this token was minted to. Immutable, informational.
    address public immutable MARKET;

    /// @notice The factory that deployed this token. Authenticity is checked
    ///         against the factory's registry, not against this field alone.
    address public immutable FACTORY;

    /// @notice The creator wallet that requested the launch. This is the canonical
    ///         creator identity (§579) — the platform deployer never is (§578).
    address public immutable CREATOR;

    error ZeroAddress();

    /// @param name_ Free-form, may duplicate another token's name.
    /// @param symbol_ Free-form, may duplicate another token's ticker.
    /// @param market_ Receives the entire genesis supply for curve distribution.
    /// @param creator_ Canonical creator identity. Receives ZERO tokens.
    constructor(string memory name_, string memory symbol_, address market_, address creator_)
        ERC20(name_, symbol_)
    {
        if (market_ == address(0) || creator_ == address(0)) revert ZeroAddress();

        MARKET = market_;
        CREATOR = creator_;
        FACTORY = msg.sender;

        // The one and only mint. There is no other path to _mint in this contract,
        // and ERC20 exposes none — so totalSupply is fixed for all time.
        //
        // The full supply goes to the market, NOT to the creator: the market holds
        // the undistributed reserve and releases it along the curve. This is what
        // makes "creator allocation 0%" structural rather than a promise.
        _mint(market_, GENESIS_SUPPLY);
    }
}
