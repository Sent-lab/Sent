// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SENT FeeVault
/// @notice Holds and pays out the 1% core trading fee, split 65% creator / 35%
///         platform (§11, §131, §314.1).
///
/// LOCKED
///   - the split is 65/35 and is never reduced by Stockback (§314.2);
///   - creator fee revenue is a CREATOR LIABILITY, not platform property;
///   - the platform's share settles to the Treasury Safe (§563, §607), and never
///     to the Founder Profit Safe directly (§570, §608).
///
/// FORBIDDEN, STRUCTURALLY
///   There is no admin withdrawal path, no sweep, no "rescue" that can reach
///   creator balances, and no pause that strands them (§559, §685). Governance can
///   change where the PLATFORM share settles; it can never touch a creator's
///   accrued balance. The only function that moves a creator's money is the one
///   the creator calls.
///
/// ACCOUNTING
///   Balances are tracked per (market, asset) so a creator's entitlement is always
///   attributable to a specific market and denominated in that market's official
///   paired xStock. Payouts are pull-based: a failing or malicious quote asset can
///   never block accrual for everyone, only that claimant's own withdrawal.
contract FeeVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Governance Safe (§557). May retarget the platform payout address.
    ///         Has no path to creator funds.
    address public governance;

    /// @notice Treasury Safe (§563). Destination for the platform's 35% share.
    address public treasury;

    /// @notice Markets authorised to accrue fees. Set by the factory at launch.
    mapping(address market => bool) public isMarket;

    /// @notice The factory, the only contract permitted to register a market.
    address public immutable FACTORY;

    /// @dev creator => quote asset => claimable balance.
    mapping(address creator => mapping(address asset => uint256)) public creatorBalance;

    /// @dev quote asset => claimable platform balance.
    mapping(address asset => uint256) public platformBalance;

    /// @dev Total accrued ever, per asset. Used by the solvency invariant.
    mapping(address asset => uint256) public totalAccrued;
    mapping(address asset => uint256) public totalClaimed;

    event FeesAccrued(
        address indexed market,
        address indexed creator,
        address indexed asset,
        uint256 creatorAmount,
        uint256 platformAmount
    );
    event CreatorClaimed(address indexed creator, address indexed asset, uint256 amount, address to);
    event PlatformClaimed(address indexed asset, uint256 amount, address indexed treasury);
    event MarketRegistered(address indexed market);
    event TreasuryUpdated(address indexed from, address indexed to);
    event GovernanceTransferred(address indexed from, address indexed to);

    error NotGovernance();
    error NotFactory();
    error NotMarket();
    error ZeroAddress();
    error NothingToClaim();
    error AlreadyRegistered();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    constructor(address governance_, address treasury_, address factory_) {
        if (governance_ == address(0) || treasury_ == address(0) || factory_ == address(0)) {
            revert ZeroAddress();
        }
        governance = governance_;
        treasury = treasury_;
        FACTORY = factory_;
    }

    // -----------------------------------------------------------------------
    // Accrual
    // -----------------------------------------------------------------------

    /// @notice Register a market as an authorised fee source.
    /// @dev Only the factory may call this, so a market that the factory did not
    ///      deploy can never credit itself fees (§28 fee-claim invariants).
    function registerMarket(address market) external {
        if (msg.sender != FACTORY) revert NotFactory();
        if (isMarket[market]) revert AlreadyRegistered();
        isMarket[market] = true;
        emit MarketRegistered(market);
    }

    /// @notice Book a trade's core fee.
    /// @dev The market must have ALREADY transferred `creatorAmount + platformAmount`
    ///      of `asset` to this vault. This function is pure accounting — it does not
    ///      pull funds, so it cannot be used to drain an approval.
    ///
    ///      The split arrives pre-computed from `Fees.sol`, the single canonical
    ///      source (§1064). The vault does not recompute it: two implementations of
    ///      the same split is exactly how they drift.
    function accrue(address creator, address asset, uint256 creatorAmount, uint256 platformAmount) external {
        if (!isMarket[msg.sender]) revert NotMarket();
        if (creator == address(0) || asset == address(0)) revert ZeroAddress();

        creatorBalance[creator][asset] += creatorAmount;
        platformBalance[asset] += platformAmount;
        totalAccrued[asset] += creatorAmount + platformAmount;

        emit FeesAccrued(msg.sender, creator, asset, creatorAmount, platformAmount);
    }

    // -----------------------------------------------------------------------
    // Claims — pull only
    // -----------------------------------------------------------------------

    /// @notice Claim your own accrued creator fees.
    /// @param to Where to send them. Defaults to the caller when zero.
    /// @dev `msg.sender` is the creator. There is deliberately no `claimFor` and no
    ///      operator role: nobody, including governance, can move a creator's fees.
    function claimCreatorFees(address asset, address to) external nonReentrant returns (uint256 amount) {
        amount = creatorBalance[msg.sender][asset];
        if (amount == 0) revert NothingToClaim();

        address recipient = to == address(0) ? msg.sender : to;

        // Effects before interaction.
        creatorBalance[msg.sender][asset] = 0;
        totalClaimed[asset] += amount;

        IERC20(asset).safeTransfer(recipient, amount);

        emit CreatorClaimed(msg.sender, asset, amount, recipient);
    }

    /// @notice Sweep the platform's accrued share to the Treasury Safe.
    /// @dev Permissionless on purpose: the destination is fixed to `treasury`, so
    ///      letting anyone pay the gas to settle protocol revenue costs nothing and
    ///      removes an operational dependency on a hot key (§584).
    ///
    ///      This is the ONLY exit for platform funds, and it always lands at the
    ///      Treasury Safe. Founder profit is a later, explicit distribution FROM the
    ///      treasury (§571, §608) — never a shortcut from here.
    function settlePlatformFees(address asset) external nonReentrant returns (uint256 amount) {
        amount = platformBalance[asset];
        if (amount == 0) revert NothingToClaim();

        platformBalance[asset] = 0;
        totalClaimed[asset] += amount;

        IERC20(asset).safeTransfer(treasury, amount);

        emit PlatformClaimed(asset, amount, treasury);
    }

    // -----------------------------------------------------------------------
    // Governance — narrow by construction
    // -----------------------------------------------------------------------

    /// @notice Retarget where the platform share settles.
    /// @dev The only governance power over money here, and it can only redirect the
    ///      PLATFORM share. Creator balances are unreachable from this contract's
    ///      governance surface entirely.
    function setTreasury(address newTreasury) external onlyGovernance {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function transferGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        emit GovernanceTransferred(governance, newGovernance);
        governance = newGovernance;
    }

    // -----------------------------------------------------------------------
    // Solvency
    // -----------------------------------------------------------------------

    /// @notice Outstanding obligation for an asset: everything accrued but unclaimed.
    /// @dev The vault's balance must always cover this. Asserted as an invariant.
    function outstanding(address asset) external view returns (uint256) {
        return totalAccrued[asset] - totalClaimed[asset];
    }
}
