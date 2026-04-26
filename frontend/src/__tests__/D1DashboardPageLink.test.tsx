import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { D1DashboardPage } from "@/pages/D1DashboardPage";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { role: "ADMIN", email: "t@emb.global" }, isLoading: false }),
}));

vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        entity: "IND",
        as_of_date: "2026-04-19",
        snapshot_id: "snap-001",
        snapshot_status: "PUBLISHED",
        currency_display: "INR",
        kpis: {
          total_outstanding: "1000000",
          pct_overdue: "25.5",
          parties_with_90plus_count: 3,
          last_snapshot_date: "2026-04-19",
          fx_rate_used: null,
          fx_rate_effective_from: null,
          fx_rate_from_ccy: null,
          fx_rate_to_ccy: null,
        },
        ageing_buckets: {},
        top_parties: [],
        recent_exceptions: [],
        parties_on_default_credit_period_count: 5,
        trend_weekly: [],
      }),
  }),
);

function Wrapper() {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/dashboard?entity=IND"]}>
        <Routes>
          <Route path="/dashboard" element={<D1DashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("D1 credit period link", () => {
  it("links to /config/credit-period not /credit-period", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      const links = document.querySelectorAll('a[href*="credit-period"]');
      expect(links.length).toBeGreaterThan(0);
    });
    const links = document.querySelectorAll('a[href*="credit-period"]');
    links.forEach((l) => {
      expect(l.getAttribute("href")).toBe("/config/credit-period");
    });
  });
});
