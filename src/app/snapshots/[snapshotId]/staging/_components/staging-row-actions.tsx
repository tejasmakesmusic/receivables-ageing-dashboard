"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  StagingCreditPeriodRow,
  StagingInvoiceRow,
} from "@/server/snapshots/service";

type StagingRow = StagingInvoiceRow | StagingCreditPeriodRow;
type ActionState = "idle" | "submitting" | "error";

type ApiError = {
  error?: string;
  message?: string;
};

function isInvoiceRow(row: StagingRow): row is StagingInvoiceRow {
  return "party_name_raw" in row;
}

function rowName(row: StagingRow) {
  return isInvoiceRow(row) ? row.party_name_raw : row.name;
}

export function StagingRowActions({
  row,
  snapshotId,
}: {
  row: StagingRow;
  snapshotId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");
  const isInvoice = isInvoiceRow(row);
  const isResolved = Boolean(row.analyst_overrides.resolved_canonical_id);
  const candidate = isInvoice ? row.alias_resolution.topMatches[0] : null;

  async function readError(response: Response) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    return (
      payload?.message ?? payload?.error ?? `Request failed with ${response.status}`
    );
  }

  async function patchRow(body: Record<string, unknown>) {
    setState("submitting");
    setMessage("");

    try {
      const response = await fetch(
        `/api/snapshots/${snapshotId}/staging/${row.row_index}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      router.refresh();
      setState("idle");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Could not update staging row",
      );
    }
  }

  if (isResolved) {
    return <span className="text-xs text-emerald-700">Resolved</span>;
  }

  if (isInvoice && row.status === "PARSE_ERROR") {
    if (row.analyst_overrides.dismissed) {
      return <span className="text-xs text-emerald-700">Reviewed</span>;
    }

    return (
      <div className="grid gap-1">
        <button
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:pointer-events-none disabled:opacity-60"
          disabled={state === "submitting"}
          onClick={() =>
            patchRow({
              action: "dismiss_parse_error",
              reason: "Reviewed from staging UI",
            })
          }
          type="button"
        >
          {state === "submitting" ? "Saving..." : "Mark Reviewed"}
        </button>
        {message ? <span className="text-xs text-red-700">{message}</span> : null}
      </div>
    );
  }

  return (
    <div className="grid max-w-56 gap-1">
      {candidate ? (
        <button
          className="rounded border border-slate-200 bg-white px-2 py-1 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-60"
          disabled={state === "submitting"}
          onClick={() =>
            patchRow({
              action: "resolve_alias",
              canonical_id: candidate.canonicalId,
              create_alias: true,
            })
          }
          type="button"
        >
          Use {candidate.canonicalName}
        </button>
      ) : null}
      <button
        className="rounded border border-slate-200 bg-white px-2 py-1 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-60"
        disabled={state === "submitting"}
        onClick={() =>
          patchRow({
            action: "create_canonical",
            canonical_name: rowName(row),
          })
        }
        type="button"
      >
        Create Canonical
      </button>
      {message ? <span className="text-xs text-red-700">{message}</span> : null}
    </div>
  );
}
