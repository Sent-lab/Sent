// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";
import {Fees} from "../src/lib/Fees.sol";

contract MockXStock is ERC20 {
    constructor() ERC20("Mock NVDAx", "NVDAx") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FeeVaultTest is Test {
    FeeVault vault;
    MockXStock asset;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address founderProfit = makeAddr("founderProfitSafe");
    address factory = makeAddr("factory");
    address market = makeAddr("market");
    address creator = makeAddr("creator");
    address attacker = makeAddr("attacker");

    function setUp() public {
        vault = new FeeVault(governance, treasury, factory);
        asset = new MockXStock();

        vm.prank(factory);
        vault.registerMarket(market);
    }

    /// @dev Simulate a trade: the market moves the fee in, then books it.
    function _accrue(uint256 notional) internal returns (Fees.Breakdown memory f) {
        f = Fees.forBuy(notional);
        asset.mint(address(vault), f.coreFee);

        vm.prank(market);
        vault.accrue(creator, address(asset), f.creatorFee, f.platformFee);
    }

    // -----------------------------------------------------------------------
    // The 65/35 split arrives intact
    // -----------------------------------------------------------------------

    function test_accrualMatchesLockedSplit() public {
        Fees.Breakdown memory f = _accrue(10_000e18);

        assertEq(f.coreFee, 100e18, "1% core fee");
        assertEq(vault.creatorBalance(creator, address(asset)), 65e18, "creator 65%");
        assertEq(vault.platformBalance(address(asset)), 35e18, "platform 35%");
    }

    function testFuzz_splitIsExhaustiveAndSolvent(uint256 notional) public {
        notional = bound(notional, 0, 1e30);
        Fees.Breakdown memory f = _accrue(notional);

        uint256 creatorBal = vault.creatorBalance(creator, address(asset));
        uint256 platformBal = vault.platformBalance(address(asset));

        assertEq(creatorBal + platformBal, f.coreFee, "no fee may vanish or appear");
        assertGe(asset.balanceOf(address(vault)), vault.outstanding(address(asset)), "vault must stay solvent");
    }

    // -----------------------------------------------------------------------
    // Creator funds are unreachable by anyone but the creator
    // -----------------------------------------------------------------------

    function test_creatorClaimsOwnFees() public {
        _accrue(10_000e18);

        vm.prank(creator);
        uint256 claimed = vault.claimCreatorFees(address(asset), address(0));

        assertEq(claimed, 65e18, "creator receives their full accrual");
        assertEq(asset.balanceOf(creator), 65e18, "funds actually arrive");
        assertEq(vault.creatorBalance(creator, address(asset)), 0, "balance cleared");
    }

    function test_governanceCannotTouchCreatorFunds() public {
        _accrue(10_000e18);

        // There is no function on this contract that lets governance move a
        // creator's balance. Prove the surface is what it claims: governance
        // claiming yields nothing, because it has no accrual of its own.
        vm.prank(governance);
        vm.expectRevert(FeeVault.NothingToClaim.selector);
        vault.claimCreatorFees(address(asset), governance);

        assertEq(vault.creatorBalance(creator, address(asset)), 65e18, "creator balance untouched");
    }

    function test_attackerCannotClaimCreatorFunds() public {
        _accrue(10_000e18);

        vm.prank(attacker);
        vm.expectRevert(FeeVault.NothingToClaim.selector);
        vault.claimCreatorFees(address(asset), attacker);

        assertEq(vault.creatorBalance(creator, address(asset)), 65e18, "creator balance untouched");
    }

    /// @dev §559: retargeting the treasury must not create a path to creator money.
    function test_retargetingTreasuryCannotDivertCreatorFees() public {
        _accrue(10_000e18);

        vm.prank(governance);
        vault.setTreasury(attacker);

        vault.settlePlatformFees(address(asset));

        assertEq(asset.balanceOf(attacker), 35e18, "only the platform share moved");
        assertEq(vault.creatorBalance(creator, address(asset)), 65e18, "creator share untouched");
    }

    // -----------------------------------------------------------------------
    // Platform revenue lands at the Treasury Safe, never at Founder Profit
    // -----------------------------------------------------------------------

    function test_platformSettlesToTreasuryOnly() public {
        _accrue(10_000e18);

        // Permissionless: anyone may pay gas to settle, but only to `treasury`.
        vm.prank(attacker);
        vault.settlePlatformFees(address(asset));

        assertEq(asset.balanceOf(treasury), 35e18, "platform share reaches the Treasury Safe");
        assertEq(asset.balanceOf(founderProfit), 0, "founder profit is never a direct destination");
        assertEq(asset.balanceOf(attacker), 0, "the settler gains nothing");
    }

    // -----------------------------------------------------------------------
    // Only factory-registered markets can accrue
    // -----------------------------------------------------------------------

    function test_unregisteredMarketCannotAccrue() public {
        vm.prank(attacker);
        vm.expectRevert(FeeVault.NotMarket.selector);
        vault.accrue(attacker, address(asset), 1e18, 1e18);
    }

    function test_onlyFactoryCanRegisterMarkets() public {
        vm.prank(attacker);
        vm.expectRevert(FeeVault.NotFactory.selector);
        vault.registerMarket(attacker);
    }

    function test_onlyGovernanceCanRetarget() public {
        vm.prank(attacker);
        vm.expectRevert(FeeVault.NotGovernance.selector);
        vault.setTreasury(attacker);
    }

    // -----------------------------------------------------------------------
    // Solvency across many markets and creators
    // -----------------------------------------------------------------------

    function testFuzz_vaultStaysSolventAcrossManyAccruals(uint256[16] calldata notionals) public {
        uint256 expectedOutstanding = 0;

        for (uint256 i = 0; i < notionals.length; i++) {
            uint256 notional = bound(notionals[i], 0, 1e28);
            Fees.Breakdown memory f = Fees.forBuy(notional);

            asset.mint(address(vault), f.coreFee);
            vm.prank(market);
            vault.accrue(creator, address(asset), f.creatorFee, f.platformFee);

            expectedOutstanding += f.coreFee;
        }

        assertEq(vault.outstanding(address(asset)), expectedOutstanding, "obligation tracked exactly");
        assertGe(asset.balanceOf(address(vault)), expectedOutstanding, "vault covers its obligation");

        // Drain both sides; the vault must end at exactly zero obligation.
        if (expectedOutstanding > 0) {
            if (vault.creatorBalance(creator, address(asset)) > 0) {
                vm.prank(creator);
                vault.claimCreatorFees(address(asset), address(0));
            }
            if (vault.platformBalance(address(asset)) > 0) {
                vault.settlePlatformFees(address(asset));
            }
        }

        assertEq(vault.outstanding(address(asset)), 0, "everything accrued is claimable and claimed");
    }
}

contract XStockRegistryTest is Test {
    XStockRegistry registry;

    address governance = makeAddr("governanceSafe");
    address attacker = makeAddr("attacker");
    address nvdax = makeAddr("NVDAx");

    function setUp() public {
        registry = new XStockRegistry(governance, address(0));
    }

    function _allGates() internal pure returns (XStockRegistry.Gates memory) {
        return XStockRegistry.Gates({
            canonicalRepresentation: true,
            transferBehaviour: true,
            multiplierBehaviour: true,
            priceSource: true,
            haltSource: true,
            hyperSwapCompatible: true,
            normalizedAccountingTested: true,
            legalReviewed: true
        });
    }

    // -----------------------------------------------------------------------
    // §420 — registration alone proves nothing
    // -----------------------------------------------------------------------

    function test_registeredButUnverifiedIsNotLaunchable() public {
        vm.prank(governance);
        registry.registerAsset(nvdax, 18, 1385, 0);

        assertFalse(registry.isLaunchable(nvdax), "registration is not verification");
    }

    function test_cannotEnableWithoutAllGates() public {
        vm.startPrank(governance);
        registry.registerAsset(nvdax, 18, 1385, 0);

        XStockRegistry.Gates memory gates = _allGates();
        gates.legalReviewed = false; // one gate short

        registry.setGates(nvdax, gates);

        vm.expectRevert(XStockRegistry.GatesNotAllPassed.selector);
        registry.enableAsset(nvdax);
        vm.stopPrank();

        assertFalse(registry.isLaunchable(nvdax), "seven of eight gates is not enough");
    }

    function test_fullyVerifiedAssetIsLaunchable() public {
        vm.startPrank(governance);
        registry.registerAsset(nvdax, 18, 1385, 0);
        registry.setGates(nvdax, _allGates());
        registry.enableAsset(nvdax);
        vm.stopPrank();

        assertTrue(registry.isLaunchable(nvdax), "all eight gates plus enable");

        address[] memory launchable = registry.launchableAssets();
        assertEq(launchable.length, 1);
        assertEq(launchable[0], nvdax);
    }

    /// @dev A gate regressing must immediately withdraw the asset from new launches.
    function test_gateRegressionDisablesImmediately() public {
        vm.startPrank(governance);
        registry.registerAsset(nvdax, 18, 1385, 0);
        registry.setGates(nvdax, _allGates());
        registry.enableAsset(nvdax);
        assertTrue(registry.isLaunchable(nvdax));

        XStockRegistry.Gates memory regressed = _allGates();
        regressed.transferBehaviour = false;
        registry.setGates(nvdax, regressed);
        vm.stopPrank();

        assertFalse(registry.isLaunchable(nvdax), "a lost gate must stop new launches at once");
    }

    function test_onlyGovernanceCanRegisterOrEnable() public {
        vm.prank(attacker);
        vm.expectRevert(XStockRegistry.NotGovernance.selector);
        registry.registerAsset(nvdax, 18, 1385, 0);

        vm.prank(governance);
        registry.registerAsset(nvdax, 18, 1385, 0);

        vm.prank(attacker);
        vm.expectRevert(XStockRegistry.NotGovernance.selector);
        registry.setGates(nvdax, _allGates());
    }

    function test_disableStopsNewLaunches() public {
        vm.startPrank(governance);
        registry.registerAsset(nvdax, 18, 1385, 0);
        registry.setGates(nvdax, _allGates());
        registry.enableAsset(nvdax);
        registry.disableAsset(nvdax, "halted upstream");
        vm.stopPrank();

        assertFalse(registry.isLaunchable(nvdax), "disabled assets cannot back new launches");

        // The record survives: disabling is not deletion, and a live market's pair
        // remains resolvable for its entire life (§387, §388).
        XStockRegistry.Asset memory a = registry.getAsset(nvdax);
        assertTrue(a.exists, "asset record must survive disabling");
        assertEq(a.token, nvdax);
    }

    function test_emptyRegistryLaunchesNothing() public view {
        // §420: the production allowlist starts empty and stays empty until assets
        // are verified. A market cannot be launched against an unknown asset.
        assertEq(registry.registeredCount(), 0);
        assertFalse(registry.isLaunchable(nvdax));
    }
}
