import { Route, Routes, Link } from "react-router-dom";

// Placeholder routes for every screen in spec §9. RBAC gates and real
// components land in Milestones 3–6. Wireframes come in M2 and live under
// /wireframes/ as static HTML+Tailwind before any of these are built out.

function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Receivables Ageing Dashboard — Phase 1</h1>
      <p className="mt-2 text-slate-600">
        Scaffold only. Feature implementation starts at Milestone 1.
      </p>
      <nav className="mt-6 grid grid-cols-2 gap-2 text-sm">
        {routeIndex.map(([path, label]) => (
          <Link key={path} to={path} className="text-blue-600 hover:underline">
            {label}
          </Link>
        ))}
      </nav>
    </main>
  );
}

function Stub({ code, title }: { code: string; title: string }) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="text-xs font-mono text-slate-500">{code}</div>
      <h1 className="mt-1 text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-slate-600">Placeholder. Implementation pending.</p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
        ← Home
      </Link>
    </main>
  );
}

const routeIndex: [string, string][] = [
  ["/upload", "S1 · Upload"],
  ["/staging", "S2 · Staging"],
  ["/config/credit-period", "S3 · Credit period"],
  ["/config/aliases", "S4 · Aliases"],
  ["/exceptions", "S5 · Exceptions"],
  ["/follow-ups", "S6 · Follow-ups"],
  ["/dashboard", "D1 · Dashboard"],
  ["/party", "D2 · Party drill-down"],
  ["/invoice", "D3 · Invoice drill-down"],
  ["/admin/users", "A1 · Users"],
  ["/admin/emails", "A2 · Emails"],
  ["/admin/exception-buckets", "A3 · Exception buckets"],
  ["/admin/fx-rates", "A4 · FX rates"],
  ["/admin/audit-log", "A5 · Audit log"],
  ["/admin/reconciliation", "A6 · Reconciliation"],
  ["/pending", "— · Pending approval"],
];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/upload" element={<Stub code="S1" title="Upload" />} />
      <Route path="/staging" element={<Stub code="S2" title="Staging review" />} />
      <Route path="/staging/:snapshotId" element={<Stub code="S2" title="Staging review" />} />
      <Route
        path="/config/credit-period"
        element={<Stub code="S3" title="Credit period master" />}
      />
      <Route path="/config/aliases" element={<Stub code="S4" title="Party aliases" />} />
      <Route path="/exceptions" element={<Stub code="S5" title="Exceptions" />} />
      <Route path="/follow-ups" element={<Stub code="S6" title="Follow-ups" />} />
      <Route path="/dashboard" element={<Stub code="D1" title="Dashboard" />} />
      <Route path="/party" element={<Stub code="D2" title="Party drill-down" />} />
      <Route path="/party/:id" element={<Stub code="D2" title="Party drill-down" />} />
      <Route path="/invoice" element={<Stub code="D3" title="Invoice drill-down" />} />
      <Route path="/invoice/:id" element={<Stub code="D3" title="Invoice drill-down" />} />
      <Route path="/admin/users" element={<Stub code="A1" title="Users + PENDING approvals" />} />
      <Route path="/admin/emails" element={<Stub code="A2" title="Email rules" />} />
      <Route
        path="/admin/exception-buckets"
        element={<Stub code="A3" title="Exception buckets" />}
      />
      <Route path="/admin/fx-rates" element={<Stub code="A4" title="FX rates" />} />
      <Route path="/admin/audit-log" element={<Stub code="A5" title="Audit log" />} />
      <Route
        path="/admin/reconciliation"
        element={<Stub code="A6" title="Reconciliation" />}
      />
      <Route path="/pending" element={<Stub code="—" title="Awaiting role assignment" />} />
      <Route path="*" element={<Stub code="404" title="Not found" />} />
    </Routes>
  );
}
