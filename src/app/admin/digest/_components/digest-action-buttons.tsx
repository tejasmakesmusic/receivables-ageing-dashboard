"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type DigestActionState = "idle" | "submitting" | "error";

type ApiError = {
  message?: string;
  error?: string;
};

async function postJson(url: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const payload = (await response.json().catch(() => null)) as ApiError | null;

  if (!response.ok) {
    throw new Error(
      payload?.message ?? payload?.error ?? `Request failed with ${response.status}`,
    );
  }
}

export function TriggerDigestButton() {
  const router = useRouter();
  const [state, setState] = useState<DigestActionState>("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    setState("submitting");
    setMessage("");

    try {
      await postJson("/api/admin/digest/trigger");
      router.refresh();
      setState("idle");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Digest trigger failed");
    }
  }

  return (
    <div className="grid gap-1">
      <button
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-60"
        disabled={state === "submitting"}
        onClick={handleClick}
        type="button"
      >
        {state === "submitting" ? "Triggering..." : "Trigger today's digest"}
      </button>
      {message ? (
        <span aria-live="polite" className="text-xs text-red-700">
          {message}
        </span>
      ) : null}
    </div>
  );
}

export function DigestActions({
  id,
  state,
}: {
  id: string;
  state: string;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"approve" | "skip" | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const canApprove = state === "PREVIEWED";
  const canSkip = !["SENT", "SKIPPED", "FAILED"].includes(state);

  async function runAction(action: "approve" | "skip") {
    setPendingAction(action);
    setMessage("");

    try {
      await postJson(`/api/admin/digest/${id}/${action}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Digest update failed");
    } finally {
      setPendingAction(null);
    }
  }

  if (!canApprove && !canSkip) {
    return <span className="text-slate-400">-</span>;
  }

  return (
    <div className="grid gap-1">
      <div className="flex gap-2">
        {canApprove ? (
          <button
            className="rounded bg-green-100 px-2 py-1 text-xs text-green-800 hover:bg-green-200 disabled:pointer-events-none disabled:opacity-60"
            disabled={pendingAction !== null}
            onClick={() => runAction("approve")}
            type="button"
          >
            {pendingAction === "approve" ? "Approving..." : "Approve & send"}
          </button>
        ) : null}
        {canSkip ? (
          <button
            className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 disabled:pointer-events-none disabled:opacity-60"
            disabled={pendingAction !== null}
            onClick={() => runAction("skip")}
            type="button"
          >
            {pendingAction === "skip" ? "Skipping..." : "Skip"}
          </button>
        ) : null}
      </div>
      {message ? (
        <span aria-live="polite" className="text-xs text-red-700">
          {message}
        </span>
      ) : null}
    </div>
  );
}
