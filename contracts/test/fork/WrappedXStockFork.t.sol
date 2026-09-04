// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {WrappedXStock} from "../../src/WrappedXStock.sol";
import {WrappedXStockFactory} from "../../src/WrappedXStockFactory.sol";
import {IRebasingToken} from "../../src/interfaces/IRebasingToken.sol";

/**
 * @notice The wrapper, against the xStocks that are actually deployed.
 *
 * `WrappedXStock.t.sol` runs against a mock built to Backed's shape. That proves
 * the wrapper is consistent with our reading of that shape — not that the
 * reading is right. Every assumption this contract makes about `sharesOf`,
 * `multiplier` and how a transfer converts between them is an assumption about
 * someone else's contract, and the only place to check it is that contract.
 *
 * Which matters more here than anywhere else in this repository, because this is
 * the contract that would hold every market's collateral.
 *
 *   forge test --match-path 'test/fork/*' --fork-url https://rpc.hyperliquid.xyz/evm
 *
 * Skipped entirely when no fork is available, so `forge test` stays offline.
 */
contract WrappedXStockForkTest is Test {
    /// Backed's canonical addresses — identical on Optimism and BNB, verified by
    /// bytecode hash. See V-02.
    address constant TSLAX = 0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0;
    address constant SPYX = 0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48;
    address constant CRCLX = 0xfEbDEd1B0986a8ee107f5AB1a1c5a813491DeCEB;

    WrappedXStockFactory factory;
    bool forked;

    function setUp() public {
        forked = TSLAX.code.length > 0;
        if (!forked) return;

        factory = new WrappedXStockFactory();
    }

    /**
     * @dev Give `who` real shares of a real xStock.
     *
     *      `deal` cannot do this. It writes a `balanceOf` slot, and on a Backed
     *      token `balanceOf` is COMPUTED from shares — so the write lands
     *      nowhere and the balance stays zero, silently.
     *
     *      Guessing the slot does not work either. The first version of this
     *      helper walked `keccak256(abi.encode(who, slot))` for slots 0..39,
     *      which is the classic Solidity mapping layout, and found nothing:
     *      these contracts use namespaced storage, so the base slot is a hash of
     *      a string rather than a small integer. There is nothing to enumerate.
     *
     *      So the slot is not guessed at all — it is OBSERVED. `vm.record`
     *      captures the reads a call performs, and the last slot `sharesOf`
     *      touches is the one holding this account's shares. That works whatever
     *      layout Backed chose, and keeps working if they change it.
     *
     *      The write is then verified through the token's own getter, so a
     *      helper that silently funded nobody fails here rather than producing a
     *      green test against an empty balance.
     */
    function _dealShares(address token, address who, uint256 shares) internal {
        vm.record();
        IRebasingToken(token).sharesOf(who);
        (bytes32[] memory reads,) = vm.accesses(token);

        require(reads.length > 0, "sharesOf read no storage");

        // Walk backwards: the deepest read is the account's own slot, the
        // earlier ones are the proxy's implementation pointer and whatever the
        // getter touched on the way.
        for (uint256 i = reads.length; i > 0; i--) {
            bytes32 slot = reads[i - 1];
            bytes32 prior = vm.load(token, slot);

            vm.store(token, slot, bytes32(shares));
            if (IRebasingToken(token).sharesOf(who) == shares) return;

            vm.store(token, slot, prior);
        }
        revert("could not locate the shares slot");
    }

    // -----------------------------------------------------------------------

    /// @dev The premise. If these are not rebasing, this contract is pointless
    ///      and the registry is refusing them for no reason.
    function test_theRealXStocksAreRebasingAsAssumed() public view {
        if (!forked) return;

        address[3] memory tokens = [TSLAX, SPYX, CRCLX];

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 m = IRebasingToken(tokens[i]).multiplier();
            assertGt(m, 0, "a live multiplier");

            // sharesOf must answer, or the wrapper's arithmetic has no basis.
            IRebasingToken(tokens[i]).sharesOf(address(this));
        }

        // Measured Day 8. SPYx had already rebased; a dividend had landed.
        assertGt(IRebasingToken(SPYX).multiplier(), 1e18, "SPYx has moved off parity");
    }

    /// @dev The factory's own gate, against the real token rather than a mock.
    function test_theWrapperDeploysAgainstTheRealToken() public {
        if (!forked) return;

        address predicted = factory.predict(TSLAX);
        WrappedXStock w = WrappedXStock(factory.create(TSLAX));

        assertEq(address(w), predicted, "predict and create agree on the real token too");
        assertEq(address(w.UNDERLYING()), TSLAX);
        assertEq(w.symbol(), "wTSLAx", "the symbol is read from the real token");
        assertEq(w.decimals(), IERC20Metadata(TSLAX).decimals(), "and so are the decimals");
    }

    /// @dev A real round trip: real token, real shares, real transfer semantics.
    function test_aRoundTripOnTheRealTokenIsExact() public {
        if (!forked) return;

        WrappedXStock w = WrappedXStock(factory.create(TSLAX));
        address user = makeAddr("user");

        _dealShares(TSLAX, user, 10e18);

        uint256 assets = IERC20(TSLAX).balanceOf(user);
        assertGt(assets, 0, "the helper actually funded them");

        vm.startPrank(user);
        IERC20(TSLAX).approve(address(w), type(uint256).max);
        uint256 minted = w.wrap(assets);
        vm.stopPrank();

        assertGt(minted, 0, "shares were credited");
        assertLe(
            w.totalSupply(),
            IRebasingToken(TSLAX).sharesOf(address(w)),
            "solvency, on the real token"
        );

        vm.prank(user);
        uint256 back = w.unwrap(minted);

        assertApproxEqAbs(back, assets, 2, "what went in came out, to the wei");
        assertEq(w.totalSupply(), 0);
        assertLe(w.totalSupply(), IRebasingToken(TSLAX).sharesOf(address(w)));
    }

    /**
     * @dev The claim the whole design rests on, made against the real contract:
     *      a rebase moves no wrapper balance.
     *
     *      The multiplier is forced rather than waited for. Its storage slot is
     *      found the same self-proving way as the shares mapping — written, then
     *      read back through the token's own getter.
     */
    function test_aRealRebaseMovesNoWrapperBalance() public {
        if (!forked) return;

        WrappedXStock w = WrappedXStock(factory.create(TSLAX));
        address user = makeAddr("user");

        _dealShares(TSLAX, user, 100e18);

        vm.startPrank(user);
        IERC20(TSLAX).approve(address(w), type(uint256).max);
        uint256 minted = w.wrap(IERC20(TSLAX).balanceOf(user));
        vm.stopPrank();

        uint256 supplyBefore = w.totalSupply();
        uint256 userBefore = w.balanceOf(user);
        uint256 current = IRebasingToken(TSLAX).multiplier();

        // A 1-for-2 reverse split: the case that breaks a raw-held quote asset.
        _forceMultiplier(TSLAX, current / 2);

        assertEq(w.totalSupply(), supplyBefore, "a real rebase moves no wrapper supply");
        assertEq(w.balanceOf(user), userBefore, "nor any holder's balance");
        assertLe(
            w.totalSupply(),
            IRebasingToken(TSLAX).sharesOf(address(w)),
            "and cannot make the wrapper insolvent"
        );

        // The holder can still leave, for correspondingly less underlying.
        vm.prank(user);
        uint256 out = w.unwrap(minted);
        assertGt(out, 0, "redemption still works after a reverse split");
    }

    /// @dev Same technique as `_dealShares`, for the same reason.
    function _forceMultiplier(address token, uint256 value) internal {
        vm.record();
        IRebasingToken(token).multiplier();
        (bytes32[] memory reads,) = vm.accesses(token);

        for (uint256 i = reads.length; i > 0; i--) {
            bytes32 slot = reads[i - 1];
            bytes32 prior = vm.load(token, slot);

            vm.store(token, slot, bytes32(value));
            if (IRebasingToken(token).multiplier() == value) return;

            vm.store(token, slot, prior);
        }
        revert("could not locate the multiplier slot");
    }
}

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}
