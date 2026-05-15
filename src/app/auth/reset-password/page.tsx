"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const errorMessages: Record<string, string> = {
    token_expired: "This reset link has expired.",
    password_too_short: "Password must be at least 8 characters.",
    passwords_mismatch: "Passwords do not match.",
    server_error: "Something went wrong. Please try again.",
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
        <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm text-center">
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">
            This reset link is invalid.
          </p>
          <a
            href="/auth/forgot-password"
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            Request a new one
          </a>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("passwords_mismatch");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "server_error");
        return;
      }

      router.push(data.redirectTo ?? "/dashboard");
    } catch {
      setError("server_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-[var(--color-text)]">
          Set new password
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="password"
              className="text-xs font-medium text-[var(--color-text-muted)]"
            >
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="confirmPassword"
              className="text-xs font-medium text-[var(--color-text-muted)]"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--color-status-danger-text)]">
              {errorMessages[error] ?? errorMessages.server_error}
              {error === "token_expired" && (
                <>
                  {" "}
                  <a href="/auth/forgot-password" className="underline">
                    Request a new link.
                  </a>
                </>
              )}
            </p>
          )}

          <Button type="submit" disabled={loading} className="mt-1 w-full">
            {loading ? "Saving…" : "Set new password"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
