import Link from "next/link";

export default function PendingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <section className="w-full max-w-lg space-y-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">
            Awaiting role assignment
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Your <span className="font-mono">@emb.global</span> account is
            recognized but hasn&apos;t been granted a workspace role yet.
            Until an administrator approves your access, you can&apos;t view
            invoices, snapshots, or reports.
          </p>
        </div>

        <ol className="space-y-2 text-sm text-[var(--color-text)]">
          <li className="flex gap-2">
            <span className="font-mono text-[var(--color-text-muted)]">1.</span>
            <span>
              An admin has been notified that you signed in for the first time.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-[var(--color-text-muted)]">2.</span>
            <span>
              They&apos;ll assign you a role (ANALYST, REVIEWER, CFO, or ADMIN)
              and — if needed — an entity scope (IND or UAE).
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-[var(--color-text-muted)]">3.</span>
            <span>
              Refresh this page after approval — you&apos;ll land on the home
              workspace.
            </span>
          </li>
        </ol>

        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3 text-xs text-[var(--color-text-muted)]">
          Need this faster?{" "}
          <a
            className="text-[var(--color-accent)] underline hover:opacity-80"
            href="mailto:tejaswa.sharma@emb.global?subject=Receivables%20access%20request"
          >
            Email Tejaswa Sharma
          </a>{" "}
          with your role + entity scope and they&apos;ll approve directly.
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4 text-xs">
          <Link
            className="text-[var(--color-accent)] hover:underline"
            href="/auth/login"
          >
            ← Back to sign in
          </Link>
          <a
            className="text-[var(--color-text-muted)] hover:underline"
            href="/api/auth/logout"
          >
            Sign out
          </a>
        </div>
      </section>
    </div>
  );
}
