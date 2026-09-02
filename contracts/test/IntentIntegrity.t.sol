// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LaunchMarket} from "../src/LaunchMarket.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {HolderRewardVault} from "../src/HolderRewardVault.sol";
import {IGraduationRouter} from "../src/interfaces/IGraduationRouter.sol";

contract IntentQuote is ERC20 {
    uint8 private immutable D;

    constructor(uint8 d) ERC20("Mock NVDAx", "NVDAx") {
        D = d;
    }

    function decimals() public view override returns (uint8) {
        return D;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract IntentRouter is IGraduationRouter {
    function graduate(address t, address, uint256, uint256, uint256, uint256)
        external
        pure
        override
        returns (address, uint256)
    {
        return (address(uint160(uint256(keccak256(abi.encode(t, "pool"))))), 1);
    }

    function swapExactQuoteForToken(address, address, uint256, address) external pure override returns (uint256) {
        return 0;
    }
}

/// @notice Proves the §694 hard invariant end to end:
///
///     UI REVIEW = TRANSACTION INTENT = SDK BUILDER = ACTUAL CALLDATA
///
/// The SDK builds real intents in TypeScript. This test takes the resulting
/// calldata BYTE FOR BYTE — it never re-encodes the call — submits it to a real
/// market with a raw `.call`, and asserts the on-chain outcome equals the numbers
/// the review sheet showed the user.
///
/// A failure here means one of:
///   - the SDK encodes arguments differently from the ABI the contract exposes;
///   - the SDK computes a fee differently from `Fees.sol`;
///   - the review is generated from something other than the call being made.
///
/// All three are exactly what §698 calls a hidden transaction mutation.
///
/// The fixtures run at 18, 8 and 6 decimals, because at 18 the raw and normalized
/// representations coincide and a unit error is invisible.
contract IntentIntegrityTest is Test {
    string json;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address creator = makeAddr("creator");
    address user = makeAddr("user");

    function setUp() public {
        json = vm.readFile("test/fixtures/intents.json");
    }

    struct Deployment {
        IntentQuote quote;
        LaunchToken token;
        LaunchMarket market;
        FeeVault feeVault;
        HolderRewardVault rewardVault;
    }

    function _deploy(uint8 decimals_) internal returns (Deployment memory d) {
        uint256 p0 = vm.parseJsonUint(json, ".p0");

        d.quote = new IntentQuote(decimals_);
        d.feeVault = new FeeVault(governance, treasury, address(this));
        d.rewardVault = new HolderRewardVault(governance, address(this));

        d.token = new LaunchToken("Sent Intent", "TEST", creator);
        d.market = new LaunchMarket(
            address(d.token), address(d.quote), decimals_, creator, address(d.feeVault), address(d.rewardVault), p0
        );
        d.token.setMarket(address(d.market));
        d.token.transfer(address(d.market), d.token.GENESIS_SUPPLY());

        d.feeVault.registerMarket(address(d.market));
        d.rewardVault.registerMarket(address(d.market), address(d.quote));
        d.market.setRouter(address(new IntentRouter()));

        d.quote.mint(user, 1_000_000 * (10 ** decimals_));
        vm.prank(user);
        d.quote.approve(address(d.market), type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // BUY
    // -----------------------------------------------------------------------

    function test_everyBuyIntentExecutesExactlyAsReviewed() public {
        uint256 count = 15;

        for (uint256 i = 0; i < count; i++) {
            string memory at = string.concat(".buys[", vm.toString(i), "]");

            uint8 decimals_ = uint8(vm.parseJsonUint(json, string.concat(at, ".quoteDecimals")));
            bytes memory data = vm.parseJsonBytes(json, string.concat(at, ".data"));

            uint256 expectTokensOut = vm.parseJsonUint(json, string.concat(at, ".expectTokensOut"));
            uint256 expectCoreFee = vm.parseJsonUint(json, string.concat(at, ".expectCoreFeeRaw"));
            uint256 expectCreator = vm.parseJsonUint(json, string.concat(at, ".expectCreatorFeeRaw"));
            uint256 expectPlatform = vm.parseJsonUint(json, string.concat(at, ".expectPlatformFeeRaw"));
            uint256 expectStockback = vm.parseJsonUint(json, string.concat(at, ".expectStockbackRaw"));

            Deployment memory d = _deploy(decimals_);
            string memory label = string.concat(" [buy case ", vm.toString(i), "]");

            // The SDK's calldata, submitted verbatim. Nothing is re-encoded here.
            vm.prank(user);
            (bool ok, bytes memory ret) = address(d.market).call(data);
            assertTrue(ok, string.concat("SDK calldata must execute", label));

            uint256 actualOut = abi.decode(ret, (uint256));

            assertEq(actualOut, expectTokensOut, string.concat("tokens out must match the review", label));
            assertEq(
                d.token.balanceOf(user), expectTokensOut, string.concat("tokens must actually arrive", label)
            );

            // Every fee row the user was shown must be what the vaults received.
            assertEq(
                d.quote.balanceOf(address(d.feeVault)),
                expectCoreFee,
                string.concat("core fee must match the review", label)
            );
            assertEq(
                d.feeVault.creatorBalance(creator, address(d.quote)),
                expectCreator,
                string.concat("creator fee must match the review", label)
            );
            assertEq(
                d.feeVault.platformBalance(address(d.quote)),
                expectPlatform,
                string.concat("platform fee must match the review", label)
            );
            assertEq(
                d.rewardVault.funded(address(d.market)),
                expectStockback,
                string.concat("stockback must match the review", label)
            );
        }
    }

    // -----------------------------------------------------------------------
    // SELL
    // -----------------------------------------------------------------------

    function test_everySellIntentExecutesExactlyAsReviewed() public {
        uint256 count = 3;

        for (uint256 i = 0; i < count; i++) {
            string memory at = string.concat(".sells[", vm.toString(i), "]");

            uint8 decimals_ = uint8(vm.parseJsonUint(json, string.concat(at, ".quoteDecimals")));
            uint256 warmup = vm.parseJsonUint(json, string.concat(at, ".warmupGrossIn"));
            bytes memory data = vm.parseJsonBytes(json, string.concat(at, ".data"));
            uint256 expectNetOut = vm.parseJsonUint(json, string.concat(at, ".expectNetOutRaw"));

            Deployment memory d = _deploy(decimals_);
            string memory label = string.concat(" [sell case ", vm.toString(i), "]");

            // Reach the same curve state the SDK quoted against.
            vm.prank(user);
            d.market.buy(warmup, 0, block.timestamp + 1);

            vm.prank(user);
            d.token.approve(address(d.market), type(uint256).max);

            uint256 before = d.quote.balanceOf(user);

            vm.prank(user);
            (bool ok, bytes memory ret) = address(d.market).call(data);
            assertTrue(ok, string.concat("SDK calldata must execute", label));

            uint256 actualOut = abi.decode(ret, (uint256));

            assertEq(actualOut, expectNetOut, string.concat("payout must match the review", label));
            assertEq(
                d.quote.balanceOf(user) - before,
                expectNetOut,
                string.concat("funds must actually arrive", label)
            );
        }
    }

    // -----------------------------------------------------------------------
    // The slippage bound in the review is enforced on-chain, not merely shown
    // -----------------------------------------------------------------------

    /// @dev §316 and §233: a minimum shown to the user is only meaningful if the
    ///      chain rejects a worse fill. Front-running the intent with another buy
    ///      moves the price; the intent must then revert rather than fill worse
    ///      than reviewed.
    function test_reviewedMinimumIsEnforcedAgainstAFrontRunner() public {
        string memory at = ".buys[4]"; // a mid-sized 18-decimal case

        uint8 decimals_ = uint8(vm.parseJsonUint(json, string.concat(at, ".quoteDecimals")));
        bytes memory data = vm.parseJsonBytes(json, string.concat(at, ".data"));

        Deployment memory d = _deploy(decimals_);

        // Someone else buys first, moving the price against our reviewed quote.
        address frontRunner = makeAddr("frontRunner");
        d.quote.mint(frontRunner, 1_000 * (10 ** decimals_));
        vm.startPrank(frontRunner);
        d.quote.approve(address(d.market), type(uint256).max);
        d.market.buy(50 * (10 ** decimals_), 0, block.timestamp + 1);
        vm.stopPrank();

        vm.prank(user);
        (bool ok,) = address(d.market).call(data);

        assertFalse(ok, "a fill worse than the reviewed minimum must revert, not settle");
    }
}
