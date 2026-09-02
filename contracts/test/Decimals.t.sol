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
import {Fees} from "../src/lib/Fees.sol";
import {XStockAssetAdapter} from "../src/XStockAssetAdapter.sol";

contract DecQuote is ERC20 {
    uint8 private immutable D;

    constructor(uint8 d) ERC20("Mock xStock", "MOCKx") {
        D = d;
    }

    function decimals() public view override returns (uint8) {
        return D;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DecRouter is IGraduationRouter {
    function graduate(address token, address, uint256, uint256, uint256, uint256)
        external
        pure
        override
        returns (address, uint256)
    {
        return (address(uint160(uint256(keccak256(abi.encode(token, "pool"))))), 1);
    }

    function swapExactQuoteForToken(address, address, uint256, address) external pure override returns (uint256) {
        return 0;
    }
}

/// @notice End-to-end market behaviour for quote assets that are NOT 18 decimals.
///
/// Every other market test in this repo uses an 18-decimal quote asset, where the
/// normalized and raw representations happen to coincide. That coincidence hides
/// an entire class of bug: any place that mixes a normalized amount with a raw one
/// is invisible at 18 decimals and wrong by a power of ten everywhere else.
///
/// Real xStocks are not guaranteed to be 18 decimals, and V-03 is still open, so
/// this suite exercises the full path — buy, sell, fee settlement, vault
/// accounting, solvency — against 6- and 8-decimal assets.
contract DecimalsTest is Test {
    uint256 constant WAD = 1e18;
    uint256 constant XSTOCK_USD = 137.42e18;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");

    struct Deployment {
        DecQuote quote;
        LaunchToken token;
        LaunchMarket market;
        FeeVault feeVault;
        HolderRewardVault rewardVault;
        uint8 decimals;
    }

    function _deploy(uint8 decimals_) internal returns (Deployment memory d) {
        d.decimals = decimals_;
        d.quote = new DecQuote(decimals_);
        d.feeVault = new FeeVault(governance, treasury, address(this));
        d.rewardVault = new HolderRewardVault(governance, address(this));
        DecRouter router = new DecRouter();

        uint256 quoteMc = (2_000e18 * WAD) / XSTOCK_USD;
        uint256 p0 = (quoteMc * WAD) / Curve.TOTAL_SUPPLY;

        d.token = new LaunchToken("Sent Dec", "DEC", creator);
        d.market = new LaunchMarket(
            address(d.token),
            address(d.quote),
            decimals_,
            creator,
            address(d.feeVault),
            address(d.rewardVault),
            p0
        );
        d.token.setMarket(address(d.market));
        d.token.transfer(address(d.market), d.token.GENESIS_SUPPLY());

        d.feeVault.registerMarket(address(d.market));
        d.rewardVault.registerMarket(address(d.market), address(d.quote));
        d.market.setRouter(address(router));

        // 10,000 whole units of the quote asset, in its own decimals.
        d.quote.mint(alice, 10_000 * (10 ** decimals_));
        vm.prank(alice);
        d.quote.approve(address(d.market), type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // Vault accounting must be in the SAME units the vault pays out in
    // -----------------------------------------------------------------------

    /// @dev The vaults hold and transfer RAW asset units. If the market books
    ///      NORMALIZED amounts into them, the two disagree by 10^(18-decimals) and
    ///      the vault becomes catastrophically insolvent the moment anyone claims.
    function test_feeVaultAccountingMatchesItsBalance_sixDecimals() public {
        Deployment memory d = _deploy(6);

        uint256 gross = 100 * (10 ** 6); // 100 whole units
        vm.prank(alice);
        d.market.buy(gross, 0, block.timestamp + 1);

        uint256 held = d.quote.balanceOf(address(d.feeVault));
        uint256 owed = d.feeVault.outstanding(address(d.quote));

        assertEq(owed, held, "fee vault must owe exactly what it holds");
        assertGt(held, 0, "a fee must actually have been collected");
    }

    function test_rewardVaultAccountingMatchesItsBalance_sixDecimals() public {
        Deployment memory d = _deploy(6);

        uint256 gross = 100 * (10 ** 6);
        vm.prank(alice);
        d.market.buy(gross, 0, block.timestamp + 1);

        uint256 held = d.quote.balanceOf(address(d.rewardVault));
        uint256 funded = d.rewardVault.funded(address(d.market));

        assertEq(funded, held, "reward vault funding must equal its balance");
        assertGt(held, 0, "stockback must actually have been contributed");
    }

    /// @dev The creator must be able to actually withdraw what they were credited.
    function test_creatorCanClaimWhatTheyWereCredited_sixDecimals() public {
        Deployment memory d = _deploy(6);

        uint256 gross = 100 * (10 ** 6);
        vm.prank(alice);
        d.market.buy(gross, 0, block.timestamp + 1);

        uint256 credited = d.feeVault.creatorBalance(creator, address(d.quote));
        assertGt(credited, 0, "creator must be credited something");

        vm.prank(creator);
        uint256 claimed = d.feeVault.claimCreatorFees(address(d.quote), address(0));

        assertEq(claimed, credited, "claim must equal the credit");
        assertEq(d.quote.balanceOf(creator), credited, "and the funds must arrive");
    }

    // -----------------------------------------------------------------------
    // Market solvency across decimal scales
    // -----------------------------------------------------------------------

    function test_marketCoversItsCollateral_sixDecimals() public {
        Deployment memory d = _deploy(6);

        uint256 gross = 50 * (10 ** 6);
        vm.prank(alice);
        d.market.buy(gross, 0, block.timestamp + 1);

        // Collateral is normalized; the balance is raw. Comparing them directly is
        // only valid at 18 decimals, so convert before asserting.
        uint256 requiredRaw = d.market.curveCollateral() / (10 ** (18 - 6));
        assertGe(d.quote.balanceOf(address(d.market)), requiredRaw, "market must cover its curve liability");
    }

    function test_buyThenSellIsALoss_sixDecimals() public {
        Deployment memory d = _deploy(6);

        uint256 spent = 50 * (10 ** 6); // ~40% of the way to graduation
        vm.prank(alice);
        uint256 out = d.market.buy(spent, 0, block.timestamp + 1);

        vm.startPrank(alice);
        d.token.approve(address(d.market), out);
        uint256 back = d.market.sell(out, 0, block.timestamp + 1);
        vm.stopPrank();

        assertLt(back, spent, "a round trip must lose to fees at any decimal scale");
    }

    function test_sellPaysWhatItQuoted_sixDecimals() public {
        Deployment memory d = _deploy(6);

        vm.prank(alice);
        uint256 out = d.market.buy(50 * (10 ** 6), 0, block.timestamp + 1);

        (uint256 quoted,,,) = d.market.quoteSell(out);

        vm.startPrank(alice);
        d.token.approve(address(d.market), out);
        uint256 received = d.market.sell(out, 0, block.timestamp + 1);
        vm.stopPrank();

        assertEq(received, quoted, "sell quote must equal execution at any decimal scale");
    }

    // -----------------------------------------------------------------------
    // Eight decimals, and a sweep
    // -----------------------------------------------------------------------

    function test_feeVaultAccountingMatchesItsBalance_eightDecimals() public {
        Deployment memory d = _deploy(8);

        vm.prank(alice);
        d.market.buy(100 * (10 ** 8), 0, block.timestamp + 1);

        assertEq(
            d.feeVault.outstanding(address(d.quote)),
            d.quote.balanceOf(address(d.feeVault)),
            "fee vault must owe exactly what it holds"
        );
    }

    /// @dev Sweep every plausible decimal value in one go.
    function testFuzz_vaultsStaySolventAcrossDecimals(uint8 decimals_, uint256 grossWhole) public {
        decimals_ = uint8(bound(decimals_, 2, 18));
        grossWhole = bound(grossWhole, 1, 1_000);

        Deployment memory d = _deploy(decimals_);

        uint256 gross = grossWhole * (10 ** decimals_);
        vm.prank(alice);
        d.market.buy(gross, 0, block.timestamp + 1);

        assertEq(
            d.feeVault.outstanding(address(d.quote)),
            d.quote.balanceOf(address(d.feeVault)),
            "fee vault obligation must match its balance"
        );
        assertEq(
            d.rewardVault.funded(address(d.market)),
            d.quote.balanceOf(address(d.rewardVault)),
            "reward vault funding must match its balance"
        );

        uint256 requiredRaw = d.market.curveCollateral() / (10 ** (18 - decimals_));
        assertGe(
            d.quote.balanceOf(address(d.market)), requiredRaw, "market must cover its curve liability"
        );
    }
}
