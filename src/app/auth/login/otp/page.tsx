"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

function OtpRequestForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "server_error");
        return;
      }

      router.push(
        `/auth/login/otp/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`,
      );
    } catch {
      setError("server_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text)]">
          EMB Receivables
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--color-text-muted)]">
          Enter your email to receive a sign-in code
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-xs font-medium text-[var(--color-text-muted)]">
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
              {error === "invalid_input"
                ? "Please enter a valid email address."
                : "Something went wrong. Please try again."}
            </p>
          )}

          <Button type="submit" disabled={loading} className="mt-1 w-full">
            {loading ? "Sending…" : "Send sign-in code"}
          </Button>

          <a
            href={`/auth/login?next=${encodeURIComponent(next)}`}
            className="mt-1 text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
          >
            Back to sign in
          </a>
        </form>
      </div>
    </div>
  );
}

export default function OtpRequestPage() {
  return (
    <Suspense>
      <OtpRequestForm />
    </Suspense>
  );
}
