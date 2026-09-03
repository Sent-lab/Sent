"use client";

/**
 * SENT — create a token (§219).
 *
 * §219's progression: identity, xStock pair, metadata, vanity address, preview,
 * review, launch. Single page rather than a wizard — the form is short enough
 * that steps would add ceremony without adding clarity, and §219 allows either
 * as long as the user always knows where they are.
 *
 * WHAT THE FORM REFUSES TO IMPLY
 * ------------------------------
 * §219: no hidden fee, creator allocation clearly 0%, pair clearly official.
 * All three are stated on the page rather than in a tooltip, because a cost or
 * an allocation a creator discovers after launching is not a disclosure.
 *
 * THE PREVIEW SHOWS NO MARKET DATA (§220)
 * ---------------------------------------
 * §220 is explicit: a preview must not falsely show market data that does not
 * exist yet. So the card preview renders identity only — no price, no holders,
 * no progress bar — because none of those exist before a launch and inventing
 * plausible ones would be a mock-up of a market rather than a preview of one.
 *
 * LAUNCHING IS NOT WIRED
 * ----------------------
 * The registry is empty until V-02, V-03 and V-05 are verified, so there is no
 * xStock to pair against, and the graduation router is unset until V-06 and
 * V-09 — a market launched now could never graduate. The page says so instead
 * of offering a button that would produce a broken market.
 */

import { useMemo, useState } from "react";
import type { JSX } from "react";

import { truncateAddress } from "../../lib/format.ts";

import styles from "./create.module.css";

/** §219: no unnecessary form fields. Each of these ends up on-chain or in the salt. */
interface Draft {
  name: string;
  symbol: string;
  quoteAsset: string;
  website: string;
  vanityPrefix: string;
}

const EMPTY: Draft = {
  name: "",
  symbol: "",
  quoteAsset: "",
  website: "",
  vanityPrefix: "",
};

export default function CreatePage(): JSX.Element {
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }));

  const problems = useMemo(() => validate(draft), [draft]);

  return (
    <div className={`${styles.page} container`} data-mode="experience">
      <header className={styles.head}>
        <h1 className={styles.title}>Launch a token</h1>
        <p className={styles.subtitle}>
          One billion tokens, fixed at launch. You receive no allocation and neither does
          the platform — the entire supply goes to the curve.
        </p>
      </header>

      {/*
        Stated before the form, not after it. §219 forbids a hidden fee, and a
        cost disclosed on the review screen has already cost the creator their
        time.
      */}
      <section className={styles.terms} aria-label="Launch terms">
        <Term label="Your allocation" value="0%" detail="No premine. The curve holds all of it." />
        <Term label="Platform allocation" value="0%" detail="The same answer, for the same reason." />
        <Term
          label="You earn"
          value="65%"
          detail="Of the 1% core trading fee, for the life of the market."
        />
        <Term
          label="Launch cost"
          value="Gas only"
          detail="Plus the protocol launch fee if governance has set one."
        />
      </section>

      <div className={styles.layout}>
        <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
          <Field
            label="Token name"
            hint="The full name, as it will appear everywhere."
            value={draft.name}
            onChange={(value) => set("name", value)}
            placeholder="Northwind Industries"
            maxLength={64}
          />

          <Field
            label="Ticker"
            hint="Two to eight characters. Uppercase."
            value={draft.symbol}
            onChange={(value) => set("symbol", value.toUpperCase())}
            placeholder="WIND"
            maxLength={8}
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="quote-asset">
              xStock pair
            </label>
            <select
              id="quote-asset"
              className={styles.select}
              value={draft.quoteAsset}
              onChange={(event) => set("quoteAsset", event.target.value)}
              disabled
            >
              <option value="">No xStock is enabled yet</option>
            </select>
            {/*
              §219: the pair must be clearly official. The list comes from the
              on-chain registry and nothing else — a free-text address field here
              would let a creator pair against an impostor token, which is the
              exact attack §4 and §699 exist to prevent.
            */}
            <p className={styles.hint}>
              Only assets governance has registered and enabled can be paired. The list is
              empty until the xStock registry is populated.
            </p>
          </div>

          <Field
            label="Website"
            hint="Optional. Shown on the market page."
            value={draft.website}
            onChange={(value) => set("website", value)}
            placeholder="https://"
            maxLength={200}
          />

          <Field
            label="Vanity prefix"
            hint="Optional. Grinds the salt for an address starting with these characters."
            value={draft.vanityPrefix}
            onChange={(value) => set("vanityPrefix", value.replace(/[^0-9a-fA-F]/g, ""))}
            placeholder="beef"
            maxLength={6}
          />

          {problems.length > 0 && (
            <ul className={styles.problems}>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          <button type="submit" className={styles.submit} disabled>
            Launch
          </button>

          <p className={styles.blocked}>
            Launching is not enabled in this build. No xStock is registered yet, and the
            graduation router is unset — a market launched now could trade but could never
            graduate.
          </p>
        </form>

        <aside className={styles.previewPane} aria-label="Preview">
          <h2 className={styles.previewTitle}>Preview</h2>

          {/*
            Identity only. §220 forbids showing market data that does not exist,
            so there is no price, no holder count and no progress bar — a
            pre-launch market has none of those, and rendering plausible ones
            would be a mock-up rather than a preview.
          */}
          <div className={styles.previewCard}>
            <div className={styles.previewHead}>
              <span className={styles.previewMonogram} aria-hidden="true">
                {draft.symbol.slice(0, 2) || "??"}
              </span>
              <div className={styles.previewIdentity}>
                <span className={styles.previewSymbol}>{draft.symbol || "TICKER"}</span>
                <span className={styles.previewName}>{draft.name || "Token name"}</span>
              </div>
              <span className={styles.previewPair}>
                {draft.quoteAsset === "" ? "xSTOCK" : draft.quoteAsset}
              </span>
            </div>

            <p className={styles.previewNote}>
              Price, holders and graduation progress appear once the market exists.
            </p>

            <div className={styles.previewFoot}>
              <span>
                by{" "}
                {truncateAddress("0x0000000000000000000000000000000000000000")}
              </span>
            </div>
          </div>

          <dl className={styles.previewFacts}>
            <div>
              <dt>Supply</dt>
              <dd className="num">1,000,000,000</dd>
            </div>
            <div>
              <dt>To the curve</dt>
              <dd className="num">100%</dd>
            </div>
            <div>
              <dt>To you at launch</dt>
              <dd className="num">0</dd>
            </div>
          </dl>

          {draft.vanityPrefix !== "" && (
            <p className={styles.hint}>
              The market address is derived from your address, your salt and the pair, so a
              vanity prefix is ground off-chain before launching and costs nothing on-chain.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Term({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className={styles.term}>
      <span className={styles.termLabel}>{label}</span>
      <span className={`${styles.termValue} num`}>{value}</span>
      <span className={styles.termDetail}>{detail}</span>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
}): JSX.Element {
  const id = `field-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <p className={styles.hint} id={`${id}-hint`}>
        {hint}
      </p>
    </div>
  );
}

/**
 * Validate the draft.
 *
 * Reports only what is actually wrong with what has been typed. An empty form is
 * not "invalid" — nobody has done anything yet, and listing five errors before a
 * user has touched a field is how a form teaches people to ignore it (§42).
 */
function validate(draft: Draft): string[] {
  const problems: string[] = [];

  if (draft.symbol !== "" && draft.symbol.length < 2) {
    problems.push("A ticker needs at least two characters.");
  }

  if (draft.symbol !== "" && !/^[A-Z0-9]+$/.test(draft.symbol)) {
    problems.push("A ticker may contain letters and digits only.");
  }

  if (draft.website !== "" && !/^https?:\/\/\S+$/.test(draft.website)) {
    problems.push("A website must start with http:// or https://");
  }

  if (draft.vanityPrefix.length > 0 && draft.vanityPrefix.length > 4) {
    // Each extra hex character multiplies the search by sixteen. Saying so is
    // more useful than refusing.
    problems.push("A prefix longer than four characters takes a long time to grind.");
  }

  return problems;
}
