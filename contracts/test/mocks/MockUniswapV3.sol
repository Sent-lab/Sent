// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {INonfungiblePositionManager} from "../../src/interfaces/IUniswapV3.sol";

/// @notice A V3 pool that remembers its price and nothing else.
contract MockV3Pool {
    uint160 public sqrtPriceX96;

    constructor(uint160 sqrtPriceX96_) {
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }

    /// @dev Lets a test model the case that matters: somebody created the pool
    ///      first, at their own price, and the router must refuse to mint into
    ///      it (§15).
    function setPrice(uint160 sqrtPriceX96_) external {
        sqrtPriceX96 = sqrtPriceX96_;
    }
}

contract MockV3Factory {
    mapping(bytes32 => address) public pools;
    mapping(uint24 => int24) public feeAmountTickSpacing;

    constructor() {
        // V-07's verified tiers. 10000/200 is the one the router uses.
        feeAmountTickSpacing[500] = 10;
        feeAmountTickSpacing[3000] = 60;
        feeAmountTickSpacing[10000] = 200;
    }

    function key(address a, address b, uint24 fee) public pure returns (bytes32) {
        return keccak256(abi.encode(a, b, fee));
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return pools[key(a, b, fee)];
    }

    function record(address a, address b, uint24 fee, address pool) external {
        pools[key(a, b, fee)] = pool;
    }
}

/// @notice A position manager that mints on real V3 liquidity arithmetic.
///
/// @dev The point of this mock is the ARITHMETIC, not the bookkeeping. §416
///      forbids "pretending V2 reserve-ratio math is exact V3 mint math", so a
///      mock that consumed both amounts in full would prove nothing: the dust
///      the router has to handle would never appear, and the test would pass
///      against a router that ignored §417 entirely.
///
///      So it computes liquidity the way V3 does — the lesser of what each side
///      supports — and then takes back exactly what that liquidity requires,
///      leaving the remainder. That remainder IS the dust.
contract MockPositionManager {
    struct Position {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        address owner;
    }

    MockV3Factory public immutable FACTORY;

    mapping(uint256 => Position) public positionsById;
    mapping(uint256 => uint128) public owed0;
    mapping(uint256 => uint128) public owed1;

    uint256 public nextId = 1;

    constructor(address factory) {
        FACTORY = MockV3Factory(factory);
    }

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool) {
        pool = FACTORY.getPool(token0, token1, fee);
        if (pool != address(0)) return pool;

        pool = address(new MockV3Pool(sqrtPriceX96));
        FACTORY.record(token0, token1, fee, pool);
    }

    /// @dev Full-range liquidity, from V3's own formulas:
    ///
    ///        L0 = amount0 × sqrtP / 2^96      (token0 side, upper bound at ∞)
    ///        L1 = amount1 × 2^96 / sqrtP      (token1 side, lower bound at 0)
    ///
    ///      L = min(L0, L1), and the amounts actually taken are recomputed from
    ///      L — which is where the leftover on the larger side comes from.
    function mint(INonfungiblePositionManager.MintParams calldata p)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        address pool = FACTORY.getPool(p.token0, p.token1, p.fee);
        uint160 sqrtP = MockV3Pool(pool).sqrtPriceX96();

        uint256 l0 = Math.mulDiv(p.amount0Desired, sqrtP, 1 << 96);
        uint256 l1 = Math.mulDiv(p.amount1Desired, 1 << 96, sqrtP);
        uint256 l = l0 < l1 ? l0 : l1;

        amount0 = Math.mulDiv(l, 1 << 96, sqrtP);
        amount1 = Math.mulDiv(l, sqrtP, 1 << 96);

        // Never take more than was offered. Integer rounding can push the
        // recomputed amount one wei above the desired one on the binding side.
        if (amount0 > p.amount0Desired) amount0 = p.amount0Desired;
        if (amount1 > p.amount1Desired) amount1 = p.amount1Desired;

        IERC20(p.token0).transferFrom(msg.sender, pool, amount0);
        IERC20(p.token1).transferFrom(msg.sender, pool, amount1);

        tokenId = nextId++;
        liquidity = uint128(l);

        positionsById[tokenId] = Position({
            token0: p.token0,
            token1: p.token1,
            fee: p.fee,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper,
            liquidity: liquidity,
            owner: p.recipient
        });
    }

    /// @dev Fees a test can put there, so collection can be exercised without a
    ///      swap engine.
    function creditFees(uint256 tokenId, uint128 amount0, uint128 amount1) external {
        owed0[tokenId] += amount0;
        owed1[tokenId] += amount1;
    }

    function collect(INonfungiblePositionManager.CollectParams calldata p)
        external
        payable
        returns (uint256 amount0, uint256 amount1)
    {
        Position memory position = positionsById[p.tokenId];
        require(position.owner == msg.sender, "not owner");

        amount0 = owed0[p.tokenId] < p.amount0Max ? owed0[p.tokenId] : p.amount0Max;
        amount1 = owed1[p.tokenId] < p.amount1Max ? owed1[p.tokenId] : p.amount1Max;

        owed0[p.tokenId] -= uint128(amount0);
        owed1[p.tokenId] -= uint128(amount1);

        if (amount0 > 0) IERC20(position.token0).transfer(p.recipient, amount0);
        if (amount1 > 0) IERC20(position.token1).transfer(p.recipient, amount1);
    }

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96,
            address,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256,
            uint256,
            uint128,
            uint128
        )
    {
        Position memory p = positionsById[tokenId];
        return (
            0,
            address(0),
            p.token0,
            p.token1,
            p.fee,
            p.tickLower,
            p.tickUpper,
            p.liquidity,
            0,
            0,
            owed0[tokenId],
            owed1[tokenId]
        );
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return positionsById[tokenId].owner;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data)
        external
    {
        require(positionsById[tokenId].owner == from, "not owner");
        positionsById[tokenId].owner = to;

        if (to.code.length > 0) {
            bytes4 selector = IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data);
            require(selector == IERC721Receiver.onERC721Received.selector, "bad receiver");
        }
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @notice A swap router that fills at the pool's spot price, without slippage.
///
/// @dev Enough to prove the crossing-order leg routes and pays the right
///      recipient. It is deliberately NOT a price-impact model — a mock that
///      approximated one would invite tests to assert numbers that mean nothing.
contract MockSwapRouter {
    MockV3Factory public immutable FACTORY;

    constructor(address factory) {
        FACTORY = MockV3Factory(factory);
    }

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

    function exactInputSingle(ExactInputSingleParams calldata p)
        external
        payable
        returns (uint256 amountOut)
    {
        (address token0, address token1) =
            p.tokenIn < p.tokenOut ? (p.tokenIn, p.tokenOut) : (p.tokenOut, p.tokenIn);

        address pool = FACTORY.getPool(token0, token1, p.fee);
        uint160 sqrtP = MockV3Pool(pool).sqrtPriceX96();

        // price = (sqrtP / 2^96)^2, as token1 per token0.
        uint256 priceX192 = uint256(sqrtP) * uint256(sqrtP);

        amountOut = p.tokenIn == token0
            ? Math.mulDiv(p.amountIn, priceX192, 1 << 192)
            : Math.mulDiv(p.amountIn, 1 << 192, priceX192);

        IERC20(p.tokenIn).transferFrom(msg.sender, pool, p.amountIn);
        IERC20(p.tokenOut).transfer(p.recipient, amountOut);
    }
}
