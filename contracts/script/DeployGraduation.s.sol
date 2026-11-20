// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {GraduationRouter} from "../src/GraduationRouter.sol";
import {PermanentLiquidityLock} from "../src/PermanentLiquidityLock.sol";
import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";

interface IFactoryBound {
    function factory() external view returns (address);
}

/// @title Deploy SENT's graduation lock and router after the core deployment.
/// @notice Deploys the immutable lock/router pair and prints the Safe call needed
///         to connect the router to the existing LaunchpadFactory.
/// @dev This script never submits the governance call. Review the printed
///      addresses and calldata, then propose `setRouter(router)` through the
///      governance Safe. Requires the deployer to be opted into HyperEVM's large
///      block lane and funded for deployment gas.
contract DeployGraduation is Script {
    uint256 internal constant HYPEREVM_CHAIN_ID = 999;
    uint24 internal constant FEE_TIER = 10_000;

    address internal constant V3_FACTORY = 0xB1c0fa0B789320044A6F623cFe5eBda9562602E3;
    address internal constant POSITION_MANAGER = 0x6eDA206207c09e5428F281761DdC0D300851fBC8;
    address internal constant SWAP_ROUTER = 0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D;

    function run() external returns (PermanentLiquidityLock lock, GraduationRouter router) {
        require(block.chainid == HYPEREVM_CHAIN_ID, "DeployGraduation: wrong chain");

        address launchpad = vm.envAddress("LAUNCHPAD_FACTORY");
        require(launchpad.code.length > 0, "DeployGraduation: factory has no code");
        require(ILaunchpadRouter(launchpad).router() == address(0), "DeployGraduation: router already set");
        require(V3_FACTORY.code.length > 0, "DeployGraduation: V3 factory has no code");
        require(POSITION_MANAGER.code.length > 0, "DeployGraduation: position manager has no code");
        require(SWAP_ROUTER.code.length > 0, "DeployGraduation: swap router has no code");
        require(IFactoryBound(POSITION_MANAGER).factory() == V3_FACTORY, "DeployGraduation: NPM factory mismatch");
        require(IFactoryBound(SWAP_ROUTER).factory() == V3_FACTORY, "DeployGraduation: router factory mismatch");
        require(IUniswapV3Factory(V3_FACTORY).feeAmountTickSpacing(FEE_TIER) == 200, "DeployGraduation: fee tier mismatch");

        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        uint256 nonce = vm.getNonce(deployer);
        address predictedRouter = vm.computeCreateAddress(deployer, nonce + 1);

        vm.startBroadcast(deployerKey);
        lock = new PermanentLiquidityLock(POSITION_MANAGER, predictedRouter);
        router = new GraduationRouter(
            launchpad,
            V3_FACTORY,
            POSITION_MANAGER,
            SWAP_ROUTER,
            address(lock)
        );
        vm.stopBroadcast();

        require(address(router) == predictedRouter, "DeployGraduation: CREATE prediction mismatch");

        LaunchpadFactory factory = LaunchpadFactory(payable(launchpad));
        bytes memory safeCall = abi.encodeCall(factory.setRouter, (address(router)));

        console2.log("chain id             ", block.chainid);
        console2.log("launchpad factory    ", launchpad);
        console2.log("position manager     ", POSITION_MANAGER);
        console2.log("SENT permanent lock  ", address(lock));
        console2.log("SENT graduation router", address(router));
        console2.log("governance Safe      ", factory.governance());
        console2.log("Safe call: factory.setRouter(router)");
        console2.logBytes(safeCall);
    }

    function _deployerKey() internal view returns (uint256) {
        string memory raw = vm.envString("DEPLOYER_PRIVATE_KEY");
        bytes memory b = bytes(raw);

        require(b.length == 64 || b.length == 66, "DeployGraduation: key must be 64 hex chars, 0x optional");
        if (b.length == 66) {
            require(b[0] == "0" && (b[1] == "x" || b[1] == "X"), "DeployGraduation: invalid 0x prefix");
            return vm.parseUint(raw);
        }
        return vm.parseUint(string.concat("0x", raw));
    }
}

interface ILaunchpadRouter {
    function router() external view returns (address);
}
