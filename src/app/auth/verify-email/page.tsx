"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleResend(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <section className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-3 text-xl font-semibold text-[var(--color-text)]">
          Check your inbox
        </h1>
        <p className="mb-6 text-sm text-[var(--color-text-muted)]">
          We sent a verification link to your email address. Click it to
          activate your account.
        </p>

        {sent ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            If that address has a pending verification, a new link is on its way.
          </p>
        ) : (
          <form onSubmit={handleResend} className="flex flex-col gap-2">
            <p className="text-xs text-[var(--color-text-muted)]">
              Didn&apos;t receive it? Enter your email to resend.
            </p>
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
            <Button type="submit" variant="secondary" disabled={loading}>
              {loading ? "Sending…" : "Resend verification email"}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
