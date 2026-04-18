import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { D1DashboardPage } from "@/pages/D1DashboardPage";

const MOCK_DASHBOARD = {
  entity: "IND",
  as_of_date: "2025-04-18",
  snapshot_id: "abc-123",
  snapshot_status: "PUBLISHED",
  currency_display: "INR",
  kpis: {
    total_outstanding: "18720000",
    pct_overdue: "24.5",
    parties_with_90plus_count: 3,
    last_snapshot_date: "2025-04-18",
    fx_rate_used: null,
  },
  ageing_buckets: {
    NOT_DUE: "5000000",
    "0_30": "4000000",
    "31_60": "3000000",
    "61_90": "2000000",
    "90_PLUS": "4720000",
  },
  top_parties: [
    {
      canonical_id: "party-1",
      canonical_name: "Acme Corp",
      outstanding: "5000000",
      overdue_bucket: "31_60",
      active_exception_count: 2,
    },
  ],
  recent_exceptions: [],
  parties_on_default_credit_period_count: 0,
};

const MOCK_USER = {
  id: "user-1",
  email: "admin@emb.global",
  name: "Admin",
  role: "ADMIN",
  entity_id_scope: null,
};

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_USER),
        });
      }
      if (url.includes("/dashboard")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_DASHBOARD),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    }) as typeof fetch,
  );
});

describe("D1DashboardPage", () => {
  it("renders heading", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    expect(screen.getByText(/AR Dashboard/i)).toBeInTheDocument();
  });

  it("renders entity pills IND / UAE / Consolidated", () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    expect(screen.getByRole("button", { name: "IND" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UAE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Consolidated" })).toBeInTheDocument();
  });

  it("shows KPI tiles after data loads", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Total Outstanding/i)).toBeInTheDocument();
    });
    // Overdue pct tile
    expect(screen.getByText(/% Overdue/i)).toBeInTheDocument();
  });

  it("shows top party in table", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    });
  });

  it("switches entity on pill click", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    const uaePill = screen.getByRole("button", { name: "UAE" });
    fireEvent.click(uaePill);
    expect(uaePill).toHaveAttribute("aria-pressed", "true");
  });
});
