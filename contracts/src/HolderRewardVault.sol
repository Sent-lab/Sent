// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title SENT HolderRewardVault
/// @notice Custodies Stockback contributions and pays them to eligible holders in
///         the market's official paired xStock (§283, §291, §336-§342).
///
/// TRUST MODEL (§404) — the phrase "permissionless finalization" is not enough on
/// its own, because an arbitrary caller must not be able to submit an arbitrary
/// reward root. V1 is:
///
///   deterministic off-chain TWAB computation
///     -> threshold-attested cumulative Merkle commitment
///     -> PERMISSIONLESS on-chain submission of valid attestations
///     -> activation delay
///     -> claim
///
/// The submitter receives no economic privilege whatsoever — they only pay gas.
/// Attestors sign; they never custody funds (§594).
///
/// WHY CUMULATIVE, NOT PER-EPOCH (§407)
/// ------------------------------------
/// Each root carries a holder's TOTAL entitlement to date. A claim pays
/// `cumulative - alreadyClaimed`, so:
///   - one proof settles any number of accrued epochs;
///   - a replayed or stale proof pays exactly zero rather than paying twice;
///   - the vault never has to walk history.
///
/// THE INVARIANT THAT MATTERS (§359, §364)
/// ---------------------------------------
/// Finalization cannot mint entitlement beyond funding. A commitment whose
/// `totalCumulative` exceeds what the market has actually been funded is rejected
/// at submission — before it can ever be claimed against. This is checked on the
/// way in, not discovered on the way out when the last holder finds an empty vault.
contract HolderRewardVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Delay between submission and a root becoming claimable (§334, §404).
    ///      Gives independent verifiers a window to challenge a bad dataset before
    ///      any money moves.
    uint256 public constant ACTIVATION_DELAY = 6 hours;

    /// @dev EIP-712 commitment. Binds every field §405 requires, so a signature is
    ///      useless outside the exact chain, vault, market, asset and version it was
    ///      produced for. This is what makes cross-chain, cross-market, cross-vault
    ///      and old-version replay impossible rather than merely unlikely.
    bytes32 public constant COMMITMENT_TYPEHASH = keccak256(
        "StockbackCommitment(uint256 chainId,address vault,address market,address token,address rewardAsset,uint256 distributionVersion,uint256 epochSequence,uint256 totalCumulative,bytes32 merkleRoot,bytes32 datasetHash)"
    );

    struct Commitment {
        address market;
        address token;
        address rewardAsset;
        uint256 distributionVersion;
        uint256 epochSequence;
        uint256 totalCumulative;
        bytes32 merkleRoot;
        bytes32 datasetHash;
    }

    struct Distribution {
        bytes32 merkleRoot;
        bytes32 datasetHash;
        uint256 totalCumulative;
        uint256 epochSequence;
        uint256 activeAt;
    }

    address public governance;

    /// @notice Guardian Safe (§588). A brake, never a steering wheel.
    ///
    /// §589 names the exact power this exists for: "pause Stockback claims before
    /// a suspicious root activates." Without it the activation delay is merely a
    /// wait — a compromised attestor quorum could submit a bad root and nothing
    /// could stop it going live. The delay is only a defence if someone can act
    /// inside it.
    ///
    /// §590 forbids the Guardian from withdrawing funds, setting roots, changing
    /// the creator, or rewriting economics. It has none of those here.
    ///
    /// §591 forbids the same emergency actor from both pausing and recovering, so
    /// the Guardian CANNOT unpause. Only governance can, after investigating.
    address public guardian;

    /// @notice While true, claims and activations are frozen. Funding and
    ///         submission continue, so the market never stalls and evidence keeps
    ///         accumulating — only the movement of money stops.
    bool public claimsPaused;

    /// @notice Attestor set (§592). Signs commitments; never custodies funds.
    mapping(address attestor => bool) public isAttestor;
    address[] private _attestors;

    /// @notice Signatures required for a commitment to be accepted (§596).
    uint256 public quorum;

    /// @notice Markets authorised to fund this vault, registered by the factory.
    mapping(address market => bool) public isMarket;
    address public immutable FACTORY;

    /// @dev market => reward asset (the market's official paired xStock).
    mapping(address market => address) public rewardAsset;

    /// @dev market => total Stockback contributions ever received.
    mapping(address market => uint256) public funded;

    /// @dev market => total ever paid out.
    mapping(address market => uint256) public claimed;

    /// @dev market => the currently ACTIVE distribution.
    mapping(address market => Distribution) public active;

    /// @dev market => a submitted distribution still inside its activation delay.
    mapping(address market => Distribution) public pending;

    /// @dev market => account => cumulative amount already claimed.
    mapping(address market => mapping(address account => uint256)) public claimedBy;

    bytes32 private immutable _DOMAIN_SEPARATOR;

    event MarketRegistered(address indexed market, address indexed rewardAsset);
    event Funded(address indexed market, uint256 amount, uint256 totalFunded);
    event CommitmentSubmitted(
        address indexed market, bytes32 indexed merkleRoot, uint256 totalCumulative, uint256 activeAt, address submitter
    );
    event CommitmentActivated(address indexed market, bytes32 indexed merkleRoot, uint256 totalCumulative);
    event Claimed(address indexed market, address indexed account, uint256 amount, uint256 cumulative);
    event AttestorAdded(address indexed attestor);
    event AttestorRemoved(address indexed attestor);
    event QuorumUpdated(uint256 from, uint256 to);
    event GovernanceTransferred(address indexed from, address indexed to);
    event VaultInitialised(address indexed governance, address indexed factory, uint256 chainId);
    event GuardianUpdated(address indexed from, address indexed to);
    event ClaimsPaused(address indexed guardian, string reason);
    event ClaimsUnpaused(address indexed governance);
    event PendingCommitmentCancelled(address indexed market, bytes32 indexed merkleRoot, string reason);

    error NotGovernance();
    error NotFactory();
    error NotMarket();
    error ZeroAddress();
    error AlreadyRegistered();
    error QuorumNotMet(uint256 provided, uint256 required);
    error SignaturesNotSorted();
    error NotAnAttestor(address signer);
    error EntitlementExceedsFunding(uint256 totalCumulative, uint256 funded);
    error StaleCommitment(uint256 provided, uint256 current);
    error WrongRewardAsset();
    error InvalidProof();
    error NothingToClaim();
    error NotYetActive(uint256 activeAt);
    error QuorumTooHigh(uint256 quorum, uint256 attestors);
    error QuorumZero();
    error TooManySignatures(uint256 provided, uint256 attestors);
    error NotGuardian();
    error ClaimsArePaused();
    error NotPaused();
    error NoPendingCommitment();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    modifier whenNotPaused() {
        if (claimsPaused) revert ClaimsArePaused();
        _;
    }

    constructor(address governance_, address factory_) {
        if (governance_ == address(0) || factory_ == address(0)) revert ZeroAddress();
        governance = governance_;
        FACTORY = factory_;

        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SENT Stockback"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );

        // Bootstrap event: the indexer rebuilds all state from chain events
        // (§138), so the starting configuration must be in the log too, not only
        // in constructor arguments an indexer would have to decode separately.
        emit VaultInitialised(governance_, factory_, block.chainid);
    }

    // -----------------------------------------------------------------------
    // Registration and funding
    // -----------------------------------------------------------------------

    function registerMarket(address market, address asset) external {
        if (msg.sender != FACTORY) revert NotFactory();
        if (isMarket[market]) revert AlreadyRegistered();
        if (market == address(0) || asset == address(0)) revert ZeroAddress();

        isMarket[market] = true;
        rewardAsset[market] = asset;

        emit MarketRegistered(market, asset);
    }

    /// @notice Book a Stockback contribution.
    /// @dev The market must have already transferred `amount` of the reward asset
    ///      here. Pure accounting — this never pulls, so it cannot drain an approval.
    function fund(uint256 amount) external {
        if (!isMarket[msg.sender]) revert NotMarket();

        funded[msg.sender] += amount;
        emit Funded(msg.sender, amount, funded[msg.sender]);
    }

    // -----------------------------------------------------------------------
    // Attested commitment — permissionless submission
    // -----------------------------------------------------------------------

    /// @notice Submit a threshold-attested cumulative distribution.
    /// @param signatures Attestor signatures, ordered by ascending signer address.
    /// @dev ANYONE may call this. The submitter gains nothing — no fee, no priority,
    ///      no claim. Ordering is enforced so a duplicate signature cannot be counted
    ///      twice to fake a quorum.
    function submitCommitment(Commitment calldata commitment, bytes[] calldata signatures) external {
        if (!isMarket[commitment.market]) revert NotMarket();
        if (commitment.rewardAsset != rewardAsset[commitment.market]) revert WrongRewardAsset();

        // Monotonicity must be measured against the FURTHEST-ADVANCED commitment
        // the vault knows about, which is the pending one whenever it exists.
        //
        // Checking only against `active` left a downgrade open: an older but still
        // valid commitment could overwrite a pending newer one, rolling
        // entitlements backwards AND restarting the activation delay. Both
        // attestor-signed, so signature checks alone would never catch it.
        Distribution storage current = active[commitment.market];
        Distribution storage inFlight = pending[commitment.market];

        uint256 highestSequence = current.epochSequence;
        uint256 highestTotal = current.totalCumulative;
        bool haveAny = current.merkleRoot != bytes32(0);

        if (inFlight.merkleRoot != bytes32(0)) {
            haveAny = true;
            if (inFlight.epochSequence > highestSequence) highestSequence = inFlight.epochSequence;
            if (inFlight.totalCumulative > highestTotal) highestTotal = inFlight.totalCumulative;
        }

        // A root may only ever move the cumulative total forward, and only for a
        // strictly newer epoch sequence (§365).
        if (haveAny && commitment.epochSequence <= highestSequence) {
            revert StaleCommitment(commitment.epochSequence, highestSequence);
        }
        if (commitment.totalCumulative < highestTotal) {
            revert StaleCommitment(commitment.totalCumulative, highestTotal);
        }

        // THE conservation check (§364). Rejected here, at the door, rather than
        // discovered later by whichever holder happens to claim last.
        if (commitment.totalCumulative > funded[commitment.market]) {
            revert EntitlementExceedsFunding(commitment.totalCumulative, funded[commitment.market]);
        }

        _verifyQuorum(commitment, signatures);

        uint256 activeAt = block.timestamp + ACTIVATION_DELAY;

        pending[commitment.market] = Distribution({
            merkleRoot: commitment.merkleRoot,
            datasetHash: commitment.datasetHash,
            totalCumulative: commitment.totalCumulative,
            epochSequence: commitment.epochSequence,
            activeAt: activeAt
        });

        emit CommitmentSubmitted(
            commitment.market, commitment.merkleRoot, commitment.totalCumulative, activeAt, msg.sender
        );
    }

    /// @notice Promote a pending distribution once its activation delay has passed.
    ///
    /// @dev Permissionless. The delay is what gives independent verifiers time to
    ///      detect a bad dataset before money moves, and the Guardian time to
    ///      cancel it (§589).
    ///
    ///      NOT idempotent: a second call reverts, because the pending slot is
    ///      cleared. The doc comment previously claimed idempotence, which is the
    ///      kind of inaccuracy that leads a caller to retry blindly. Two callers
    ///      racing means the loser pays for a revert, which is the honest outcome
    ///      and cheaper than pretending the second call did something.
    function activate(address market) external whenNotPaused {
        Distribution memory p = pending[market];
        // A distinct error: "nothing is pending" is a different situation from
        // "your proof does not verify", and reporting the latter for the former
        // sends whoever is debugging in the wrong direction.
        if (p.merkleRoot == bytes32(0)) revert NoPendingCommitment();
        if (block.timestamp < p.activeAt) revert NotYetActive(p.activeAt);

        active[market] = p;
        delete pending[market];

        emit CommitmentActivated(market, p.merkleRoot, p.totalCumulative);
    }

    // -----------------------------------------------------------------------
    // Claims
    // -----------------------------------------------------------------------

    /// @notice Claim Stockback against the active cumulative distribution.
    /// @param cumulativeAmount The account's TOTAL entitlement to date, as committed.
    /// @dev Pays `cumulativeAmount - claimedBy[...]`. A replayed proof therefore
    ///      pays zero rather than paying twice, and a holder who missed several
    ///      epochs settles all of them in one transaction.
    function claim(address market, address account, uint256 cumulativeAmount, bytes32[] calldata proof)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 payout)
    {
        Distribution memory dist = active[market];
        if (dist.merkleRoot == bytes32(0)) revert InvalidProof();

        // Double-hashed leaf: standard defence against a second-preimage attack
        // where an internal node is passed off as a leaf.
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, cumulativeAmount))));
        if (!MerkleProof.verify(proof, dist.merkleRoot, leaf)) revert InvalidProof();

        uint256 already = claimedBy[market][account];
        if (cumulativeAmount <= already) revert NothingToClaim();

        payout = cumulativeAmount - already;

        // Effects before interaction.
        claimedBy[market][account] = cumulativeAmount;
        claimed[market] += payout;

        IERC20(rewardAsset[market]).safeTransfer(account, payout);

        emit Claimed(market, account, payout, cumulativeAmount);
    }

    // -----------------------------------------------------------------------
    // Guardian — a brake, enumerated exactly (§589, §590, §591)
    // -----------------------------------------------------------------------

    /// @notice Freeze claims and activations. Guardian only.
    /// @dev This is the whole reason the activation delay is a defence rather than
    ///      a countdown. It moves no funds and rewrites no state beyond the flag.
    function pauseClaims(string calldata reason) external onlyGuardian {
        claimsPaused = true;
        emit ClaimsPaused(msg.sender, reason);
    }

    /// @notice Discard a commitment that has not yet activated. Guardian only.
    /// @dev The narrow, surgical power §589 describes. It can only DELETE a
    ///      pending root — it can never install one, so a compromised Guardian can
    ///      stall distributions but can never redirect a single token. Governance
    ///      remains the only path to a new root, and that still needs an attestor
    ///      quorum.
    function cancelPendingCommitment(address market, string calldata reason) external onlyGuardian {
        Distribution memory p = pending[market];
        if (p.merkleRoot == bytes32(0)) revert NoPendingCommitment();

        delete pending[market];
        emit PendingCommitmentCancelled(market, p.merkleRoot, reason);
    }

    /// @notice Resume claims. GOVERNANCE ONLY — deliberately not the Guardian.
    /// @dev §591: the same emergency actor must not both pause and recover.
    ///      Governance investigates, then approves the unpause.
    function unpauseClaims() external onlyGovernance {
        if (!claimsPaused) revert NotPaused();
        claimsPaused = false;
        emit ClaimsUnpaused(msg.sender);
    }

    function setGuardian(address newGuardian) external onlyGovernance {
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    // -----------------------------------------------------------------------
    // Attestor management (§592-§597)
    // -----------------------------------------------------------------------

    function addAttestor(address attestor) external onlyGovernance {
        if (attestor == address(0)) revert ZeroAddress();
        if (!isAttestor[attestor]) {
            isAttestor[attestor] = true;
            _attestors.push(attestor);
            emit AttestorAdded(attestor);
        }
    }

    function removeAttestor(address attestor) external onlyGovernance {
        if (!isAttestor[attestor]) return;

        isAttestor[attestor] = false;

        uint256 n = _attestors.length;
        for (uint256 i = 0; i < n; i++) {
            if (_attestors[i] == attestor) {
                _attestors[i] = _attestors[n - 1];
                _attestors.pop();
                break;
            }
        }

        // Removing a signer must never leave an unreachable quorum, which would
        // freeze all future distributions and strand funded rewards.
        if (quorum > _attestors.length) revert QuorumTooHigh(quorum, _attestors.length);

        emit AttestorRemoved(attestor);
    }

    function setQuorum(uint256 newQuorum) external onlyGovernance {
        if (newQuorum == 0) revert QuorumZero();
        if (newQuorum > _attestors.length) revert QuorumTooHigh(newQuorum, _attestors.length);

        emit QuorumUpdated(quorum, newQuorum);
        quorum = newQuorum;
    }

    function attestorCount() external view returns (uint256) {
        return _attestors.length;
    }

    function transferGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();
        emit GovernanceTransferred(governance, newGovernance);
        governance = newGovernance;
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function outstanding(address market) external view returns (uint256) {
        return funded[market] - claimed[market];
    }

    function claimable(address market, address account, uint256 cumulativeAmount) external view returns (uint256) {
        uint256 already = claimedBy[market][account];
        return cumulativeAmount > already ? cumulativeAmount - already : 0;
    }

    function domainSeparator() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    function hashCommitment(Commitment calldata c) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                COMMITMENT_TYPEHASH,
                block.chainid,
                address(this),
                c.market,
                c.token,
                c.rewardAsset,
                c.distributionVersion,
                c.epochSequence,
                c.totalCumulative,
                c.merkleRoot,
                c.datasetHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, structHash));
    }

    // -----------------------------------------------------------------------

    function _verifyQuorum(Commitment calldata commitment, bytes[] calldata signatures) private view {
        uint256 required = quorum;
        if (required == 0) revert QuorumZero();
        if (signatures.length < required) revert QuorumNotMet(signatures.length, required);

        // More signatures than attestors is necessarily invalid: signers must be
        // distinct, ascending and registered, so the surplus can only be a
        // duplicate or a stranger. Rejecting up front states that rather than
        // discovering it partway through a loop the caller paid for.
        if (signatures.length > _attestors.length) {
            revert TooManySignatures(signatures.length, _attestors.length);
        }

        bytes32 digest = hashCommitment(commitment);
        address previous = address(0);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);

            // Strictly ascending order rejects duplicates in one comparison: the
            // same signature twice cannot both be > the previous signer.
            if (signer <= previous) revert SignaturesNotSorted();
            if (!isAttestor[signer]) revert NotAnAttestor(signer);

            previous = signer;
        }
    }
}
