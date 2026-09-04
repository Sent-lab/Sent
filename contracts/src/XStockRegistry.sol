// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title SENT XStockRegistry
/// @notice The allowlist of official xStock quote assets a market may pair against.
///
/// LOCKED (§2, §6, §421): the quote asset must be an official/canonical HyperEVM
/// xStock representation. Nothing else may ever become a quote asset.
///
/// §420 is the governing rule and it is deliberately strict:
///
///   "The production registry must be allowlist-based per verified HyperEVM
///    deployment. Do not infer availability from the global xStocks product
///    catalog."
///
/// WHY AN ALLOWLIST AND NOT A LINKAGE CHECK
/// ----------------------------------------
/// On Hyperliquid, a HyperCore HIP-1 token is linked to an ERC-20 on HyperEVM by
/// its spot deployer. It is tempting to treat "this ERC-20 is linked" as proof of
/// authenticity. It is not. Hyperliquid's own documentation states that there are
/// currently no checks that the system address holds sufficient supply, or that
/// the linked contract is a valid ERC-20 at all, and that integrators must verify
/// the implementation and balances themselves.
///
/// So linkage is a ROUTING fact, never a SAFETY fact. This registry therefore
/// requires every §420 gate to be attested explicitly before an asset can be used,
/// and records who attested and when.
///
/// PERMANENCE OF A MARKET'S PAIR
/// -----------------------------
/// Disabling an asset stops NEW launches only. Markets that already launched
/// against it keep trading: their pair, their curve anchor and their Stockback
/// reward asset are fixed for life (§387, §388). Governance cannot retroactively
/// change what a live market is paired against — that would rewrite user
/// positions, which §559 forbids.
import {RebaseDetector} from "./lib/RebaseDetector.sol";

/// @dev The one thing this registry asks a wrapper factory. Declared narrowly so
///      a mistake here cannot reach anything else on it.
interface IWrapperFactory {
    function wrapperOf(address underlying) external view returns (address);
}

contract XStockRegistry {
    /// @notice The eight §420 gates. An asset is usable only when ALL are true.
    /// @dev Stored as explicit named flags rather than a bitmask so that a
    ///      half-verified asset is obvious on a block explorer, not encoded.
    struct Gates {
        bool canonicalRepresentation;
        bool transferBehaviour;
        bool multiplierBehaviour;
        bool priceSource;
        bool haltSource;
        bool hyperSwapCompatible;
        bool normalizedAccountingTested;
        bool legalReviewed;
    }

    struct Asset {
        /// @dev The ERC-20 on HyperEVM. Canonical identity of the quote asset.
        address token;
        /// @dev decimals() as reported by the token. Normalisation input (§399).
        uint8 decimals;
        /// @dev HyperCore HIP-1 token index, for operational traceability only.
        ///      Never used as an authenticity check.
        uint32 coreTokenIndex;
        /// @dev Core<->EVM wei-decimal offset. Recorded because a non-divisible
        ///      transfer burns the remainder on the Core side (V-03).
        uint8 evmExtraWeiDecimals;
        /// @dev All eight §420 gates.
        Gates gates;
        /// @dev False stops NEW launches. Live markets are untouched.
        bool enabledForNewLaunches;
        /// @dev Block timestamp when the asset last passed every gate.
        uint64 verifiedAt;
        /// @dev True once registered. Distinguishes "absent" from "revoked".
        bool exists;
        /**
         * @dev The rebasing xStock this asset wraps, or zero if it wraps nothing.
         *
         *      Recorded because a listed wrapper is one step removed from the
         *      thing §420's `canonicalRepresentation` gate is actually about. An
         *      operator attesting "this is the canonical Tesla xStock" needs the
         *      registry to say which underlying that attestation was made
         *      against, and a UI showing "quoted in wTSLAx" needs to be able to
         *      show what wTSLAx is.
         */
        address wrappedUnderlying;
    }

    /// @notice Governance Safe (§557). Parameters only — it holds no funds and has
    ///         no path to user or creator assets (§559).
    address public governance;

    mapping(address token => Asset) private _assets;
    address[] private _registered;

    event AssetRegistered(address indexed token, uint32 coreTokenIndex, uint8 decimals);
    event GatesUpdated(address indexed token, Gates gates, bool allPassed);
    event AssetEnabled(address indexed token, uint64 verifiedAt);
    event AssetDisabled(address indexed token, string reason);
    event GovernanceTransferred(address indexed from, address indexed to);

    error NotGovernance();
    error ZeroAddress();
    error AlreadyRegistered();
    error UnknownAsset();
    error GatesNotAllPassed();

    /**
     * @dev The asset's balances move without a transfer (§420, V-03).
     *
     *      `currentMultiplier` is carried so the refusal says which case it is:
     *      1e18 means a rebase that has not happened yet, anything else means one
     *      already has. Same decision, very different conversation with whoever
     *      proposed the asset.
     */
    error AssetRebases(address token, uint256 currentMultiplier);
    error AlreadyEnabled();
    error NotEnabled();

    /**
     * @notice The wrapper factory whose deployments may be listed, or zero.
     *
     * @dev IMMUTABLE, and that is the whole security property.
     *
     *      A wrapper is a contract that custodies the quote asset. Asking it
     *      "what do you wrap?" and believing the answer is no check at all — a
     *      malicious wrapper returns whatever address makes it look legitimate.
     *      The only thing that cannot be faked is PROVENANCE: the factory
     *      deploys one fixed bytecode via CREATE2 and records it, so a wrapper
     *      the factory names is a wrapper whose code is known.
     *
     *      Settable-once would be an admin path to listing arbitrary custody
     *      contracts, which is the exact thing this prevents.
     */
    address public immutable WRAPPER_FACTORY;

    error NoWrapperFactory();
    error NotFromWrapperFactory(address wrapper, address expected);
    error WrapperUnderlyingMismatch(address wrapper, address claimed, address actual);

    event WrappedAssetRegistered(
        address indexed wrapper, address indexed underlying, uint32 coreTokenIndex, uint8 decimals
    );

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    /**
     * @param governance_    the governance Safe (§557).
     * @param wrapperFactory the `WrappedXStockFactory` whose deployments may be
     *                       listed. May be zero, which simply means no wrapper
     *                       can ever be registered here — a registry that lists
     *                       only directly-usable assets, refusing rather than
     *                       improvising.
     */
    constructor(address governance_, address wrapperFactory) {
        if (governance_ == address(0)) revert ZeroAddress();
        governance = governance_;
        WRAPPER_FACTORY = wrapperFactory;
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    /// @notice Register an asset. Registration alone does NOT make it usable —
    ///         every gate must pass and it must then be explicitly enabled.
    function registerAsset(address token, uint8 decimals_, uint32 coreTokenIndex, uint8 evmExtraWeiDecimals)
        external
        onlyGovernance
    {
        if (token == address(0)) revert ZeroAddress();
        if (_assets[token].exists) revert AlreadyRegistered();

        /*
         * Refused here, at registration, and not only at enable.
         *
         * A registered-but-disabled asset reads as "under review", and the whole
         * point is that this one never reaches review. Rejecting it at the first
         * door means nobody spends a week attesting gates for an asset that
         * cannot be used whatever the gates say.
         */
        if (RebaseDetector.isRebasing(token)) {
            (, uint256 m) = RebaseDetector.multiplierHasMoved(token);
            revert AssetRebases(token, m);
        }

        Asset storage a = _assets[token];
        a.token = token;
        a.decimals = decimals_;
        a.coreTokenIndex = coreTokenIndex;
        a.evmExtraWeiDecimals = evmExtraWeiDecimals;
        a.exists = true;
        // gates default to all-false; enabledForNewLaunches defaults to false.

        _registered.push(token);

        emit AssetRegistered(token, coreTokenIndex, decimals_);
    }

    /**
     * @notice Register a wrapper, bound to the xStock it wraps.
     *
     * @dev The path that exists because §420's gates are about the UNDERLYING
     *      while the listed asset is the wrapper (D-017).
     *
     *      Two checks, and only one of them is worth anything on its own:
     *
     *      1. The factory names this wrapper for this underlying. **This is the
     *         real check.** The factory deploys one fixed bytecode by CREATE2
     *         and records it, so a wrapper it names has code we know — and a
     *         lookalike that merely claims the right underlying cannot appear
     *         here at all.
     *
     *      2. The wrapper agrees. This is redundant given (1) and is kept
     *         because it costs one staticcall and turns a factory-mapping bug
     *         into a revert rather than a listing.
     *
     *      A wrapper called "Wrapped Tesla xStock" holding something else is the
     *      cheapest attack on a user who reads before signing, and governance
     *      ticking `canonicalRepresentation` is a human check against it.
     *      Provenance is not.
     *
     *      `expectedUnderlying` is passed rather than read so the transaction —
     *      and the event — record which asset was actually attested to, instead
     *      of whatever the wrapper happened to say at the time.
     */
    function registerWrappedAsset(
        address wrapper,
        address expectedUnderlying,
        uint8 decimals_,
        uint32 coreTokenIndex,
        uint8 evmExtraWeiDecimals
    ) external onlyGovernance {
        if (wrapper == address(0) || expectedUnderlying == address(0)) revert ZeroAddress();
        if (WRAPPER_FACTORY == address(0)) revert NoWrapperFactory();
        if (_assets[wrapper].exists) revert AlreadyRegistered();

        address named = IWrapperFactory(WRAPPER_FACTORY).wrapperOf(expectedUnderlying);
        if (named != wrapper) revert NotFromWrapperFactory(wrapper, named);

        address actual = IWrappedAsset(wrapper).UNDERLYING();
        if (actual != expectedUnderlying) {
            revert WrapperUnderlyingMismatch(wrapper, expectedUnderlying, actual);
        }

        // The wrapper itself must not rebase — that is the entire point of it.
        // Checked here as well as in `registerAsset` so no registration path
        // skips it, rather than assuming the wrapper is fine because it is a
        // wrapper.
        if (RebaseDetector.isRebasing(wrapper)) {
            (, uint256 m) = RebaseDetector.multiplierHasMoved(wrapper);
            revert AssetRebases(wrapper, m);
        }

        Asset storage a = _assets[wrapper];
        a.token = wrapper;
        a.decimals = decimals_;
        a.coreTokenIndex = coreTokenIndex;
        a.evmExtraWeiDecimals = evmExtraWeiDecimals;
        a.wrappedUnderlying = expectedUnderlying;
        a.exists = true;

        _registered.push(wrapper);

        emit AssetRegistered(wrapper, coreTokenIndex, decimals_);
        emit WrappedAssetRegistered(wrapper, expectedUnderlying, coreTokenIndex, decimals_);
    }

    /// @notice What a listed asset wraps, or zero if it wraps nothing.
    /// @dev Read by the API so a review can say "quoted in wTSLAx (Tesla xStock)"
    ///      rather than showing a symbol the user has to take on trust.
    function underlyingOf(address token) external view returns (address) {
        return _assets[token].wrappedUnderlying;
    }

    /// @notice Record the outcome of the §420 verification gates.
    /// @dev Gates are set wholesale rather than incrementally so that the emitted
    ///      event is a complete statement of what was attested, and so a partial
    ///      update cannot silently leave a stale `true` behind.
    function setGates(address token, Gates calldata gates) external onlyGovernance {
        Asset storage a = _assets[token];
        if (!a.exists) revert UnknownAsset();

        a.gates = gates;

        bool passed = _allGatesPassed(gates);

        // Losing a gate immediately withdraws the asset from new launches. It does
        // not touch markets already trading against it.
        if (!passed && a.enabledForNewLaunches) {
            a.enabledForNewLaunches = false;
            emit AssetDisabled(token, "gate regression");
        }

        emit GatesUpdated(token, gates, passed);
    }

    /// @notice Enable an asset for new launches. Requires all eight gates.
    function enableAsset(address token) external onlyGovernance {
        Asset storage a = _assets[token];
        if (!a.exists) revert UnknownAsset();
        if (a.enabledForNewLaunches) revert AlreadyEnabled();
        if (!_allGatesPassed(a.gates)) revert GatesNotAllPassed();

        /*
         * Checked AGAIN, and this is not redundant.
         *
         * These assets are upgradeable proxies - SPYx's implementation is
         * Backed's, behind an EIP-1967 proxy whose admin can replace it. An asset
         * that did not rebase when it was registered can rebase by the time it is
         * enabled, and enabling is the moment markets become possible against it.
         *
         * Re-reading costs one staticcall at the only point where being wrong
         * starts to matter.
         */
        if (RebaseDetector.isRebasing(token)) {
            (, uint256 m) = RebaseDetector.multiplierHasMoved(token);
            revert AssetRebases(token, m);
        }

        a.enabledForNewLaunches = true;
        a.verifiedAt = uint64(block.timestamp);

        emit AssetEnabled(token, a.verifiedAt);
    }

    /// @notice Stop NEW launches against an asset.
    /// @dev Live markets are intentionally unaffected: a market's pair is fixed for
    ///      life (§387, §388). This function cannot reach an existing position.
    function disableAsset(address token, string calldata reason) external onlyGovernance {
        Asset storage a = _assets[token];
        if (!a.exists) revert UnknownAsset();
        if (!a.enabledForNewLaunches) revert NotEnabled();

        a.enabledForNewLaunches = false;
        emit AssetDisabled(token, reason);
    }

    function transferGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        emit GovernanceTransferred(governance, newGovernance);
        governance = newGovernance;
    }

    // -----------------------------------------------------------------------
    // Views — the factory's launch gate
    // -----------------------------------------------------------------------

    /// @notice The single question the factory asks before allowing a launch.
    function isLaunchable(address token) external view returns (bool) {
        Asset storage a = _assets[token];
        return a.exists && a.enabledForNewLaunches && _allGatesPassed(a.gates);
    }

    function getAsset(address token) external view returns (Asset memory) {
        Asset storage a = _assets[token];
        if (!a.exists) revert UnknownAsset();
        return a;
    }

    function registeredCount() external view returns (uint256) {
        return _registered.length;
    }

    function registeredAt(uint256 index) external view returns (address) {
        return _registered[index];
    }

    /// @notice Assets currently launchable. Deliberately a view for off-chain use;
    ///         the factory uses the O(1) `isLaunchable` check.
    function launchableAssets() external view returns (address[] memory result) {
        uint256 n = _registered.length;
        address[] memory buffer = new address[](n);
        uint256 count = 0;

        for (uint256 i = 0; i < n; i++) {
            address token = _registered[i];
            Asset storage a = _assets[token];
            if (a.enabledForNewLaunches && _allGatesPassed(a.gates)) {
                buffer[count] = token;
                count++;
            }
        }

        result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = buffer[i];
        }
    }

    function _allGatesPassed(Gates memory g) private pure returns (bool) {
        return g.canonicalRepresentation && g.transferBehaviour && g.multiplierBehaviour && g.priceSource
            && g.haltSource && g.hyperSwapCompatible && g.normalizedAccountingTested && g.legalReviewed;
    }
}

/// @dev The one function this registry calls on a wrapper.
interface IWrappedAsset {
    function UNDERLYING() external view returns (address);
}
