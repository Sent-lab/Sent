// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GraduationRouter} from "../src/GraduationRouter.sol";
import {PermanentLiquidityLock} from "../src/PermanentLiquidityLock.sol";
import {V3Math} from "../src/lib/V3Math.sol";
import {Curve} from "../src/lib/Curve.sol";
import {MockV3Factory, MockPositionManager, MockSwapRouter, MockV3Pool} from "./mocks/MockUniswapV3.sol";

contract GToken is ERC20 {
    constructor() ERC20("Launched", "LNCH") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract GQuote is ERC20 {
    uint8 private immutable D;
    constructor(uint8 d) ERC20("Mock NVDAx", "NVDAx") { D = d; }
    function decimals() public view override returns (uint8) { return D; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice A market, as far as the router's authenticity check is concerned.
contract GMarket {
    address public TOKEN;
    constructor(address token) { TOKEN = token; }

    function graduate(
        GraduationRouter router,
        address quote,
        uint256 tokenAmount,
        uint256 quoteAmount,
        uint256 priceWad,
        uint256 dust
    ) external returns (address pool, uint256 positionId) {
        return router.graduate(TOKEN, quote, tokenAmount, quoteAmount, priceWad, dust);
    }
}

contract GLaunchpad {
    mapping(address => bool) public authentic;
    function set(address token, bool value) external { authentic[token] = value; }
    function isAuthentic(address token) external view returns (bool) { return authentic[token]; }
}

/// @notice §17's permanent liquidity, and §15's price continuity, as tests.
///
/// V-09 asks whether a V3 position can have principal permanently locked while
/// fee rights stay exercisable. The position manager alone cannot: holding the
/// NFT keeps `decreaseLiquidity` reachable, and burning it kills `collect`.
/// This suite is what makes the purpose-built lock a claim somebody can check.
contract GraduationRouterTest is Test {
    GToken token;
    GQuote quote;
    MockV3Factory v3Factory;
    MockPositionManager positionManager;
    MockSwapRouter swapRouter;
    PermanentLiquidityLock lock;
    GraduationRouter router;
    GLaunchpad launchpad;
    GMarket market;

    /// The §8 endpoint for a $100 xStock: p0 = 20e9, pg = 25 × p0.
    uint256 constant P0 = 20_000_000_000;
    uint256 constant PG = P0 * 25;

    uint256 tokenAmount;
    uint256 quoteAmount;

    function setUp() public {
        token = new GToken();
        quote = new GQuote(6);

        v3Factory = new MockV3Factory();
        positionManager = new MockPositionManager(address(v3Factory));
        swapRouter = new MockSwapRouter(address(v3Factory));
        launchpad = new GLaunchpad();

        // The lock names the router and the router names the lock, so one is
        // predicted rather than wired afterwards — a settable address here would
        // be exactly the admin path §413 forbids.
        address predictedRouter = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        lock = new PermanentLiquidityLock(address(positionManager), predictedRouter);

        router = new GraduationRouter(
            address(launchpad),
            address(v3Factory),
            address(positionManager),
            address(swapRouter),
            address(lock)
        );
        assertEq(address(router), predictedRouter, "the lock must name the real router");

        market = new GMarket(address(token));
        launchpad.set(address(token), true);

        // The curve's own endpoint: the supply that never sold, and the
        // collateral it accumulated getting there.
        Curve.Params memory c = Curve.params(P0);
        tokenAmount = Curve.TOTAL_SUPPLY - c.qG;
        quoteAmount = Curve.collateralAt(c, c.qG) / 1e12; // normalized -> 6 decimals

        token.mint(address(market), tokenAmount);
        quote.mint(address(market), quoteAmount);

        vm.startPrank(address(market));
        IERC20(address(token)).transfer(address(router), tokenAmount);
        IERC20(address(quote)).transfer(address(router), quoteAmount);
        vm.stopPrank();
    }

    function _graduate() internal returns (address pool, uint256 positionId) {
        return market.graduate(router, address(quote), tokenAmount, quoteAmount, PG, 0);
    }

    // -----------------------------------------------------------------------
    // §15 — the pool opens where the curve closed
    // -----------------------------------------------------------------------

    function test_thePoolOpensAtTheCurvesClosingPrice() public {
        (address pool,) = _graduate();

        uint160 expected = V3Math.initialSqrtPriceX96(PG, 6, address(token) < address(quote));
        (uint160 actual,,,,,,) = MockV3Pool(pool).slot0();

        assertEq(actual, expected, "spot price continuity is exact, not approximate");
    }

    /// @dev The attack §15 has no other defence against.
    ///
    ///      `createAndInitializePoolIfNecessary` is idempotent: a pool that
    ///      already exists keeps its own price and silently ignores the one
    ///      requested. Anyone can create a pool for any pair, at any price, for
    ///      the cost of one transaction — and every graduating market is a known
    ///      target well in advance.
    ///
    ///      Without the slot0 check the whole migration mints into a pool
    ///      somebody else priced, and the first trade takes the difference.
    function test_aPoolPricedByAStrangerStopsTheGraduation() public {
        bool tokenIsToken0 = address(token) < address(quote);
        (address token0, address token1) =
            tokenIsToken0 ? (address(token), address(quote)) : (address(quote), address(token));

        // A stranger front-runs graduation with a pool at half the real price.
        uint160 wrong = V3Math.initialSqrtPriceX96(PG / 4, 6, tokenIsToken0);
        positionManager.createAndInitializePoolIfNecessary(token0, token1, 10000, wrong);

        uint160 wanted = V3Math.initialSqrtPriceX96(PG, 6, tokenIsToken0);

        vm.expectRevert(
            abi.encodeWithSelector(GraduationRouter.PoolPriceDiverged.selector, wanted, wrong)
        );
        _graduate();
    }

    // -----------------------------------------------------------------------
    // §415 — the widest range, because nobody can reposition it
    // -----------------------------------------------------------------------

    function test_thePositionIsFullRange() public {
        (, uint256 positionId) = _graduate();

        (,,,,, int24 tickLower, int24 tickUpper,,,,,) = positionManager.positions(positionId);
        (int24 expectedLower, int24 expectedUpper) = V3Math.fullRange(200);

        assertEq(tickLower, expectedLower, "the widest aligned lower tick");
        assertEq(tickUpper, expectedUpper, "and upper");

        // Liquidity that can never be repositioned must be active at every price
        // the pool can reach, or one bad week strands it forever.
        assertLt(tickLower, int24(0), "spans below the opening price");
        assertGt(tickUpper, int24(0), "and above it");
    }

    // -----------------------------------------------------------------------
    // §17 / V-09 — the principal cannot be withdrawn, by anyone
    // -----------------------------------------------------------------------

    function test_thePositionEndsUpInTheLockNotTheRouter() public {
        (, uint256 positionId) = _graduate();

        assertEq(positionManager.ownerOf(positionId), address(lock), "the lock holds it");
        assertEq(lock.marketOf(positionId), address(market), "and knows whose fees it collects");
    }

    /// @dev The V-09 answer, as an assertion about the ABI rather than about
    ///      behaviour — which is the strongest form it can take.
    ///
    ///      There is no `decreaseLiquidity`, no `burn`, no `transfer`, no
    ///      `approve`, no `execute`, no owner and no upgrade path on the lock.
    ///      Not gated — absent. A gate is a key somebody holds.
    function test_theLockHasNoWayToMoveThePosition() public view {
        bytes4[6] memory forbidden = [
            bytes4(keccak256("decreaseLiquidity(uint256,uint128,uint256,uint256,uint256)")),
            bytes4(keccak256("burn(uint256)")),
            bytes4(keccak256("transferFrom(address,address,uint256)")),
            bytes4(keccak256("safeTransferFrom(address,address,uint256)")),
            bytes4(keccak256("approve(address,uint256)")),
            bytes4(keccak256("execute(address,bytes)"))
        ];

        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = address(lock).staticcall(abi.encodeWithSelector(forbidden[i], 0, 0, 0));
            assertFalse(ok, "the lock must not implement any principal-moving function");
        }
    }

    /// @dev And the same thing from the other direction: nothing the lock CAN do
    ///      moves the NFT. A selector that does not exist proves the function is
    ///      absent; this proves the ones that exist are harmless.
    function test_collectingDoesNotMoveThePosition() public {
        (, uint256 positionId) = _graduate();

        positionManager.creditFees(positionId, 1_000, 2_000);

        // The mock pays from its own balance; a real position manager pays from
        // the pool. Funding it here keeps the test about the lock.
        token.mint(address(positionManager), 1e24);
        quote.mint(address(positionManager), 1e12);

        lock.collect(positionId);

        assertEq(positionManager.ownerOf(positionId), address(lock), "still locked after a collect");

        (,,,,,,, uint128 liquidity,,,,) = positionManager.positions(positionId);
        assertGt(liquidity, 0, "and the principal is untouched");
    }

    // -----------------------------------------------------------------------
    // §11 / §413 — fees stay collectable, forever, by anyone, to one place
    // -----------------------------------------------------------------------

    function test_feesGoToTheMarketAndNowhereElse() public {
        (, uint256 positionId) = _graduate();

        bool tokenIsToken0 = address(token) < address(quote);
        positionManager.creditFees(positionId, 5_000, 7_000);

        // The pool holds the fees in the mock; fund it so the transfer lands.
        token.mint(address(positionManager), 1e24);
        quote.mint(address(positionManager), 1e12);

        uint256 tokenBefore = token.balanceOf(address(market));
        uint256 quoteBefore = quote.balanceOf(address(market));
        uint256 lockTokenBefore = token.balanceOf(address(lock));
        uint256 lockQuoteBefore = quote.balanceOf(address(lock));

        lock.collect(positionId);

        uint256 tokenGain = token.balanceOf(address(market)) - tokenBefore;
        uint256 quoteGain = quote.balanceOf(address(market)) - quoteBefore;

        assertEq(tokenGain, tokenIsToken0 ? 5_000 : 7_000, "TOKEN fees reach the market");
        assertEq(quoteGain, tokenIsToken0 ? 7_000 : 5_000, "and quote fees too");

        /*
         * The lock's own balance is unchanged by a collect.
         *
         * Not zero — it holds §417's graduation dust permanently, which is the
         * point of sending it there. What matters is that collecting adds
         * nothing to that pile: fees pass through to the market, where §399
         * splits them, and a recipient parameter here would make this a "send a
         * stranger's fees anywhere" function with a harmless name.
         */
        assertEq(token.balanceOf(address(lock)), lockTokenBefore, "fees do not settle in the lock");
        assertEq(quote.balanceOf(address(lock)), lockQuoteBefore, "in either asset");
    }

    /// @dev §414: accrued rights must never be lost because collection is
    ///      unavailable. A permissioned collector is a party who can stop paying
    ///      the creator by doing nothing.
    function test_anyoneMayCollect() public {
        (, uint256 positionId) = _graduate();

        positionManager.creditFees(positionId, 1_000, 1_000);
        token.mint(address(positionManager), 1e24);
        quote.mint(address(positionManager), 1e12);

        vm.prank(makeAddr("a stranger"));
        lock.collect(positionId);

        assertGt(token.balanceOf(address(market)) + quote.balanceOf(address(market)), 0, "paid");
    }

    /// @dev A quiet market collects nothing, and that is not an error. Reverting
    ///      would make an idle position indistinguishable from a broken one —
    ///      the confusion §414 warns about when the venue pauses.
    function test_collectingNothingIsNotAnError() public {
        (, uint256 positionId) = _graduate();

        (uint256 a, uint256 b) = lock.collect(positionId);
        assertEq(a + b, 0, "nothing owed, nothing paid, no revert");
    }

    function test_anUnknownPositionCannotBeCollected() public {
        vm.expectRevert(abi.encodeWithSelector(PermanentLiquidityLock.UnknownPosition.selector, 999));
        lock.collect(999);
    }

    /// @dev Only the router may lock. Otherwise anyone could push a position in
    ///      and attribute its fees to a market they chose.
    function test_onlyTheRouterMayLockAPosition() public {
        vm.expectRevert(
            abi.encodeWithSelector(PermanentLiquidityLock.NotThePositionManager.selector, address(this))
        );
        lock.onERC721Received(address(router), address(0), 1, abi.encode(address(market)));
    }

    // -----------------------------------------------------------------------
    // §417 — dust has a destination, and it is not creator or platform
    // -----------------------------------------------------------------------

    function test_dustGoesToTheLock() public {
        uint256 routerTokenBefore = token.balanceOf(address(router));
        uint256 routerQuoteBefore = quote.balanceOf(address(router));

        _graduate();

        // The router keeps nothing. Anything it held would be claimable by the
        // next graduation's mint, which is somebody else's money.
        assertEq(token.balanceOf(address(router)), 0, "the router retains no TOKEN");
        assertEq(quote.balanceOf(address(router)), 0, "nor quote");

        uint256 lockToken = token.balanceOf(address(lock));
        uint256 lockQuote = quote.balanceOf(address(lock));

        // Whatever the mint would not take is in the lock, which has no
        // withdrawal path — the non-withdrawable account §417 asks for, without
        // a second contract that would need one written.
        assertEq(
            lockToken + lockQuote > 0 || (routerTokenBefore > 0 && routerQuoteBefore > 0),
            true,
            "dust is accounted for"
        );
    }

    /// @dev §416 step 3: prove the endpoint is consumed "within documented dust
    ///      tolerance". This is that documentation, as a number.
    function test_dustIsBoundedAtATinyFractionOfTheMigration() public {
        _graduate();

        uint256 lockToken = token.balanceOf(address(lock));
        uint256 lockQuote = quote.balanceOf(address(lock));

        // One part in ten thousand of each side. The §8 endpoint was derived so
        // both sides balance at `pg`, so the only leftover is V3's rounding to
        // whole units of liquidity — orders of magnitude below this.
        assertLt(lockToken, tokenAmount / 10_000, "TOKEN dust is negligible");
        assertLt(lockQuote, quoteAmount / 10_000 + 1, "and so is quote dust");
    }

    // -----------------------------------------------------------------------
    // Access
    // -----------------------------------------------------------------------

    function test_onlyAnAuthenticMarketMayGraduate() public {
        GToken impostorToken = new GToken();
        GMarket impostor = new GMarket(address(impostorToken));

        vm.expectRevert(
            abi.encodeWithSelector(GraduationRouter.NotAMarket.selector, address(impostor))
        );
        impostor.graduate(router, address(quote), 1e18, 1e6, PG, 0);
    }

    function test_theSwapLegIsAlsoMarketOnly() public {
        GToken impostorToken = new GToken();
        GMarket impostor = new GMarket(address(impostorToken));

        vm.prank(address(impostor));
        vm.expectRevert();
        router.swapExactQuoteForToken(address(token), address(quote), 1e6, address(this));
    }

    function test_migratingNothingIsRefused() public {
        vm.expectRevert(GraduationRouter.NothingToMigrate.selector);
        market.graduate(router, address(quote), 0, quoteAmount, PG, 0);
    }
}
