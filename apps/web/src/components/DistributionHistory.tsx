/**
 * SENT — how Stockback was distributed, and whether anyone else checked
 * (§333, §367).
 *
 * `/markets/:token/epochs` was the last endpoint with no reader.
 *
 * WHY THE INPUTS ARE SHOWN AND NOT ONLY THE ROOT
 * ----------------------------------------------
 * §333's dataset exists so that somebody who does not trust this service can
 * re-derive an epoch's Merkle root themselves. The pool, the eligible holder
 * count and the total weight are what make the total reproducible; a panel
 * showing only a root would be asking to be believed, which is the thing the
 * section is written against.
 *
 * So the numbers that go INTO the root sit beside it, and the root and dataset
 * hash are shown in full rather than truncated to something you cannot compare.
 *
 * ATTESTED IS THE LINE THAT MATTERS (§293, §334)
 * ----------------------------------------------
 * An unattested epoch's figures are real arithmetic and pay nothing. That is
 * the whole distinction between "this node computed it" and "the chain honours
 * it", and it is the one thing on this panel a holder can act on — so it is a
 * badge per row rather than a footnote, and the unattested state says what it
 * means instead of just being absent.
 *
 * PROGRESSIVE, NOT HIDDEN
 * -----------------------
 * The status is always visible because it is the actionable part. The per-epoch
 * table is inside a `details` because it is reference data for someone doing a
 * verification, and the summary says what is inside — §44 forbids making people
 * hunt for information, not folding a ledger behind a labelled control.
 */

import { getEpochs, isOk } from "../lib/api.ts";
import { formatQuoteCompact } from "../lib/format.ts";
import { VerifyDatasetButton } from "./VerifyDatasetButton.tsx";

import styles from "./DistributionHistory.module.css";
import type { JSX } from "react";

const STATE_COPY: Record<string, { label: string; detail: string }> = {
  OPEN: {
    label: "Open",
    detail:
      "The current epoch is still accumulating. Nothing has been submitted for it yet.",
  },
  FINALIZING: {
    label: "Finalizing",
    detail:
      "A root is on chain and waiting out its activation delay. Entitlements against it are not payable until it activates.",
  },
  FINALIZED: {
    label: "Finalized",
    detail: "A root is active. Entitlements against it can be claimed now.",
  },
};

function big(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function day(seconds: number): string {
  return seconds > 0 ? new Date(seconds * 1000).toISOString().slice(0, 10) : "—";
}

export async function DistributionHistory({
  token,
  rewardSymbol,
}: {
  token: string;
  rewardSymbol: string;
}): Promise<JSX.Element | null> {
  const result = await getEpochs(token, { revalidateSeconds: 30 }).catch(() => null);
  if (result === null || !isOk(result)) return null;

  const { epochs, status } = result.data;
  const state = STATE_COPY[status.state] ?? {
    label: status.state,
    detail: "",
  };

  return (
    <section className={styles.history} aria-label="Stockback distribution">
      <header className={styles.head}>
        <h2 className={styles.title}>Stockback distribution</h2>
        <span className={styles.state} data-state={status.state}>
          {state.label}
        </span>
      </header>

      <p className={styles.detail}>{state.detail}</p>

      <dl className={styles.totals}>
        <Total
          term="Funded"
          value={`${formatQuoteCompact(big(status.totalFunded))} ${rewardSymbol}`}
        />
        <Total
          term="Claimed"
          value={`${formatQuoteCompact(big(status.totalClaimed))} ${rewardSymbol}`}
        />
        <Total
          term="Outstanding"
          value={`${formatQuoteCompact(big(status.outstanding))} ${rewardSymbol}`}
        />
      </dl>

      {epochs.length === 0 ? (
        <p className={styles.empty}>
          No epoch has closed yet. The first distribution appears here once one does.
        </p>
      ) : (
        <details className={styles.details}>
          <summary className={styles.summary}>
            {epochs.length === 1
              ? "1 closed epoch — pool, holders, weight and root"
              : `${epochs.length} closed epochs — pool, holders, weight and root`}
          </summary>

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Epoch</th>
                  <th scope="col">Closed</th>
                  <th scope="col">Pool</th>
                  <th scope="col">Allocated</th>
                  <th scope="col">Carried</th>
                  <th scope="col">Holders</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Root</th>
                  <th scope="col">State</th>
                  <th scope="col">Check</th>
                </tr>
              </thead>
              <tbody>
                {epochs.map((e) => (
                  <tr key={e.epochSequence}>
                    <td className="num">{e.epochSequence}</td>
                    <td>{day(e.endTime)}</td>
                    <td className="num">{formatQuoteCompact(big(e.pool))}</td>
                    <td className="num">{formatQuoteCompact(big(e.allocated))}</td>
                    {/* §327: rounding dust rolls forward rather than vanishing,
                        and showing it is how that is checkable. */}
                    <td className="num">{formatQuoteCompact(big(e.carryForward))}</td>
                    <td className="num">{e.eligibleHolders}</td>
                    {/* The third input the root is derived from. The note under
                        this table says pool, holders and weight are published so
                        the total can be recomputed — so all three have to be. */}
                    <td className="num">{formatQuoteCompact(big(e.totalWeight))}</td>
                    <td className={styles.hash}>
                      {/* Full, not truncated. A root you cannot compare against
                          your own is not a root anyone can verify. */}
                      <code title={`dataset ${e.datasetHash}`}>{e.merkleRoot}</code>
                    </td>
                    <td>
                      {e.attested ? (
                        <span className={styles.attested}>Attested</span>
                      ) : (
                        <span
                          className={styles.unattested}
                          title="Computed but not activated on chain. Real arithmetic that pays nothing until an attestor quorum activates it."
                        >
                          Not attested
                        </span>
                      )}
                    </td>
                    <td>
                      <VerifyDatasetButton
                        token={token}
                        sequence={e.epochSequence}
                        merkleRoot={e.merkleRoot}
                        datasetHash={e.datasetHash}
                        holderCount={e.holderCount}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={styles.note}>
            The public entries let you rebuild and check each root and dataset hash in your
            browser. The checker reads the whole paged dataset and uses the same
            deterministic Merkle encoding as the contracts expect; it does not submit a
            transaction. Hover a root for the dataset hash it was built from.
          </p>
        </details>
      )}
    </section>
  );
}

function Total({ term, value }: { term: string; value: string }): JSX.Element {
  return (
    <div className={styles.total}>
      <dt className={styles.totalTerm}>{term}</dt>
      <dd className={`${styles.totalValue} num`}>{value}</dd>
    </div>
  );
}
