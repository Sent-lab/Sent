/**
 * SENT — what a creator published about their market (§95.20, §412).
 *
 * The API has served this the whole time and nothing rendered it: the
 * description, the image, the links, and — the one that matters — whether the
 * published content still hashes to the commitment baked into the token's own
 * address.
 *
 * VERIFIED IS THREE STATES, NOT TWO
 * ---------------------------------
 * `verified` is `boolean | null`, and the null is load-bearing. It means the
 * check could not be made: no metadata indexed, or a market launched before the
 * event carried the hash. Rendering that as "unverified" would accuse an honest
 * creator of something the data does not say. So there are three outcomes and
 * the third one says it does not know.
 *
 * A FAILED CHECK IS NOT A COSMETIC PROBLEM
 * ----------------------------------------
 * §412 binds `launchIntentHash` into the salt the token address is derived from.
 * If the published metadata no longer hashes to it, the content being shown is
 * not the content this address was created for — which is the exact substitution
 * a lookalike relies on. That gets the warning treatment; everything else here
 * is presentation.
 *
 * THE IMAGE IS FETCHED BY THE BROWSER, NEVER BY US
 * ------------------------------------------------
 * `preview.ts` explains at length why the API does not fetch a creator-supplied
 * IPFS CID: an outbound request per crawler hit, from our infrastructure, to a
 * URL a stranger chose, is a request-forgery surface with a public trigger. In a
 * browser the request is the user's own, which is the case that comment
 * explicitly leaves open. So the gateway URL is built here and the `img` does
 * the rest — and if it fails to load, the layout does not move.
 */

import { ipfsUrl } from "@sent/sdk";

import styles from "./MarketAbout.module.css";
import type { JSX } from "react";

export interface MarketAboutProps {
  readonly metadata: {
    readonly revision: string;
    readonly description: string;
    readonly imageCid: string;
    readonly links: readonly { readonly label: string; readonly url: string }[];
    readonly unsafeLinksRemoved: number;
    readonly verified: boolean | null;
  } | null;
  readonly symbol: string;
}

export function MarketAbout({ metadata, symbol }: MarketAboutProps): JSX.Element | null {
  // No metadata at all is not an empty state worth a panel — a creator who
  // published nothing has nothing here, and a heading over a blank box says
  // something is missing rather than that nothing was said.
  if (metadata === null) return null;

  const image = metadata.imageCid === "" ? null : ipfsUrl(metadata.imageCid);
  const hasBody = metadata.description !== "" || image !== null || metadata.links.length > 0;

  if (!hasBody && metadata.verified !== false) return null;

  return (
    <section className={styles.about} aria-label={`About ${symbol}`}>
      <header className={styles.head}>
        <h2 className={styles.title}>About</h2>
        <Verification state={metadata.verified} />
      </header>

      {metadata.verified === false && (
        <p className={styles.mismatch} role="status">
          The published description no longer matches the commitment in this token&apos;s
          address. §412 binds that hash into the address itself, so what is shown here is
          not what this address was created for. Treat the identity of this market as
          unconfirmed.
        </p>
      )}

      <div className={styles.body}>
        {image !== null && (
          /*
           * Fixed box, `object-fit: cover`, and dimensions on the element.
           * A creator-supplied image of unknown size must not be able to push
           * the page around while it loads (§80).
           */
          <img
            className={styles.image}
            src={image}
            alt=""
            width={96}
            height={96}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        )}

        <div className={styles.text}>
          {metadata.description !== "" && (
            <p className={styles.description}>{metadata.description}</p>
          )}

          {metadata.links.length > 0 && (
            <ul className={styles.links}>
              {metadata.links.map((link) => (
                <li key={`${link.label}-${link.url}`}>
                  <a
                    href={link.url}
                    className={styles.link}
                    target="_blank"
                    // `noopener` is the security half; `noreferrer` stops this
                    // market's URL leaking to a destination the creator chose.
                    rel="noopener noreferrer nofollow"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {metadata.unsafeLinksRemoved > 0 && (
        <p className={styles.removed}>
          {metadata.unsafeLinksRemoved === 1
            ? "One link was removed for not being a plain http or https address."
            : `${metadata.unsafeLinksRemoved} links were removed for not being plain http or https addresses.`}{" "}
          They are dropped by the API, not hidden here.
        </p>
      )}
    </section>
  );
}

/**
 * The §412 check, as a badge.
 *
 * Three outcomes, and the third is not a softer version of the second. "We
 * could not check" and "this does not match" are opposite claims about the same
 * creator.
 */
function Verification({ state }: { state: boolean | null }): JSX.Element {
  if (state === true) {
    return (
      <span
        className={styles.verified}
        title="The published content hashes to the commitment in the token's address (§412)."
      >
        Matches its address
      </span>
    );
  }

  if (state === false) {
    return (
      <span
        className={styles.failed}
        title="The published content does not hash to the commitment in the token's address."
      >
        Does not match its address
      </span>
    );
  }

  return (
    <span
      className={styles.unchecked}
      title="No commitment was recorded for this market, so there is nothing to check against."
    >
      Not checked
    </span>
  );
}
