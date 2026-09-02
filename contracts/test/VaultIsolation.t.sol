// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {FeeVault} from "../src/FeeVault.sol";
import {HolderRewardVault} from "../src/HolderRewardVault.sol";
import {Fees} from "../src/lib/Fees.sol";

contract IsoAsset is ERC20 {
    constructor(string memory n) ERC20(n, n) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Cross-market and cross-creator isolation in both vaults.
///
/// Both vaults hold a POOLED balance: every market paired against the same xStock
/// shares one ERC-20 balance inside one contract. Per-market accounting is the
/// only thing separating them.
///
/// If that accounting leaks, one market's funds pay another market's claims. The
/// vault stays solvent in aggregate, every individual transfer succeeds, and
/// nothing looks wrong until the last market to claim finds an empty balance —
/// by which point the money is gone and attributing it is archaeology.
///
/// None of this was covered before: every existing vault test used a single
/// market and a single creator, where a leak is invisible by construction.
contract VaultIsolationTest is Test {
    FeeVault feeVault;
    HolderRewardVault rewardVault;
    IsoAsset assetA;
    IsoAsset assetB;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address factory = address(this);

    address marketOne = makeAddr("marketOne");
    address marketTwo = makeAddr("marketTwo");
    address marketThree = makeAddr("marketThree");

    address creatorOne = makeAddr("creatorOne");
    address creatorTwo = makeAddr("creatorTwo");

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 att1Key = 0xA11CE;
    uint256 att2Key = 0xB0B;
    address att1;
    address att2;

    function setUp() public {
        feeVault = new FeeVault(governance, treasury, factory);
        rewardVault = new HolderRewardVault(governance, factory);

        assetA = new IsoAsset("NVDAx");
        assetB = new IsoAsset("SPYx");

        att1 = vm.addr(att1Key);
        att2 = vm.addr(att2Key);

        vm.startPrank(governance);
        rewardVault.addAttestor(att1);
        rewardVault.addAttestor(att2);
        rewardVault.setQuorum(2);
        vm.stopPrank();

        feeVault.registerMarket(marketOne);
        feeVault.registerMarket(marketTwo);
        feeVault.registerMarket(marketThree);

        // Two markets share a reward asset; the third uses a different one.
        rewardVault.registerMarket(marketOne, address(assetA));
        rewardVault.registerMarket(marketTwo, address(assetA));
        rewardVault.registerMarket(marketThree, address(assetB));
    }

    // -----------------------------------------------------------------------
    // FeeVault
    // -----------------------------------------------------------------------

    function _accrue(address market, address creator, IsoAsset asset, uint256 core) internal {
        (uint256 creatorAmt, uint256 platformAmt) = Fees.splitCore(core);
        asset.mint(address(feeVault), core);
        vm.prank(market);
        feeVault.accrue(creator, address(asset), creatorAmt, platformAmt);
    }

    /// @dev One creator claiming must not touch another creator's balance, even
    ///      though both sit in the same asset in the same contract.
    function test_oneCreatorCannotDrainAnother() public {
        _accrue(marketOne, creatorOne, assetA, 1_000e18);
        _accrue(marketTwo, creatorTwo, assetA, 400e18);

        uint256 expectedOne = feeVault.creatorBalance(creatorOne, address(assetA));
        uint256 expectedTwo = feeVault.creatorBalance(creatorTwo, address(assetA));

        assertGt(expectedOne, expectedTwo, "the two creators earned different amounts");

        vm.prank(creatorOne);
        uint256 claimed = feeVault.claimCreatorFees(address(assetA), address(0));

        assertEq(claimed, expectedOne, "creator one receives exactly their own accrual");
        assertEq(
            feeVault.creatorBalance(creatorTwo, address(assetA)),
            expectedTwo,
            "creator two's balance is untouched"
        );

        // And creator two can still claim in full afterwards.
        vm.prank(creatorTwo);
        assertEq(
            feeVault.claimCreatorFees(address(assetA), address(0)),
            expectedTwo,
            "creator two can still claim everything they earned"
        );

        // What remains is the PLATFORM share, which settles separately to the
        // Treasury Safe. Asserting zero here was wrong: it would have required
        // creator claims to somehow consume platform revenue too.
        uint256 platformShare = feeVault.platformBalance(address(assetA));
        assertEq(
            feeVault.outstanding(address(assetA)),
            platformShare,
            "only the platform share remains after both creators claim"
        );

        feeVault.settlePlatformFees(address(assetA));
        assertEq(feeVault.outstanding(address(assetA)), 0, "the vault then settles to exactly zero");
        assertEq(assetA.balanceOf(address(feeVault)), 0, "and holds nothing");
    }

    /// @dev A creator earning across several markets accrues into one balance per
    ///      asset, and claims it once.
    function test_creatorAccrualAcrossMarketsAggregates() public {
        _accrue(marketOne, creatorOne, assetA, 1_000e18);
        _accrue(marketTwo, creatorOne, assetA, 500e18);

        (uint256 expectOne,) = Fees.splitCore(1_000e18);
        (uint256 expectTwo,) = Fees.splitCore(500e18);

        assertEq(
            feeVault.creatorBalance(creatorOne, address(assetA)),
            expectOne + expectTwo,
            "accruals from both markets aggregate"
        );
    }

    /// @dev Balances are per (creator, asset). Claiming one asset must not touch
    ///      the other, or a creator paired against two xStocks could be paid twice
    ///      in the wrong denomination.
    function test_assetsAreIsolatedFromEachOther() public {
        _accrue(marketOne, creatorOne, assetA, 1_000e18);
        _accrue(marketThree, creatorOne, assetB, 700e18);

        uint256 expectB = feeVault.creatorBalance(creatorOne, address(assetB));

        vm.prank(creatorOne);
        feeVault.claimCreatorFees(address(assetA), address(0));

        assertEq(
            feeVault.creatorBalance(creatorOne, address(assetB)),
            expectB,
            "claiming one asset must not clear another"
        );
        assertEq(assetB.balanceOf(creatorOne), 0, "and must not pay in the wrong asset");
    }

    /// @dev The platform sweep must move only the platform's share, leaving every
    ///      creator balance intact even though they share the same balance.
    function test_platformSweepCannotReachCreatorBalances() public {
        _accrue(marketOne, creatorOne, assetA, 1_000e18);
        _accrue(marketTwo, creatorTwo, assetA, 400e18);

        uint256 creatorTotal = feeVault.creatorBalance(creatorOne, address(assetA))
            + feeVault.creatorBalance(creatorTwo, address(assetA));

        feeVault.settlePlatformFees(address(assetA));

        assertEq(
            feeVault.outstanding(address(assetA)),
            creatorTotal,
            "only the platform share left the vault"
        );
        assertGe(
            assetA.balanceOf(address(feeVault)),
            creatorTotal,
            "the vault still covers every creator balance"
        );
    }

    // -----------------------------------------------------------------------
    // HolderRewardVault
    // -----------------------------------------------------------------------

    function _fund(address market, IsoAsset asset, uint256 amount) internal {
        asset.mint(address(rewardVault), amount);
        vm.prank(market);
        rewardVault.fund(amount);
    }

    function _leaf(address account, uint256 cumulative) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, cumulative))));
    }

    function _root(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _build(address market, IsoAsset asset, uint256 total, bytes32 root)
        internal
        pure
        returns (HolderRewardVault.Commitment memory)
    {
        return HolderRewardVault.Commitment({
            market: market,
            token: address(0xBEEF),
            rewardAsset: address(asset),
            distributionVersion: 1,
            epochSequence: 1,
            totalCumulative: total,
            merkleRoot: root,
            datasetHash: keccak256("dataset")
        });
    }

    /// @dev Signing is SEPARATE from submitting, deliberately.
    ///
    ///      `hashCommitment` is an external view call, so signing inside the same
    ///      statement as `submitCommitment` consumes a pending `vm.expectRevert`
    ///      on the wrong call and the test passes for the wrong reason. That
    ///      mistake was made once in HolderRewardVault.t.sol and made again here,
    ///      which is why the helper now forces the split.
    function _sign(HolderRewardVault.Commitment memory c) internal view returns (bytes[] memory sigs) {
        bytes32 digest = rewardVault.hashCommitment(c);
        (uint256 loKey, uint256 hiKey) = att1 < att2 ? (att1Key, att2Key) : (att2Key, att1Key);

        sigs = new bytes[](2);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(loKey, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(hiKey, digest);
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);
    }

    function _commit(address market, IsoAsset asset, uint256 total, bytes32 root) internal {
        HolderRewardVault.Commitment memory c = _build(market, asset, total, root);
        rewardVault.submitCommitment(c, _sign(c));
    }

    /// @dev THE isolation test. Two markets share one reward asset and therefore
    ///      one pooled balance. A commitment for one must be bounded by that
    ///      market's own funding, never by the pooled total.
    function test_aMarketCannotCommitAgainstAnotherMarketsFunding() public {
        _fund(marketOne, assetA, 100e18);
        _fund(marketTwo, assetA, 900e18);

        // The vault physically holds 1,000. Market one was funded 100.
        assertEq(assetA.balanceOf(address(rewardVault)), 1_000e18, "pooled balance");
        assertEq(rewardVault.funded(marketOne), 100e18, "market one's own funding");

        // Committing 500 for market one would be covered by the pooled balance but
        // is not covered by market one's funding. It must be rejected.
        HolderRewardVault.Commitment memory c = _build(marketOne, assetA, 500e18, keccak256("root"));
        bytes[] memory sigs = _sign(c);

        vm.expectRevert(
            abi.encodeWithSelector(HolderRewardVault.EntitlementExceedsFunding.selector, 500e18, 100e18)
        );
        rewardVault.submitCommitment(c, sigs);
    }

    /// @dev Claims against one market must not consume another market's funding.
    function test_claimsDoNotCrossMarkets() public {
        _fund(marketOne, assetA, 100e18);
        _fund(marketTwo, assetA, 900e18);

        bytes32 leafA = _leaf(alice, 60e18);
        bytes32 leafB = _leaf(bob, 40e18);
        _commit(marketOne, assetA, 100e18, _root(leafA, leafB));

        vm.warp(block.timestamp + rewardVault.ACTIVATION_DELAY() + 1);
        rewardVault.activate(marketOne);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;
        rewardVault.claim(marketOne, alice, 60e18, proof);

        assertEq(rewardVault.claimed(marketOne), 60e18, "market one's claimed rises");
        assertEq(rewardVault.claimed(marketTwo), 0, "market two's claimed is untouched");
        assertEq(
            rewardVault.outstanding(marketTwo),
            900e18,
            "market two's obligation is unchanged by market one's payout"
        );
    }

    /// @dev A proof valid for one market must not verify against another, even
    ///      when both use the same asset and the same holder.
    function test_aProofDoesNotTransferBetweenMarkets() public {
        _fund(marketOne, assetA, 100e18);
        _fund(marketTwo, assetA, 100e18);

        bytes32 leafA = _leaf(alice, 60e18);
        bytes32 leafB = _leaf(bob, 40e18);
        bytes32 root = _root(leafA, leafB);

        _commit(marketOne, assetA, 100e18, root);
        vm.warp(block.timestamp + rewardVault.ACTIVATION_DELAY() + 1);
        rewardVault.activate(marketOne);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;

        // Market two has no active distribution at all.
        vm.expectRevert(HolderRewardVault.InvalidProof.selector);
        rewardVault.claim(marketTwo, alice, 60e18, proof);
    }

    /// @dev A commitment naming the wrong reward asset must be rejected, or a
    ///      market could be paid in an asset its holders never contributed.
    function test_aCommitmentCannotSwapTheRewardAsset() public {
        _fund(marketOne, assetA, 100e18);

        HolderRewardVault.Commitment memory c = _build(marketOne, assetB, 100e18, keccak256("root"));
        bytes[] memory sigs = _sign(c);

        vm.expectRevert(HolderRewardVault.WrongRewardAsset.selector);
        rewardVault.submitCommitment(c, sigs);
    }

    /// @dev Full drain across two markets sharing one asset: everything each
    ///      market was funded is claimable, and nothing more.
    function test_bothMarketsCanBeFullyDrainedIndependently() public {
        _fund(marketOne, assetA, 100e18);
        _fund(marketTwo, assetA, 300e18);

        bytes32 oneA = _leaf(alice, 100e18);
        bytes32 oneB = _leaf(bob, 0);
        _commit(marketOne, assetA, 100e18, _root(oneA, oneB));

        bytes32 twoA = _leaf(alice, 300e18);
        bytes32 twoB = _leaf(bob, 0);
        _commit(marketTwo, assetA, 300e18, _root(twoA, twoB));

        vm.warp(block.timestamp + rewardVault.ACTIVATION_DELAY() + 1);
        rewardVault.activate(marketOne);
        rewardVault.activate(marketTwo);

        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = oneB;
        bytes32[] memory p2 = new bytes32[](1);
        p2[0] = twoB;

        rewardVault.claim(marketOne, alice, 100e18, p1);
        rewardVault.claim(marketTwo, alice, 300e18, p2);

        assertEq(assetA.balanceOf(alice), 400e18, "alice receives both markets' entitlements");
        assertEq(rewardVault.outstanding(marketOne), 0, "market one fully settled");
        assertEq(rewardVault.outstanding(marketTwo), 0, "market two fully settled");
        assertEq(assetA.balanceOf(address(rewardVault)), 0, "the pooled balance is exactly exhausted");
    }

    /// @dev Guardian pause is vault-wide, not per market. That is deliberate — a
    ///      suspected attestor compromise affects every distribution the same
    ///      quorum signed — but it must be stated rather than discovered.
    function test_guardianPauseIsVaultWideByDesign() public {
        address guardian = makeAddr("guardianSafe");
        vm.prank(governance);
        rewardVault.setGuardian(guardian);

        _fund(marketOne, assetA, 100e18);
        _fund(marketThree, assetB, 100e18);

        bytes32 leafA = _leaf(alice, 100e18);
        bytes32 leafB = _leaf(bob, 0);
        _commit(marketOne, assetA, 100e18, _root(leafA, leafB));
        vm.warp(block.timestamp + rewardVault.ACTIVATION_DELAY() + 1);
        rewardVault.activate(marketOne);

        vm.prank(guardian);
        rewardVault.pauseClaims("suspected attestor compromise");

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;

        vm.expectRevert(HolderRewardVault.ClaimsArePaused.selector);
        rewardVault.claim(marketOne, alice, 100e18, proof);

        // Funding continues everywhere, so markets keep working while paused.
        _fund(marketThree, assetB, 50e18);
        assertEq(rewardVault.funded(marketThree), 150e18, "funding is unaffected by a pause");
    }
}
