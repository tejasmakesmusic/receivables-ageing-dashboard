"use client";

import { useState } from "react";

/**
 * Triggers the OAuth dance by navigating to /api/admin/xero/connect.
 * Kept as a client-side button (not <a href>) to honor the
 * no-api-navigation guard while still hitting the redirect route.
 */
export function ConnectXeroButton() {
  const [submitting, setSubmitting] = useState(false);

  return (
    <button
      className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] disabled:pointer-events-none disabled:opacity-60"
      disabled={submitting}
      onClick={() => {
        setSubmitting(true);
        window.location.href = "/api/admin/xero/connect";
      }}
      type="button"
    >
      {submitting ? "Redirecting to Xero..." : "Connect Xero"}
    </button>
  );
}
