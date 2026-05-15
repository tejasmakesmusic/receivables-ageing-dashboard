"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

function OtpVerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const next = searchParams.get("next") ?? "/dashboard";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "server_error");
        return;
      }

      router.push(data.redirectTo ?? next);
    } catch {
      setError("server_error");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResent(false);
    try {
      await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResent(true);
    } catch {
      // silently ignore — user can try again
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text)]">
          Check your inbox
        </h1>
        {email && (
          <p className="mb-6 text-center text-sm text-[var(--color-text-muted)]">
            We sent a sign-in code and a magic link to{" "}
            <strong>{email}</strong>
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="code" className="text-xs font-medium text-[var(--color-text-muted)]">
              Sign-in code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-center text-lg font-mono tracking-[0.5em] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--color-status-danger-text)]">
              {error === "invalid_otp"
                ? "Invalid or expired code."
                : "Something went wrong. Please try again."}
            </p>
          )}

          {resent && (
            <p className="text-xs text-[var(--color-status-success-text)]">
              A new code has been sent.
            </p>
          )}

          <Button
            type="submit"
            disabled={loading || code.length !== 6}
            className="mt-1 w-full"
          >
            {loading ? "Verifying…" : "Verify code"}
          </Button>

          <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
            <button
              type="button"
              onClick={handleResend}
              className="hover:text-[var(--color-accent)]"
            >
              Resend code
            </button>
            <a href="/auth/login" className="hover:text-[var(--color-accent)]">
              Back to sign in
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function OtpVerifyPage() {
  return (
    <Suspense>
      <OtpVerifyForm />
    </Suspense>
  );
}
