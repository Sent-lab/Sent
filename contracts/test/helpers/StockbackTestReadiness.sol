// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {HolderRewardVault} from "../../src/HolderRewardVault.sol";

/// @dev Production launches must not bypass the reward-vault readiness gate.
///      Launch fixtures configure a small, explicitly test-only signer set so
///      they exercise the same gate as production instead of weakening it.
library StockbackTestReadiness {
    address internal constant GUARDIAN = address(0xA11CE);
    address internal constant ATTESTOR_ONE = address(0xA77001);
    address internal constant ATTESTOR_TWO = address(0xA77002);

    function configure(Vm vm, HolderRewardVault vault, address governance) internal {
        vm.startPrank(governance);
        vault.setGuardian(GUARDIAN);
        vault.addAttestor(ATTESTOR_ONE);
        vault.addAttestor(ATTESTOR_TWO);
        vault.setQuorum(2);
        vm.stopPrank();
    }
}
