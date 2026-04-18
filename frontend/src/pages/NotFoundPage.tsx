import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <p className="text-4xl font-bold text-slate-300">404</p>
      <h1 className="mt-2 text-lg font-semibold text-slate-700">Page not found</h1>
      <Link to="/dashboard" className="mt-4 text-sm text-blue-600 hover:underline">
        ← Back to Dashboard
      </Link>
    </div>
  );
}
