"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PullStatus = "idle" | "submitting" | "error";

/**
 * ADR-0012 — UAE-only one-click Xero pull.
 *
 * Lives next to the manual workbook upload form so analysts can choose
 * between the two ingestion paths without having to fill workbook
 * fields just to trigger a Xero sync. Entity, source, and as-of date
 * are all server-derived for Xero pulls — they're not asked here.
 */
export function XeroPullCard() {
  const router = useRouter();
  const [status, setStatus] = useState<PullStatus>("idle");
  const [message, setMessage] = useState("");

  async function pullFromXero() {
    setStatus("submitting");
    setMessage("");
    const response = await fetch("/api/xero/snapshots/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          snapshot_id?: string;
          message?: string;
          error?: { message?: string };
        }
      | null;

    if (!response.ok || !payload?.snapshot_id) {
      setStatus("error");
      setMessage(
        payload?.message ??
          payload?.error?.message ??
          "Xero pull failed. Check the connection and try again.",
      );
      return;
    }
    router.push(`/snapshots/${payload.snapshot_id}/staging`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-muted)]">
        Read-only OAuth pull from the UAE Xero organisation. No file or
        as-of date needed — Receivables OS still owns ageing, credit days,
        staging, and publish.
      </p>
      <button
        className="w-fit rounded bg-[var(--color-accent)] px-4 py-2 text-[var(--color-bg)] transition-colors hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-60"
        disabled={status === "submitting"}
        onClick={pullFromXero}
        type="button"
      >
        {status === "submitting" ? "Pulling from Xero..." : "Pull from Xero"}
      </button>
      {message ? (
        <p aria-live="polite" className="text-sm text-[var(--color-danger)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
