// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {HolderRewardVault} from "../src/HolderRewardVault.sol";

/// @title SENT deployment.
///
/// @notice Deploys the registry and the factory. The factory constructs the fee
///         vault and the reward vault itself, so those are NOT deployed here —
///         doing so would produce a second pair that nothing points at.
///
/// @dev WHAT THIS SCRIPT REFUSES TO DO
///      ---------------------------------------------------------------------
///      It does not enable any xStock. Registration is a governance action that
///      requires verified facts about a specific token (V-02, V-03, V-05), and a
///      deploy script that enabled assets from a config file would be the single
///      easiest place in this system to point a market at the wrong address.
///
///      It does not set the graduation router. The router depends on HyperSwap's
///      position manager and the lock primitive, both of which are open
///      verification items (V-06, V-09). A market launched before the router is
///      wired cannot graduate, so the factory must not accept launches until
///      governance sets it — which is a governance transaction, not this script.
///
///      It refuses to hand mainnet governance to an externally owned account.
///      Governance can enable assets, move the treasury and set the router; a
///      hot key holding that is a compromise away from a malicious asset list.
contract Deploy is Script {
    /// @dev HyperEVM. Verified as V-01.
    uint256 internal constant HYPEREVM_CHAIN_ID = 999;

    struct Config {
        address governance;
        address treasury;
        uint256 launchFee;
    }

    function run() external returns (XStockRegistry registry, LaunchpadFactory factory) {
        Config memory config = _loadConfig();

        _assertSafeForChain(config);

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        registry = new XStockRegistry(config.governance);
        factory = new LaunchpadFactory(config.governance, config.treasury, address(registry), config.launchFee);

        vm.stopBroadcast();

        _report(config, registry, factory);
    }

    // -----------------------------------------------------------------------

    function _loadConfig() internal view returns (Config memory config) {
        config.governance = vm.envAddress("GOVERNANCE");
        config.treasury = vm.envAddress("TREASURY");
        config.launchFee = vm.envUint("LAUNCH_FEE");
    }

    /// @dev The guards that make an accidental mainnet deploy fail loudly.
    ///
    ///      All of them are chain-gated rather than universal: a local fork or an
    ///      integration test legitimately runs with an EOA holding governance,
    ///      and a check that blocked that would only teach people to comment it
    ///      out — which is worse than not having it.
    function _assertSafeForChain(Config memory config) internal view {
        require(config.governance != address(0), "Deploy: governance is zero");
        require(config.treasury != address(0), "Deploy: treasury is zero");

        if (block.chainid != HYPEREVM_CHAIN_ID) return;

        // A Safe is a contract; an EOA is not. This does not prove the address is
        // a Safe, and it is not meant to — it rules out the specific failure of
        // launching mainnet with governance on a single hot key.
        require(config.governance.code.length > 0, "Deploy: mainnet governance must be a contract (C-08)");
        require(config.treasury.code.length > 0, "Deploy: mainnet treasury must be a contract (C-08)");

        // Governance and treasury being the same address is legal but almost
        // always a copy-paste: fee withdrawal and protocol authority collapse
        // into one signer set, and the separation the vaults assume is gone.
        require(config.governance != config.treasury, "Deploy: governance and treasury must differ");
    }

    /// @dev Prints what was deployed AND what is still missing.
    ///
    ///      The second half matters more. A deployment log that lists addresses
    ///      and stops reads as "done", and the two steps this script deliberately
    ///      does not perform are both required before a single token can trade.
    function _report(Config memory config, XStockRegistry registry, LaunchpadFactory factory) internal view {
        FeeVault feeVault = factory.FEE_VAULT();
        HolderRewardVault rewardVault = factory.REWARD_VAULT();

        console2.log("chain id          ", block.chainid);
        console2.log("registry          ", address(registry));
        console2.log("factory           ", address(factory));
        console2.log("fee vault         ", address(feeVault));
        console2.log("reward vault      ", address(rewardVault));
        console2.log("governance        ", config.governance);
        console2.log("treasury          ", config.treasury);
        console2.log("launch fee        ", config.launchFee);

        console2.log("");
        console2.log("NOT DONE - required before any launch:");
        console2.log("  1. governance calls factory.setRouter(...)   [blocked on V-06, V-09]");
        console2.log("  2. governance registers and enables xStocks  [blocked on V-02, V-03, V-05]");
        console2.log("  3. attestors registered on the reward vault  [blocked on C-08]");
        console2.log("");
        console2.log("A launch attempted before step 1 produces a market that cannot graduate.");
    }
}
