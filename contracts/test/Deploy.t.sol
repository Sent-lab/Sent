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

/// @dev A contract that is not a Safe. Passes the code-length check and fails
///      the quorum check, which is the whole point of having both.
contract NotASafe {
    uint256 public x;
}

/// @dev A Safe, as far as the deploy guard can tell: it answers `getThreshold`
///      and `getOwners`, which is what the guard reads.
contract FakeSafe {
    uint256 private _threshold;
    address[] private _owners;

    constructor(uint256 threshold_, uint256 ownerCount) {
        _threshold = threshold_;
        for (uint256 i = 0; i < ownerCount; i++) {
            _owners.push(address(uint160(uint256(keccak256(abi.encode(address(this), i))))));
        }
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }
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

    // -----------------------------------------------------------------------
    // The quorum guard (C-08, §601)
    // -----------------------------------------------------------------------

    /**
     * @dev A 1-of-1 governance Safe is refused, and this is the test that
     *      matters most in this file.
     *
     *      It is the arrangement where BOTH failure modes are live at once:
     *      lose the key and every protocol parameter becomes unreachable
     *      forever; leak it and the holder can make itself the only Stockback
     *      attestor, sign any root, and drain the reward vault after
     *      ACTIVATION_DELAY — removing the Guardian's brake first, because
     *      setGuardian is onlyGovernance too.
     *
     *      It also passes every other guard in this script, which is why it
     *      needs its own.
     */
    function test_MainnetRejectsOneOfOneGovernance() public {
        address governance = address(new FakeSafe(1, 1));
        address treasury = address(new FakeSafe(2, 3));

        vm.chainId(HYPEREVM);
        vm.expectRevert(bytes("Deploy: governance threshold must be at least 2 (C-08, S601)"));
        harness.checkConfig(_config(governance, treasury));
    }

    /// @dev And 2-of-2 is refused too, which is the less obvious half.
    ///
    ///      It survives one stolen key and not one LOST key: with no spare
    ///      owner, a single unreachable signer freezes the protocol permanently.
    ///      Treating it as "good enough" would trade one unrecoverable failure
    ///      for another.
    function test_MainnetRejectsTwoOfTwoGovernance() public {
        address governance = address(new FakeSafe(2, 2));
        address treasury = address(new FakeSafe(2, 3));

        vm.chainId(HYPEREVM);
        vm.expectRevert(bytes("Deploy: governance needs more owners than its threshold (C-08, S601)"));
        harness.checkConfig(_config(governance, treasury));
    }

    /// @dev 2-of-3 is the smallest arrangement that survives either failure.
    function test_MainnetAcceptsTwoOfThreeGovernance() public {
        address governance = address(new FakeSafe(2, 3));
        address treasury = address(new FakeSafe(2, 3));

        vm.chainId(HYPEREVM);
        harness.checkConfig(_config(governance, treasury));
    }

    /// @dev A contract whose authority structure cannot be read is refused
    ///      rather than waved through. This address controls every parameter in
    ///      the protocol; "it is a contract and we could not tell what it does"
    ///      is not a standard to deploy mainnet against.
    function test_MainnetRejectsAContractThatIsNotASafe() public {
        address governance = address(new NotASafe());
        address treasury = address(new FakeSafe(2, 3));

        vm.chainId(HYPEREVM);
        vm.expectRevert(bytes("Deploy: governance is not a Safe (C-08)"));
        harness.checkConfig(_config(governance, treasury));
    }

    /// @dev The quorum guard is mainnet-only, like the others. A local chain
    ///      must stay usable without a ceremony.
    function test_NonMainnetAllowsAOneOfOneSafe() public {
        address governance = address(new FakeSafe(1, 1));

        vm.chainId(SOME_TESTNET);
        harness.checkConfig(_config(governance, EOA_TREASURY));
    }

    /// @dev Treasury may be any contract; governance may not.
    ///
    ///      The asymmetry is deliberate and worth pinning. Treasury receives
    ///      money and controls nothing, so a multisig, a splitter or a vault all
    ///      make sense there. Governance controls every parameter in the
    ///      protocol and has a path to the reward vault, so its authority
    ///      structure has to be legible before deployment.
    ///
    ///      This test asserted that ANY two contracts were accepted until the
    ///      quorum guard landed. That premise is gone rather than weakened, and
    ///      it is rewritten rather than deleted so the narrowing is visible.
    function test_MainnetAcceptsAnyTreasuryContractButNotAnyGovernance() public {
        vm.chainId(HYPEREVM);

        // No revert expected. Explicit rather than implied, so a guard that
        // starts rejecting everything fails here instead of silently blocking
        // the deploy on the day it runs.
        harness.checkConfig(_config(address(new FakeSafe(2, 3)), address(new NotASafe())));
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
