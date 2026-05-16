"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DisconnectXeroButton({
  connectionId,
}: {
  connectionId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  async function disconnect() {
    setStatus("submitting");
    const response = await fetch("/api/admin/xero/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: connectionId }),
    });
    if (!response.ok) {
      setStatus("error");
      return;
    }
    setStatus("idle");
    router.refresh();
  }

  return (
    <button
      className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-bg-subtle)] disabled:pointer-events-none disabled:opacity-60"
      disabled={status === "submitting"}
      onClick={disconnect}
      type="button"
    >
      {status === "submitting"
        ? "Disconnecting..."
        : status === "error"
          ? "Retry disconnect"
          : "Disconnect"}
    </button>
  );
}
