export default function PendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
      <section className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-3 text-xl font-semibold text-slate-900">
          Awaiting role assignment
        </h1>
        <p className="text-sm text-slate-600">
          Your account is recognized but not yet active.
        </p>
      </section>
    </main>
  );
}
