/**
 * D2 — Party detail (Tier 3 stub)
 * Route: /party/:canonical_id
 */
import { useParams, Link } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";

export function D2PartyDetailPage() {
  const { canonical_id } = useParams<{ canonical_id: string }>();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-xs font-mono text-slate-400 mb-1">D2 · Party detail</div>
      <h1 className="text-xl font-semibold text-slate-800">Party drill-down</h1>
      <p className="mt-1 text-sm text-slate-500 font-mono">{canonical_id}</p>
      <div className="mt-4">
        <Badge variant="info">Coming in M5</Badge>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        Full party outstanding, invoice history, and exception timeline are tracked as M5 scope.
      </p>
      <Link to="/dashboard" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
        ← Back to Dashboard
      </Link>
    </div>
  );
}
