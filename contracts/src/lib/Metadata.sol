// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title Metadata
/// @notice Creator-supplied token metadata, on-chain (§95.20, §115).
///
/// WHERE THIS LIVES, AND WHY IT IS NOT A DATABASE ROW
/// --------------------------------------------------
/// A description in the platform's own database is a description the platform
/// can silently rewrite. Every other fact about a market is on-chain and
/// verifiable; the one a human actually reads would not have been, and nothing
/// would show that it had changed.
///
/// So it is on-chain. The image is the exception, and only because a PNG is not
/// something to put in calldata — what goes on-chain is its IPFS CID, which is
/// itself a hash of the bytes. A gateway that serves different bytes fails the
/// CID check, so the image is verifiable without being stored.
///
/// EVENTS, NOT STORAGE
/// -------------------
/// No contract reads any of this. Storing it would cost ~20,000 gas per 32-byte
/// word for data whose only consumer is an indexer, against roughly 8 gas per
/// byte in a log. On a 500-byte description that is the difference between a
/// launch someone will pay for and one they will not.
///
/// The cost is that a contract cannot read metadata back. That is not a
/// limitation here — nothing in the curve, the fees or the vaults has any
/// business branching on a description.
///
/// THE HASH WAS ALREADY IN THE ADDRESS
/// -----------------------------------
/// `launchIntentHash` is bound into the CREATE2 salt (§412), and the factory has
/// always described it as the hash of "the launch intent the creator reviewed
/// (metadata, socials)". So the metadata was already committed — permanently,
/// in the token's own address — and the content was never published anywhere.
///
/// Emitting it closes that loop: anyone can hash what was published and check it
/// against the address the token actually has. §231's trust signals become
/// checkable rather than asserted.
library Metadata {
    /// @dev A description long enough to say what a token is, short enough that
    ///      it cannot be used as cheap on-chain storage for something else.
    uint256 internal constant MAX_DESCRIPTION = 512;

    /// @dev CIDv1 base32 is 59 characters; CIDv0 base58 is 46. 128 leaves room
    ///      for longer multihashes without becoming a general-purpose field.
    uint256 internal constant MAX_CID = 128;

    uint256 internal constant MAX_LINKS = 4;
    uint256 internal constant MAX_LINK_LABEL = 24;
    uint256 internal constant MAX_LINK_URL = 200;

    struct Link {
        string label;
        string url;
    }

    struct Content {
        string description;
        /// @dev IPFS CID of the token image. Empty means no image.
        string imageCid;
        Link[] links;
    }

    error DescriptionTooLong(uint256 length, uint256 max);
    error CidTooLong(uint256 length, uint256 max);
    error TooManyLinks(uint256 count, uint256 max);
    error LinkLabelTooLong(uint256 length, uint256 max);
    error LinkUrlTooLong(uint256 length, uint256 max);
    error EmptyLink();

    /// @notice Bound every field. Reverts rather than truncating.
    ///
    /// @dev Truncation would publish something the creator did not write, under
    ///      their name, permanently — and the hash in the token's address would
    ///      then not match what was published, breaking the one verification
    ///      this whole design exists to enable.
    ///
    ///      WHAT IS DELIBERATELY NOT CHECKED HERE: whether a URL is well-formed
    ///      or safe. §95.20 asks for social URL validation, and on-chain is the
    ///      wrong place for it — a `javascript:` URL is inert in calldata and
    ///      dangerous only when something renders it as a link. The check
    ///      belongs at the render boundary, where the danger is, and doing it
    ///      here would cost every creator gas for a guarantee that still has to
    ///      be enforced again in the client.
    function validate(Content calldata content) internal pure {
        if (bytes(content.description).length > MAX_DESCRIPTION) {
            revert DescriptionTooLong(bytes(content.description).length, MAX_DESCRIPTION);
        }

        if (bytes(content.imageCid).length > MAX_CID) {
            revert CidTooLong(bytes(content.imageCid).length, MAX_CID);
        }

        if (content.links.length > MAX_LINKS) {
            revert TooManyLinks(content.links.length, MAX_LINKS);
        }

        for (uint256 i = 0; i < content.links.length; i++) {
            uint256 labelLength = bytes(content.links[i].label).length;
            uint256 urlLength = bytes(content.links[i].url).length;

            // A link with no URL is a label pointing at nothing, and a URL with
            // no label renders as a bare address. Both are a mistake in the
            // form rather than a choice, and both are permanent once emitted.
            if (labelLength == 0 || urlLength == 0) revert EmptyLink();

            if (labelLength > MAX_LINK_LABEL) revert LinkLabelTooLong(labelLength, MAX_LINK_LABEL);
            if (urlLength > MAX_LINK_URL) revert LinkUrlTooLong(urlLength, MAX_LINK_URL);
        }
    }
}
