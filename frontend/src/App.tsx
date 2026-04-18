import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import { ProtectedRoute } from "@/components/ProtectedRoute";

import { LoginPage } from "@/pages/LoginPage";
import { PendingPage } from "@/pages/PendingPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

import { S1UploadPage } from "@/pages/S1UploadPage";
import { S2StagingPage } from "@/pages/S2StagingPage";
import { D1DashboardPage } from "@/pages/D1DashboardPage";
import { S5ExceptionsPage } from "@/pages/S5ExceptionsPage";
import { A6ReconciliationPage } from "@/pages/A6ReconciliationPage";
import { S3CreditPeriodPage } from "@/pages/S3CreditPeriodPage";
import { S4AliasesPage } from "@/pages/S4AliasesPage";
import { A3ExceptionBucketsPage } from "@/pages/A3ExceptionBucketsPage";
import { A4FxRatesPage } from "@/pages/A4FxRatesPage";
import { A5AuditLogPage } from "@/pages/A5AuditLogPage";
import { A2EmailOutboxPage } from "@/pages/A2EmailOutboxPage";
import { D2PartyDetailPage } from "@/pages/D2PartyDetailPage";
import { D3InvoiceDetailPage } from "@/pages/D3InvoiceDetailPage";
import { S6FollowUpsPage } from "@/pages/S6FollowUpsPage";

function AdminUsersRedirect() {
  // M1 users page lives at /admin/users on the Jinja side.
  // We redirect from React's route to the server-rendered page.
  window.location.href = "/admin/users";
  return null;
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pending" element={<PendingPage />} />

      {/* Authenticated shell — all non-PENDING roles */}
      <Route
        element={
          <ProtectedRoute allowedRoles={["ANALYST", "CFO", "ADMIN"]}>
            <Shell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Dashboard — all authenticated roles */}
        <Route path="/dashboard" element={<D1DashboardPage />} />

        {/* Stubs — all authenticated */}
        <Route path="/party/:canonical_id" element={<D2PartyDetailPage />} />
        <Route path="/invoice/:invoice_id" element={<D3InvoiceDetailPage />} />

        {/* ANALYST + ADMIN routes */}
        <Route element={<ProtectedRoute allowedRoles={["ANALYST", "ADMIN"]} />}>
          <Route path="/upload" element={<S1UploadPage />} />
          <Route path="/staging/:snapshot_id" element={<S2StagingPage />} />
          <Route path="/exceptions" element={<S5ExceptionsPage />} />
          <Route path="/follow-ups" element={<S6FollowUpsPage />} />
          <Route path="/config/credit-period" element={<S3CreditPeriodPage />} />
          <Route path="/config/aliases" element={<S4AliasesPage />} />
        </Route>

        {/* ADMIN-only routes */}
        <Route element={<ProtectedRoute allowedRoles={["ADMIN"]} />}>
          <Route path="/admin/exception-buckets" element={<A3ExceptionBucketsPage />} />
          <Route path="/admin/fx-rates" element={<A4FxRatesPage />} />
          <Route path="/admin/audit-log" element={<A5AuditLogPage />} />
          <Route path="/admin/emails" element={<A2EmailOutboxPage />} />
          <Route path="/admin/reconciliation" element={<A6ReconciliationPage />} />
          <Route path="/admin/users" element={<AdminUsersRedirect />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
