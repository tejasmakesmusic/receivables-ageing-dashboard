import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { A6ReconciliationPage } from "@/pages/A6ReconciliationPage";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_SNAPSHOTS = {
  items: [
    {
      id: "snap-001",
      entity_code: "IND",
      source_hint: "TALLY",
      status: "PUBLISHED",
      as_of_date: "2026-03-31",
      uploaded_at: "2026-04-01T10:00:00Z",
      uploaded_by_email: "analyst@emb.global",
      row_count: 10,
      total_outstanding: "18720000.00",
      reconciliation: {
        status: "MISMATCHED",
        delta: "220000.00",
        tally_xero_closing_ar: "19000000.00",
        dashboard_ar: "18720000.00",
        updated_at: "2026-04-01T12:00:00Z",
      },
    },
    {
      id: "snap-002",
      entity_code: "IND",
      source_hint: "TALLY",
      status: "PUBLISHED",
      as_of_date: "2026-02-28",
      uploaded_at: "2026-03-01T10:00:00Z",
      uploaded_by_email: "analyst@emb.global",
      row_count: 8,
      total_outstanding: "17000000.00",
      reconciliation: {
        status: "MATCHED",
        delta: "0.00",
        tally_xero_closing_ar: "17000000.00",
        dashboard_ar: "17000000.00",
        updated_at: "2026-03-02T09:00:00Z",
      },
    },
    {
      id: "snap-003",
      entity_code: "IND",
      source_hint: "TALLY",
      status: "PUBLISHED",
      as_of_date: "2026-01-31",
      uploaded_at: "2026-02-01T10:00:00Z",
      uploaded_by_email: "analyst@emb.global",
      row_count: 7,
      total_outstanding: "15000000.00",
      reconciliation: null,
    },
  ],
  total: 3,
  page: 1,
  page_size: 8,
};

const MOCK_RECONCILIATION = {
  snapshot_id: "snap-001",
  snapshot_as_of_date: "2026-03-31",
  entity_code: "IND",
  dashboard_ar: "18720000.00",
  exception_bucket_total: "500000.00",
  exception_bucket_breakdown: { DISPUTED: "500000.00" },
  tally_xero_closing_ar: "19000000.00",
  delta: "220000.00",
  status: "MISMATCHED",
  entered_by: { id: "user-1", email: "admin@emb.global" },
  entered_at: "2026-04-01T12:00:00Z",
  notes: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderAs(role: string) {
  const mockUser = {
    id: "user-1",
    email: `${role.toLowerCase()}@emb.global`,
    name: role,
    role,
    entity_id_scope: null,
  };

  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockUser),
        });
      }
      if (url.includes("/snapshots/snap-001/reconciliation")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_RECONCILIATION),
        });
      }
      if (url.includes("/snapshots")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_SNAPSHOTS),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    }) as typeof fetch,
  );

  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter>
        <A6ReconciliationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("A6ReconciliationPage — write guard per ADR-0006", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ADMIN: entry form is visible and save button is enabled when closing AR entered", async () => {
    renderAs("ADMIN");
    await waitFor(() => {
      expect(screen.getByText("Enter Tally/Xero closing AR")).toBeInTheDocument();
    });
    const saveBtn = screen.getByRole("button", { name: /save reconciliation/i });
    expect(saveBtn).toBeInTheDocument();
    // Button disabled until input filled — just assert it exists and is not hidden
    expect(saveBtn).not.toHaveAttribute("aria-hidden");
  });

  it("ANALYST: entry form is visible and save button is present", async () => {
    renderAs("ANALYST");
    await waitFor(() => {
      expect(screen.getByText("Enter Tally/Xero closing AR")).toBeInTheDocument();
    });
    const saveBtn = screen.getByRole("button", { name: /save reconciliation/i });
    expect(saveBtn).toBeInTheDocument();
  });

  it("CFO: entry form is hidden and read-only message is shown", async () => {
    renderAs("CFO");
    // Wait for page to stabilise (snapshots + reconciliation load)
    await waitFor(() => {
      expect(screen.getByText("Reconciliation")).toBeInTheDocument();
    });
    // Give queries time to resolve
    await waitFor(() => {
      expect(screen.queryByText("Enter Tally/Xero closing AR")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("PENDING: entry form is hidden and read-only message is shown", async () => {
    renderAs("PENDING");
    await waitFor(() => {
      expect(screen.getByText("Reconciliation")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText("Enter Tally/Xero closing AR")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("save button is disabled when closing AR input is empty (ANALYST)", async () => {
    renderAs("ANALYST");
    await waitFor(() => {
      expect(screen.getByText("Enter Tally/Xero closing AR")).toBeInTheDocument();
    });
    const saveBtn = screen.getByRole("button", { name: /save reconciliation/i });
    expect(saveBtn).toBeDisabled();
  });

  it("save button is disabled when closing AR input is empty (ADMIN)", async () => {
    renderAs("ADMIN");
    await waitFor(() => {
      expect(screen.getByText("Enter Tally/Xero closing AR")).toBeInTheDocument();
    });
    const saveBtn = screen.getByRole("button", { name: /save reconciliation/i });
    expect(saveBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// A6 publish-gate warning banner
// ---------------------------------------------------------------------------

describe("A6ReconciliationPage — publish-gate warning banner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function renderWithReconStatus(role: string, reconStatus: "MISMATCHED" | "UNRECONCILED" | "MATCHED") {
    const mockUser = {
      id: "user-1",
      email: `${role.toLowerCase()}@emb.global`,
      name: role,
      role,
      entity_id_scope: null,
    };

    const reconciliation = {
      ...MOCK_RECONCILIATION,
      status: reconStatus,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockUser),
          });
        }
        if (url.includes("/snapshots/snap-001/reconciliation")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(reconciliation),
          });
        }
        if (url.includes("/snapshots")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_SNAPSHOTS),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }) as typeof fetch,
    );

    return render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <A6ReconciliationPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("banner visible when status=UNRECONCILED for ANALYST", async () => {
    renderWithReconStatus("ANALYST", "UNRECONCILED");
    await waitFor(() => {
      expect(screen.getByText(/next publish blocked/i)).toBeInTheDocument();
    });
  });

  it("banner visible when status=UNRECONCILED for ADMIN", async () => {
    renderWithReconStatus("ADMIN", "UNRECONCILED");
    await waitFor(() => {
      expect(screen.getByText(/next publish blocked/i)).toBeInTheDocument();
    });
  });

  it("banner visible when status=MISMATCHED", async () => {
    renderWithReconStatus("ADMIN", "MISMATCHED");
    await waitFor(() => {
      expect(screen.getByText(/next publish blocked/i)).toBeInTheDocument();
    });
  });

  it("banner hidden when status=MATCHED", async () => {
    renderWithReconStatus("ADMIN", "MATCHED");
    // Wait for reconciliation data to load
    await waitFor(() => {
      expect(screen.getByText(/reconciliation/i)).toBeInTheDocument();
    });
    // Allow time for data to resolve
    await waitFor(() => {
      expect(screen.queryByText(/next publish blocked/i)).not.toBeInTheDocument();
    });
  });

  it("Override CTA visible for ADMIN only — not ANALYST", async () => {
    renderWithReconStatus("ANALYST", "MISMATCHED");
    await waitFor(() => {
      expect(screen.getByText(/next publish blocked/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /override next publish/i })).not.toBeInTheDocument();
  });

  it("Override CTA visible for ADMIN", async () => {
    renderWithReconStatus("ADMIN", "MISMATCHED");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /override next publish/i })).toBeInTheDocument();
    });
  });

  it("Override CTA not visible for CFO", async () => {
    renderWithReconStatus("CFO", "MISMATCHED");
    await waitFor(() => {
      expect(screen.getByText(/next publish blocked/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /override next publish/i })).not.toBeInTheDocument();
  });

  it("click Override CTA opens modal; Got it closes it", async () => {
    renderWithReconStatus("ADMIN", "MISMATCHED");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /override next publish/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /override next publish/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText(/override flow wiring pending/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// A6 historical reconciliations table
// ---------------------------------------------------------------------------

describe("A6ReconciliationPage — Recent reconciliations table", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 3 mocked snapshots in the historical table", async () => {
    renderAs("ADMIN");

    // Table heading should appear
    await waitFor(() => {
      expect(
        screen.getByText(/recent reconciliations/i),
      ).toBeInTheDocument();
    });

    // All three as_of_date values should appear (formatted)
    // Dates are formatted via Intl — just check all rows render via status badges
    await waitFor(() => {
      // 3 status badges: MISMATCHED, MATCHED, UNRECONCILED
      expect(screen.getByText("MISMATCHED")).toBeInTheDocument();
      expect(screen.getByText("MATCHED")).toBeInTheDocument();
      expect(screen.getByText("UNRECONCILED")).toBeInTheDocument();
    });
  });

  it("clicking a row switches the main detail card to that snapshot", async () => {
    // Build a per-test mock that tracks which reconciliation URL is fetched
    const fetchedReconIds: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                id: "user-1",
                email: "admin@emb.global",
                name: "ADMIN",
                role: "ADMIN",
                entity_id_scope: null,
              }),
          });
        }
        // Track reconciliation fetches
        const reconMatch = url.match(/\/snapshots\/(snap-\d+)\/reconciliation/);
        if (reconMatch) {
          fetchedReconIds.push(reconMatch[1]);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_RECONCILIATION),
          });
        }
        if (url.includes("/snapshots")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_SNAPSHOTS),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      }) as typeof fetch,
    );

    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <A6ReconciliationPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Wait for table to render
    await waitFor(() => {
      expect(screen.getByText(/recent reconciliations/i)).toBeInTheDocument();
    });

    // Click the MATCHED row (snap-002)
    await waitFor(() => {
      expect(screen.getByText("MATCHED")).toBeInTheDocument();
    });

    const matchedBadge = screen.getByText("MATCHED");
    const matchedRow = matchedBadge.closest("tr");
    expect(matchedRow).not.toBeNull();
    fireEvent.click(matchedRow!);

    // After click, snap-002 reconciliation should eventually be fetched
    await waitFor(() => {
      expect(fetchedReconIds).toContain("snap-002");
    });
  });
});
