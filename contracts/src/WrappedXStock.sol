// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IRebasingToken} from "./interfaces/IRebasingToken.sol";

/**
 * @title WrappedXStock
 * @notice A non-rebasing claim on a rebasing xStock, so a graduated pool can hold it.
 *
 * WHY THIS EXISTS — AND IT IS NOT ABOUT THIS PROTOCOL'S ACCOUNTING
 * ---------------------------------------------------------------
 * xStocks rebase. Backed's own documentation says corporate actions — dividends,
 * stock splits, reverse splits — are applied through an onchain multiplier so
 * that a token always tracks one share. Measured on HyperEVM, six of the ten
 * largest have already moved off 1.0.
 *
 * `LaunchMarket` could be taught to live with that: book collateral in SHARES
 * rather than balances and the rebase becomes neutral in both directions. That
 * fix is real, and it is not enough, because it only fixes the half of the
 * lifecycle this protocol controls.
 *
 * At graduation the quote asset is minted into a Uniswap V3 position that is
 * locked forever (§17). **Uniswap V3 cannot hold a rebasing token.** It computes
 * payouts from internal liquidity accounting rather than from balances, and it
 * has no `skim()` — V2 has one, V3 does not. So:
 *
 *   multiplier rises   the pool's balance grows and its accounting does not.
 *                      The surplus is unreachable by anyone, and the position is
 *                      permanent, so it is unreachable FOREVER. Every dividend
 *                      the underlying equity pays is silently buried.
 *
 *   multiplier falls   the pool holds less than its liquidity promises. Swaps
 *                      that would pay out more than the remaining balance
 *                      revert. The permanent position is broken, permanently.
 *
 * The first is not an edge case. It is every dividend, every quarter.
 *
 * So the quote asset has to be non-rebasing END TO END, and that is the whole
 * job of this contract.
 *
 * WHAT IT IS
 * ----------
 * A share receipt. It holds the xStock's SHARES — the rebase-invariant unit the
 * token already exposes — and mints exactly one wrapper token per share held.
 *
 *     xStock:   balanceOf = sharesOf × multiplier / 1e18   (moves on its own)
 *     wrapper:  balanceOf = shares                          (moves only on transfer)
 *
 * A dividend raises the multiplier, so each wrapper token redeems for more
 * xStock than it did yesterday. Holders receive the dividend as a rising
 * redemption rate rather than as a balance that changes underneath them — and a
 * V3 pool sees an ordinary token whose price drifts, which is the thing V3 is
 * built to handle.
 *
 * IT HAS NO KEYS, AND THAT IS THE POINT
 * -------------------------------------
 * This contract will hold every market's collateral. If it can be drained,
 * paused, upgraded or reconfigured, then everything downstream inherits that.
 *
 * So, like `PermanentLiquidityLock`: no owner, no governance, no guardian, no
 * pause, no upgrade path, no initialiser, no `execute`, no `delegatecall`, no
 * fee, no rescue function, and no way to change the underlying. Not gated —
 * ABSENT. A gate is a key somebody holds.
 *
 * THE SOLVENCY INVARIANT
 * ----------------------
 *     totalSupply() <= UNDERLYING.sharesOf(address(this))
 *
 * Every wrapper token in existence is backed by at least one share actually
 * held. It is maintained EXACTLY rather than approximately: both directions
 * measure the shares that really moved instead of trusting an arithmetic
 * prediction, because the underlying converts between balances and shares with
 * its own rounding and this contract does not get to assume which way it goes.
 *
 * WHAT THIS CONTRACT CANNOT PROTECT AGAINST
 * -----------------------------------------
 * The underlying is pausable and sits behind an upgradeable proxy with an EOA
 * minter (V-05). If it pauses, unwrapping stops; if it is upgraded into
 * something else, this contract wraps something else. Nothing here can fix that,
 * and pretending otherwise by adding an admin "for emergencies" would replace a
 * risk nobody controls with a key somebody does.
 */
contract WrappedXStock is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The rebasing xStock this wraps. Immutable — a wrapper that could
    ///         change its underlying is a wrapper that can be emptied.
    IRebasingToken public immutable UNDERLYING;

    error ZeroAmount();
    error NotRebasing(address token);
    error MultiplierIsZero();
    error SharesLeftExceedBurned(uint256 moved, uint256 burned);

    event Wrapped(address indexed account, uint256 assetsIn, uint256 sharesMinted);
    event Unwrapped(address indexed account, uint256 sharesBurned, uint256 assetsOut);

    /**
     * @param underlying The rebasing xStock.
     * @param name_      e.g. "Wrapped Tesla xStock"
     * @param symbol_    e.g. "wTSLAx"
     *
     * @dev The underlying is CHECKED to be rebasing, which reads backwards and
     *      is not. This contract's arithmetic is defined in terms of `sharesOf`
     *      and `multiplier`. Wrapping a token that has neither would produce a
     *      contract whose `totalSupply` tracks nothing — every deposit would
     *      mint zero, or revert, depending on how the fallback behaved.
     *
     *      A plain ERC-20 does not need wrapping and must not be wrapped here.
     */
    constructor(address underlying, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
    {
        if (underlying == address(0)) revert NotRebasing(underlying);

        (bool okShares,) = underlying.staticcall(
            abi.encodeWithSelector(IRebasingToken.sharesOf.selector, address(this))
        );
        (bool okMul, bytes memory mulData) = underlying.staticcall(
            abi.encodeWithSelector(IRebasingToken.multiplier.selector)
        );

        if (!okShares || !okMul || mulData.length < 32) revert NotRebasing(underlying);
        if (abi.decode(mulData, (uint256)) == 0) revert MultiplierIsZero();

        UNDERLYING = IRebasingToken(underlying);
    }

    /**
     * @notice Same decimals as the underlying.
     *
     * @dev Shares and balances share a scale on Backed's implementation —
     *      `balanceOf` is `sharesOf` scaled by a 1e18 multiplier — so a wrapper
     *      token and an xStock token are the same size at parity. Deriving this
     *      rather than hardcoding 18 keeps that true if it is ever wrapped
     *      around something with a different scale.
     */
    function decimals() public view override returns (uint8) {
        return IERC20Metadata(address(UNDERLYING)).decimals();
    }

    // -----------------------------------------------------------------------
    // Wrapping
    // -----------------------------------------------------------------------

    /**
     * @notice Deposit xStock, receive wrapper tokens one-for-one with SHARES.
     *
     * @param assets Amount of the underlying, in its own balance units.
     * @return minted Wrapper tokens minted — the shares that actually arrived.
     *
     * @dev The mint is DERIVED FROM MEASUREMENT, not from `assets`.
     *
     *      `assets` is a balance figure. What this contract is entitled to mint
     *      against is the SHARES that balance turned into, and the conversion
     *      happens inside the underlying with its own rounding. Minting
     *      `assets × 1e18 / multiplier` would be this contract's prediction of
     *      that rounding, and a prediction that rounds the wrong way by one wei
     *      per deposit mints tokens no share backs.
     *
     *      Measuring the delta cannot be wrong about it, and it also makes a
     *      fee-on-transfer underlying safe for free: whatever arrives is what is
     *      credited.
     */
    function wrap(uint256 assets) external nonReentrant returns (uint256 minted) {
        if (assets == 0) revert ZeroAmount();

        uint256 before = UNDERLYING.sharesOf(address(this));
        IERC20(address(UNDERLYING)).safeTransferFrom(msg.sender, address(this), assets);
        minted = UNDERLYING.sharesOf(address(this)) - before;

        // A deposit that moves no shares mints nothing, and taking the assets
        // for it would be theft by rounding.
        if (minted == 0) revert ZeroAmount();

        _mint(msg.sender, minted);

        emit Wrapped(msg.sender, assets, minted);
    }

    /**
     * @notice Burn wrapper tokens, receive the underlying.
     *
     * @param shares Wrapper tokens to burn.
     * @return assets Underlying sent, in its balance units.
     *
     * @dev BURN FIRST, THEN SEND, THEN VERIFY — in that order, deliberately.
     *
     *      Burning first is the balance check: a caller who does not hold the
     *      tokens fails here, before anything leaves. It is also the state
     *      change, so the external call happens with the accounting already
     *      settled.
     *
     *      The verification afterwards is the one that matters. This contract
     *      asks the underlying to move `assets`, and the underlying decides how
     *      many shares that is. If it moved MORE shares than were burned, the
     *      invariant is broken and the transaction must not stand — so it
     *      reverts rather than continuing with a wrapper that is short.
     *
     *      Moving FEWER shares than burned is allowed and leaves a sliver
     *      behind. That is holder-neutral dust, not a loss to anyone in
     *      particular, and it strengthens the invariant rather than weakening it.
     */
    function unwrap(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();

        assets = convertToAssets(shares);
        if (assets == 0) revert ZeroAmount();

        _burn(msg.sender, shares);

        uint256 before = UNDERLYING.sharesOf(address(this));
        IERC20(address(UNDERLYING)).safeTransfer(msg.sender, assets);
        uint256 moved = before - UNDERLYING.sharesOf(address(this));

        if (moved > shares) revert SharesLeftExceedBurned(moved, shares);

        emit Unwrapped(msg.sender, shares, assets);
    }

    // -----------------------------------------------------------------------
    // Conversion — the same functions a quote and a fill both use (§315)
    // -----------------------------------------------------------------------

    /// @notice Underlying balance one wrapper token currently redeems for.
    /// @dev This is the number a price feed multiplies by to reach USD, and the
    ///      number that rises when the underlying pays a dividend.
    function assetsPerShare() public view returns (uint256) {
        return UNDERLYING.multiplier();
    }

    /// @notice Underlying redeemable for `shares` wrapper tokens. Rounds DOWN.
    /// @dev Down, always. Rounding up here would ask the underlying for more
    ///      than the burned shares back, which is the one case `unwrap` reverts.
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 m = assetsPerShare();
        if (m == 0) revert MultiplierIsZero();
        return (shares * m) / 1e18;
    }

    /// @notice Wrapper tokens `assets` of underlying is worth. Rounds DOWN.
    /// @dev An ESTIMATE, and labelled as one. `wrap` credits what actually
    ///      arrives, so a caller comparing this against the mint may see a wei
    ///      of difference. Presenting it as exact is how a UI ends up asserting
    ///      an amount the chain then contradicts.
    function previewWrap(uint256 assets) external view returns (uint256) {
        uint256 m = assetsPerShare();
        if (m == 0) revert MultiplierIsZero();
        return (assets * 1e18) / m;
    }

    /// @notice Shares this contract actually holds. The invariant's right side.
    function backingShares() external view returns (uint256) {
        return UNDERLYING.sharesOf(address(this));
    }
}

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}
