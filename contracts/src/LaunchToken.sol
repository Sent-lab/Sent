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
/// entire curve-solvency and Stockback-accounting model assumes balances move 1:1
/// and that `totalSupply` is immutable. Adding any hook here silently breaks
/// invariants three layers away.
///
/// SUPPLY (§2, §5)
///   1,000,000,000 TOKEN, 18 decimals, minted exactly once in the constructor to
///   the factory, which immediately forwards the whole supply to the market.
///   Creator allocation 0%. Platform allocation 0%. No premine exists, so a
///   creator who wants TOKEN must buy it on the open market like anyone else
///   (§325) — which is also why they are neither privileged nor excluded from
///   Stockback.
///
/// WHY THE CONSTRUCTOR DOES NOT TAKE THE MARKET (D-009)
///   The market needs the token address and the token needs the market address.
///   Under CREATE2 that is a genuine circular dependency, because each address
///   depends on the other's constructor arguments through the init-code hash.
///
///   It is broken here rather than in the market, because the market's `TOKEN` is
///   security-critical — every transfer, the whole reserve and the graduation
///   migration depend on it, so it must stay immutable. This contract's `market`
///   field is informational only: nothing in this file reads it, and no balance,
///   supply or transfer decision depends on it. Making the harmless field
///   write-once is strictly safer than making the critical one mutable.
///
/// IDENTITY (§4, §138)
///   The contract address is the canonical token identity. Name and ticker are
///   free and may duplicate. The CREATE2 vanity suffix is BRANDING ONLY —
///   authenticity comes from the factory registry and the TokenLaunched event,
///   never from the address pattern.
contract LaunchToken is ERC20 {
    /// @dev Fixed supply. LOCKED at 1B, 18 decimals.
    uint256 public constant GENESIS_SUPPLY = 1_000_000_000e18;

    /// @notice The factory that deployed this token. Authenticity is checked
    ///         against the factory's registry, not against this field alone.
    address public immutable FACTORY;

    /// @notice The creator wallet that requested the launch. Canonical creator
    ///         identity (§579) — the platform deployer never is (§578).
    address public immutable CREATOR;

    /// @notice The market holding the undistributed reserve. Informational only:
    ///         nothing in this contract reads it. Write-once, factory only.
    address public market;

    event MarketSet(address indexed market);

    error ZeroAddress();
    error NotFactory();
    error MarketAlreadySet();

    /// @param name_ Free-form, may duplicate another token's name.
    /// @param symbol_ Free-form, may duplicate another token's ticker.
    /// @param creator_ Canonical creator identity. Receives ZERO tokens.
    constructor(string memory name_, string memory symbol_, address creator_) ERC20(name_, symbol_) {
        if (creator_ == address(0)) revert ZeroAddress();

        CREATOR = creator_;
        FACTORY = msg.sender;

        // The one and only mint. No other path to _mint exists in this contract
        // and ERC20 exposes none, so totalSupply is fixed for all time.
        //
        // The supply goes to the factory, which forwards all of it to the market
        // in the same transaction. It never touches the creator — that is what
        // makes "creator allocation 0%" structural rather than a promise.
        _mint(msg.sender, GENESIS_SUPPLY);
    }

    /// @notice Record the market address. Factory only, once, informational.
    function setMarket(address market_) external {
        if (msg.sender != FACTORY) revert NotFactory();
        if (market != address(0)) revert MarketAlreadySet();
        if (market_ == address(0)) revert ZeroAddress();
        market = market_;
        emit MarketSet(market_);
    }
}
