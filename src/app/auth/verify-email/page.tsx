export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <section className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-3 text-xl font-semibold text-[var(--color-text)]">
          Check your inbox
        </h1>
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          We sent a verification link to your email address. Click it to activate
          your account.
        </p>
        <p className="text-xs text-[var(--color-text-muted)]">
          Didn&apos;t receive it?{" "}
          <a href="/auth/register" className="underline hover:text-[var(--color-accent)]">
            Try registering again
          </a>
        </p>
      </section>
    </main>
  );
}
