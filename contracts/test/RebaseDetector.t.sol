// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {XStockRegistry} from "../src/XStockRegistry.sol";
import {RebaseDetector} from "../src/lib/RebaseDetector.sol";

/**
 * @dev A quote asset whose balances move without a transfer.
 *
 * Modelled on the real thing rather than invented. Backed Finance's
 * "Backed Token Implementation" — the contract behind `SP500 xStock` (SPYx) at
 * 0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48 on HyperEVM — exposes `multiplier()`
 * and `sharesOf(address)`, and computes a balance as shares times the multiplier.
 * Its multiplier read 1.0057145603 when this was written, so it had already
 * rebased at least once.
 *
 * The point of copying the shape is that a mock invented from the description
 * would test the description.
 */
contract RebasingXStock is ERC20 {
    uint256 public multiplier = 1e18;
    mapping(address => uint256) private _shares;
    uint256 private _totalShares;

    constructor() ERC20("SP500 xStock", "SPYx") {}

    function sharesOf(address account) external view returns (uint256) {
        return _shares[account];
    }

    function mintShares(address to, uint256 shares) external {
        _shares[to] += shares;
        _totalShares += shares;
    }

    /// @dev A reverse split. Every holder's balance falls, no transfer occurs,
    ///      and no ERC-20 event is emitted — which is exactly the problem.
    function setMultiplier(uint256 m) external {
        multiplier = m;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return (_shares[account] * multiplier) / 1e18;
    }

    function totalSupply() public view override returns (uint256) {
        return (_totalShares * multiplier) / 1e18;
    }
}

/// @dev Lido's shape, the other widespread rebasing design.
contract PooledRebasingToken is ERC20 {
    constructor() ERC20("Staked Thing", "stTHING") {}

    function getPooledEthByShares(uint256 shares) external pure returns (uint256) {
        return shares;
    }
}

/// @dev An ordinary xStock-shaped ERC-20 with no rebase surface.
contract PlainQuoteToken is ERC20 {
    constructor() ERC20("Plain xStock", "PLAINx") {}
}

/**
 * @dev A token whose fallback answers everything.
 *
 * The detector will refuse it. That is a false positive and it is the correct
 * direction to fail: the cost is not listing an asset, versus a market that
 * silently cannot pay its sellers.
 */
contract AnsweringFallbackToken {
    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(uint256(1));
    }
}

contract RebaseDetectorTest is Test {
    XStockRegistry registry;
    address governance = makeAddr("governanceSafe");

    RebasingXStock rebasing;
    PlainQuoteToken plain;

    function setUp() public {
        registry = new XStockRegistry(governance, address(0));
        rebasing = new RebasingXStock();
        plain = new PlainQuoteToken();
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
    // Detection
    // -----------------------------------------------------------------------

    function test_theBackedRebaseShapeIsDetected() public view {
        assertTrue(RebaseDetector.isRebasing(address(rebasing)), "multiplier() + sharesOf()");
    }

    function test_theLidoShapeIsDetected() public {
        PooledRebasingToken pooled = new PooledRebasingToken();
        assertTrue(RebaseDetector.isRebasing(address(pooled)), "getPooledEthByShares()");
    }

    function test_anOrdinaryTokenIsNotFlagged() public view {
        assertFalse(RebaseDetector.isRebasing(address(plain)), "a plain ERC-20 must pass");
    }

    /// @dev The refusal has to distinguish these two, because they are the same
    ///      decision and a very different conversation.
    function test_theRefusalSaysWhetherItHasAlreadyRebased() public {
        (bool moved, uint256 value) = RebaseDetector.multiplierHasMoved(address(rebasing));
        assertFalse(moved, "starts at parity");
        assertEq(value, 1e18);

        // The real SPYx read 1.0057145603 when this was written.
        rebasing.setMultiplier(1_005_714_560_286_254_000);

        (moved, value) = RebaseDetector.multiplierHasMoved(address(rebasing));
        assertTrue(moved, "a rebase that has happened");
        assertEq(value, 1_005_714_560_286_254_000);
    }

    /// @dev A false positive is the direction this is allowed to fail in.
    function test_anAnsweringFallbackIsRefusedRatherThanTrusted() public {
        AnsweringFallbackToken odd = new AnsweringFallbackToken();
        assertTrue(RebaseDetector.isRebasing(address(odd)), "refuse what cannot be ruled out");
    }

    // -----------------------------------------------------------------------
    // The registry acts on it
    // -----------------------------------------------------------------------

    function test_aRebasingAssetCannotBeRegisteredAtAll() public {
        vm.prank(governance);
        vm.expectRevert(
            abi.encodeWithSelector(XStockRegistry.AssetRebases.selector, address(rebasing), 1e18)
        );
        registry.registerAsset(address(rebasing), 18, 1385, 0);
    }

    /// @dev THE ONE THAT MATTERS.
    ///
    ///      §420's `multiplierBehaviour` gate is a boolean governance attests to,
    ///      and a boolean is only as good as whoever ticks it. The failure here is
    ///      silent, delayed by however long it takes a company to declare a split,
    ///      and unrecoverable once markets are live against the asset.
    ///
    ///      So a fully-attested asset with every gate green must still be refused.
    function test_everyGateGreenDoesNotOverrideIt() public {
        vm.startPrank(governance);

        vm.expectRevert(
            abi.encodeWithSelector(XStockRegistry.AssetRebases.selector, address(rebasing), 1e18)
        );
        registry.registerAsset(address(rebasing), 18, 1385, 0);

        vm.stopPrank();

        // And it never became launchable by any route.
        assertFalse(registry.isLaunchable(address(rebasing)));
        assertEq(registry.registeredCount(), 0);
    }

    /**
     * @dev The second check, and why it is not redundant.
     *
     *      These assets are upgradeable proxies — SPYx's implementation sits
     *      behind an EIP-1967 proxy whose admin can replace it. An asset that did
     *      not rebase when it was registered can rebase by the time it is
     *      enabled, and enabling is the moment markets become possible.
     *
     *      Simulated by registering a plain token and then giving that same
     *      address rebasing code, which is what an upgrade looks like from here.
     */
    function test_anAssetThatBecomesRebasingCannotBeEnabled() public {
        vm.startPrank(governance);
        registry.registerAsset(address(plain), 18, 1385, 0);
        registry.setGates(address(plain), _allGates());
        vm.stopPrank();

        // It was fine at registration.
        assertFalse(RebaseDetector.isRebasing(address(plain)));

        // The proxy is upgraded under it. `vm.etch` replaces code and keeps
        // storage, which is exactly what an upgrade does — so the multiplier slot
        // holds whatever the old implementation left there rather than 1e18. It
        // reads 0 here, and a multiplier of zero would make every balance zero.
        // The detector refuses on the interface's presence, not on its value,
        // which is why that does not matter.
        RebasingXStock upgraded = new RebasingXStock();
        vm.etch(address(plain), address(upgraded).code);

        vm.prank(governance);
        vm.expectRevert(
            abi.encodeWithSelector(XStockRegistry.AssetRebases.selector, address(plain), 0)
        );
        registry.enableAsset(address(plain));

        assertFalse(registry.isLaunchable(address(plain)), "and it is still not launchable");
    }

    function test_aPlainAssetStillGoesAllTheWayThrough() public {
        vm.startPrank(governance);
        registry.registerAsset(address(plain), 18, 1385, 0);
        registry.setGates(address(plain), _allGates());
        registry.enableAsset(address(plain));
        vm.stopPrank();

        assertTrue(registry.isLaunchable(address(plain)), "the check must not block a good asset");
    }
}
