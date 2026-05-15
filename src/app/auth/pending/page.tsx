export default function PendingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-3 text-xl font-semibold text-[var(--color-text)]">
          Awaiting role assignment
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Your account is recognized but not yet active.
        </p>
      </section>
    </div>
  );
}
