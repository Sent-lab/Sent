// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {GraduationRouter} from "../../src/GraduationRouter.sol";
import {PermanentLiquidityLock} from "../../src/PermanentLiquidityLock.sol";
import {V3Math} from "../../src/lib/V3Math.sol";
import {INonfungiblePositionManager, IUniswapV3Factory} from "../../src/interfaces/IUniswapV3.sol";

contract ForkToken is ERC20 {
    constructor() ERC20("Fork Launch", "FORK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract ForkMarket {
    address public TOKEN;
    address public liquidityLock;
    constructor(address token) { TOKEN = token; }
    function setLiquidityLock(address lock) external { liquidityLock = lock; }

    function graduate(GraduationRouter r, address q, uint256 t, uint256 c, uint256 p)
        external
        returns (address pool, uint256 id)
    {
        return r.graduate(TOKEN, q, t, c, p, 0);
    }
}

contract ForkLaunchpad {
    mapping(address => bool) public authentic;
    function set(address t) external { authentic[t] = true; }
    function isAuthentic(address t) external view returns (bool) { return authentic[t]; }
}

/// @notice V-06, V-08 and V-09, against the real HyperSwap V3 deployment.
///
/// Every other test in this repository runs against a mock position manager
/// that implements V3's liquidity formulas the way this codebase understands
/// them. That proves the router is consistent with our reading — not that our
/// reading is right.
///
/// This one runs against the contracts that are actually deployed on HyperEVM,
/// which is what V-08 and V-09 both name as their verification method:
///
///   V-08  "simulate mint amount0/amount1 requirements at PG for candidate
///          ranges on a HyperEVM fork"
///   V-09  "inspect NonfungiblePositionManager capabilities; fork-test
///          collect() while decreaseLiquidity() is unreachable"
///
/// ADDRESSES
/// ---------
/// Found by on-chain measurement, not from a docs page — HyperSwap's V3 docs
/// return 403 to automated fetch and its public deployment page lists V2 only.
/// The method is recorded in the ledger; the short version is that the position
/// manager was located by its own `IncreaseLiquidity` events, and all three
/// contracts point at the same factory.
///
///   forge test --match-path 'test/fork/*' --fork-url https://rpc.hyperliquid.xyz/evm
///
/// Skipped entirely when no fork is available, so `forge test` stays offline.
contract HyperSwapForkTest is Test {
    address constant V3_FACTORY = 0xB1c0fa0B789320044A6F623cFe5eBda9562602E3;
    address constant POSITION_MANAGER = 0x6eDA206207c09e5428F281761DdC0D300851fBC8;
    address constant SWAP_ROUTER = 0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D;

    /// Wrapped HYPE. Standing in for an xStock, which V-02 has not confirmed —
    /// the mechanism under test is the venue's, not the quote asset's.
    address constant WHYPE = 0x5555555555555555555555555555555555555555;

    GraduationRouter router;
    PermanentLiquidityLock lock;
    ForkLaunchpad launchpad;
    ForkMarket market;
    ForkToken token;

    uint256 constant PRICE_WAD = 500_000_000_000;

    /// Measured across 600 blocks at the tip, Day 8: 394 of 400 sampled blocks
    /// carried the first limit, 6 the second. See V-20.
    uint256 constant DEFAULT_LANE_GAS = 3_000_000;
    uint256 constant LARGE_LANE_GAS = 30_000_000;

    bool forked;

    function setUp() public {
        // No fork, no test. `forge test` must stay runnable offline.
        forked = POSITION_MANAGER.code.length > 0;
        if (!forked) return;

        token = new ForkToken();
        launchpad = new ForkLaunchpad();

        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        lock = new PermanentLiquidityLock(POSITION_MANAGER, predicted);
        router = new GraduationRouter(
            address(launchpad), V3_FACTORY, POSITION_MANAGER, SWAP_ROUTER, address(lock)
        );

        market = new ForkMarket(address(token));
        launchpad.set(address(token));
    }

    /// @dev V-06: the three addresses are one deployment, asserted rather than
    ///      assumed. A router pointed at a factory that does not know its own
    ///      position manager would mint into a pool nothing else can see.
    function test_theThreeAddressesAreOneDeployment() public view {
        if (!forked) return;

        assertEq(
            INonfungiblePositionManagerFactory(POSITION_MANAGER).factory(),
            V3_FACTORY,
            "the position manager serves this factory"
        );
        assertEq(
            INonfungiblePositionManagerFactory(SWAP_ROUTER).factory(),
            V3_FACTORY,
            "and so does the swap router"
        );
    }

    /// @dev V-07, re-measured. The router reads tick spacing from the factory
    ///      rather than hardcoding it; this confirms the value it will read.
    function test_theOnePercentTierIsEnabledWithSpacing200() public view {
        if (!forked) return;

        assertEq(
            IUniswapV3Factory(V3_FACTORY).feeAmountTickSpacing(10000),
            int24(200),
            "1% is enabled, spacing 200"
        );
        assertEq(router.TICK_SPACING(), int24(200), "and the router read it");
    }

    /// @dev V-08: the mint, against real tick math rather than our model of it.
    ///
    ///      This is the assertion §416 asks for — that the endpoint is consumed
    ///      "within documented dust tolerance" — made against the contract that
    ///      actually does the arithmetic.
    function test_aFullRangeMintConsumesBothSidesOnTheRealVenue() public {
        if (!forked) return;

        // The §8 endpoint, scaled down: WHYPE is 18 decimals, and the ratio is
        // what is under test rather than the absolute size.
        uint256 tokenAmount = 342_105_263e18;
        uint256 quoteAmount = (tokenAmount * PRICE_WAD) / 1e18;

        token.mint(address(router), tokenAmount);
        deal(WHYPE, address(router), quoteAmount);

        (address pool, uint256 positionId) =
            market.graduate(router, WHYPE, tokenAmount, quoteAmount, PRICE_WAD);

        assertTrue(pool != address(0), "a pool was created");
        assertTrue(positionId != 0, "and a position minted");

        // §417's dust, measured on the real venue.
        uint256 dustToken = IERC20(address(token)).balanceOf(address(lock));
        uint256 dustQuote = IERC20(WHYPE).balanceOf(address(lock));

        emit log_named_uint("token dust (wei)", dustToken);
        emit log_named_uint("quote dust (wei)", dustQuote);
        emit log_named_uint("token migrated", tokenAmount);
        emit log_named_uint("quote migrated", quoteAmount);

        // One part in ten thousand, the bound the mock tests use. Holding on the
        // real venue is what makes that bound a measurement.
        assertLt(dustToken, tokenAmount / 10_000, "TOKEN dust within tolerance");
        assertLt(dustQuote, quoteAmount / 10_000 + 1, "quote dust within tolerance");

        // §15: the pool opens where the curve closed.
        (uint160 actual,,,,,,) = IUniswapV3PoolSlot0(pool).slot0();
        uint160 expected =
            V3Math.initialSqrtPriceX96(PRICE_WAD, 18, address(token) < WHYPE);
        assertEq(actual, expected, "spot price continuity on the real venue");
    }

    /// @dev V-20, measured rather than recalled - the number D-016 turns on.
    ///
    ///      The design splits graduation across two transactions because the
    ///      migration does not fit in HyperEVM's default block lane. That claim
    ///      is only worth anything if the migration's cost is measured against
    ///      the real venue, since HyperSwap's `createPool` is the dominant term
    ///      and it is not ours to make cheaper.
    ///
    ///      The companion assertion lives in `LaunchMarket.t.sol`, where the
    ///      crossing buy is held under half the default lane. Together they are
    ///      the whole argument: the part every user pays fits in the lane every
    ///      user sends to, and the part that does not fit is paid once, by
    ///      whoever finalises.
    function test_theMigrationNeedsTheLargeBlockLane() public {
        if (!forked) return;

        uint256 tokenAmount = 342_105_263e18;
        uint256 quoteAmount = (tokenAmount * PRICE_WAD) / 1e18;

        token.mint(address(router), tokenAmount);
        deal(WHYPE, address(router), quoteAmount);

        uint256 before = gasleft();
        market.graduate(router, WHYPE, tokenAmount, quoteAmount, PRICE_WAD);
        uint256 used = before - gasleft();

        emit log_named_uint("migration gas, real venue", used);
        emit log_named_uint("default lane ceiling", DEFAULT_LANE_GAS);
        emit log_named_uint("large lane ceiling", LARGE_LANE_GAS);

        // The finding, asserted so it cannot quietly stop being true. If
        // HyperSwap ever ships a cheaper pool and this drops under the default
        // lane, D-016 should be revisited - and this failing is how anyone finds
        // out, rather than the split staying because nobody re-measured.
        assertGt(used, DEFAULT_LANE_GAS, "if this ever fails, re-open D-016");
        assertLt(used, LARGE_LANE_GAS, "and it must still fit the large lane");
    }

    /// @dev V-09, the whole question, against the real position manager.
    ///
    ///      The lock holds a genuine HyperSwap position. `collect` works. And
    ///      `decreaseLiquidity` is unreachable — not because the lock refuses
    ///      it, but because the lock has no function that would call it and
    ///      nobody else owns the NFT.
    function test_thePrincipalIsUnreachableWhileFeesAreNot() public {
        if (!forked) return;

        uint256 tokenAmount = 342_105_263e18;
        uint256 quoteAmount = (tokenAmount * PRICE_WAD) / 1e18;

        token.mint(address(router), tokenAmount);
        deal(WHYPE, address(router), quoteAmount);

        (, uint256 positionId) = market.graduate(router, WHYPE, tokenAmount, quoteAmount, PRICE_WAD);

        // The real NPM says the lock owns it.
        assertEq(
            IERC721Owner(POSITION_MANAGER).ownerOf(positionId),
            address(lock),
            "the real position manager agrees the lock owns it"
        );

        (,,,,,,, uint128 liquidity,,,,) =
            INonfungiblePositionManager(POSITION_MANAGER).positions(positionId);
        assertGt(liquidity, 0, "and the position holds real liquidity");

        // Collect works, and pays the market. Nothing is owed yet on a fresh
        // position, so this proves the call path rather than an amount.
        lock.collect(positionId);
        assertEq(
            IERC721Owner(POSITION_MANAGER).ownerOf(positionId),
            address(lock),
            "collecting does not move the position"
        );

        /*
         * And the principal cannot be withdrawn by anyone.
         *
         * Not "the lock refuses" — the lock has no function that calls
         * `decreaseLiquidity`, and the NPM only accepts it from the owner or an
         * approved operator. The lock is the owner and approves nobody, so the
         * call has no sender who could make it.
         */
        vm.prank(address(this));
        (bool ok,) = POSITION_MANAGER.call(
            abi.encodeWithSignature(
                "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))",
                positionId,
                liquidity,
                uint256(0),
                uint256(0),
                block.timestamp
            )
        );
        assertFalse(ok, "nobody can reduce the locked liquidity");

        (,,,,,,, uint128 after_,,,,) =
            INonfungiblePositionManager(POSITION_MANAGER).positions(positionId);
        assertEq(after_, liquidity, "the principal is exactly where it was");
    }
}

interface INonfungiblePositionManagerFactory {
    function factory() external view returns (address);
}

interface IERC721Owner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IUniswapV3PoolSlot0 {
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
}
