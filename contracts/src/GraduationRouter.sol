// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IGraduationRouter} from "./interfaces/IGraduationRouter.sol";
import {
    IUniswapV3Factory,
    IUniswapV3Pool,
    INonfungiblePositionManager,
    ISwapRouter
} from "./interfaces/IUniswapV3.sol";
import {V3Math} from "./lib/V3Math.sol";
import {PermanentLiquidityLock} from "./PermanentLiquidityLock.sol";

/// @title GraduationRouter
/// @notice The boundary between the curve and HyperSwap (§14, §15, §415, §416, §417).
///
/// The market's job ends at "here are the assets and the price they must open
/// at". Everything after that is here: mint geometry, price continuity, the
/// permanent lock, and the deterministic destination for what will not fit.
///
/// FULL RANGE, BECAUSE THE PRINCIPAL CAN NEVER BE MOVED (§415)
/// -----------------------------------------------------------
/// §415 locks V1 to the widest supported range, and the reasoning is the part
/// that matters: nobody can reposition this position, ever. A concentrated range
/// the price walks out of is liquidity stranded permanently, on a market whose
/// entire promise is that its liquidity cannot be pulled. Full range cannot be
/// stranded — it is active at every price the pool can reach.
///
/// It is also what makes §416's arithmetic land. At the §8 endpoint the
/// remaining supply is worth exactly the collateral that came with it — 342.105M
/// TOKEN at `pg` against ~$17,105 of quote — and a full-range mint at `pg`
/// consumes both sides in exactly that ratio. The endpoint was derived for this;
/// the geometry is not a coincidence and is not a fit.
///
/// WHAT §416 FORBIDS, AND WHERE THIS AVOIDS IT
/// -------------------------------------------
/// "Pretending V2 reserve-ratio math is exact V3 mint math." This does not
/// compute amounts from a ratio and hope. It hands both balances to the position
/// manager, which computes the exact liquidity itself, and then handles what
/// comes back unconsumed — because something always does.
///
/// DUST IS NOT A ROUNDING ERROR, IT IS SOMEBODY'S MONEY (§417)
/// -----------------------------------------------------------
/// V3 mints in whole units of liquidity, so a few wei of one side is always left
/// over. §417 fixes the destination and forbids the tempting one: leftovers must
/// never be credited to creator or platform as a windfall.
///
/// So it goes to the lock, which has no withdrawal path at all. Not to the
/// treasury, not to the market, not back to the caller.
contract GraduationRouter is IGraduationRouter {
    using SafeERC20 for IERC20;

    /// @notice The fee tier every graduation opens at.
    ///
    /// @dev 1% — the widest standard tier, and the right one for an asset whose
    ///      pool is one day old. A new launch is volatile and thinly traded;
    ///      0.05% or 0.3% would price liquidity as if the risk were a stablecoin
    ///      pair's, and the LP taking that risk cannot withdraw.
    ///
    ///      V-07 confirmed 10000 is enabled on HyperSwap with a tick spacing of
    ///      200, which is the one input here that is verified rather than
    ///      assumed.
    uint24 public constant FEE_TIER = 10000;

    /// @dev Ticks must be multiples of this. Read from the factory rather than
    ///      hardcoded, so a venue that disagrees fails loudly at graduation
    ///      instead of minting into a range V3 will not accept.
    int24 public immutable TICK_SPACING;

    IUniswapV3Factory public immutable V3_FACTORY;
    INonfungiblePositionManager public immutable POSITION_MANAGER;
    ISwapRouter public immutable SWAP_ROUTER;
    PermanentLiquidityLock public immutable LOCK;

    /// @notice The launchpad factory. Only its markets may graduate.
    address public immutable LAUNCHPAD;

    event Graduated(
        address indexed token,
        address indexed pool,
        uint256 indexed positionId,
        uint256 tokenUsed,
        uint256 quoteUsed,
        uint256 tokenDust,
        uint256 quoteDust
    );

    error ZeroAddress();
    error NotAMarket(address caller);
    error PoolPriceDiverged(uint160 wanted, uint160 got);
    error NothingToMigrate();
    error UnsupportedFeeTier(uint24 fee);
    error PoolNotCreated();

    /// @dev The caller must be a market this launchpad created. Anything else
    ///      could hand this contract arbitrary tokens and mint a position the
    ///      lock would then hold forever, attributed to an address of their
    ///      choosing.
    modifier onlyMarket() {
        if (!ILaunchpad(LAUNCHPAD).isAuthentic(ILaunchMarketToken(msg.sender).TOKEN())) {
            revert NotAMarket(msg.sender);
        }
        _;
    }

    constructor(
        address launchpad,
        address v3Factory,
        address positionManager,
        address swapRouter,
        address lock
    ) {
        if (
            launchpad == address(0) || v3Factory == address(0) || positionManager == address(0)
                || swapRouter == address(0) || lock == address(0)
        ) revert ZeroAddress();

        LAUNCHPAD = launchpad;
        V3_FACTORY = IUniswapV3Factory(v3Factory);
        POSITION_MANAGER = INonfungiblePositionManager(positionManager);
        SWAP_ROUTER = ISwapRouter(swapRouter);
        LOCK = PermanentLiquidityLock(lock);

        int24 spacing = IUniswapV3Factory(v3Factory).feeAmountTickSpacing(FEE_TIER);
        if (spacing == 0) revert UnsupportedFeeTier(FEE_TIER);
        TICK_SPACING = spacing;
    }

    /// @inheritdoc IGraduationRouter
    function graduate(
        address token,
        address quoteAsset,
        uint256 tokenAmount,
        uint256 quoteAmount,
        uint256 finalMarginalPriceWad,
        uint256 dustQuote
    ) external onlyMarket returns (address pool, uint256 positionId) {
        if (tokenAmount == 0 || quoteAmount == 0) revert NothingToMigrate();

        // Sorted by address, which is V3's rule and nobody's choice. Everything
        // downstream — the price, the amounts, the ticks — depends on it.
        bool tokenIsToken0 = token < quoteAsset;
        (address token0, address token1) =
            tokenIsToken0 ? (token, quoteAsset) : (quoteAsset, token);

        uint160 sqrtPriceX96 = V3Math.initialSqrtPriceX96(
            finalMarginalPriceWad, IERC20Decimals(quoteAsset).decimals(), tokenIsToken0
        );

        pool = POSITION_MANAGER.createAndInitializePoolIfNecessary(
            token0, token1, FEE_TIER, sqrtPriceX96
        );
        if (pool == address(0)) revert PoolNotCreated();

        /*
         * §15 is a HARD invariant, so it is checked rather than assumed.
         *
         * `createAndInitializePoolIfNecessary` is idempotent: a pool that
         * already exists keeps the price it has and the requested price is
         * ignored. Anyone can create a pool for any pair at any price before a
         * market graduates — it costs one transaction — and without this check
         * the entire migration would be minted into a pool somebody else priced.
         *
         * The whole graduation reverts, which under §16 means no GRADUATED
         * status and no partial migration. That is the correct failure: the
         * alternative is opening at a price the curve never reached.
         */
        (uint160 actualSqrtPrice,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (actualSqrtPrice != sqrtPriceX96) {
            revert PoolPriceDiverged(sqrtPriceX96, actualSqrtPrice);
        }

        // Dust arrived with the migration and is part of what is being locked.
        uint256 quoteTotal = quoteAmount + dustQuote;

        (uint256 amount0Desired, uint256 amount1Desired) =
            tokenIsToken0 ? (tokenAmount, quoteTotal) : (quoteTotal, tokenAmount);

        IERC20(token0).forceApprove(address(POSITION_MANAGER), amount0Desired);
        IERC20(token1).forceApprove(address(POSITION_MANAGER), amount1Desired);

        (int24 tickLower, int24 tickUpper) = V3Math.fullRange(TICK_SPACING);

        uint256 amount0;
        uint256 amount1;

        (positionId,, amount0, amount1) = POSITION_MANAGER.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: FEE_TIER,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                /*
                 * No minimums, deliberately, and this is safe only because of
                 * the slot0 check above.
                 *
                 * A minimum protects against the price moving between quote and
                 * execution. Here the price is asserted equal to the one this
                 * function chose, three lines earlier, in the same transaction —
                 * so there is no window to be sandwiched in. A non-zero minimum
                 * would instead make graduation revert on the ordinary rounding
                 * that §417 exists to handle.
                 */
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        // Approvals are cleared even though the manager consumed what it needed.
        // A standing allowance to an external contract is a permanent liability
        // for a router that will hold assets again on the next graduation.
        IERC20(token0).forceApprove(address(POSITION_MANAGER), 0);
        IERC20(token1).forceApprove(address(POSITION_MANAGER), 0);

        /*
         * To the lock, permanently (§17).
         *
         * `safeTransferFrom` with the market in `data` — the lock records it as
         * the fee destination and can never be told otherwise. The transfer is
         * what makes the principal unwithdrawable: this router keeps no path to
         * the NFT afterwards, and the lock has none at all.
         */
        POSITION_MANAGER.safeTransferFrom(
            address(this), address(LOCK), positionId, abi.encode(msg.sender)
        );

        // The market learns where its position went, once. It cannot know
        // earlier: the lock is told which market a position belongs to at mint
        // time, and the position does not exist until then.
        ILaunchMarketLock(msg.sender).setLiquidityLock(address(LOCK));

        /*
         * §417: what would not fit goes to the lock, never to creator or
         * platform.
         *
         * V3 mints in whole units of liquidity, so one side always has a
         * remainder. It is small — bounded and asserted in the router's tests —
         * but it is holder money, and "small" is not a destination.
         *
         * The lock has no withdrawal path, which makes this the non-withdrawable
         * account §417 asks for rather than a second contract that would need
         * one written.
         */
        uint256 dust0 = amount0Desired - amount0;
        uint256 dust1 = amount1Desired - amount1;

        if (dust0 > 0) IERC20(token0).safeTransfer(address(LOCK), dust0);
        if (dust1 > 0) IERC20(token1).safeTransfer(address(LOCK), dust1);

        emit Graduated(
            token,
            pool,
            positionId,
            tokenIsToken0 ? amount0 : amount1,
            tokenIsToken0 ? amount1 : amount0,
            tokenIsToken0 ? dust0 : dust1,
            tokenIsToken0 ? dust1 : dust0
        );
    }

    /// @inheritdoc IGraduationRouter
    function swapExactQuoteForToken(
        address token,
        address quoteAsset,
        uint256 quoteIn,
        address recipient
    ) external onlyMarket returns (uint256 tokensOut) {
        if (quoteIn == 0) return 0;

        IERC20(quoteAsset).forceApprove(address(SWAP_ROUTER), quoteIn);

        tokensOut = SWAP_ROUTER.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: quoteAsset,
                tokenOut: token,
                fee: FEE_TIER,
                recipient: recipient,
                deadline: block.timestamp,
                amountIn: quoteIn,
                /*
                 * The bound belongs to the CALLER, and §411/V-19 says so.
                 *
                 * This leg executes inside a crossing buy whose `minTokensOut`
                 * the user signed. Imposing a second minimum here would either
                 * duplicate a check the market already makes or contradict it —
                 * and a router-chosen bound is one the user never reviewed,
                 * which is the §694 failure in a place nobody would look for it.
                 */
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        IERC20(quoteAsset).forceApprove(address(SWAP_ROUTER), 0);
    }
}

/// @dev The two external reads this router needs, declared narrowly.
interface ILaunchpad {
    function isAuthentic(address token) external view returns (bool);
}

interface ILaunchMarketToken {
    function TOKEN() external view returns (address);
}

interface ILaunchMarketLock {
    function setLiquidityLock(address lock) external;
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}
