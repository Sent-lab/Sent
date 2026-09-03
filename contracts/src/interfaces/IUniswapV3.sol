// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title The HyperSwap V3 surface this protocol touches
/// @notice Declared here, minimally, rather than imported (§443).
///
/// HyperSwap V3 is a Uniswap V3 fork, so these signatures are known even though
/// the deployed addresses are not (V-06). That is the whole reason a router can
/// be written and tested today: the interface is a published standard, and only
/// the addresses are an owner decision.
///
/// WHY NOT THE REAL PACKAGE
/// ------------------------
/// The upstream periphery package pins an old Solidity and drags in a library graph
/// this repository has no other use for. What is needed is four functions. A
/// narrow interface also bounds what a typo can produce: with the full
/// `INonfungiblePositionManager` in scope, `decreaseLiquidity` is one
/// autocomplete away from a permanent liquidity lock that is not one.
///
/// Every struct below mirrors the upstream field order exactly. ABI encoding is
/// positional, so a reordered field produces calldata that decodes into a
/// different call without failing.
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}

interface IUniswapV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    /// @notice Creates the pool if it does not exist and initialises its price.
    /// @dev Returns the pool either way. Idempotent: a pool that already exists
    ///      keeps the price it has, which is why the router checks afterwards
    ///      rather than assuming the price it asked for is the price it got.
    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
