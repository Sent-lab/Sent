// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";
import {WrappedXStockFactory} from "../src/WrappedXStockFactory.sol";
import {ReferencePriceAdapter} from "../src/ReferencePriceAdapter.sol";
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

    function run()
        external
        returns (
            XStockRegistry registry,
            LaunchpadFactory factory,
            ReferencePriceAdapter referencePrice,
            WrappedXStockFactory wrappers
        )
    {
        Config memory config = _loadConfig();

        _assertSafeForChain(config);

        uint256 deployerKey = _deployerKey();

        vm.startBroadcast(deployerKey);

        /*
         * The wrapper factory goes first, because the registry binds to it
         * immutably.
         *
         * Deployed unconditionally and with no configuration, which is safe for
         * the same reason the registry can trust it: it takes no constructor
         * arguments, holds nothing, has no owner and no keys, and its only job
         * is to deploy one fixed bytecode at a derivable address. There is
         * nothing here to get wrong later and nothing to point at the wrong
         * thing.
         *
         * It creates no wrappers by itself. Which assets get wrapped is a §420
         * decision, taken afterwards, by governance.
         */
        wrappers = new WrappedXStockFactory();

        registry = new XStockRegistry(config.governance, address(wrappers));
        factory = new LaunchpadFactory(config.governance, config.treasury, address(registry), config.launchFee);

        /*
         * Deployed, and deliberately NOT wired to the factory.
         *
         * The adapter is useless until governance points an asset at a feed, and
         * which feed is V-11 — still unverified (§253). Calling
         * `setReferencePrice` here would produce a factory that passes its own
         * "is it set" check while every launch reverts inside the adapter with
         * `NoSource`, which is a worse failure than the honest one: a launch
         * blocked by `ReferencePriceNotSet` says what is missing.
         */
        referencePrice = new ReferencePriceAdapter(config.governance);

        /*
         * The graduation router is NOT deployed here, and that is deliberate.
         *
         * It is written and tested — `GraduationRouter`, `PermanentLiquidityLock`
         * and `V3Math` — but its constructor takes three HyperSwap addresses
         * that V-06 has not confirmed, and ALL THREE are immutable once
         * deployed — as is the position manager inside the lock. Guessing them
         * produces a router that looks configured and mints a market's entire
         * liquidity into a contract nobody verified, and correcting it later
         * means redeploying both while the old lock still holds a real position
         * that nothing can move.
         *
         * §279 forbids a placeholder standing in for an unverified dependency,
         * and a factory with no router already refuses to launch anything —
         * which is the honest failure and the one an operator can act on.
         *
         * Deployment order, once V-06 and V-09 close:
         *
         *   1. PermanentLiquidityLock(positionManager, <predicted router>)
         *   2. GraduationRouter(factory, v3Factory, positionManager, swapRouter, lock)
         *   3. governance calls factory.setRouter(router)
         *
         * The lock names the router and the router names the lock, so one
         * address is predicted rather than set afterwards — a setter there
         * would be exactly the admin path §413 forbids.
         */

        vm.stopBroadcast();

        _report(config, registry, factory, referencePrice);
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
    /**
     * @dev The deployer key, with or without a `0x` prefix.
     *
     *      `vm.envUint` requires the prefix and fails with "missing hex prefix"
     *      when it is absent. That is a correct error and a useless one: every
     *      wallet this key comes out of exports it WITHOUT the prefix. MetaMask
     *      does, and it is the obvious place an operator gets it from.
     *
     *      So the first attempt at a mainnet deploy fails on a formatting detail
     *      that has nothing to do with the deployment, after the operator has
     *      already typed a private key into a terminal — which is exactly the
     *      moment to not make someone retry blind.
     *
     *      Read as a string and normalised instead. The key itself is never
     *      logged; only its shape is checked.
     */
    function _deployerKey() internal view returns (uint256) {
        string memory raw = vm.envString("DEPLOYER_PRIVATE_KEY");
        bytes memory b = bytes(raw);

        require(b.length == 64 || b.length == 66, "Deploy: DEPLOYER_PRIVATE_KEY must be 64 hex chars, 0x optional");

        if (b.length == 66) {
            require(b[0] == "0" && (b[1] == "x" || b[1] == "X"), "Deploy: 66-char key must start with 0x");
            return vm.parseUint(raw);
        }

        return vm.parseUint(string.concat("0x", raw));
    }

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

        _assertGovernanceQuorum(config.governance);
    }

    /**
     * @dev Refuse a governance Safe that one key can control, or one key can
     *      freeze.
     *
     *      The check above only proves governance is a CONTRACT, and says so. A
     *      1-of-1 Safe passes it, and a 1-of-1 Safe is the specific arrangement
     *      that makes both of the following true at once:
     *
     *      LOST  — every parameter in the protocol becomes unreachable. Assets
     *              cannot be registered, the graduation router cannot be wired,
     *              no price feed can be configured. The contracts point at that
     *              address permanently; there is no recovery path and no
     *              redeployment that keeps the same markets.
     *
     *      STOLEN — governance can reach user money. `addAttestor` and
     *              `setQuorum` on `HolderRewardVault` are both `onlyGovernance`,
     *              so a holder of that key can make itself the only attestor,
     *              sign any Merkle root, wait out `ACTIVATION_DELAY`, and claim
     *              the vault. The Guardian's cancel is the brake — and
     *              `setGuardian` is `onlyGovernance` too, so the same key
     *              removes it first.
     *
     *      Hence BOTH conditions, not one:
     *
     *        threshold >= 2      one stolen key is not enough
     *        owners > threshold  one lost key does not freeze the protocol
     *
     *      2-of-2 satisfies the first and fails the second, which is why it is
     *      rejected rather than treated as "good enough". 2-of-3 is the smallest
     *      arrangement that survives either failure.
     *
     *      §601 asks for more than this — Governance, Treasury, Founder and
     *      Guardian must not all share an identical quorum — and §602 asks for
     *      independent failure domains, which no on-chain check can see. Three
     *      keys on one laptop pass this and are not separation. This is a floor,
     *      not a substitute for the ceremony.
     */
    function _assertGovernanceQuorum(address governance) internal view {
        (bool okThreshold, bytes memory thresholdData) =
            governance.staticcall(abi.encodeWithSignature("getThreshold()"));
        (bool okOwners, bytes memory ownersData) =
            governance.staticcall(abi.encodeWithSignature("getOwners()"));

        /*
         * A governance contract whose authority structure cannot be read is
         * refused rather than waved through.
         *
         * §557 names a Safe specifically, and this address controls every
         * parameter in the protocol. "It is a contract and we could not tell
         * what it does" is not a standard to deploy mainnet against — and a
         * deliberate change to something else (a timelock, a DAO) should be a
         * deliberate change to this script, made by someone who read this.
         */
        require(okThreshold && thresholdData.length >= 32, "Deploy: governance is not a Safe (C-08)");
        require(okOwners && ownersData.length >= 64, "Deploy: governance is not a Safe (C-08)");

        uint256 threshold = abi.decode(thresholdData, (uint256));
        address[] memory owners = abi.decode(ownersData, (address[]));

        require(threshold >= 2, "Deploy: governance threshold must be at least 2 (C-08, S601)");
        require(
            owners.length > threshold,
            "Deploy: governance needs more owners than its threshold (C-08, S601)"
        );
    }

    /// @dev Prints what was deployed AND what is still missing.
    ///
    ///      The second half matters more. A deployment log that lists addresses
    ///      and stops reads as "done", and the two steps this script deliberately
    ///      does not perform are both required before a single token can trade.
    function _report(
        Config memory config,
        XStockRegistry registry,
        LaunchpadFactory factory,
        ReferencePriceAdapter referencePrice
    ) internal view {
        FeeVault feeVault = factory.FEE_VAULT();
        HolderRewardVault rewardVault = factory.REWARD_VAULT();

        console2.log("chain id          ", block.chainid);
        console2.log("registry          ", address(registry));
        console2.log("factory           ", address(factory));
        console2.log("fee vault         ", address(feeVault));
        console2.log("reward vault      ", address(rewardVault));
        console2.log("reference price   ", address(referencePrice));
        console2.log("governance        ", config.governance);
        console2.log("treasury          ", config.treasury);
        console2.log("launch fee        ", config.launchFee);

        console2.log("");
        console2.log("NOT DONE - required before any launch:");
        console2.log("  1. deploy the lock + router, then factory.setRouter(...)");
        console2.log("     the router is written and tested; its HyperSwap");
        console2.log("     addresses are  [blocked on V-06, V-09]");
        console2.log("  2. governance registers and enables xStocks  [blocked on V-02, V-03, V-05]");
        console2.log("  3. governance configures a price feed per asset on the adapter,");
        console2.log("     then calls factory.setReferencePrice(...)  [blocked on V-11]");
        console2.log("  4. attestors registered on the reward vault  [blocked on C-08]");
        console2.log("");
        console2.log("A launch is refused outright until 1 and 3 are done. Step 3 is the");
        console2.log("launch anchor: without it p0 has no source, and p0 is immutable for");
        console2.log("the life of every market it prices.");
    }
}
