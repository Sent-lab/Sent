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
 * WHY THE PRECONDITIONS ARE READ AND NOT WRITTEN DOWN
 * ---------------------------------------------------
 * This page used to carry a paragraph saying launching was unavailable because
 * no xStock was registered and the graduation router was unset. Both were true.
 * Neither is something a page can know: they are governance actions, and nobody
 * edits a React component when a Safe transaction executes.
 *
 * So the page asks `/launch/config`, which reads both from the chain. When an
 * asset is enabled and a router is set, the form launches; when it is not, the
 * page says which of the two is missing. It is right on both sides of the
 * moment governance acts, without anyone remembering to change it.
 *
 * A LAUNCH WITHOUT A ROUTER IS A TRAP, NOT A LIMITATION
 * -----------------------------------------------------
 * `_enterGraduating` reverts with `RouterNotSet` when the router is zero, and
 * the call that reverts is the BUY that crosses the endpoint. So the market
 * would trade normally right up to graduation and then refuse, permanently, for
 * every holder in it. That is worth refusing to create.
 *
 * §694 THROUGH THE WHOLE FLOW
 * ---------------------------
 * The address in the preview is read from the factory's own
 * `previewLaunchAddress` and handed back to the launch as `expectedToken`, so
 * the chain refuses to deploy anywhere else. The metadata hash is computed by
 * the SDK and bound into the same salt. What the creator reviewed is what gets
 * deployed, enforced on-chain rather than promised here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { buildLaunchIntent, launchIntentHash, validateMetadata } from "@sent/sdk";

import { getLaunchConfig, isOk, type LaunchConfigResponse } from "../../lib/api.ts";
import { previewLaunchAddress } from "../../lib/chain.ts";
import { formatFixed, truncateAddress } from "../../lib/format.ts";
import { useWallet, CHAIN_ID } from "../../lib/wallet.ts";
import { IntentReview } from "../../components/IntentReview.tsx";

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
  const wallet = useWallet();
  const { read, address } = wallet;

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [config, setConfig] = useState<LaunchConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [predicted, setPredicted] = useState<`0x${string}` | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      const result = await getLaunchConfig({ signal: controller.signal }).catch(() => null);
      if (controller.signal.aborted) return;

      if (result === null || !isOk(result)) {
        setConfigError(
          result === null
            ? "Could not reach the API to check what can be launched."
            : result.message,
        );
        return;
      }

      setConfig(result.data);
      setConfigError(null);

      // Pre-select when there is exactly one choice. With several, the creator
      // picks — the pair is an economic decision, not a default.
      if (result.data.launchable.length === 1) {
        set("quoteAsset", result.data.launchable[0]!.token);
      }
    })();

    return () => controller.abort();
  }, []);

  const asset = useMemo(
    () => config?.launchable.find((a) => a.token === draft.quoteAsset) ?? null,
    [config, draft.quoteAsset],
  );

  /*
   * The metadata, exactly as it will be hashed.
   *
   * Built here and used for BOTH the hash and the intent, so the commitment in
   * the address and the content published alongside it cannot describe
   * different things (§412).
   */
  const metadata = useMemo(
    () => ({
      description: "",
      imageCid: "",
      links: draft.website.trim() === "" ? [] : [{ label: "website", url: draft.website.trim() }],
    }),
    [draft.website],
  );

  /*
   * A salt per draft, not per keystroke.
   *
   * §412 binds the creator into the effective salt, so this only has to be
   * unique per launch rather than unguessable. It is regenerated when the page
   * mounts; grinding one for a vanity prefix is not wired, which the form says
   * rather than implies.
   */
  const [userSalt] = useState<`0x${string}`>(() => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}` as const;
  });

  const metadataProblems = useMemo(() => validateMetadata(metadata), [metadata]);
  const problems = useMemo(() => validate(draft), [draft]);

  const ready = config?.ready === true;
  const complete =
    problems.length === 0 &&
    metadataProblems.length === 0 &&
    draft.quoteAsset !== "" &&
    asset !== null;

  /*
   * The address, read from the factory as the draft changes.
   *
   * Debounced: every keystroke in the name field moves it, and an eth_call per
   * character would be a request storm for a value nobody reads mid-typing.
   */
  useEffect(() => {
    if (!complete || address === null || config === null) {
      setPredicted(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void previewLaunchAddress(read, config.factory as `0x${string}`, {
        creator: address,
        userSalt,
        quoteAsset: draft.quoteAsset as `0x${string}`,
        launchIntentHash: launchIntentHash(metadata),
        name: draft.name,
        symbol: draft.symbol,
      })
        .then((r) => {
          if (!cancelled) setPredicted(r.token);
        })
        .catch(() => {
          if (!cancelled) setPredicted(null);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [complete, address, config, draft.name, draft.symbol, draft.quoteAsset, metadata, read, userSalt]);

  const intent = useMemo(() => {
    if (!ready || !complete || config === null || asset === null || predicted === null) {
      return null;
    }

    return buildLaunchIntent({
      chainId: CHAIN_ID,
      factory: config.factory as `0x${string}`,
      name: draft.name,
      symbol: draft.symbol,
      quoteAsset: asset.token as `0x${string}`,
      quoteSymbol: asset.symbol,
      userSalt,
      launchIntentHash: launchIntentHash(metadata),
      // Zero opts out of the anchor-tolerance check. The reference price the
      // creator was shown is not served yet, and inventing one would arm a
      // guard against a number nobody displayed.
      reviewedUsdWad: 0n,
      // The address they are looking at, enforced on-chain.
      expectedToken: predicted,
      metadata,
      launchFee: BigInt(config.launchFee),
    });
  }, [ready, complete, config, asset, predicted, draft.name, draft.symbol, metadata, userSalt]);

  const wire = useMemo(
    () =>
      intent === null
        ? null
        : {
            kind: intent.kind,
            chainId: intent.chainId,
            to: intent.to,
            data: intent.data,
            value: intent.value.toString(),
            review: {
              kind: intent.review.kind,
              summary: intent.review.summary,
              rows: intent.review.rows,
            },
          },
    [intent],
  );

  const submit = useCallback(async (): Promise<void> => {
    if (wire === null) return;

    setSubmitting(true);
    setError(null);
    setSent(null);

    try {
      setSent(await wallet.send(wire));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The launch was not sent. Nothing was created.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [wallet, wire]);

  return (
    <div className={`${styles.page} container`} data-mode="experience">
      <header className={styles.head}>
        <h1 className={`${styles.title} m-primary`}>Launch a token</h1>
        <p className={`${styles.subtitle} m-secondary`}>
          One billion tokens, fixed at launch. You receive no allocation and neither does
          the platform — the entire supply goes to the curve.
        </p>
      </header>

      {/*
        Stated before the form, not after it. §219 forbids a hidden fee, and a
        cost disclosed on the review screen has already cost the creator their
        time.
      */}
      <section className={`${styles.terms} m-secondary`} aria-label="Launch terms">
        <Term label="Your allocation" value="0%" detail="No premine. The curve holds all of it." />
        <Term label="Platform allocation" value="0%" detail="The same answer, for the same reason." />
        <Term
          label="You earn"
          value="65%"
          detail="Of the 1% core trading fee, for the life of the market."
        />
        <Term
          label="Launch cost"
          value={
            config === null
              ? "Gas only"
              : BigInt(config.launchFee) === 0n
                ? "Gas only"
                : `${formatFixed(BigInt(config.launchFee), 18, { places: 4 })} HYPE`
          }
          detail={
            config === null
              ? "Plus the protocol launch fee if governance has set one."
              : BigInt(config.launchFee) === 0n
                ? "Governance has not set a launch fee. You pay gas and nothing else."
                : "The protocol launch fee, read from the factory, plus gas."
          }
        />
      </section>

      <div className={styles.layout}>
        <form className={`${styles.form} m-secondary`} onSubmit={(event) => event.preventDefault()}>
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
              disabled={config === null || config.launchable.length === 0}
            >
              {config === null ? (
                <option value="">Checking the registry…</option>
              ) : config.launchable.length === 0 ? (
                <option value="">No xStock is enabled yet</option>
              ) : (
                <>
                  <option value="">Choose an xStock</option>
                  {config.launchable.map((a) => (
                    <option key={a.token} value={a.token}>
                      {a.symbol === "" ? truncateAddress(a.token) : a.symbol}
                      {a.underlying !== null ? " (wrapper)" : ""}
                    </option>
                  ))}
                </>
              )}
            </select>
            {/*
              §219: the pair must be clearly official. The list comes from the
              on-chain registry and nothing else — a free-text address field here
              would let a creator pair against an impostor token, which is the
              exact attack §4 and §699 exist to prevent.
            */}
            <p className={styles.hint}>
              Only assets governance has registered and enabled can be paired — the list is
              read from the on-chain registry, never typed.{" "}
              {asset !== null && (
                <>
                  {asset.symbol} is <span className="mono">{truncateAddress(asset.token)}</span>
                  {asset.underlying !== null && (
                    <> and wraps <span className="mono">{truncateAddress(asset.underlying)}</span></>
                  )}
                  .
                </>
              )}
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

          {/*
            The vanity field is gone rather than inert.

            It said it "grinds the salt for an address starting with these
            characters" and nothing ground anything. A control that describes
            work it does not do is worse than its absence: a creator would type
            a prefix, get an unrelated address, and have no way to tell whether
            the feature or their input was at fault.

            Grinding needs CREATE2 computed locally, which needs the token's
            creation code in the client, kept in step with what is deployed.
            That is a real piece of work and it is not this one. The address is
            derived and shown below either way, and enforced on-chain.
          */}

          {problems.length > 0 && (
            <ul className={styles.problems}>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          {/*
            One button, and every disabled reason is stated somewhere the
            creator can see. §42: a submit that is enabled and then rejects is
            the shape this is written against.
          */}
          {!wallet.available ? (
            <button type="button" className={styles.submit} disabled>
              No wallet found
            </button>
          ) : address === null ? (
            <button
              type="button"
              className={styles.submit}
              onClick={() => void wallet.connect()}
              disabled={wallet.connecting}
            >
              {wallet.connecting ? "Check your wallet" : "Connect wallet"}
            </button>
          ) : wallet.wrongChain ? (
            <button
              type="button"
              className={styles.submit}
              onClick={() => void wallet.switchChain()}
            >
              Switch network
            </button>
          ) : (
            <button
              type="button"
              className={styles.submit}
              onClick={() => void submit()}
              disabled={wire === null || submitting}
            >
              {submitting ? "Confirm in your wallet" : `Launch ${draft.symbol || "token"}`}
            </button>
          )}

          {/*
            The reason, read rather than remembered.

            Each branch names one missing precondition. "Not enabled in this
            build" was the old copy and it was the least useful true thing that
            could be said — it described the code, when what a creator needs is
            what the chain is waiting for.
          */}
          {configError !== null ? (
            <p className={styles.blocked}>{configError}</p>
          ) : config === null ? (
            <p className={styles.blocked}>Checking what can be launched…</p>
          ) : config.launchable.length === 0 ? (
            <p className={styles.blocked}>
              No xStock is registered and enabled yet, so there is nothing to pair against.
              Governance registers an asset and passes its §420 gates before it can be a
              quote asset here.
            </p>
          ) : config.graduationRouter === null ? (
            <p className={styles.blocked}>
              The graduation router is not set. A market launched now would trade normally
              and then refuse to graduate — permanently, for everyone holding it — so
              launching is held until governance sets it.
            </p>
          ) : null}

          {sent !== null && (
            <p className={styles.hint}>
              Sent. Your market appears on Explore as soon as the launch is indexed.
            </p>
          )}

          {error !== null && <p className={styles.blocked}>{error}</p>}
          {wallet.error !== null && <p className={styles.blocked}>{wallet.error}</p>}
        </form>

        <aside className={`${styles.previewPane} m-secondary`} aria-label="Preview">
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
                by {address === null ? "your wallet, once connected" : truncateAddress(address)}
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

          {/*
            §412's whole point, made visible.

            The address is read from the factory's own preview and passed back
            to the launch as `expectedToken`, so the chain refuses to deploy
            anywhere else. It moves if the name, ticker, pair or metadata
            change — which is worth seeing happen rather than being told about.
          */}
          {predicted !== null && (
            <div className={styles.previewFacts}>
              <div>
                <dt>Token address</dt>
                <dd className="mono" title={predicted}>
                  {truncateAddress(predicted)}
                </dd>
              </div>
            </div>
          )}

          {predicted !== null && (
            <p className={styles.hint}>
              Derived from your address, your salt, the pair and the metadata — so it is
              reachable only by you, and only for exactly this launch. Change any of them
              and it moves.
            </p>
          )}

          {wire !== null && <IntentReview intent={wire} pending={false} />}
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
