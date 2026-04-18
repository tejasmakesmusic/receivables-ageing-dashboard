import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function mockMe(user: Record<string, unknown> | null, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: () => (user ? Promise.resolve(user) : Promise.reject()),
    } as unknown as Response),
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("redirects to /login on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Unauthorized" }),
      } as unknown as Response),
    );
    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route path="/login" element={<div>Login page</div>} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute allowedRoles={["ANALYST", "ADMIN"]}>
                  <div>Protected content</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Login page")).toBeInTheDocument();
    });
  });

  it("redirects PENDING to /pending", async () => {
    mockMe({ id: "1", email: "p@emb.global", name: "P", role: "PENDING", entity_id_scope: null });
    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route path="/pending" element={<div>Pending page</div>} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute allowedRoles={["ANALYST", "ADMIN"]}>
                  <div>Protected</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Pending page")).toBeInTheDocument();
    });
  });

  it("redirects CFO away from ADMIN-only route", async () => {
    mockMe({ id: "1", email: "cfo@emb.global", name: "CFO", role: "CFO", entity_id_scope: null });
    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter initialEntries={["/admin/fx-rates"]}>
          <Routes>
            <Route path="/dashboard" element={<div>Dashboard</div>} />
            <Route
              path="/admin/fx-rates"
              element={
                <ProtectedRoute allowedRoles={["ADMIN"]}>
                  <div>FX rates page</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
  });

  it("renders children for permitted role", async () => {
    mockMe({
      id: "1",
      email: "admin@emb.global",
      name: "Admin",
      role: "ADMIN",
      entity_id_scope: null,
    });
    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute allowedRoles={["ADMIN"]}>
                  <div>Admin content</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Admin content")).toBeInTheDocument();
    });
  });
});
