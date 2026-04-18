/**
 * S6 — Follow-ups (Tier 3 stub)
 * Route: /follow-ups   Roles: ANALYST, ADMIN
 */
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";

export function S6FollowUpsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-xs font-mono text-slate-400 mb-1">S6 · Follow-ups</div>
      <h1 className="text-xl font-semibold text-slate-800">Follow-up tracking</h1>
      <div className="mt-4">
        <Badge variant="info">Coming in M5-full</Badge>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        Follow-up tracking is a separate workflow from exceptions — it handles outbound
        communication and chase schedules. Tracked separately in M5.
      </p>
      <Link to="/exceptions" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
        ← Exceptions
      </Link>
    </div>
  );
}
