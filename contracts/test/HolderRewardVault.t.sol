// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HolderRewardVault} from "../src/HolderRewardVault.sol";
import {XStockAssetAdapter} from "../src/XStockAssetAdapter.sol";

contract MockAsset is ERC20 {
    uint8 private immutable DECIMALS;

    constructor(uint8 decimals_) ERC20("Mock xStock", "MOCKx") {
        DECIMALS = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract HolderRewardVaultTest is Test {
    HolderRewardVault vault;
    MockAsset asset;

    address governance = makeAddr("governanceSafe");
    address factory = makeAddr("factory");
    address market = makeAddr("market");
    address token = makeAddr("launchToken");
    address submitter = makeAddr("randomSubmitter");

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address guardian = makeAddr("guardianSafe");

    uint256 att1Key = 0xA11CE;
    uint256 att2Key = 0xB0B;
    uint256 att3Key = 0xC0FFEE;
    uint256 rogueKey = 0xBAD;

    address att1;
    address att2;
    address att3;

    function setUp() public {
        vault = new HolderRewardVault(governance, factory);
        asset = new MockAsset(18);

        att1 = vm.addr(att1Key);
        att2 = vm.addr(att2Key);
        att3 = vm.addr(att3Key);

        vm.startPrank(governance);
        vault.addAttestor(att1);
        vault.addAttestor(att2);
        vault.addAttestor(att3);
        vault.setQuorum(2);
        vm.stopPrank();

        vm.prank(factory);
        vault.registerMarket(market, address(asset));
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    function _fund(uint256 amount) internal {
        asset.mint(address(vault), amount);
        vm.prank(market);
        vault.fund(amount);
    }

    function _leaf(address account, uint256 cumulative) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, cumulative))));
    }

    /// @dev Two-leaf tree: root = hash of the sorted pair.
    function _root(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _commitment(uint256 epochSeq, uint256 totalCumulative, bytes32 root)
        internal
        view
        returns (HolderRewardVault.Commitment memory)
    {
        return HolderRewardVault.Commitment({
            market: market,
            token: token,
            rewardAsset: address(asset),
            distributionVersion: 1,
            epochSequence: epochSeq,
            totalCumulative: totalCumulative,
            merkleRoot: root,
            datasetHash: keccak256("dataset")
        });
    }

    /// @dev Sign with two attestors, returned in ascending signer order.
    function _sign(HolderRewardVault.Commitment memory c) internal view returns (bytes[] memory sigs) {
        bytes32 digest = vault.hashCommitment(c);

        (uint256 loKey, uint256 hiKey) = att1 < att2 ? (att1Key, att2Key) : (att2Key, att1Key);

        sigs = new bytes[](2);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(loKey, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(hiKey, digest);
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);
    }

    // -----------------------------------------------------------------------
    // Conservation — the invariant that matters (§359, §364)
    // -----------------------------------------------------------------------

    function test_cannotCommitMoreThanFunded() public {
        _fund(100e18);

        HolderRewardVault.Commitment memory c = _commitment(1, 101e18, keccak256("root"));

        // Sign BEFORE arming expectRevert: _sign calls vault.hashCommitment, and
        // that external call would otherwise consume the expectation.
        bytes[] memory sigs = _sign(c);

        vm.expectRevert(
            abi.encodeWithSelector(HolderRewardVault.EntitlementExceedsFunding.selector, 101e18, 100e18)
        );
        vault.submitCommitment(c, sigs);
    }

    function test_commitmentUpToFundingIsAccepted() public {
        _fund(100e18);

        HolderRewardVault.Commitment memory c = _commitment(1, 100e18, keccak256("root"));
        vault.submitCommitment(c, _sign(c));

        (bytes32 root,, uint256 total,,) = vault.pending(market);
        assertEq(root, keccak256("root"));
        assertEq(total, 100e18);
    }

    // -----------------------------------------------------------------------
    // Permissionless submission, zero privilege (§404)
    // -----------------------------------------------------------------------

    function test_anyoneMaySubmitAndGainsNothing() public {
        _fund(100e18);

        HolderRewardVault.Commitment memory c = _commitment(1, 60e18, keccak256("root"));

        vm.prank(submitter);
        vault.submitCommitment(c, _sign(c));

        assertEq(asset.balanceOf(submitter), 0, "submitter must receive nothing");
        assertEq(vault.claimedBy(market, submitter), 0, "submitter gains no entitlement");
    }

    // -----------------------------------------------------------------------
    // Quorum and signature integrity (§596)
    // -----------------------------------------------------------------------

    function test_belowQuorumRejected() public {
        _fund(100e18);
        HolderRewardVault.Commitment memory c = _commitment(1, 60e18, keccak256("root"));

        bytes32 digest = vault.hashCommitment(c);
        bytes[] memory one = new bytes[](1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(att1Key, digest);
        one[0] = abi.encodePacked(r, s, v);

        vm.expectRevert(abi.encodeWithSelector(HolderRewardVault.QuorumNotMet.selector, 1, 2));
        vault.submitCommitment(c, one);
    }

    /// @dev The same attestor twice must not satisfy a quorum of two.
    function test_duplicateSignatureCannotFakeQuorum() public {
        _fund(100e18);
        HolderRewardVault.Commitment memory c = _commitment(1, 60e18, keccak256("root"));

        bytes32 digest = vault.hashCommitment(c);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(att1Key, digest);

        bytes[] memory dupes = new bytes[](2);
        dupes[0] = abi.encodePacked(r, s, v);
        dupes[1] = abi.encodePacked(r, s, v);

        vm.expectRevert(HolderRewardVault.SignaturesNotSorted.selector);
        vault.submitCommitment(c, dupes);
    }

    function test_nonAttestorSignatureRejected() public {
        _fund(100e18);
        HolderRewardVault.Commitment memory c = _commitment(1, 60e18, keccak256("root"));

        bytes32 digest = vault.hashCommitment(c);
        address rogue = vm.addr(rogueKey);

        // Pair a real attestor with a rogue, ordered correctly so the sort check
        // passes and the attestor check is what actually rejects it.
        (uint256 loKey, uint256 hiKey) = att1 < rogue ? (att1Key, rogueKey) : (rogueKey, att1Key);

        bytes[] memory sigs = new bytes[](2);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(loKey, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(hiKey, digest);
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);

        vm.expectRevert(abi.encodeWithSelector(HolderRewardVault.NotAnAttestor.selector, rogue));
        vault.submitCommitment(c, sigs);
    }

    /// @dev §405: a signature must be useless against a different market.
    function test_signatureCannotBeReplayedAcrossMarkets() public {
        _fund(100e18);

        address market2 = makeAddr("market2");
        vm.prank(factory);
        vault.registerMarket(market2, address(asset));

        HolderRewardVault.Commitment memory c = _commitment(1, 60e18, keccak256("root"));
        bytes[] memory sigs = _sign(c);

        // Same signatures, different market — the digest changes, so recovery
        // yields addresses that are not attestors.
        HolderRewardVault.Commitment memory c2 = c;
        c2.market = market2;

        vm.expectRevert();
        vault.submitCommitment(c2, sigs);
    }

    // -----------------------------------------------------------------------
    // Activation delay (§334)
    // -----------------------------------------------------------------------

    function test_claimRequiresActivation() public {
        _fund(100e18);

        bytes32 leafA = _leaf(alice, 60e18);
        bytes32 leafB = _leaf(bob, 40e18);
        bytes32 root = _root(leafA, leafB);

        HolderRewardVault.Commitment memory c = _commitment(1, 100e18, root);
        vault.submitCommitment(c, _sign(c));

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;

        // Not yet active: there is no active root at all.
        vm.expectRevert(HolderRewardVault.InvalidProof.selector);
        vault.claim(market, alice, 60e18, proof);

        // Cannot rush it.
        vm.expectRevert();
        vault.activate(market);

        vm.warp(block.timestamp + vault.ACTIVATION_DELAY());
        vault.activate(market);

        uint256 payout = vault.claim(market, alice, 60e18, proof);
        assertEq(payout, 60e18, "alice receives her cumulative entitlement");
        assertEq(asset.balanceOf(alice), 60e18);
    }

    // -----------------------------------------------------------------------
    // Cumulative claim semantics (§336, §337)
    // -----------------------------------------------------------------------

    function test_replayedClaimPaysZero() public {
        _fund(100e18);

        bytes32 leafA = _leaf(alice, 60e18);
        bytes32 leafB = _leaf(bob, 40e18);
        bytes32 root = _root(leafA, leafB);

        HolderRewardVault.Commitment memory c = _commitment(1, 100e18, root);
        vault.submitCommitment(c, _sign(c));
        vm.warp(block.timestamp + vault.ACTIVATION_DELAY());
        vault.activate(market);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;

        vault.claim(market, alice, 60e18, proof);

        vm.expectRevert(HolderRewardVault.NothingToClaim.selector);
        vault.claim(market, alice, 60e18, proof);

        assertEq(asset.balanceOf(alice), 60e18, "alice was paid exactly once");
    }

    /// @dev A later cumulative root pays only the difference.
    function test_secondEpochPaysOnlyTheDelta() public {
        _fund(200e18);

        bytes32 leafA1 = _leaf(alice, 60e18);
        bytes32 leafB1 = _leaf(bob, 40e18);
        HolderRewardVault.Commitment memory c1 = _commitment(1, 100e18, _root(leafA1, leafB1));
        vault.submitCommitment(c1, _sign(c1));
        vm.warp(block.timestamp + vault.ACTIVATION_DELAY());
        vault.activate(market);

        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = leafB1;
        vault.claim(market, alice, 60e18, p1);

        // Epoch 2: alice's cumulative rises to 90.
        bytes32 leafA2 = _leaf(alice, 90e18);
        bytes32 leafB2 = _leaf(bob, 70e18);
        HolderRewardVault.Commitment memory c2 = _commitment(2, 160e18, _root(leafA2, leafB2));
        vault.submitCommitment(c2, _sign(c2));
        vm.warp(block.timestamp + vault.ACTIVATION_DELAY());
        vault.activate(market);

        bytes32[] memory p2 = new bytes32[](1);
        p2[0] = leafB2;
        uint256 payout = vault.claim(market, alice, 90e18, p2);

        assertEq(payout, 30e18, "only the delta is paid");
        assertEq(asset.balanceOf(alice), 90e18, "cumulative honoured exactly once");
    }

    function test_staleEpochRejected() public {
        _fund(200e18);

        bytes32 root1 = _root(_leaf(alice, 60e18), _leaf(bob, 40e18));
        HolderRewardVault.Commitment memory c1 = _commitment(5, 100e18, root1);
        vault.submitCommitment(c1, _sign(c1));
        vm.warp(block.timestamp + vault.ACTIVATION_DELAY());
        vault.activate(market);

        HolderRewardVault.Commitment memory old = _commitment(4, 120e18, keccak256("older"));
        bytes[] memory oldSigs = _sign(old);

        vm.expectRevert(abi.encodeWithSelector(HolderRewardVault.StaleCommitment.selector, 4, 5));
        vault.submitCommitment(old, oldSigs);
    }

    function test_forgedProofRejected() public {
        _fund(100e18);

        bytes32 leafA = _leaf(alice, 60e18);
        bytes32 leafB = _leaf(bob, 40e18);
        HolderRewardVault.Commitment memory c = _commitment(1, 100e18, _root(leafA, leafB));
        vault.submitCommitment(c, _sign(c));
        vm.warp(block.timestamp + vault.ACTIVATION_DELAY());
        vault.activate(market);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;

        // Alice claiming more than her committed leaf must fail.
        vm.expectRevert(HolderRewardVault.InvalidProof.selector);
        vault.claim(market, alice, 99e18, proof);
    }

    // -----------------------------------------------------------------------
    // Attestor set safety
    // -----------------------------------------------------------------------

    function test_removingAttestorCannotStrandQuorum() public {
        vm.startPrank(governance);
        vault.removeAttestor(att3); // 3 -> 2 attestors, quorum 2: still reachable
        assertEq(vault.attestorCount(), 2);

        vm.expectRevert(abi.encodeWithSelector(HolderRewardVault.QuorumTooHigh.selector, 2, 1));
        vault.removeAttestor(att2);
        vm.stopPrank();

        // Funds must never become unreachable because the signer set was shrunk
        // below its own quorum.
        assertEq(vault.attestorCount(), 2, "attestor set stays quorum-reachable");
    }

    // -----------------------------------------------------------------------
    // Guardian — §589, §590, §591
    // -----------------------------------------------------------------------

    function _activeRoot() internal returns (bytes32 leafB) {
        _fund(100e18);
        bytes32 leafA = _leaf(alice, 60e18);
        leafB = _leaf(bob, 40e18);
        HolderRewardVault.Commitment memory c = _commitment(1, 100e18, _root(leafA, leafB));
        vault.submitCommitment(c, _sign(c));
        vm.warp(block.timestamp + vault.ACTIVATION_DELAY());
        vault.activate(market);
    }

    /// @dev The power §589 names explicitly: stop a suspicious root before it goes
    ///      live. Without it the activation delay is a countdown, not a defence.
    function test_guardianCanStopASuspiciousRootBeforeItActivates() public {
        vm.prank(governance);
        vault.setGuardian(guardian);

        _fund(100e18);
        HolderRewardVault.Commitment memory bad =
            _commitment(1, 100e18, _root(_leaf(alice, 100e18), _leaf(bob, 0)));
        vault.submitCommitment(bad, _sign(bad));

        vm.prank(guardian);
        vault.cancelPendingCommitment(market, "dataset mismatch across indexers");

        vm.warp(block.timestamp + vault.ACTIVATION_DELAY());

        vm.expectRevert(HolderRewardVault.InvalidProof.selector);
        vault.activate(market);
    }

    function test_guardianPauseFreezesClaimsAndActivations() public {
        vm.prank(governance);
        vault.setGuardian(guardian);

        bytes32 leafB = _activeRoot();

        vm.prank(guardian);
        vault.pauseClaims("suspected attestor compromise");

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;

        vm.expectRevert(HolderRewardVault.ClaimsArePaused.selector);
        vault.claim(market, alice, 60e18, proof);
    }

    /// @dev §591: the actor that pulls the brake must not be the one that releases
    ///      it. Governance investigates first.
    function test_guardianCannotUnpauseOnlyGovernanceCan() public {
        vm.prank(governance);
        vault.setGuardian(guardian);

        bytes32 leafB = _activeRoot();

        vm.prank(guardian);
        vault.pauseClaims("suspected attestor compromise");

        vm.prank(guardian);
        vm.expectRevert(HolderRewardVault.NotGovernance.selector);
        vault.unpauseClaims();

        vm.prank(governance);
        vault.unpauseClaims();

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;
        assertEq(vault.claim(market, alice, 60e18, proof), 60e18, "claims resume after governance approval");
    }

    /// @dev §590: the Guardian is a brake, never a steering wheel. It has no path
    ///      to funds, roots, governance or the attestor set - the absence of those
    ///      functions IS the guarantee, so this asserts what it can reach.
    function test_guardianCannotMoveFundsOrInstallRoots() public {
        vm.prank(governance);
        vault.setGuardian(guardian);
        _fund(100e18);

        vm.startPrank(guardian);

        vm.expectRevert(HolderRewardVault.NotGovernance.selector);
        vault.addAttestor(guardian);

        vm.expectRevert(HolderRewardVault.NotGovernance.selector);
        vault.setQuorum(1);

        vm.expectRevert(HolderRewardVault.NotGovernance.selector);
        vault.transferGovernance(guardian);

        vm.expectRevert(HolderRewardVault.NotGovernance.selector);
        vault.setGuardian(guardian);

        vm.stopPrank();

        assertEq(asset.balanceOf(guardian), 0, "guardian holds nothing");
        assertEq(vault.funded(market), 100e18, "funding untouched");
    }

    /// @dev A pause must not strand funding or block evidence gathering: markets
    ///      keep funding and attestors keep submitting. Only money stops moving.
    function test_pauseDoesNotStallFundingOrSubmission() public {
        vm.prank(governance);
        vault.setGuardian(guardian);

        _fund(100e18);

        vm.prank(guardian);
        vault.pauseClaims("investigating");

        _fund(50e18);
        assertEq(vault.funded(market), 150e18, "funding continues while paused");

        HolderRewardVault.Commitment memory c =
            _commitment(2, 150e18, _root(_leaf(alice, 90e18), _leaf(bob, 60e18)));
        vault.submitCommitment(c, _sign(c));

        (, , uint256 total,,) = vault.pending(market);
        assertEq(total, 150e18, "submission continues while paused");
    }

    function test_onlyFactoryRegistersMarkets() public {
        vm.expectRevert(HolderRewardVault.NotFactory.selector);
        vault.registerMarket(makeAddr("rogueMarket"), address(asset));
    }

    /// @dev A pending commitment sits inside its activation delay. Overwriting it
    ///      with an OLDER (but still newer-than-active) commitment would both roll
    ///      entitlements backwards and restart the delay - a downgrade and a
    ///      griefing vector in one.
    function test_pendingCommitmentCannotBeDowngraded() public {
        _fund(200e18);

        bytes32 rootHigh = _root(_leaf(alice, 90e18), _leaf(bob, 70e18));
        HolderRewardVault.Commitment memory high = _commitment(9, 160e18, rootHigh);
        vault.submitCommitment(high, _sign(high));

        (, , uint256 pendingTotal, uint256 pendingSeq,) = vault.pending(market);
        assertEq(pendingSeq, 9, "the newer commitment is pending");
        assertEq(pendingTotal, 160e18);

        // An older commitment, still ahead of `active` (which is empty), should not
        // be able to replace what is already pending.
        bytes32 rootLow = _root(_leaf(alice, 10e18), _leaf(bob, 10e18));
        HolderRewardVault.Commitment memory low = _commitment(8, 20e18, rootLow);
        bytes[] memory lowSigs = _sign(low);

        vm.expectRevert(abi.encodeWithSelector(HolderRewardVault.StaleCommitment.selector, 8, 9));
        vault.submitCommitment(low, lowSigs);

        (, , uint256 stillTotal, uint256 stillSeq,) = vault.pending(market);
        assertEq(stillSeq, 9, "pending must not be downgraded");
        assertEq(stillTotal, 160e18, "entitlements must not roll backwards");
    }

    /// @dev A genuinely newer commitment may still supersede a pending one.
    function test_pendingCanBeSupersededByANewerCommitment() public {
        _fund(200e18);

        HolderRewardVault.Commitment memory first =
            _commitment(3, 100e18, _root(_leaf(alice, 60e18), _leaf(bob, 40e18)));
        vault.submitCommitment(first, _sign(first));

        HolderRewardVault.Commitment memory second =
            _commitment(4, 150e18, _root(_leaf(alice, 90e18), _leaf(bob, 60e18)));
        vault.submitCommitment(second, _sign(second));

        (, , uint256 total, uint256 seq,) = vault.pending(market);
        assertEq(seq, 4, "a newer commitment supersedes the pending one");
        assertEq(total, 150e18);
    }

    function test_onlyMarketCanFund() public {
        vm.expectRevert(HolderRewardVault.NotMarket.selector);
        vault.fund(1e18);
    }
}

contract XStockAssetAdapterTest is Test {
    using XStockAssetAdapter for XStockAssetAdapter.AssetConfig;

    function _cfg(uint8 decimals_, bool multiplier) internal pure returns (XStockAssetAdapter.AssetConfig memory) {
        return XStockAssetAdapter.AssetConfig({
            asset: address(0xBEEF),
            decimals: decimals_,
            hasMultiplierSemantics: multiplier
        });
    }

    function test_eighteenDecimalsIsIdentity() public pure {
        XStockAssetAdapter.AssetConfig memory c = _cfg(18, false);
        assertEq(XStockAssetAdapter.toNormalized(c, 12345), 12345);
        assertEq(XStockAssetAdapter.toRawForPayout(c, 12345), 12345);
        assertEq(XStockAssetAdapter.toRawForCharge(c, 12345), 12345);
    }

    function test_sixDecimalsScales() public pure {
        XStockAssetAdapter.AssetConfig memory c = _cfg(6, false);

        assertEq(XStockAssetAdapter.toNormalized(c, 1_000_000), 1e18, "1.0 unit -> 1e18 normalized");
        assertEq(XStockAssetAdapter.toRawForPayout(c, 1e18), 1_000_000, "round trip exact on whole units");
        assertEq(XStockAssetAdapter.dustFloor(c), 1e12, "sub-1e12 normalized is unrepresentable");
    }

    /// @dev The rounding direction is the whole point: payouts floor, charges ceil.
    function test_payoutFloorsAndChargeCeils() public pure {
        XStockAssetAdapter.AssetConfig memory c = _cfg(6, false);

        uint256 awkward = 1e18 + 1; // one wei above a representable amount

        assertEq(XStockAssetAdapter.toRawForPayout(c, awkward), 1_000_000, "payout must never round up");
        assertEq(XStockAssetAdapter.toRawForCharge(c, awkward), 1_000_001, "charge must never round down");
    }

    function testFuzz_payoutNeverExceedsRequested(uint8 decimals_, uint256 normalized) public pure {
        decimals_ = uint8(bound(decimals_, 0, 18));
        normalized = bound(normalized, 0, 1e30);

        XStockAssetAdapter.AssetConfig memory c = _cfg(decimals_, false);

        uint256 raw = XStockAssetAdapter.toRawForPayout(c, normalized);
        uint256 settled = XStockAssetAdapter.settledNormalized(c, raw);

        assertLe(settled, normalized, "a payout must never settle more than intended");
    }

    function testFuzz_chargeNeverUndercharges(uint8 decimals_, uint256 normalized) public pure {
        decimals_ = uint8(bound(decimals_, 0, 18));
        normalized = bound(normalized, 0, 1e30);

        XStockAssetAdapter.AssetConfig memory c = _cfg(decimals_, false);

        uint256 raw = XStockAssetAdapter.toRawForCharge(c, normalized);
        uint256 settled = XStockAssetAdapter.settledNormalized(c, raw);

        assertGe(settled, normalized, "a charge must never settle less than intended");
    }

    /// @dev §421/§279: an unverified multiplier asset must fail loudly, not quietly
    ///      produce a plausible-looking wrong number.
    function test_multiplierSemanticsRevertUntilVerified() public {
        XStockAssetAdapter.AssetConfig memory c = _cfg(18, true);

        vm.expectRevert(
            abi.encodeWithSelector(XStockAssetAdapter.MultiplierSemanticsUnverified.selector, address(0xBEEF))
        );
        this.callToNormalized(c, 1e18);
    }

    function callToNormalized(XStockAssetAdapter.AssetConfig memory c, uint256 amount)
        external
        pure
        returns (uint256)
    {
        return XStockAssetAdapter.toNormalized(c, amount);
    }
}
