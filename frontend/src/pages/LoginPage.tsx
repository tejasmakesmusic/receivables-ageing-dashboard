import { Button } from "@/components/ui/Button";

export function LoginPage() {
  function handleGoogleLogin() {
    window.location.href = "/auth/google/login";
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-800">EMB Receivables</h1>
        <p className="mt-1 text-sm text-slate-500">Ageing Dashboard</p>

        <div className="mt-8">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={handleGoogleLogin}
          >
            Sign in with Google
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          EMB Global employees only. Access is restricted to @emb.global accounts.
        </p>
      </div>
    </div>
  );
}
