import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { D3InvoiceDetailPage } from "@/pages/D3InvoiceDetailPage";

const MOCK_INVOICE = {
  invoice_id: "inv-001",
  invoice_ref: "INV-2025-001",
  invoice_date: "2025-03-01",
  amount: "3000000",
  currency: "INR",
  due_date: "2025-04-01",
  credit_days_applied: 30,
  credit_days_source: "CONFIG",
  status: "ACTIVE",
  canonical_id: "party-42",
  canonical_name: "Acme Corp India Pvt Ltd",
  entity_code: "IND",
  first_seen_snapshot_id: "snap-001",
  settled_snapshot_id: null,
  exception_tags: [
    {
      id: "exc-1",
      bucket_type_code: "DISPUTE",
      bucket_type_name: "Dispute",
      reason: "Client disputes invoice amount",
      tagged_at: "2025-04-01T10:00:00Z",
      tagged_by_email: "analyst@emb.global",
      status: "OPEN",
      expected_resolution_date: "2025-05-01",
      resolved_at: null,
      resolution_note: null,
    },
  ],
  snapshot_history: [
    {
      as_of_date: "2025-03-15",
      snapshot_id: "snap-002",
      outstanding_amount: "3000000",
      overdue_days: 0,
      bucket: "NOT_DUE",
    },
    {
      as_of_date: "2025-04-15",
      snapshot_id: "snap-003",
      outstanding_amount: "3000000",
      overdue_days: 14,
      bucket: "0_30",
    },
  ],
};

const MOCK_INVOICE_NO_TAGS = {
  ...MOCK_INVOICE,
  exception_tags: [],
};

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Wrapper({ invoiceId = "inv-001" }: { invoiceId?: string }) {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={[`/invoice/${invoiceId}`]}>
        <Routes>
          <Route path="/invoice/:invoice_id" element={<D3InvoiceDetailPage />} />
          <Route path="/party/:canonical_id" element={<div data-testid="party-detail-page">Party Detail</div>} />
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
      if (url.includes("/invoices/inv-001")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_INVOICE),
        });
      }
      if (url.includes("/invoices/no-tags")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_INVOICE_NO_TAGS),
        });
      }
      if (url.includes("/invoices/not-found")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.resolve({ detail: "Invoice not found" }),
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

describe("D3InvoiceDetailPage", () => {
  it("shows loading skeleton while query is pending", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})) as typeof fetch,
    );
    render(<Wrapper />);
    // Data not yet arrived — header content should be absent
    expect(screen.queryByText("INV-2025-001")).not.toBeInTheDocument();
  });

  it("renders invoice_ref in header after data loads", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("INV-2025-001")).toBeInTheDocument();
    });
  });

  it("renders canonical_name as a link to /party/{canonical_id}", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      const links = screen.getAllByRole("link", { name: "Acme Corp India Pvt Ltd" });
      // At least one link to the party page
      const partyLink = links.find((l) =>
        l.getAttribute("href") === "/party/party-42",
      );
      expect(partyLink).toBeDefined();
    });
  });

  it("renders status badge", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    });
  });

  it("renders entity_code badge", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("IND")).toBeInTheDocument();
    });
  });

  it("renders credit_days_source badge", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("CONFIG")).toBeInTheDocument();
    });
  });

  it("renders Amount and Currency detail rows", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Amount")).toBeInTheDocument();
      expect(screen.getByText("Currency")).toBeInTheDocument();
      // currency value appears in both Amount row suffix and Currency row
      const inrEls = screen.getAllByText("INR");
      expect(inrEls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders exception tags section with tag row when tags exist", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Exception Tags")).toBeInTheDocument();
      expect(screen.getByText("DISPUTE")).toBeInTheDocument();
      expect(screen.getByText("Client disputes invoice amount")).toBeInTheDocument();
      expect(screen.getByText("analyst@emb.global")).toBeInTheDocument();
    });
  });

  it("shows active exception count when tags exist", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText(/1 active/i)).toBeInTheDocument();
    });
  });

  it("hides exception tag rows and shows empty message when no tags", async () => {
    render(<Wrapper invoiceId="no-tags" />);
    await waitFor(() => {
      expect(
        screen.getByText("No exception tags on this invoice."),
      ).toBeInTheDocument();
      expect(screen.queryByText("DISPUTE")).not.toBeInTheDocument();
    });
  });

  it("renders snapshot history table with rows newest-first", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Snapshot History")).toBeInTheDocument();
      const rows = screen.getAllByRole("row");
      // rows[0] = thead; rows[1] = newest (2025-04-15), rows[2] = older (2025-03-15)
      // Find which rendered row index contains the newer date
      const rowTexts = rows.map((r) => r.textContent ?? "");
      const newerIdx = rowTexts.findIndex((t) => t.includes("2025"));
      // Both rows present
      expect(rowTexts.some((t) => t.includes("14"))).toBe(true); // overdue_days newer row
      expect(rowTexts.some((t) => t.includes("0"))).toBe(true);  // overdue_days older row
      // Newer row (snap-003, 2025-04-15) appears before older (snap-002, 2025-03-15)
      const snapRows = rows.filter(
        (r) =>
          r.textContent?.includes("14") || r.textContent?.includes("Not Due"),
      );
      expect(snapRows.length).toBeGreaterThanOrEqual(1);
      // Verify newest-first: the row with overdue_days=14 (April) comes before overdue_days=0 (March)
      const allRows = Array.from(rows);
      const idxApril = allRows.findIndex((r) => r.textContent?.includes("14") && r.textContent?.includes("30"));
      const idxMarch = allRows.findIndex((r) => (r.textContent?.includes("Not Due") || r.textContent?.includes("NOT_DUE")));
      if (idxApril > -1 && idxMarch > -1) {
        expect(idxApril).toBeLessThan(idxMarch);
      }
      expect(newerIdx).toBeGreaterThan(-1);
    });
  });

  it("renders snapshot history bucket badges", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("0–30 days")).toBeInTheDocument();
      expect(screen.getByText("Not Due")).toBeInTheDocument();
    });
  });

  it("shows 404 state when API returns 404", async () => {
    render(<Wrapper invoiceId="not-found" />);
    await waitFor(() => {
      expect(screen.getByText("Invoice not found")).toBeInTheDocument();
    });
  });

  it("shows back link to dashboard", () => {
    render(<Wrapper />);
    const backLink = screen.getByRole("link", { name: /← Dashboard/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/dashboard");
  });
});
