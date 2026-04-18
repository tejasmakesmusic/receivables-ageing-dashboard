import { Button } from "@/components/ui/Button";

export function PendingPage() {
  function handleLogout() {
    window.location.href = "/auth/logout";
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm text-center">
        <div className="mb-4 text-3xl">⏳</div>
        <h1 className="text-lg font-semibold text-slate-800">Awaiting role assignment</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your account has been registered. An admin will assign your role shortly. You'll be
          notified by email once approved.
        </p>
        <div className="mt-6">
          <Button variant="secondary" size="md" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
