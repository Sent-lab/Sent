// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {LaunchToken} from "./LaunchToken.sol";
import {LaunchMarket} from "./LaunchMarket.sol";
import {XStockRegistry} from "./XStockRegistry.sol";
import {FeeVault} from "./FeeVault.sol";
import {HolderRewardVault} from "./HolderRewardVault.sol";
import {Curve} from "./lib/Curve.sol";
import {IReferencePriceAdapter} from "./interfaces/IReferencePriceAdapter.sol";
import {Metadata} from "./lib/Metadata.sol";

/// @title SENT LaunchpadFactory
/// @notice Deploys markets and is the single source of token authenticity (§138).
///
/// AUTHENTICITY IS THE REGISTRY, NOT THE ADDRESS (§4)
/// --------------------------------------------------
/// A vanity suffix is branding. Anyone can grind an address that ends in the same
/// characters, so a suffix proves nothing and the UI must never treat it as proof.
/// The only authenticity source is this factory's registry and its `TokenLaunched`
/// event.
///
/// CREATOR-BOUND CREATE2 (§412)
/// ----------------------------
/// A naive vanity flow is trivially front-runnable: the creator grinds a salt,
/// broadcasts it, and a mempool observer copies the salt into their own
/// transaction and becomes the creator of the address the victim paid to find.
///
/// So the salt a creator supplies is never the salt used. The deployment salt is
///
///     effectiveSalt = keccak256(creator, userSalt, LAUNCH_VERSION, pairIdentity, launchIntentHash)
///
/// with `creator` bound in. A front-runner copying the whole calldata derives a
/// DIFFERENT effectiveSalt, because their address differs — so they land on a
/// different address entirely and cannot steal the ground one. The victim's
/// address remains reachable only by the victim.
///
/// CREATOR IDENTITY (§578, §579)
/// -----------------------------
/// `msg.sender` is the creator, and it is recorded before anything else happens.
/// This factory is deployed and operated by the platform deployer wallet, and the
/// deployer is NEVER the creator of anything it deploys on a user's behalf. §578
/// calls this out as a CRITICAL LOCK, and §641 makes it a P0 test.
///
/// THE CIRCULAR DEPENDENCY (D-009)
/// -------------------------------
/// Token needs market, market needs token. Under CREATE2 each address depends on
/// the other's constructor arguments, so one side must be resolved after
/// deployment. It is resolved on the TOKEN side, because the market's `TOKEN` is
/// security-critical and stays immutable while the token's `market` field is
/// informational and is never read by any balance or transfer decision.
///
/// Both addresses stay fully predictable off-chain: the token address is a pure
/// function of (factory, effectiveSalt, name, symbol, creator), so a grinder can
/// search `userSalt` without deploying anything.
contract LaunchpadFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Bound into every salt so a future launch version can never collide
    ///      with, or replay, an address derived under this one.
    uint256 public constant LAUNCH_VERSION = 1;

    address public governance;
    XStockRegistry public immutable REGISTRY;
    FeeVault public immutable FEE_VAULT;
    HolderRewardVault public immutable REWARD_VAULT;

    /// @notice Where the graduation router lives. Markets inherit it at launch.
    address public router;

    /// @notice The launch anchor's source (§135, §402).
    ///
    /// @dev Mutable for the same reason `router` is: V-11 is open, the feed is
    ///      an engineering validation still to be done (§253), and a factory
    ///      that had to be redeployed to change it would take every launched
    ///      market's authenticity record with it.
    ///
    ///      Zero means no launch is possible. That is the correct failure and
    ///      the same one `RouterNotSet` expresses — §279 forbids a placeholder
    ///      standing in for an unverified dependency, and a refusal is not a
    ///      placeholder.
    address public referencePrice;

    /// @notice Launch fee, in the native gas token. §2 targets ~$1-2 equivalent.
    uint256 public launchFee;

    /// @notice Destination for launch fees: the Treasury Safe (§563, §607).
    address public treasury;

    struct Launch {
        address token;
        address market;
        address creator;
        address quoteAsset;
        uint64 launchedAt;
        bool exists;
    }

    /// @dev token => launch record. THE authenticity source (§138).
    mapping(address token => Launch) private _launches;
    address[] private _allTokens;

    /// @dev creator => tokens they launched.
    mapping(address creator => address[]) private _byCreator;

    /// @dev effectiveSalt => used. Replay protection (§412).
    mapping(bytes32 salt => bool) public saltUsed;

    event TokenLaunched(
        address indexed token,
        address indexed market,
        address indexed creator,
        address quoteAsset,
        string name,
        string symbol,
        uint256 p0,
        bytes32 effectiveSalt,
        /// @dev The commitment the address was derived from (§412).
        ///
        ///      `effectiveSalt` is a hash OF this, so the intent hash cannot be
        ///      recovered from it. Without this field the metadata published
        ///      alongside the launch could be read but never checked against
        ///      what the creator actually committed to — which is the only
        ///      thing that makes publishing it worth anything.
        bytes32 launchIntentHash
    );
    event RouterUpdated(address indexed from, address indexed to);
    event ReferencePriceUpdated(address indexed from, address indexed to);

    /// @notice A token's metadata at launch (§95.20).
    /// @dev `revision` is zero here and increments on every revision, so an
    ///      indexer orders them without needing block numbers — and a consumer
    ///      that sees revision 3 knows it has missed 1 and 2 rather than
    ///      assuming it has the latest.
    event LaunchMetadata(
        address indexed token,
        address indexed creator,
        uint256 indexed revision,
        string description,
        string imageCid,
        Metadata.Link[] links
    );
    event LaunchFeeUpdated(uint256 from, uint256 to);
    event TreasuryUpdated(address indexed from, address indexed to);
    event GovernanceTransferred(address indexed from, address indexed to);

    error NotGovernance();
    error ZeroAddress();
    error QuoteAssetNotLaunchable(address quoteAsset);
    error SaltAlreadyUsed(bytes32 effectiveSalt);
    error PredictedAddressMismatch(address predicted, address actual);
    error InsufficientLaunchFee(uint256 sent, uint256 required);
    error InvalidReferencePrice();
    error ReferencePriceNotSet();
    error NotTheCreator(address token, address caller);
    error UnknownToken(address token);
    error ReferencePriceDeviated(uint256 reviewed, uint256 actual, uint256 toleranceBps);
    error RouterNotSet();
    error LaunchFeeTransferFailed();
    error DecimalsDriftedFromRegistry(uint8 registered, uint8 reported);
    error DecimalsUnavailable(address quoteAsset);

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    constructor(address governance_, address treasury_, address registry_, uint256 launchFee_) {
        if (governance_ == address(0) || treasury_ == address(0) || registry_ == address(0)) {
            revert ZeroAddress();
        }

        governance = governance_;
        treasury = treasury_;
        REGISTRY = XStockRegistry(registry_);
        launchFee = launchFee_;

        // The vaults are deployed by this factory so that their immutable FACTORY
        // field can only ever be this contract. A market registered with either
        // vault is therefore provably one this factory created.
        FEE_VAULT = new FeeVault(governance_, treasury_, address(this));
        REWARD_VAULT = new HolderRewardVault(governance_, address(this));
    }

    // -----------------------------------------------------------------------
    // Launch
    // -----------------------------------------------------------------------

    struct LaunchParams {
        string name;
        string symbol;
        address quoteAsset;
        /// @dev The salt the creator's grinder found. Never used directly.
        bytes32 userSalt;
        /// @dev Hash of the launch intent the creator reviewed (metadata, socials).
        ///      Bound into the salt so a modified intent produces a different
        ///      address rather than silently launching something else.
        bytes32 launchIntentHash;
        /// @dev The xStock/USD price the creator REVIEWED, wad.
        ///
        ///      No longer the anchor. The anchor comes from the reference price
        ///      adapter; this is the bound on how far the feed may have moved
        ///      since the preview, in the same shape as `minTokensOut` on a
        ///      trade. Zero opts out explicitly.
        uint256 xStockUsdWad;
        /// @dev The address the creator was shown in the preview. Enforced.
        address expectedToken;
        /// @dev Description, image CID and links (§95.20).
        ///
        ///      Emitted, never stored — nothing on-chain reads it, and a log is
        ///      roughly eight gas a byte against twenty thousand per word of
        ///      storage. `launchIntentHash` above already commits to this
        ///      content through the token's own address; publishing it is what
        ///      makes that commitment checkable by anyone.
        Metadata.Content metadata;
    }

    /// @notice Launch a token and its market.
    /// @dev `msg.sender` is the creator, permanently. Callable by anyone; the
    ///      caller becomes the creator of what they launch, and can never become
    ///      the creator of what someone else launched.
    function launch(LaunchParams calldata params)
        external
        payable
        nonReentrant
        returns (address token, address market)
    {
        if (msg.value < launchFee) revert InsufficientLaunchFee(msg.value, launchFee);
        if (router == address(0)) revert RouterNotSet();
        if (referencePrice == address(0)) revert ReferencePriceNotSet();

        // Before anything is deployed. A launch that fails on a description
        // length after minting a token and a market would leave both stranded
        // at an address the creator can never reuse — the salt is spent.
        Metadata.validate(params.metadata);

        // §420: only a fully verified official xStock may back a market. An empty
        // or unverified registry means no launch is possible at all — which is the
        // correct behaviour, not an outage.
        if (!REGISTRY.isLaunchable(params.quoteAsset)) revert QuoteAssetNotLaunchable(params.quoteAsset);

        bytes32 effectiveSalt = computeEffectiveSalt(
            msg.sender, params.userSalt, params.quoteAsset, params.launchIntentHash
        );
        if (saltUsed[effectiveSalt]) revert SaltAlreadyUsed(effectiveSalt);
        saltUsed[effectiveSalt] = true;

        // The creator signed off on a specific address in the preview (§3 step 5).
        // If anything about the launch changed, the address changes, and this
        // check stops the launch rather than deploying something they never saw.
        address predicted = predictTokenAddress(effectiveSalt, params.name, params.symbol, msg.sender);
        if (params.expectedToken != address(0) && params.expectedToken != predicted) {
            revert PredictedAddressMismatch(params.expectedToken, predicted);
        }

        /*
         * THE ANCHOR COMES FROM THE FEED, NOT FROM THE CALLER (§135, §402).
         *
         * `params.xStockUsdWad` used to BE the anchor. Any caller could pass any
         * non-zero number, and the only check was that it was not zero — so a
         * launch at a price a thousand times too low produced a `p0` a thousand
         * times too high and a market that could never realistically graduate,
         * while a price a thousand times too high produced one that graduated
         * for almost nothing and locked dust into a pool that is supposed to be
         * permanent liquidity.
         *
         * The adapter reverts on stale, non-positive, out-of-band or unreadable,
         * which is §402's "if invalid/stale, the launch is blocked" expressed as
         * the absence of any other path.
         */
        uint256 anchorUsdWad = IReferencePriceAdapter(referencePrice).usdPriceWad(params.quoteAsset);

        /*
         * And the caller's number becomes an ACCEPTANCE BOUND.
         *
         * The same shape as `minTokensOut` on a trade. The creator reviewed a
         * preview at some price (§3 step 5); between review and mining, the feed
         * moves. Without this the launch silently anchors at whatever the feed
         * says now, and the creator's market is not the market they were shown —
         * which is the §694 failure, one layer down from the calldata.
         *
         * Zero opts out, for a caller that genuinely wants the current price
         * whatever it is. Explicit, because the safe default is to check.
         */
        _assertAnchorWithinTolerance(params.xStockUsdWad, anchorUsdWad);

        uint256 p0 = referencePriceToP0(anchorUsdWad, params.quoteAsset);

        // Decimals come from the REGISTRY, not from the token.
        //
        // The registry value is what governance verified through the eight 420
        // gates. Asking the token directly would trust an asset that may lie,
        // may have been upgraded, or may simply have been mis-registered - and a
        // wrong decimals value silently corrupts every normalisation this market
        // ever performs, for its entire life.
        //
        // The token is still consulted, but only to detect drift: a disagreement
        // means the verified record is stale, and the launch must stop rather
        // than proceed on either value.
        uint8 quoteDecimals = REGISTRY.getAsset(params.quoteAsset).decimals;
        _assertDecimalsMatchRegistry(params.quoteAsset, quoteDecimals);

        token = address(new LaunchToken{salt: effectiveSalt}(params.name, params.symbol, msg.sender));
        if (token != predicted) revert PredictedAddressMismatch(predicted, token);

        market = address(
            new LaunchMarket{salt: effectiveSalt}(
                token,
                params.quoteAsset,
                quoteDecimals,
                msg.sender,
                address(FEE_VAULT),
                address(REWARD_VAULT),
                p0
            )
        );

        LaunchToken(token).setMarket(market);

        // The entire genesis supply moves to the market. The creator receives
        // nothing, here or anywhere else.
        IERC20(token).safeTransfer(market, LaunchToken(token).GENESIS_SUPPLY());

        FEE_VAULT.registerMarket(market);
        REWARD_VAULT.registerMarket(market, params.quoteAsset);
        LaunchMarket(market).setRouter(router);

        _launches[token] = Launch({
            token: token,
            market: market,
            creator: msg.sender,
            quoteAsset: params.quoteAsset,
            launchedAt: uint64(block.timestamp),
            exists: true
        });
        _allTokens.push(token);
        _byCreator[msg.sender].push(token);

        if (msg.value > 0) {
            (bool ok,) = treasury.call{value: msg.value}("");
            if (!ok) revert LaunchFeeTransferFailed();
        }

        emit TokenLaunched(
            token,
            market,
            msg.sender,
            params.quoteAsset,
            params.name,
            params.symbol,
            p0,
            effectiveSalt,
            params.launchIntentHash
        );

        // After `TokenLaunched`, deliberately. An indexer that sees metadata for
        // a token it has never heard of has nothing to attach it to, and the two
        // events are in one transaction so the order is the only thing that
        // decides which arrives first.
        emit LaunchMetadata(
            token,
            msg.sender,
            0,
            params.metadata.description,
            params.metadata.imageCid,
            params.metadata.links
        );
    }

    // -----------------------------------------------------------------------
    // Metadata revisions (§95.20)
    // -----------------------------------------------------------------------

    /// @dev How many times each token's metadata has been revised.
    ///
    ///      The one thing about metadata that IS stored, because it is the one
    ///      thing a contract has to read: without it two revisions in the same
    ///      block are indistinguishable, and an indexer would have no ordering
    ///      to apply beyond log index — which is not a promise the chain makes
    ///      across a reorg.
    mapping(address token => uint256) public metadataRevision;

    /// @notice Revise a token's metadata. Creator only.
    ///
    /// @dev WHY THIS IS NOT IMMUTABLE
    ///      A typo in a description is permanent otherwise, and permanence is
    ///      not a virtue here — it is the reason a creator would host the real
    ///      description somewhere else, which is exactly the outcome putting it
    ///      on-chain was meant to avoid.
    ///
    /// @dev WHAT A REVISION CANNOT DO
    ///      `launchIntentHash` is bound into the token's address (§412) and is
    ///      unreachable from here. So a revision never rewrites history: the
    ///      launch-time content stays published in its own event, hashes to the
    ///      commitment in the address, and every revision after it is visibly a
    ///      revision — with an author, a block, and a number.
    ///
    ///      §27's boundary holds: governance has no path to this function. The
    ///      creator is the only party who can change what their token says, and
    ///      the platform cannot.
    function reviseMetadata(address token, Metadata.Content calldata content) external {
        Launch memory record = _launches[token];
        if (!record.exists) revert UnknownToken(token);
        if (record.creator != msg.sender) revert NotTheCreator(token, msg.sender);

        Metadata.validate(content);

        uint256 revision = metadataRevision[token] + 1;
        metadataRevision[token] = revision;

        emit LaunchMetadata(
            token, msg.sender, revision, content.description, content.imageCid, content.links
        );
    }

    /// @dev Reverts if the asset's own `decimals()` disagrees with the verified
    ///      registry record. A token that does not implement `decimals()` at all
    ///      could not have passed the §420 gates, so an absent value is treated as
    ///      drift too.
    function _assertDecimalsMatchRegistry(address quoteAsset, uint8 registered) private view {
        try IERC20Metadata(quoteAsset).decimals() returns (uint8 reported) {
            if (reported != registered) revert DecimalsDriftedFromRegistry(registered, reported);
        } catch {
            revert DecimalsUnavailable(quoteAsset);
        }
    }

    // -----------------------------------------------------------------------
    // Address prediction — what a grinder calls off-chain
    // -----------------------------------------------------------------------

    /// @notice The salt actually used, bound to the creator (§412).
    /// @dev Because `creator` is inside the hash, two different callers passing
    ///      identical parameters land on two different addresses. That is what
    ///      makes a copied salt worthless to a front-runner.
    function computeEffectiveSalt(
        address creator,
        bytes32 userSalt,
        address quoteAsset,
        bytes32 launchIntentHash
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(creator, userSalt, LAUNCH_VERSION, quoteAsset, launchIntentHash));
    }

    /// @notice Predict a token address without deploying. The grinder's inner loop.
    function predictTokenAddress(bytes32 effectiveSalt, string memory name, string memory symbol, address creator)
        public
        view
        returns (address)
    {
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(LaunchToken).creationCode, abi.encode(name, symbol, creator)));

        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), effectiveSalt, initCodeHash))))
        );
    }

    /// @notice Full preview: what address a given userSalt would produce.
    function previewLaunchAddress(
        address creator,
        bytes32 userSalt,
        address quoteAsset,
        bytes32 launchIntentHash,
        string calldata name,
        string calldata symbol
    ) external view returns (address token, bytes32 effectiveSalt) {
        effectiveSalt = computeEffectiveSalt(creator, userSalt, quoteAsset, launchIntentHash);
        token = predictTokenAddress(effectiveSalt, name, symbol, creator);
    }

    // -----------------------------------------------------------------------
    // Curve anchoring (§8, §402)
    // -----------------------------------------------------------------------

    /// @notice Derive the starting price from the $2,000 reference market cap.
    /// @dev Anchored ONCE, at launch, from the reference snapshot. The live USD
    ///      feed never re-anchors an existing market — §402 splits those roles
    ///      precisely so a display feed can never move a market's economics.
    /// @notice How far the feed may have moved from the price the creator saw.
    /// @dev 5%. Wide enough that an ordinary block delay on a volatile equity
    ///      does not fail launches for no reason, narrow enough that a market
    ///      cannot be anchored somewhere the creator would not recognise. §14's
    ///      principle — the user picks the bound, nothing is implicit — is
    ///      honoured by `xStockUsdWad` being the creator's own number; this is
    ///      the ceiling on how far it may be from reality.
    uint256 public constant ANCHOR_TOLERANCE_BPS = 500;

    /// @dev Reverts when the feed has moved further than the tolerance from the
    ///      price the creator reviewed. A zero `reviewed` opts out explicitly.
    function _assertAnchorWithinTolerance(uint256 reviewed, uint256 actual) private pure {
        if (reviewed == 0) return;

        uint256 diff = reviewed > actual ? reviewed - actual : actual - reviewed;

        // Against the ACTUAL price, not the reviewed one: the reviewed number is
        // caller-supplied, and a denominator a caller controls is a tolerance a
        // caller controls.
        if (diff * 10_000 > actual * ANCHOR_TOLERANCE_BPS) {
            revert ReferencePriceDeviated(reviewed, actual, ANCHOR_TOLERANCE_BPS);
        }
    }

    function referencePriceToP0(uint256 xStockUsdWad, address) public pure returns (uint256 p0) {
        if (xStockUsdWad == 0) revert InvalidReferencePrice();

        uint256 referenceMcUsd = 2_000e18; // LOCKED (§0)
        uint256 quoteMc = (referenceMcUsd * 1e18) / xStockUsdWad;
        p0 = (quoteMc * 1e18) / Curve.TOTAL_SUPPLY;

        if (p0 == 0) revert InvalidReferencePrice();
    }

    // -----------------------------------------------------------------------
    // Authenticity views (§138)
    // -----------------------------------------------------------------------

    /// @notice THE authenticity check. A UI must use this, never an address suffix.
    function isAuthentic(address token) external view returns (bool) {
        return _launches[token].exists;
    }

    function getLaunch(address token) external view returns (Launch memory) {
        return _launches[token];
    }

    function creatorOf(address token) external view returns (address) {
        return _launches[token].creator;
    }

    function totalLaunches() external view returns (uint256) {
        return _allTokens.length;
    }

    function tokenAt(uint256 index) external view returns (address) {
        return _allTokens[index];
    }

    function launchesByCreator(address creator) external view returns (address[] memory) {
        return _byCreator[creator];
    }

    // -----------------------------------------------------------------------
    // Governance — parameters only, never funds (§559)
    // -----------------------------------------------------------------------

    function setRouter(address router_) external onlyGovernance {
        if (router_ == address(0)) revert ZeroAddress();
        emit RouterUpdated(router, router_);
        router = router_;
    }

    /// @notice Point the launch anchor at a price adapter (§135, §402).
    /// @dev Governance names a SOURCE. It cannot write a price — there is no
    ///      function on the adapter that would let it, and §18 forbids an admin
    ///      injecting a manual price to force a graduation.
    function setReferencePrice(address adapter) external onlyGovernance {
        if (adapter == address(0)) revert ZeroAddress();
        emit ReferencePriceUpdated(referencePrice, adapter);
        referencePrice = adapter;
    }

    function setLaunchFee(uint256 newFee) external onlyGovernance {
        emit LaunchFeeUpdated(launchFee, newFee);
        launchFee = newFee;
    }

    function setTreasury(address newTreasury) external onlyGovernance {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function transferGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        emit GovernanceTransferred(governance, newGovernance);
        governance = newGovernance;
    }
}
