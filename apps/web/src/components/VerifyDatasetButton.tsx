"use client";

import { useState, type JSX } from "react";
import { buildDistributionTree, type Entitlement } from "@sent/stockback/merkle";
import { API_BASE } from "../lib/api.ts";
import styles from "./DistributionHistory.module.css";

interface DatasetPage {
  readonly ok: boolean;
  readonly data?: {
    readonly merkleRoot: string;
    readonly datasetHash: string;
    readonly holderCount: number;
    readonly entries: readonly { account: string; cumulative: string }[];
    readonly nextCursor: string | null;
  };
}

export function VerifyDatasetButton({
  token,
  sequence,
  merkleRoot,
  datasetHash,
  holderCount,
}: {
  token: string;
  sequence: string;
  merkleRoot: string;
  datasetHash: string;
  holderCount: number;
}): JSX.Element {
  const [state, setState] = useState<
    "idle" | "checking" | "verified" | "mismatch" | "error" | "unconfigured"
  >("idle");

  async function verify(): Promise<void> {
    setState("checking");
    if (API_BASE === "") {
      setState("unconfigured");
      return;
    }

    try {
      const entries: Entitlement[] = [];
      let cursor: string | null = null;
      const seenCursors = new Set<string>();
      const base = API_BASE.replace(/\/+$/, "");

      do {
        const query = new URLSearchParams({ limit: "500" });
        if (cursor !== null) query.set("cursor", cursor);
        const url = `${base}/v1/markets/${encodeURIComponent(token)}/epochs/${sequence}/entries?${query.toString()}`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("Dataset endpoint unavailable");
        const body = (await response.json()) as DatasetPage;
        const page = body.data;
        if (
          body.ok !== true ||
          page === undefined ||
          !Array.isArray(page.entries) ||
          page.merkleRoot.toLowerCase() !== merkleRoot.toLowerCase() ||
          page.datasetHash.toLowerCase() !== datasetHash.toLowerCase() ||
          page.holderCount !== holderCount
        ) {
          throw new Error("Dataset pages do not match the published epoch");
        }

        for (const entry of page.entries) {
          if (!/^0x[0-9a-fA-F]{40}$/.test(entry.account) || !/^\d+$/.test(entry.cumulative)) {
            throw new Error("Dataset contains an invalid entry");
          }
          entries.push({
            account: entry.account.toLowerCase() as `0x${string}`,
            cumulative: BigInt(entry.cumulative),
          });
        }
        if (entries.length > holderCount) throw new Error("Dataset contains too many entries");

        cursor = page.nextCursor;
        if (cursor !== null) {
          if (seenCursors.has(cursor.toLowerCase())) throw new Error("Dataset cursor repeated");
          seenCursors.add(cursor.toLowerCase());
        }
      } while (cursor !== null);

      if (entries.length !== holderCount || entries.length === 0) {
        setState("mismatch");
        return;
      }

      const rebuilt = buildDistributionTree(entries);
      setState(
        rebuilt.root.toLowerCase() === merkleRoot.toLowerCase() &&
          rebuilt.datasetHash.toLowerCase() === datasetHash.toLowerCase()
          ? "verified"
          : "mismatch",
      );
    } catch {
      setState("error");
    }
  }

  const label =
    state === "checking"
      ? "Checking…"
      : state === "verified"
        ? "Verified locally"
        : state === "mismatch"
          ? "Does not match"
            : state === "unconfigured"
              ? "Not configured"
          : state === "error"
            ? "Could not verify"
            : "Verify dataset";

  return (
    <span className={styles.verifier}>
      <button
        type="button"
        className={styles.verifyButton}
        onClick={() => void verify()}
        disabled={state === "checking"}
        aria-label={`Rebuild and verify epoch ${sequence} dataset`}
      >
        {label}
      </button>
      {state === "mismatch" && (
        <span role="status" className={styles.verifyStatus}>
          Published root or dataset hash differs from the public entries.
        </span>
      )}
      {state === "error" && (
        <span role="status" className={styles.verifyStatus}>
          Could not read every page. Retry when the API is available.
        </span>
      )}
      {state === "unconfigured" && (
        <span role="status" className={styles.verifyStatus}>
          Dataset verification is not configured for this deployment.
        </span>
      )}
      {state === "verified" && (
        <span role="status" className={styles.verifyStatus}>
          All {holderCount.toLocaleString()} entries reproduce the published root and hash.
        </span>
      )}
    </span>
  );
}
