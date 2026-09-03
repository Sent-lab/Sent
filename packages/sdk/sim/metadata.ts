/**
 * SENT — metadata commitment audit (§95.20, §412).
 *
 * The hash here is the one bound into every token's address. If this file and
 * `Metadata.sol` disagree by a single byte, every token on the platform reports
 * as tampered — a total failure that looks exactly like an attack, which is why
 * §1064 forbids a second implementation and why the encoding is asserted rather
 * than assumed.
 *
 * Run: pnpm sim:metadata
 */

import { encodeAbiParameters, keccak256 } from "viem";

import {
  launchIntentHash,
  matchesCommitment,
  validateMetadata,
  isPlausibleCid,
  isSafeUrl,
  ipfsUrl,
  METADATA_LIMITS,
  type TokenMetadata,
} from "../src/metadata.ts";

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const BASE: TokenMetadata = {
  description: "a market for something",
  imageCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  links: [
    { label: "website", url: "https://example.com" },
    { label: "x", url: "https://x.com/example" },
  ],
};

// ---------------------------------------------------------------------------

section("The hash is abi.encode of the struct, in declaration order");

{
  // Computed independently here, against the tuple shape written out by hand.
  // Calling the implementation to produce the expectation would assert that the
  // function equals itself.
  const expected = keccak256(
    encodeAbiParameters(
      [
        {
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
        },
      ],
      [{ description: BASE.description, imageCid: BASE.imageCid, links: [...BASE.links] }],
    ),
  );

  check("the intent hash is the struct's abi encoding", launchIntentHash(BASE) === expected);
}

{
  check("hashing is deterministic", launchIntentHash(BASE) === launchIntentHash({ ...BASE }));

  // Every field is committed. A field left out of the hash is a field an
  // attacker can change without changing the address.
  check(
    "the description is committed",
    launchIntentHash({ ...BASE, description: "different" }) !== launchIntentHash(BASE),
  );
  check(
    "the image CID is committed",
    launchIntentHash({ ...BASE, imageCid: "Qm" + "1".repeat(44) }) !== launchIntentHash(BASE),
  );
  check(
    "the links are committed",
    launchIntentHash({ ...BASE, links: [] }) !== launchIntentHash(BASE),
  );

  /*
   * Order is part of the commitment.
   *
   * Not a formality: a UI that sorted links for display and hashed the sorted
   * copy would produce a hash that disagrees with the one the creator ground a
   * salt against, and the address would come out somewhere else entirely.
   */
  check(
    "and their order",
    launchIntentHash({ ...BASE, links: [...BASE.links].reverse() }) !== launchIntentHash(BASE),
  );
}

{
  check("matching content verifies", matchesCommitment(BASE, launchIntentHash(BASE)));
  check(
    "tampered content does not",
    !matchesCommitment({ ...BASE, description: "rewritten" }, launchIntentHash(BASE)),
  );

  // A commitment arriving from a chain read may be either case; a comparison
  // that failed on that would report every token as tampered.
  check(
    "the comparison is case-insensitive on the hex",
    matchesCommitment(BASE, launchIntentHash(BASE).toUpperCase() as `0x${string}`),
  );
}

section("Bounds match the contract, and are counted in bytes");

{
  check("nothing is wrong with valid metadata", validateMetadata(BASE).length === 0);

  const long = validateMetadata({ ...BASE, description: "x".repeat(513) });
  check("an overlong description is caught", long.some((p) => p.field === "description"));

  check(
    "and exactly the limit is not",
    validateMetadata({ ...BASE, description: "x".repeat(512) }).length === 0,
  );

  /*
   * BYTES, not characters.
   *
   * The contract counts bytes and an emoji is four of them. A form that counted
   * characters would accept a description that reverts on-chain — the worst
   * place to discover the difference, because the salt is already spent.
   */
  const emoji = "🚀".repeat(129); // 516 bytes, 129 characters
  check("length is measured in bytes, not characters", validateMetadata({ ...BASE, description: emoji }).length > 0);
  check("and the same string is under the limit by character count", emoji.length < METADATA_LIMITS.description);
}

{
  const tooMany = validateMetadata({
    ...BASE,
    links: Array.from({ length: 5 }, () => ({ label: "l", url: "https://example.com" })),
  });
  check("too many links is caught", tooMany.some((p) => p.field === "links"));

  const empty = validateMetadata({ ...BASE, links: [{ label: "website", url: "" }] });
  check("a half-empty link is caught", empty.some((p) => p.code === "EMPTY"));

  // One report per problem, so a form can show them all at once rather than
  // making someone resubmit to discover the next one.
  const several = validateMetadata({
    description: "x".repeat(600),
    imageCid: "not-a-cid",
    links: [{ label: "x", url: "javascript:alert(1)" }],
  });
  check("every problem is reported, not just the first", several.length >= 3);
}

section("CIDs are checked by shape, and only by shape");

{
  check("a CIDv1 is plausible", isPlausibleCid(BASE.imageCid));
  check("so is a CIDv0", isPlausibleCid("QmYwAPJzv5CZsnAzt8auVZRn1BbCbmvWQ8ZUZzVUfPq4Uh"));

  // The pastes this is here to catch: a gateway URL, a filename, a truncation.
  check("a gateway URL is not a CID", !isPlausibleCid("https://ipfs.io/ipfs/QmYwAPJz"));
  check("nor is a filename", !isPlausibleCid("logo.png"));
  check("nor a truncated CID", !isPlausibleCid("bafybeigdyrzt5sfp7udm"));
  check("nor an empty string", !isPlausibleCid(""));

  /*
   * What this deliberately does NOT do is resolve the CID.
   *
   * A structurally valid CID pointing at nothing is undetectable here, and a
   * validator that implied otherwise would be the more dangerous check: it
   * would make an unresolvable image look verified.
   */
  check(
    "a well-formed CID for nothing still passes",
    isPlausibleCid("bafybeiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
  );
}

section("Link schemes are an allowlist");

{
  check("https is allowed", isSafeUrl("https://example.com"));
  check("http is allowed", isSafeUrl("http://example.com"));

  /*
   * The blocklist everyone writes catches the first of these and misses the
   * rest. An allowlist is the same code and does not depend on having seen the
   * attack before.
   */
  check("javascript is not", !isSafeUrl("javascript:alert(1)"));
  check("data is not", !isSafeUrl("data:text/html,<script>alert(1)</script>"));
  check("vbscript is not", !isSafeUrl("vbscript:msgbox(1)"));
  check("blob is not", !isSafeUrl("blob:https://example.com/uuid"));
  check("file is not", !isSafeUrl("file:///etc/passwd"));

  // A relative URL has no base here and would resolve against whichever page
  // renders it — a different site every time.
  check("a relative URL is not safe", !isSafeUrl("/somewhere"));
  check("nor is unparseable text", !isSafeUrl("not a url at all"));

  // Case and whitespace tricks resolve through the URL parser rather than
  // through a string comparison, which is why the parser is used at all.
  check("an uppercased scheme is still refused", !isSafeUrl("JavaScript:alert(1)"));
}

section("Gateway URLs");

{
  check("a CID becomes a gateway URL", ipfsUrl(BASE.imageCid)?.endsWith(BASE.imageCid) === true);
  check("an empty CID becomes null, not a broken URL", ipfsUrl("") === null);
  check("and so does a malformed one", ipfsUrl("logo.png") === null);

  check(
    "the gateway is the caller's choice",
    ipfsUrl(BASE.imageCid, "https://cloudflare-ipfs.com/ipfs/")?.startsWith("https://cloudflare") ===
      true,
  );
}

console.log(failures === 0 ? "\nmetadata: all checks passed" : `\nmetadata: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
