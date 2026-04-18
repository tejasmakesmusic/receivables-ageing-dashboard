/**
 * D3 — Invoice detail (Tier 3 stub)
 * Route: /invoice/:invoice_id
 */
import { useParams, Link } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";

export function D3InvoiceDetailPage() {
  const { invoice_id } = useParams<{ invoice_id: string }>();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-xs font-mono text-slate-400 mb-1">D3 · Invoice detail</div>
      <h1 className="text-xl font-semibold text-slate-800">Invoice drill-down</h1>
      <p className="mt-1 text-sm text-slate-500 font-mono">{invoice_id}</p>
      <div className="mt-4">
        <Badge variant="info">Coming in M5</Badge>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        Full invoice history, ageing timeline, and exception audit trail are tracked as M5 scope.
      </p>
      <Link to="/dashboard" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
        ← Back to Dashboard
      </Link>
    </div>
  );
}
