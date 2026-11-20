// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {ChainlinkTokenizedAssetAggregatorShim} from "../src/ChainlinkTokenizedAssetAggregatorShim.sol";
import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {ReferencePriceAdapter} from "../src/ReferencePriceAdapter.sol";

interface IXStockRegistryForSource {
    function WRAPPER_FACTORY() external view returns (address);
    function underlyingOf(address asset) external view returns (address);
}

interface IWrappedXStockForSource {
    function UNDERLYING() external view returns (address);
}

interface IWrappedXStockFactoryForSource {
    function wrapperOf(address underlying) external view returns (address);
}

/// @title Deploy a quote-asset-bound SPYx or NVDAx v10 price source.
/// @notice Deploys only the immutable report shim. It prints governance calldata to
///         configure the source and, when needed, connect the existing adapter
///         to the existing LaunchpadFactory. It never executes either call.
/// @dev Bounds, asset, adapter and factory are explicit operator inputs. There
///      are no guessed price bands or staleness defaults in a mainnet script.
contract DeployXStockPriceSource is Script {
    uint256 internal constant HYPEREVM_CHAIN_ID = 999;
    address internal constant VERIFIER_PROXY = 0x60fAa7faC949aF392DFc858F5d97E3EEfa07E9EB;
    address internal constant SPYX_RAW_ASSET = 0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48;
    bytes32 internal constant SPYX_V10_FEED_ID =
        0x000ac6ba1b453a15c1fe9dcd82265ca47bcd04e7b3667de1623617c45cef2a77;
    address internal constant NVDAX_RAW_ASSET = 0xc845b2894dBddd03858fd2D643B4eF725fE0849d;
    bytes32 internal constant NVDAX_V10_FEED_ID =
        0x000a37a55df2ef907d8fa06af6632bc16da58a62b68be2e1994efaa037a0918a;

    function run() external returns (ChainlinkTokenizedAssetAggregatorShim shim) {
        require(block.chainid == HYPEREVM_CHAIN_ID, "DeployXStockPriceSource: wrong chain");

        address launchpadAddress = vm.envAddress("LAUNCHPAD_FACTORY");
        address adapterAddress = vm.envAddress("REFERENCE_PRICE_ADAPTER");
        address priceAsset = vm.envAddress("PRICE_ASSET");
        uint256 maxAgeInput = vm.envUint("PRICE_MAX_AGE_SECONDS");
        uint256 minPriceInput = vm.envUint("PRICE_MIN_USD_WAD");
        uint256 maxPriceInput = vm.envUint("PRICE_MAX_USD_WAD");

        require(launchpadAddress.code.length > 0, "DeployXStockPriceSource: factory has no code");
        require(adapterAddress.code.length > 0, "DeployXStockPriceSource: adapter has no code");
        require(priceAsset.code.length > 0, "DeployXStockPriceSource: quote asset has no code");
        require(VERIFIER_PROXY.code.length > 0, "DeployXStockPriceSource: verifier has no code");
        require(maxAgeInput > 0 && maxAgeInput <= type(uint32).max, "DeployXStockPriceSource: invalid max age");
        require(minPriceInput > 0 && minPriceInput <= type(uint128).max, "DeployXStockPriceSource: invalid minimum");
        require(maxPriceInput >= minPriceInput && maxPriceInput <= type(uint128).max, "DeployXStockPriceSource: invalid maximum");

        LaunchpadFactory launchpad = LaunchpadFactory(payable(launchpadAddress));
        ReferencePriceAdapter adapter = ReferencePriceAdapter(adapterAddress);
        address governanceSafe = launchpad.governance();
        require(governanceSafe.code.length > 0, "DeployXStockPriceSource: governance has no code");
        require(adapter.governance() == governanceSafe, "DeployXStockPriceSource: governance mismatch");
        IXStockRegistryForSource registry = IXStockRegistryForSource(address(launchpad.REGISTRY()));
        address wrapperFactory = registry.WRAPPER_FACTORY();
        require(wrapperFactory.code.length > 0, "DeployXStockPriceSource: wrapper factory has no code");
        address underlying = IWrappedXStockForSource(priceAsset).UNDERLYING();
        bytes32 feedId;
        if (underlying == SPYX_RAW_ASSET) {
            feedId = SPYX_V10_FEED_ID;
        } else if (underlying == NVDAX_RAW_ASSET) {
            feedId = NVDAX_V10_FEED_ID;
        } else {
            revert("DeployXStockPriceSource: unsupported xStock underlying");
        }
        require(
            IWrappedXStockFactoryForSource(wrapperFactory).wrapperOf(underlying) == priceAsset,
            "DeployXStockPriceSource: quote asset is not SENT's canonical xStock wrapper"
        );
        require(
            registry.underlyingOf(priceAsset) == underlying,
            "DeployXStockPriceSource: canonical xStock wrapper is not registered"
        );
        require(
            launchpad.referencePrice() == address(0) || launchpad.referencePrice() == adapterAddress,
            "DeployXStockPriceSource: another adapter is already connected"
        );
        require(
            adapter.sourceOf(priceAsset).aggregator == address(0),
            "DeployXStockPriceSource: asset already has a price source"
        );

        uint32 maxAge = uint32(maxAgeInput);
        uint128 minPrice = uint128(minPriceInput);
        uint128 maxPrice = uint128(maxPriceInput);
        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        bytes32 salt = keccak256(abi.encode("SENT_XSTOCK_V10_SOURCE", priceAsset, feedId));
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(ChainlinkTokenizedAssetAggregatorShim).creationCode,
                abi.encode(priceAsset, VERIFIER_PROXY, feedId)
            )
        );
        address predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash))))
        );
        require(predicted.code.length == 0, "DeployXStockPriceSource: deterministic shim already deployed");

        vm.startBroadcast(deployerKey);
        shim = new ChainlinkTokenizedAssetAggregatorShim{salt: salt}(
            priceAsset,
            VERIFIER_PROXY,
            feedId
        );
        vm.stopBroadcast();

        require(address(shim) == predicted, "DeployXStockPriceSource: CREATE2 address mismatch");

        bytes memory configureCall = abi.encodeCall(
            adapter.configure,
            (priceAsset, address(shim), maxAge, minPrice, maxPrice)
        );
        console2.log("chain id                 ", block.chainid);
        console2.log("SENT xStock wrapper      ", priceAsset);
        console2.log("Chainlink verifier       ", VERIFIER_PROXY);
        console2.log("xStock underlying        ", underlying);
        console2.log("v10 feed ID              ", vm.toString(feedId));
        console2.log("deployed bound shim      ", address(shim));
        console2.log("reference price adapter ", adapterAddress);
        console2.log("governance contract      ", governanceSafe);
        console2.log("max age seconds          ", maxAge);
        console2.log("minimum USD wad          ", minPrice);
        console2.log("maximum USD wad          ", maxPrice);
        console2.log("Governance call: adapter.configure(asset, shim, maxAge, min, max)");
        console2.logBytes(configureCall);

        if (launchpad.referencePrice() == address(0)) {
            bytes memory connectCall = abi.encodeCall(launchpad.setReferencePrice, (adapterAddress));
            console2.log("Governance call: factory.setReferencePrice(adapter)");
            console2.logBytes(connectCall);
        } else {
            console2.log("Factory already points to this adapter; no connect call needed.");
        }
    }

    function _deployerKey() internal view returns (uint256) {
        string memory raw = vm.envString("DEPLOYER_PRIVATE_KEY");
        bytes memory value = bytes(raw);
        require(value.length == 64 || value.length == 66, "DeployXStockPriceSource: invalid private key length");
        if (value.length == 66) {
            require(value[0] == "0" && (value[1] == "x" || value[1] == "X"), "DeployXStockPriceSource: invalid key prefix");
            return vm.parseUint(raw);
        }
        return vm.parseUint(string.concat("0x", raw));
    }
}
