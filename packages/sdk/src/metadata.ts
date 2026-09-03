/**
 * SENT — token metadata, and the commitment that was already in the address.
 *
 * §412 binds `launchIntentHash` into the CREATE2 salt, and the factory has
 * always described it as the hash of "the launch intent the creator reviewed
 * (metadata, socials)". The commitment has therefore always existed — in the
 * token's own address, permanently — while the content it commits to was
 * published nowhere and could not be checked by anyone.
 *
 * The chain now carries the content (§95.20). This file is the other half: the
 * one definition of how content becomes that hash, so a UI, an indexer and a
 * creator's grinder all produce the same bytes.
 *
 * ONE ENCODING, OR THE COMMITMENT MEANS NOTHING
 * ---------------------------------------------
 * If the launch form hashes `{description, links}` and the verifier hashes
 * `{links, description}`, every token on the platform reports as tampered. §1064
 * exists for exactly this, and a hash is the least forgiving place to have two
 * implementations — the failure is total and looks like an attack.
 *
 * So the encoding is `abi.encode` of the Solidity struct, in declaration order,
 * mirrored here by viem's encoder against the same ABI type. Not JSON: two JSON
 * serialisers disagree about key order, whitespace and unicode escapes, and none
 * of those disagreements are visible until the hash differs.
 */

import { encodeAbiParameters, keccak256, type Hex } from "viem";

export interface MetadataLink {
  readonly label: string;
  readonly url: string;
}

export interface TokenMetadata {
  readonly description: string;
  /** IPFS CID of the image. Empty string when there is none. */
  readonly imageCid: string;
  readonly links: readonly MetadataLink[];
}

/** Mirrors `Metadata.sol`. Changing either without the other breaks every hash. */
export const METADATA_LIMITS = {
  description: 512,
  cid: 128,
  links: 4,
  linkLabel: 24,
  linkUrl: 200,
} as const;

/** The ABI type of `Metadata.Content`, in declaration order. */
const CONTENT_TYPE = {
  type: "tuple",
  components: [
    { name: "description", type: "string" },
    { name: "imageCid", type: "string" },
    {
      name: "links",
      type: "tuple[]",
      components: [
        { name: "label", type: "string" },
        { name: "url", type: "string" },
      ],
    },
  ],
} as const;

/**
 * The hash that goes into `launchIntentHash`, and therefore into the address.
 *
 * A creator grinding a vanity salt computes this once, before searching: the
 * address depends on it, so changing a single character of the description
 * after grinding invalidates every salt found.
 */
export function launchIntentHash(metadata: TokenMetadata): Hex {
  return keccak256(
    encodeAbiParameters(
      [CONTENT_TYPE],
      [
        {
          description: metadata.description,
          imageCid: metadata.imageCid,
          links: metadata.links.map((l) => ({ label: l.label, url: l.url })),
        },
      ],
    ),
  );
}

/**
 * Whether published content matches the commitment in a token's address.
 *
 * The check §231's trust signals need to be more than a badge. It is only
 * meaningful against the LAUNCH-time content: a revision is a new event with a
 * revision number, and it deliberately cannot alter the address.
 */
export function matchesCommitment(metadata: TokenMetadata, intentHash: Hex): boolean {
  return launchIntentHash(metadata).toLowerCase() === intentHash.toLowerCase();
}

export type MetadataProblem =
  | { readonly field: "description"; readonly code: "TOO_LONG"; readonly limit: number }
  | { readonly field: "imageCid"; readonly code: "TOO_LONG" | "MALFORMED"; readonly limit?: number }
  | { readonly field: "links"; readonly code: "TOO_MANY"; readonly limit: number }
  | {
      readonly field: "link";
      readonly index: number;
      readonly code: "EMPTY" | "LABEL_TOO_LONG" | "URL_TOO_LONG" | "UNSAFE_SCHEME";
    };

/**
 * A CIDv0 or CIDv1, by shape.
 *
 * Deliberately NOT a full multibase/multihash decode. The purpose here is to
 * catch a paste that is obviously not a CID — a gateway URL, a filename, a
 * truncated string — before it is published permanently. A structurally valid
 * CID that points at nothing is not something any validator can detect, and
 * pretending otherwise would be the more dangerous check: it would make an
 * unresolvable image look verified.
 *
 *   CIDv0  Qm… base58btc, 46 characters
 *   CIDv1  bafy… / bafk… base32 lower-case
 */
const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1 = /^b[a-z2-7]{58,}$/;

export function isPlausibleCid(cid: string): boolean {
  return CID_V0.test(cid) || CID_V1.test(cid);
}

/**
 * Every scheme a link may use.
 *
 * An allowlist, not a blocklist. `javascript:` is the one everybody thinks of,
 * and `data:`, `vbscript:` and `blob:` are the ones they forget — a blocklist
 * is a list of the attacks somebody has already seen.
 *
 * THE CHAIN DOES NOT ENFORCE THIS, AND SHOULD NOT
 * -----------------------------------------------
 * A `javascript:` URL is inert in calldata; it is dangerous only where
 * something renders it as a link. Validating on-chain would charge every
 * creator gas for a guarantee the client still has to enforce — and a client
 * that trusted the chain's validation instead of doing its own would be exactly
 * one contract upgrade away from an XSS.
 *
 * So this runs at the render boundary, which is where the danger actually is.
 */
const SAFE_SCHEMES = new Set(["http:", "https:"]);

export function isSafeUrl(url: string): boolean {
  try {
    return SAFE_SCHEMES.has(new URL(url).protocol);
  } catch {
    // Unparseable is not safe. A relative URL in a token's link list has no
    // base to resolve against and would resolve against whatever page renders
    // it, which is a different site's problem every time.
    return false;
  }
}

/**
 * Validate before signing, with the same bounds the contract enforces.
 *
 * The contract reverts; this returns a list, because a form that surfaces one
 * problem per submission is a form people fight. Both are needed: a client-side
 * check that the contract did not also enforce would be a suggestion.
 */
export function validateMetadata(metadata: TokenMetadata): MetadataProblem[] {
  const problems: MetadataProblem[] = [];

  // Byte length, not string length. The contract counts bytes, and an emoji is
  // four of them — a description that fits in the form and reverts on-chain is
  // the worst possible place to discover the difference.
  const bytes = (value: string): number => new TextEncoder().encode(value).length;

  if (bytes(metadata.description) > METADATA_LIMITS.description) {
    problems.push({ field: "description", code: "TOO_LONG", limit: METADATA_LIMITS.description });
  }

  if (bytes(metadata.imageCid) > METADATA_LIMITS.cid) {
    problems.push({ field: "imageCid", code: "TOO_LONG", limit: METADATA_LIMITS.cid });
  } else if (metadata.imageCid !== "" && !isPlausibleCid(metadata.imageCid)) {
    problems.push({ field: "imageCid", code: "MALFORMED" });
  }

  if (metadata.links.length > METADATA_LIMITS.links) {
    problems.push({ field: "links", code: "TOO_MANY", limit: METADATA_LIMITS.links });
  }

  metadata.links.forEach((link, index) => {
    if (link.label === "" || link.url === "") {
      problems.push({ field: "link", index, code: "EMPTY" });
      return;
    }

    if (bytes(link.label) > METADATA_LIMITS.linkLabel) {
      problems.push({ field: "link", index, code: "LABEL_TOO_LONG" });
    }
    if (bytes(link.url) > METADATA_LIMITS.linkUrl) {
      problems.push({ field: "link", index, code: "URL_TOO_LONG" });
    }
    if (!isSafeUrl(link.url)) {
      problems.push({ field: "link", index, code: "UNSAFE_SCHEME" });
    }
  });

  return problems;
}

/** Where to fetch an image CID from. Gateway choice is the caller's. */
export function ipfsUrl(cid: string, gateway = "https://ipfs.io/ipfs/"): string | null {
  if (cid === "" || !isPlausibleCid(cid)) return null;
  return `${gateway}${cid}`;
}
