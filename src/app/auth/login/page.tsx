"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(urlError ?? null);
  const [loading, setLoading] = useState(false);

  const errorMessages: Record<string, string> = {
    invalid_credentials: "Invalid email or password.",
    use_google: "This account uses Google Sign-In. Use the button below.",
    email_not_verified: "Please verify your email first. Check your inbox.",
    oauth_failed: "Google sign-in failed. Please try again.",
    token_expired: "This verification link has expired.",
    token_invalid: "This verification link is invalid.",
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, next }),
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-[var(--color-text)]">
          EMB Receivables
        </h1>

        <a
          href={`/auth/google/login?next=${encodeURIComponent(next)}`}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z"/>
            <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z"/>
            <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.4L4.5 7.49a4.77 4.77 0 014.48-3.3z"/>
          </svg>
          Continue with Google
        </a>

        <div className="relative my-4 flex items-center">
          <div className="flex-grow border-t border-[var(--color-border)]" />
          <span className="mx-3 text-xs text-[var(--color-text-muted)]">or</span>
          <div className="flex-grow border-t border-[var(--color-border)]" />
        </div>

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

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-xs font-medium text-[var(--color-text-muted)]">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--color-status-danger-text)]">
              {errorMessages[error] ?? "Something went wrong. Please try again."}
            </p>
          )}

          <Button type="submit" disabled={loading} className="mt-1 w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>

          <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
            <span className="cursor-not-allowed opacity-50">Forgot password?</span>
            <a href="/auth/register" className="hover:text-[var(--color-accent)]">
              Create account
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}
