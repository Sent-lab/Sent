// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";

import {XStockRegistry} from "../src/XStockRegistry.sol";
import {WrappedXStockFactory} from "../src/WrappedXStockFactory.sol";
import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {ReferencePriceAdapter} from "../src/ReferencePriceAdapter.sol";

/**
 * @notice What each deployment transaction costs, against HyperEVM's block lanes.
 *
 *     forge script script/GasProbe.s.sol:GasProbe
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST
 * -----------------------------------
 * It was written as a test first, and the test lied. `forge test` reported 3,228
 * gas for deploying a 22KB contract — the code-deposit cost (200 gas per byte of
 * runtime code, ~4.5M here) is not metered in the test VM, so every number came
 * back three orders of magnitude too small and the assertions passed on nonsense.
 *
 * `forge script` meters it the way a node does. The distinction matters enough to
 * record: a gas measurement taken in `forge test` is not a gas measurement.
 *
 * WHAT IT FOUND (Day 8)
 * ---------------------
 *     WrappedXStockFactory      1,552,649    fits the default lane
 *     XStockRegistry            1,385,236    fits the default lane
 *     LaunchpadFactory (+2)     7,360,893    2.45x the default lane
 *     ReferencePriceAdapter       691,533    fits the default lane
 *                               ----------
 *     total                    11,023,962
 *
 * HyperEVM's default block lane caps at 3,000,000 gas (V-20). So **the deployer
 * account needs the large block lane**, for the same reason the keeper does — and
 * that is an opt-in the deployer must have BEFORE it starts, because the failure
 * is a transaction that never mines rather than one that reverts.
 *
 * `LaunchpadFactory` is the whole reason: its constructor also deploys `FeeVault`
 * and `HolderRewardVault`, so one transaction pays for three contracts.
 *
 * Kept in the repository rather than run once and quoted, because these numbers
 * move whenever the contracts do, and the runbook's large-lane instruction is
 * only correct while `LaunchpadFactory` is over the ceiling.
 */
contract GasProbe is Script {
    uint256 constant DEFAULT_LANE = 3_000_000;

    function run() external {
        address gov = address(0xA11CE);
        address tre = address(0xB0B);

        uint256 g;
        uint256 total;

        g = gasleft();
        WrappedXStockFactory wrappers = new WrappedXStockFactory();
        total += _report("WrappedXStockFactory  ", g - gasleft());

        g = gasleft();
        XStockRegistry registry = new XStockRegistry(gov, address(wrappers));
        total += _report("XStockRegistry        ", g - gasleft());

        g = gasleft();
        new LaunchpadFactory(gov, tre, address(registry), 0);
        total += _report("LaunchpadFactory (+2) ", g - gasleft());

        g = gasleft();
        new ReferencePriceAdapter(gov);
        total += _report("ReferencePriceAdapter ", g - gasleft());

        console2.log("-------------------------------------------");
        console2.log("total                 ", total);
        console2.log("default lane ceiling  ", DEFAULT_LANE);
    }

    function _report(string memory name, uint256 used) internal pure returns (uint256) {
        if (used > DEFAULT_LANE) {
            console2.log(string.concat(name, "  NEEDS LARGE LANE"), used);
        } else {
            console2.log(name, used);
        }
        return used;
    }
}
