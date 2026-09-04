// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";
import {ReferencePriceAdapter} from "../src/ReferencePriceAdapter.sol";
import {IGraduationRouter} from "../src/interfaces/IGraduationRouter.sol";
import {Metadata} from "../src/lib/Metadata.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

contract MQuote is ERC20 {
    constructor() ERC20("Mock NVDAx", "NVDAx") {}
}

contract MRouter is IGraduationRouter {
    function graduate(address token, address, uint256, uint256, uint256, uint256)
        external
        pure
        returns (address, uint256)
    {
        return (address(uint160(uint256(keccak256(abi.encode(token))))), 1);
    }

    function swapExactQuoteForToken(address, address, uint256, address) external pure returns (uint256) {
        return 0;
    }
}

/// @notice §95.20's metadata, on-chain.
///
/// The question every test here circles is the same one: **who can change what a
/// token says about itself.** The answer must be "its creator, visibly" — not
/// the platform, not silently, and not nobody.
contract MetadataTest is Test {
    LaunchpadFactory factory;
    XStockRegistry registry;
    ReferencePriceAdapter priceAdapter;
    MockAggregator feed;
    MQuote quote;
    MRouter router;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address creator = makeAddr("creator");
    address stranger = makeAddr("stranger");

    uint256 constant FEE = 0;
    uint256 constant XSTOCK_USD = 100e18;

    /// A real CIDv1. Not a placeholder — the CID is a hash of the image bytes,
    /// so a fake one would be a fake nobody could distinguish from a broken
    /// upload, which is the same failure this design exists to avoid.
    string constant CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

    function setUp() public {
        registry = new XStockRegistry(governance, address(0));
        quote = new MQuote();
        router = new MRouter();

        factory = new LaunchpadFactory(governance, treasury, address(registry), FEE);
        feed = new MockAggregator(int256(XSTOCK_USD / 1e10), 8);
        priceAdapter = new ReferencePriceAdapter(governance);

        vm.startPrank(governance);
        factory.setRouter(address(router));
        priceAdapter.configure(address(quote), address(feed), 1 hours, 1e18, 100_000e18);
        factory.setReferencePrice(address(priceAdapter));

        registry.registerAsset(address(quote), 18, 1385, 0);
        registry.setGates(
            address(quote),
            XStockRegistry.Gates({
                canonicalRepresentation: true,
                transferBehaviour: true,
                multiplierBehaviour: true,
                priceSource: true,
                haltSource: true,
                hyperSwapCompatible: true,
                normalizedAccountingTested: true,
                legalReviewed: true
            })
        );
        registry.enableAsset(address(quote));
        vm.stopPrank();
    }

    function _content(string memory description) internal pure returns (Metadata.Content memory) {
        Metadata.Link[] memory links = new Metadata.Link[](2);
        links[0] = Metadata.Link({label: "website", url: "https://example.com"});
        links[1] = Metadata.Link({label: "x", url: "https://x.com/example"});

        return Metadata.Content({description: description, imageCid: CID, links: links});
    }

    function _launch(Metadata.Content memory content, bytes32 salt) internal returns (address token) {
        LaunchpadFactory.LaunchParams memory p = LaunchpadFactory.LaunchParams({
            name: "Sent Test",
            symbol: "TEST",
            quoteAsset: address(quote),
            userSalt: salt,
            launchIntentHash: keccak256(abi.encode(content)),
            xStockUsdWad: XSTOCK_USD,
            expectedToken: address(0),
            metadata: content
        });

        vm.prank(creator);
        (token,) = factory.launch(p);
    }

    // -----------------------------------------------------------------------
    // The content reaches the chain
    // -----------------------------------------------------------------------

    /// @dev The decode lives in its own function. Inlined, this hits `via_ir`'s
    ///      stack limit — three strings, a dynamic array and the loop indices
    ///      are more live values than the optimiser can place.
    function _findMetadataLog(Vm.Log[] memory logs)
        internal
        pure
        returns (bool found, address token, address who, uint256 revision, bytes memory data)
    {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != LaunchpadFactory.LaunchMetadata.selector) continue;

            return (
                true,
                address(uint160(uint256(logs[i].topics[1]))),
                address(uint160(uint256(logs[i].topics[2]))),
                uint256(logs[i].topics[3]),
                logs[i].data
            );
        }

        return (false, address(0), address(0), 0, "");
    }

    function test_metadataIsPublishedAtLaunch() public {
        vm.recordLogs();
        address launched = _launch(_content("a market for something"), bytes32(uint256(1)));

        (bool found, address token, address who, uint256 revision, bytes memory data) =
            _findMetadataLog(vm.getRecordedLogs());

        assertTrue(found, "metadata must be emitted at launch");
        assertEq(token, launched, "indexed by token");
        assertEq(who, creator, "and by creator");
        assertEq(revision, 0, "launch is revision zero");

        _assertContent(data);
    }

    function _assertContent(bytes memory data) internal pure {
        (string memory description, string memory cid, Metadata.Link[] memory links) =
            abi.decode(data, (string, string, Metadata.Link[]));

        assertEq(description, "a market for something", "the description as written");
        assertEq(cid, CID, "the image CID");
        assertEq(links.length, 2, "both links");
        assertEq(links[1].url, "https://x.com/example", "in order");
    }

    /// @dev The loop this design closes.
    ///
    ///      `launchIntentHash` has always been bound into the CREATE2 salt, and
    ///      the factory has always called it the hash of "the launch intent the
    ///      creator reviewed (metadata, socials)". The commitment was in the
    ///      address; the content was published nowhere, so nobody could check it.
    ///
    ///      With the content on-chain, anyone can.
    function test_thePublishedContentHashesToTheAddressCommitment() public {
        Metadata.Content memory content = _content("verifiable");
        bytes32 intentHash = keccak256(abi.encode(content));

        address token = _launch(content, bytes32(uint256(2)));

        // The salt that produced the address commits to the intent hash. Recompute
        // it from the published content and check the token really is at the
        // address that commitment implies.
        bytes32 effectiveSalt =
            factory.computeEffectiveSalt(creator, bytes32(uint256(2)), address(quote), intentHash);

        assertEq(
            factory.predictTokenAddress(effectiveSalt, "Sent Test", "TEST", creator),
            token,
            "published metadata must hash to the commitment in the address"
        );
    }

    /// @dev And the negative: different content, different address. Otherwise
    ///      the check above would pass for metadata that was never reviewed.
    function test_differentContentWouldHaveProducedADifferentAddress() public {
        Metadata.Content memory content = _content("verifiable");
        address token = _launch(content, bytes32(uint256(3)));

        Metadata.Content memory tampered = _content("something else entirely");
        bytes32 effectiveSalt = factory.computeEffectiveSalt(
            creator, bytes32(uint256(3)), address(quote), keccak256(abi.encode(tampered))
        );

        assertTrue(
            factory.predictTokenAddress(effectiveSalt, "Sent Test", "TEST", creator) != token,
            "tampered metadata must not hash to this token's address"
        );
    }

    function test_metadataMayBeEmpty() public {
        Metadata.Content memory bare = Metadata.Content({
            description: "",
            imageCid: "",
            links: new Metadata.Link[](0)
        });

        // A launch with nothing to say is a launch, not an error. Requiring a
        // description would only produce descriptions written to satisfy a
        // validator.
        address token = _launch(bare, bytes32(uint256(4)));
        assertTrue(token != address(0), "empty metadata is allowed");
    }

    // -----------------------------------------------------------------------
    // Revisions: the creator, and nobody else
    // -----------------------------------------------------------------------

    function test_theCreatorCanReviseTheirOwnMetadata() public {
        address token = _launch(_content("first draft"), bytes32(uint256(5)));

        vm.prank(creator);
        factory.reviseMetadata(token, _content("corrected"));

        assertEq(factory.metadataRevision(token), 1, "revision increments");
    }

    function test_aStrangerCannotReviseSomeoneElsesMetadata() public {
        address token = _launch(_content("mine"), bytes32(uint256(6)));

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchpadFactory.NotTheCreator.selector, token, stranger)
        );
        factory.reviseMetadata(token, _content("not yours"));
    }

    /// @dev §27's admin boundary, at the one place metadata could have breached
    ///      it. The whole reason this is on-chain rather than in the platform's
    ///      database is that a description in a database is one the platform can
    ///      silently rewrite — so governance having a path here would give back
    ///      exactly what the design was meant to remove.
    function test_governanceCannotReviseAnyonesMetadata() public {
        address token = _launch(_content("mine"), bytes32(uint256(7)));

        vm.prank(governance);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchpadFactory.NotTheCreator.selector, token, governance)
        );
        factory.reviseMetadata(token, _content("governance says otherwise"));
    }

    function test_revisingAnUnknownTokenIsRefused() public {
        address ghost = makeAddr("neverLaunched");

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(LaunchpadFactory.UnknownToken.selector, ghost));
        factory.reviseMetadata(ghost, _content("hello"));
    }

    /// @dev A revision is visibly a revision. The launch-time content stays
    ///      published in its own event and still hashes to the address, so
    ///      history is added to rather than rewritten.
    function test_revisionsAreNumberedAndDoNotRewriteTheLaunch() public {
        address token = _launch(_content("original"), bytes32(uint256(8)));

        vm.startPrank(creator);
        factory.reviseMetadata(token, _content("second"));
        factory.reviseMetadata(token, _content("third"));
        vm.stopPrank();

        assertEq(factory.metadataRevision(token), 2, "two revisions after the launch");

        // The launch-time commitment is unreachable from `reviseMetadata` — it
        // lives in the token's address, which no function can change.
        bytes32 effectiveSalt = factory.computeEffectiveSalt(
            creator, bytes32(uint256(8)), address(quote), keccak256(abi.encode(_content("original")))
        );
        assertEq(
            factory.predictTokenAddress(effectiveSalt, "Sent Test", "TEST", creator),
            token,
            "revisions never touch the launch-time commitment"
        );
    }

    /// @dev Two revisions in one block are indistinguishable without a counter,
    ///      and log index is not an ordering the chain promises across a reorg.
    function test_revisionsInOneBlockAreStillOrdered() public {
        address token = _launch(_content("original"), bytes32(uint256(9)));

        vm.recordLogs();

        vm.startPrank(creator);
        factory.reviseMetadata(token, _content("a"));
        factory.reviseMetadata(token, _content("b"));
        vm.stopPrank();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256[] memory revisions = new uint256[](2);
        uint256 seen;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != LaunchpadFactory.LaunchMetadata.selector) continue;
            revisions[seen++] = uint256(logs[i].topics[3]);
        }

        assertEq(seen, 2, "both revisions emitted");
        assertEq(revisions[0], 1, "first is revision 1");
        assertEq(revisions[1], 2, "second is revision 2");
    }

    // -----------------------------------------------------------------------
    // Bounds
    // -----------------------------------------------------------------------

    function test_anOverlongDescriptionIsRefusedAtLaunch() public {
        Metadata.Content memory content = _content(_repeat("x", 513));

        LaunchpadFactory.LaunchParams memory p = LaunchpadFactory.LaunchParams({
            name: "Sent Test",
            symbol: "TEST",
            quoteAsset: address(quote),
            userSalt: bytes32(uint256(10)),
            launchIntentHash: keccak256("intent"),
            xStockUsdWad: XSTOCK_USD,
            expectedToken: address(0),
            metadata: content
        });

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(Metadata.DescriptionTooLong.selector, uint256(513), uint256(512))
        );
        factory.launch(p);
    }

    function test_exactlyTheLimitIsAccepted() public {
        // Off by one here is a creator whose description fits and is refused,
        // with no way to tell which character was the problem.
        address token = _launch(_content(_repeat("x", 512)), bytes32(uint256(11)));
        assertTrue(token != address(0), "512 bytes is within the limit");
    }

    function test_anOverlongCidIsRefused() public {
        address token = _launch(_content("fine"), bytes32(uint256(20)));

        Metadata.Content memory content = _content("fine");
        content.imageCid = _repeat("Q", 129);

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(Metadata.CidTooLong.selector, uint256(129), uint256(128))
        );
        factory.reviseMetadata(token, content);
    }

    function test_tooManyLinksAreRefused() public {
        address token = _launch(_content("fine"), bytes32(uint256(21)));

        Metadata.Content memory content = _content("fine");
        content.links = new Metadata.Link[](5);
        for (uint256 i = 0; i < 5; i++) {
            content.links[i] = Metadata.Link({label: "l", url: "https://example.com"});
        }

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(Metadata.TooManyLinks.selector, uint256(5), uint256(4))
        );
        factory.reviseMetadata(token, content);
    }

    /// @dev A label with no URL points at nothing; a URL with no label renders
    ///      as a bare address. Both are a mistake in the form, and both would be
    ///      permanent.
    function test_aHalfEmptyLinkIsRefused() public {
        address token = _launch(_content("fine"), bytes32(uint256(22)));

        Metadata.Content memory content = _content("fine");
        content.links = new Metadata.Link[](1);
        content.links[0] = Metadata.Link({label: "website", url: ""});

        vm.prank(creator);
        vm.expectRevert(Metadata.EmptyLink.selector);
        factory.reviseMetadata(token, content);
    }

    /// @dev Bounds apply to revisions too. Enforcing them only at launch would
    ///      make the limit a formality — a creator could launch inside it and
    ///      immediately revise past it.
    function test_boundsApplyToRevisionsAsWellAsLaunches() public {
        address token = _launch(_content("fine"), bytes32(uint256(12)));

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(Metadata.DescriptionTooLong.selector, uint256(600), uint256(512))
        );
        factory.reviseMetadata(token, _content(_repeat("x", 600)));
    }

    /// @dev A `javascript:` URL is inert in calldata and dangerous only where
    ///      something renders it. On-chain validation would cost every creator
    ///      gas for a guarantee the client still has to enforce, so it is
    ///      deliberately accepted here and refused at the render boundary.
    function test_urlsAreNotValidatedOnChain() public {
        Metadata.Content memory content = _content("fine");
        content.links = new Metadata.Link[](1);
        content.links[0] = Metadata.Link({label: "x", url: "javascript:alert(1)"});

        address token = _launch(content, bytes32(uint256(13)));
        assertTrue(token != address(0), "the chain stores bytes; the client decides what is a link");
    }

    function _repeat(string memory unit, uint256 times) internal pure returns (string memory out) {
        for (uint256 i = 0; i < times; i++) out = string.concat(out, unit);
    }
}
