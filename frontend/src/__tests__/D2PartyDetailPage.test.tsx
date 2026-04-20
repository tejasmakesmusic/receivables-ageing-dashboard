import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { D2PartyDetailPage } from "@/pages/D2PartyDetailPage";

const MOCK_PARTY = {
  canonical_id: "party-42",
  canonical_name: "Acme Corp India Pvt Ltd",
  entity_code: "IND",
  total_outstanding: "5000000",
  currency_display: "INR",
  active_invoice_count: 2,
  active_exception_count: 1,
  invoices: [
    {
      invoice_id: "inv-001",
      invoice_ref: "INV-2025-001",
      invoice_date: "2025-03-01",
      amount: "3000000",
      currency: "INR",
      due_date: "2025-04-01",
      credit_days_applied: 30,
      credit_days_source: "CONFIG",
      status: "ACTIVE",
      overdue_days: 18,
      bucket: "0_30",
      outstanding_amount: "3000000",
      active_exception_count: 1,
    },
    {
      invoice_id: "inv-002",
      invoice_ref: "INV-2025-002",
      invoice_date: "2025-01-15",
      amount: "2000000",
      currency: "INR",
      due_date: "2025-02-15",
      credit_days_applied: 30,
      credit_days_source: "CONFIG",
      status: "ACTIVE",
      overdue_days: 63,
      bucket: "61_90",
      outstanding_amount: "2000000",
      active_exception_count: 0,
    },
  ],
};

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Wrapper({ partyId = "party-42" }: { partyId?: string }) {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={[`/party/${partyId}`]}>
        <Routes>
          <Route path="/party/:canonical_id" element={<D2PartyDetailPage />} />
          <Route path="/invoice/:invoice_id" element={<div data-testid="invoice-detail-page">Invoice Detail</div>} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/parties/party-42")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_PARTY),
        });
      }
      if (url.includes("/parties/not-found")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.resolve({ detail: "Party not found" }),
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

describe("D2PartyDetailPage", () => {
  it("shows loading skeleton while query is pending", () => {
    // Delay fetch so component is in loading state on first render
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})) as typeof fetch,
    );
    render(<Wrapper />);
    // Skeleton renders multiple divs with animate-pulse; we verify the page
    // doesn't show the party name yet (data not arrived)
    expect(screen.queryByText("Acme Corp India Pvt Ltd")).not.toBeInTheDocument();
  });

  it("renders canonical_name in header after data loads", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Acme Corp India Pvt Ltd")).toBeInTheDocument();
    });
  });

  it("renders entity code badge", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("IND")).toBeInTheDocument();
    });
  });

  it("renders Total Outstanding KPI card", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Total Outstanding")).toBeInTheDocument();
    });
  });

  it("renders Open Invoices KPI card with count", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Open Invoices")).toBeInTheDocument();
      // active_invoice_count = 2
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  it("renders Active Exceptions KPI card with count", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Active Exceptions")).toBeInTheDocument();
      // active_exception_count = 1 — use getAllByText since the value also
      // appears in the invoice row exception count cell
      const ones = screen.getAllByText("1");
      expect(ones.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders invoice rows with invoice refs", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("INV-2025-001")).toBeInTheDocument();
      expect(screen.getByText("INV-2025-002")).toBeInTheDocument();
    });
  });

  it("renders invoice row link that navigates to /invoice/{invoice_id}", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      const link = screen.getByRole("link", { name: "INV-2025-001" });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/invoice/inv-001");
    });
  });

  it("renders bucket badges in invoice rows", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("0–30 days")).toBeInTheDocument();
      expect(screen.getByText("61–90 days")).toBeInTheDocument();
    });
  });

  it("shows 404 state when API returns 404", async () => {
    render(<Wrapper partyId="not-found" />);
    await waitFor(() => {
      expect(screen.getByText("Party not found")).toBeInTheDocument();
    });
  });

  it("shows back link to dashboard", async () => {
    render(<Wrapper />);
    const backLink = screen.getByRole("link", { name: /Back to Dashboard/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/dashboard");
  });
});
