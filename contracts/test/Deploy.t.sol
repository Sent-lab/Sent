// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Deploy} from "../script/Deploy.s.sol";
import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";

/// @dev Exposes the script's internal guards. They are the only part of a deploy
///      script worth testing — the deployment itself is covered everywhere else,
///      but the guards only ever run once, on the day it matters most.
contract DeployHarness is Deploy {
    function checkConfig(Deploy.Config memory config) external view {
        _assertSafeForChain(config);
    }
}

/// @dev Stands in for a Safe: any contract satisfies the code-length check, which
///      is exactly the guard's stated scope. It rules out a hot EOA holding
///      mainnet governance; it does not claim to prove the address is a Safe.
contract NotASafe {
    uint256 public x;
}

contract DeployTest is Test {
    DeployHarness internal harness;

    address internal constant EOA_GOVERNANCE = address(0xA11CE);
    address internal constant EOA_TREASURY = address(0xB0B);

    uint256 internal constant HYPEREVM = 999;
    uint256 internal constant SOME_TESTNET = 31337;

    function setUp() public {
        harness = new DeployHarness();
    }

    function _config(address governance, address treasury) internal pure returns (Deploy.Config memory) {
        return Deploy.Config({governance: governance, treasury: treasury, launchFee: 0});
    }

    // -----------------------------------------------------------------------
    // Zero addresses, on any chain
    // -----------------------------------------------------------------------

    function test_RejectsZeroGovernance() public {
        vm.expectRevert(bytes("Deploy: governance is zero"));
        harness.checkConfig(_config(address(0), EOA_TREASURY));
    }

    function test_RejectsZeroTreasury() public {
        vm.expectRevert(bytes("Deploy: treasury is zero"));
        harness.checkConfig(_config(EOA_GOVERNANCE, address(0)));
    }

    // -----------------------------------------------------------------------
    // Mainnet-only guards
    // -----------------------------------------------------------------------

    function test_MainnetRejectsEoaGovernance() public {
        vm.chainId(HYPEREVM);

        // Deployed BEFORE the cheatcode. `expectRevert` arms the very next call,
        // and `new` is a call - inlining it into the argument list would consume
        // the expectation and the test would pass without ever reaching the guard.
        address safe = address(new NotASafe());

        vm.expectRevert(bytes("Deploy: mainnet governance must be a contract (C-08)"));
        harness.checkConfig(_config(EOA_GOVERNANCE, safe));
    }

    function test_MainnetRejectsEoaTreasury() public {
        vm.chainId(HYPEREVM);

        address safe = address(new NotASafe());

        vm.expectRevert(bytes("Deploy: mainnet treasury must be a contract (C-08)"));
        harness.checkConfig(_config(safe, EOA_TREASURY));
    }

    /// @dev Governance and treasury being one address collapses protocol
    ///      authority and fee withdrawal into one signer set. Legal, almost
    ///      always a paste error.
    function test_MainnetRejectsSharedGovernanceAndTreasury() public {
        vm.chainId(HYPEREVM);

        address shared = address(new NotASafe());

        // Same reason as above: constructed first, then the expectation.
        vm.expectRevert(bytes("Deploy: governance and treasury must differ"));
        harness.checkConfig(_config(shared, shared));
    }

    function test_MainnetAcceptsTwoContracts() public {
        vm.chainId(HYPEREVM);

        // No revert expected. Explicit rather than implied, so a guard that
        // starts rejecting everything fails here instead of silently blocking
        // the deploy on the day it runs.
        harness.checkConfig(_config(address(new NotASafe()), address(new NotASafe())));
    }

    // -----------------------------------------------------------------------
    // The guards are chain-gated on purpose
    // -----------------------------------------------------------------------

    /// @dev A fork or an integration run legitimately holds governance on an EOA.
    ///      A guard that blocked that would be commented out within a week, which
    ///      is strictly worse than a guard that applies where it matters.
    function test_NonMainnetAllowsEoas() public {
        vm.chainId(SOME_TESTNET);
        harness.checkConfig(_config(EOA_GOVERNANCE, EOA_TREASURY));
    }

    function test_NonMainnetAllowsSharedAddress() public {
        vm.chainId(SOME_TESTNET);
        harness.checkConfig(_config(EOA_GOVERNANCE, EOA_GOVERNANCE));
    }

    // -----------------------------------------------------------------------
    // What the deployment actually produces
    // -----------------------------------------------------------------------

    /// @dev The vaults must be the ones the factory built. Deploying a second
    ///      pair alongside would leave two vaults where only one is wired, and
    ///      fees would accrue into an address nothing ever reads.
    function test_FactoryOwnsItsVaults() public {
        address governance = address(new NotASafe());
        address treasury = address(new NotASafe());

        XStockRegistry registry = new XStockRegistry(governance, address(0));
        LaunchpadFactory factory = new LaunchpadFactory(governance, treasury, address(registry), 0);

        assertTrue(address(factory.FEE_VAULT()) != address(0), "fee vault not created");
        assertTrue(address(factory.REWARD_VAULT()) != address(0), "reward vault not created");
        assertTrue(
            address(factory.FEE_VAULT()) != address(factory.REWARD_VAULT()),
            "vaults must be distinct contracts"
        );

        assertEq(factory.FEE_VAULT().FACTORY(), address(factory), "fee vault points elsewhere");
        assertEq(factory.REWARD_VAULT().FACTORY(), address(factory), "reward vault points elsewhere");
    }

    /// @dev The script leaves the router unset, and a market cannot graduate
    ///      without one. This pins that the freshly deployed state is the
    ///      not-yet-usable state the deployment log says it is.
    function test_RouterStartsUnset() public {
        address governance = address(new NotASafe());
        address treasury = address(new NotASafe());

        XStockRegistry registry = new XStockRegistry(governance, address(0));
        LaunchpadFactory factory = new LaunchpadFactory(governance, treasury, address(registry), 0);

        assertEq(factory.router(), address(0), "router must start unset");
    }
}
