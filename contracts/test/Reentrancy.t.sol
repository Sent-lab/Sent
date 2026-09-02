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
import {Curve} from "../src/lib/Curve.sol";

/// @notice A quote asset that calls back into an arbitrary target on transfer.
///
/// §420 requires transfer behaviour to be verified before an asset can back a
/// market, so a hostile quote asset should never reach production. This suite
/// exists because "should never" is not a control: the §420 gate is operated by
/// humans, and defence in depth means the contracts survive the gate being wrong.
contract HostileQuote is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;
    bool public fired;

    constructor() ERC20("Hostile xStock", "EVILx") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
        fired = false;
    }

    function disarm() external {
        armed = false;
    }

    /// @dev The callback hook. Fires once, on the first transfer after arming.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        if (armed && !fired && target != address(0)) {
            fired = true;
            // Deliberately swallow the result: a reverting reentrant call must not
            // mask itself as a failure of the outer transfer.
            (bool ok,) = target.call(payload);
            ok; // result inspected by the test through state, not here
        }
    }
}

contract ReentrancyTest is Test {
    uint256 constant WAD = 1e18;
    uint256 constant XSTOCK_USD = 137.42e18;

    HostileQuote quote;
    LaunchToken token;
    LaunchMarket market;
    FeeVault feeVault;
    HolderRewardVault rewardVault;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address creator = makeAddr("creator");
    address attacker = makeAddr("attacker");

    function setUp() public {
        quote = new HostileQuote();
        feeVault = new FeeVault(governance, treasury, address(this));
        rewardVault = new HolderRewardVault(governance, address(this));

        uint256 quoteMc = (2_000e18 * WAD) / XSTOCK_USD;
        uint256 p0 = (quoteMc * WAD) / Curve.TOTAL_SUPPLY;

        token = new LaunchToken("Sent Reentrant", "RE", creator);
        market = new LaunchMarket(
            address(token), address(quote), 18, creator, address(feeVault), address(rewardVault), p0
        );
        token.setMarket(address(market));
        token.transfer(address(market), token.GENESIS_SUPPLY());

        feeVault.registerMarket(address(market));
        rewardVault.registerMarket(address(market), address(quote));

        quote.mint(attacker, 1_000e18);
        vm.prank(attacker);
        quote.approve(address(market), type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // Re-entering the market
    // -----------------------------------------------------------------------

    /// @dev The classic: re-enter `buy` from inside the quote transfer, hoping to
    ///      read a half-updated curve.
    function test_reentrantBuyIsBlocked() public {
        quote.arm(
            address(market),
            abi.encodeCall(LaunchMarket.buy, (1e18, 0, type(uint256).max))
        );

        vm.prank(attacker);
        uint256 out = market.buy(10e18, 0, block.timestamp + 1);

        assertTrue(quote.fired(), "the callback must actually have fired");
        assertGt(out, 0, "the honest outer trade still succeeds");

        // One trade happened, not two. If the guard had failed, distribution and
        // collateral would reflect a second buy.
        assertEq(token.balanceOf(attacker), out, "attacker received exactly one fill");
    }

    /// @dev Cross-function: re-enter `sell` from inside a buy. Both share the same
    ///      reentrancy guard, so the curve can never be observed mid-update.
    function test_reentrantSellDuringBuyIsBlocked() public {
        quote.arm(
            address(market),
            abi.encodeCall(LaunchMarket.sell, (1e18, 0, type(uint256).max))
        );

        vm.prank(attacker);
        market.buy(10e18, 0, block.timestamp + 1);

        assertTrue(quote.fired(), "the callback must actually have fired");

        // The market must still be internally consistent afterwards.
        assertGe(
            quote.balanceOf(address(market)),
            market.collateralInAssetUnits(),
            "market still covers its curve liability"
        );
    }

    // -----------------------------------------------------------------------
    // Re-entering the vaults
    // -----------------------------------------------------------------------

    /// @dev The market transfers the core fee to FeeVault BEFORE calling accrue.
    ///      A hostile asset can therefore re-enter during that window, when the
    ///      vault's balance has risen but the accrual has not been booked. Nothing
    ///      may be claimable from that gap.
    function test_reentrantClaimDuringFeeTransferStealsNothing() public {
        quote.arm(
            address(feeVault),
            abi.encodeCall(FeeVault.claimCreatorFees, (address(quote), attacker))
        );

        vm.prank(attacker);
        market.buy(10e18, 0, block.timestamp + 1);

        assertTrue(quote.fired(), "the callback must actually have fired");
        assertEq(quote.balanceOf(attacker), 1_000e18 - 10e18, "attacker gained nothing beyond their trade");

        // The vault's books and balance still agree.
        assertEq(
            feeVault.outstanding(address(quote)),
            quote.balanceOf(address(feeVault)),
            "fee vault obligation still matches its balance"
        );
    }

    /// @dev Same window, but attacking the platform sweep, which is permissionless
    ///      and therefore callable by anyone at any moment.
    function test_reentrantPlatformSweepCannotOutrunAccrual() public {
        quote.arm(
            address(feeVault),
            abi.encodeCall(FeeVault.settlePlatformFees, (address(quote)))
        );

        vm.prank(attacker);
        market.buy(10e18, 0, block.timestamp + 1);

        assertTrue(quote.fired(), "the callback must actually have fired");

        // Whatever the sweep did or did not move, the books must still balance and
        // the creator's share must be intact and claimable.
        uint256 creatorOwed = feeVault.creatorBalance(creator, address(quote));
        assertGt(creatorOwed, 0, "creator was still credited");

        vm.prank(creator);
        uint256 claimed = feeVault.claimCreatorFees(address(quote), address(0));
        assertEq(claimed, creatorOwed, "creator can still claim in full");
    }

    /// @dev Re-enter the reward vault's funding path.
    function test_reentrantRewardVaultFundIsRejected() public {
        quote.arm(address(rewardVault), abi.encodeCall(HolderRewardVault.fund, (1_000_000e18)));

        vm.prank(attacker);
        market.buy(10e18, 0, block.timestamp + 1);

        assertTrue(quote.fired(), "the callback must actually have fired");

        // `fund` is restricted to registered markets, so a callback arriving with
        // the hostile TOKEN as msg.sender cannot inflate funding.
        assertEq(
            rewardVault.funded(address(market)),
            quote.balanceOf(address(rewardVault)),
            "funding must still equal the balance actually received"
        );
    }

    // -----------------------------------------------------------------------
    // Sell path
    // -----------------------------------------------------------------------

    function test_reentrantBuyDuringSellPayoutIsBlocked() public {
        // Establish a position first, with the hook disarmed.
        vm.prank(attacker);
        uint256 out = market.buy(20e18, 0, block.timestamp + 1);

        vm.prank(attacker);
        token.approve(address(market), out);

        quote.arm(address(market), abi.encodeCall(LaunchMarket.buy, (1e18, 0, type(uint256).max)));

        vm.prank(attacker);
        uint256 received = market.sell(out, 0, block.timestamp + 1);

        assertTrue(quote.fired(), "the callback must actually have fired");
        assertGt(received, 0, "the honest sell still settles");
        assertGe(
            quote.balanceOf(address(market)),
            market.collateralInAssetUnits(),
            "market still covers its curve liability after a reentrant sell"
        );
    }
}
