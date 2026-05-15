"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // Always show success — no enumeration
      setSubmitted(true);
    } catch {
      setError("server_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text)]">
          EMB Receivables
        </h1>

        {submitted ? (
          <div className="text-center">
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">
              If that email is registered, a password reset link is on its way.
              Check your inbox.
            </p>
            <a href="/auth/login" className="text-sm text-[var(--color-accent)] hover:underline">
              Back to sign in
            </a>
          </div>
        ) : (
          <>
            <p className="mb-6 text-center text-sm text-[var(--color-text-muted)]">
              Enter your email and we&#39;ll send you a reset link
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="email"
                  className="text-xs font-medium text-[var(--color-text-muted)]"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
                />
              </div>

              {error && (
                <p className="text-xs text-[var(--color-status-danger-text)]">
                  Something went wrong. Please try again.
                </p>
              )}

              <Button type="submit" disabled={loading} className="mt-1 w-full">
                {loading ? "Sending…" : "Send reset link"}
              </Button>

              <a
                href="/auth/login"
                className="mt-1 text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
              >
                Back to sign in
              </a>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
