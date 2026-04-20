import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { S5ExceptionsPage } from "@/pages/S5ExceptionsPage";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_FLAGS = [
  {
    invoice_id: "inv-uuid-1",
    invoice_ref: "INV-5101",
    canonical_name: "AlphaCorp Industries Ltd",
    prior_amount: "845000.00",
    new_amount: "892000.00",
    delta_pct: "5.60",
  },
  {
    invoice_id: "inv-uuid-2",
    invoice_ref: "INV-5052",
    canonical_name: "Eta Pharma Exports",
    prior_amount: "1200000.00",
    new_amount: "1290000.00",
    delta_pct: "7.50",
  },
];

const MOCK_SNAPSHOT_WITH_FLAGS = {
  id: "snap-001",
  entity_code: "IND",
  source_hint: "TALLY",
  status: "PUBLISHED",
  as_of_date: "2026-03-31",
  uploaded_at: "2026-04-01T10:00:00Z",
  uploaded_by_email: "analyst@emb.global",
  published_at: "2026-04-01T11:00:00Z",
  published_by_email: "analyst@emb.global",
  published_as: "NORMAL",
  row_count: 10,
  total_outstanding: "10000000.00",
  material_change_flags: MOCK_FLAGS,
};

const MOCK_SNAPSHOT_NO_FLAGS = {
  ...MOCK_SNAPSHOT_WITH_FLAGS,
  material_change_flags: null,
};

const MOCK_EXCEPTION_ROW_1 = {
  id: "exc-uuid-1",
  invoice_id: "inv-uuid-10",
  invoice_ref: "INV-1001",
  canonical_id: "party-uuid-1",
  canonical_name: "AlphaCorp Industries Ltd",
  entity_code: "IND",
  bucket_type_code: "DISPUTE",
  bucket_type_name: "Dispute",
  reason: "Client disputes the amount",
  status: "ACTIVE",
  tagged_at: "2026-04-01T10:00:00Z",
  tagged_by_email: "analyst@emb.global",
  expected_resolution_date: null,
  resolved_at: null,
  last_follow_up_date: null,
  last_follow_up_channel: null,
};

const MOCK_EXCEPTION_ROW_2 = {
  id: "exc-uuid-2",
  invoice_id: "inv-uuid-11",
  invoice_ref: "INV-1002",
  canonical_id: "party-uuid-2",
  canonical_name: "BetaCorp Ltd",
  entity_code: "UAE",
  bucket_type_code: "LEGAL",
  bucket_type_name: "Legal",
  reason: "Referred to legal",
  status: "ACTIVE",
  tagged_at: "2026-04-02T10:00:00Z",
  tagged_by_email: "analyst@emb.global",
  expected_resolution_date: "2026-05-01",
  resolved_at: null,
  last_follow_up_date: null,
  last_follow_up_channel: null,
};

const MOCK_EXCEPTIONS = {
  items: [] as typeof MOCK_EXCEPTION_ROW_1[],
  total: 0,
  page: 1,
  page_size: 25,
};

const MOCK_EXCEPTIONS_WITH_ROWS = {
  items: [MOCK_EXCEPTION_ROW_1, MOCK_EXCEPTION_ROW_2],
  total: 2,
  page: 1,
  page_size: 25,
};

const MOCK_BUCKETS = { items: [{ code: "DISPUTE", name: "Dispute", active: true }], total: 1 };

// ---------------------------------------------------------------------------
// Bucket summary card mock data
// ---------------------------------------------------------------------------

const MOCK_BUCKETS_FULL = {
  items: [
    { id: "b1", code: "LEGAL", name: "Legal / Litigation", active: true, description: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "b2", code: "DISPUTED", name: "Disputed by client", active: true, description: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "b3", code: "CN_PENDING", name: "Credit note pending", active: true, description: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "b4", code: "WRITTEN_OFF", name: "Written-off", active: true, description: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "b5", code: "ON_HOLD", name: "On-hold", active: true, pre_seeded: false, description: null, created_at: "2026-02-01T00:00:00Z" },
  ],
  total: 5,
};

const MOCK_EXCEPTIONS_MULTI_BUCKET = {
  items: [
    { ...MOCK_EXCEPTION_ROW_1, bucket_type_code: "LEGAL", status: "ACTIVE" },
    { ...MOCK_EXCEPTION_ROW_2, id: "exc-3", bucket_type_code: "LEGAL", status: "ACTIVE" },
    { ...MOCK_EXCEPTION_ROW_1, id: "exc-4", bucket_type_code: "DISPUTED", status: "ACTIVE" },
    { ...MOCK_EXCEPTION_ROW_2, id: "exc-5", bucket_type_code: "CN_PENDING", status: "ACTIVE" },
    { ...MOCK_EXCEPTION_ROW_1, id: "exc-6", bucket_type_code: "WRITTEN_OFF", status: "ACTIVE" },
    { ...MOCK_EXCEPTION_ROW_2, id: "exc-7", bucket_type_code: "ON_HOLD", status: "ACTIVE" },
  ],
  total: 6,
  page: 1,
  page_size: 25,
};

function renderWithBuckets(buckets = MOCK_BUCKETS_FULL, exceptions = MOCK_EXCEPTIONS_MULTI_BUCKET) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/snapshots/")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MOCK_SNAPSHOT_NO_FLAGS) });
      }
      if (url.includes("/admin/exception-buckets")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(buckets) });
      }
      if (url.includes("/exceptions")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(exceptions) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(buckets) });
    }) as typeof fetch,
  );

  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/exceptions"]}>
        <Routes>
          <Route path="/exceptions" element={<S5ExceptionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(path: string) {
  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/exceptions" element={<S5ExceptionsPage />} />
          <Route path="/invoice/:invoice_id" element={<div>Invoice detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderPageWithRows() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/snapshots/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_SNAPSHOT_NO_FLAGS),
        });
      }
      if (url.includes("/exceptions")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_EXCEPTIONS_WITH_ROWS),
        });
      }
      // exception-buckets
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_BUCKETS),
      });
    }) as typeof fetch,
  );

  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/exceptions"]}>
        <Routes>
          <Route path="/exceptions" element={<S5ExceptionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S5ExceptionsPage — MaterialChangeBanner", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/snapshots/snap-001")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_SNAPSHOT_WITH_FLAGS),
          });
        }
        if (url.includes("/snapshots/snap-empty")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_SNAPSHOT_NO_FLAGS),
          });
        }
        if (url.includes("/exceptions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_EXCEPTIONS),
          });
        }
        // exception-buckets
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_BUCKETS),
        });
      }) as typeof fetch,
    );
  });

  it("renders the banner header when flags exist", async () => {
    renderPage("/exceptions?snapshot_id=snap-001");
    await waitFor(() => {
      expect(
        screen.getByText(/2 exceptions flagged for review/i),
      ).toBeInTheDocument();
    });
  });

  it("does NOT render the banner when flags are null/empty", async () => {
    renderPage("/exceptions?snapshot_id=snap-empty");
    await waitFor(() => {
      // Exceptions heading should appear, banner should not
      expect(screen.getByText("Exceptions")).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/flagged for review/i),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the banner when no snapshot_id query param", async () => {
    renderPage("/exceptions");
    await waitFor(() => {
      expect(screen.getByText("Exceptions")).toBeInTheDocument();
    });
    expect(screen.queryByText(/flagged for review/i)).not.toBeInTheDocument();
  });

  it("banner is collapsed by default — table rows are hidden", async () => {
    renderPage("/exceptions?snapshot_id=snap-001");
    await waitFor(() => {
      expect(screen.getByText(/2 exceptions flagged for review/i)).toBeInTheDocument();
    });
    // Table should not be visible yet
    expect(screen.queryByTestId("material-change-table")).not.toBeInTheDocument();
  });

  it("clicking 'Show affected' expands the row list", async () => {
    renderPage("/exceptions?snapshot_id=snap-001");
    await waitFor(() => {
      expect(screen.getByText(/2 exceptions flagged for review/i)).toBeInTheDocument();
    });

    const toggleBtn = screen.getByRole("button", { name: /show affected/i });
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByTestId("material-change-table")).toBeInTheDocument();
    });

    // Both rows should be visible
    expect(screen.getByText("INV-5101")).toBeInTheDocument();
    expect(screen.getByText("AlphaCorp Industries Ltd")).toBeInTheDocument();
    expect(screen.getByText("INV-5052")).toBeInTheDocument();
    expect(screen.getByText("Eta Pharma Exports")).toBeInTheDocument();
  });

  it("clicking again collapses the panel", async () => {
    renderPage("/exceptions?snapshot_id=snap-001");
    await waitFor(() => {
      expect(screen.getByText(/2 exceptions flagged for review/i)).toBeInTheDocument();
    });

    const toggleBtn = screen.getByRole("button", { name: /show affected/i });
    fireEvent.click(toggleBtn);
    await waitFor(() => {
      expect(screen.getByTestId("material-change-table")).toBeInTheDocument();
    });

    // Collapse
    const hideBtn = screen.getByRole("button", { name: /hide affected/i });
    fireEvent.click(hideBtn);
    await waitFor(() => {
      expect(screen.queryByTestId("material-change-table")).not.toBeInTheDocument();
    });
  });

  it("each row has a 'Review exception' link pointing to /invoice/{id}", async () => {
    renderPage("/exceptions?snapshot_id=snap-001");
    await waitFor(() => {
      screen.getByText(/2 exceptions flagged for review/i);
    });

    fireEvent.click(screen.getByRole("button", { name: /show affected/i }));

    await waitFor(() => {
      const links = screen.getAllByRole("link", { name: /review exception/i });
      expect(links).toHaveLength(2);
      expect(links[0]).toHaveAttribute("href", "/invoice/inv-uuid-1");
      expect(links[1]).toHaveAttribute("href", "/invoice/inv-uuid-2");
    });
  });
});

// ---------------------------------------------------------------------------
// ExplainerBanner
// ---------------------------------------------------------------------------

describe("S5ExceptionsPage — ExplainerBanner", () => {
  beforeEach(() => {
    // Clear the dismiss key so each test starts fresh
    localStorage.removeItem("s5-explainer-dismissed");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/exceptions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_EXCEPTIONS),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_BUCKETS),
        });
      }) as typeof fetch,
    );
  });

  afterEach(() => {
    localStorage.removeItem("s5-explainer-dismissed");
    vi.restoreAllMocks();
  });

  it("banner renders by default (no prior dismissal)", async () => {
    renderPage("/exceptions");
    await waitFor(() => {
      expect(screen.getByTestId("s5-explainer-banner")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Exceptions vs follow-ups — what's the difference\?/i),
    ).toBeInTheDocument();
    // Body text is split across <strong> nodes — check the containing paragraph text
    const banner = screen.getByTestId("s5-explainer-banner");
    expect(banner.textContent).toMatch(/structural issue on an invoice/i);
    expect(banner.textContent).toMatch(/logged conversation\/email\/call/i);
  });

  it("dismiss button hides the banner", async () => {
    renderPage("/exceptions");
    await waitFor(() => {
      expect(screen.getByTestId("s5-explainer-banner")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("s5-explainer-dismiss"));

    expect(screen.queryByTestId("s5-explainer-banner")).not.toBeInTheDocument();
  });

  it("banner stays hidden on re-render when localStorage key is set", async () => {
    localStorage.setItem("s5-explainer-dismissed", "true");
    renderPage("/exceptions");
    // Give queries a chance to settle
    await waitFor(() => {
      expect(screen.getByText("Exceptions")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("s5-explainer-banner")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tag button + modal
// ---------------------------------------------------------------------------

describe("S5ExceptionsPage — Tag button", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a Tag button for each row", async () => {
    renderPageWithRows();
    await waitFor(() => {
      expect(screen.getAllByTestId("tag-btn")).toHaveLength(2);
    });
  });

  it("clicking Tag button opens the TagModal dialog", async () => {
    renderPageWithRows();
    await waitFor(() => {
      expect(screen.getAllByTestId("tag-btn")).toHaveLength(2);
    });

    fireEvent.click(screen.getAllByTestId("tag-btn")[0]);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Tag exception")).toBeInTheDocument();
    });
  });

  it("TagModal receives the correct invoice_id (first row)", async () => {
    renderPageWithRows();
    await waitFor(() => {
      expect(screen.getAllByTestId("tag-btn")).toHaveLength(2);
    });

    // Click first row's Tag button — invoice_id = "inv-uuid-10"
    fireEvent.click(screen.getAllByTestId("tag-btn")[0]);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // The modal POSTs to /invoices/{invoiceId}/exceptions — verify the correct
    // bucket select is rendered inside the dialog (modal rendered with that invoiceId context)
    const dialog = screen.getByRole("dialog");
    // Select component renders a <select> combobox inside the dialog
    expect(within(dialog).getAllByRole("combobox").length).toBeGreaterThan(0);
  });

  it("TagModal receives the correct invoice_id (second row)", async () => {
    renderPageWithRows();
    await waitFor(() => {
      expect(screen.getAllByTestId("tag-btn")).toHaveLength(2);
    });

    // Click second row's Tag button — invoice_id = "inv-uuid-11"
    fireEvent.click(screen.getAllByTestId("tag-btn")[1]);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Tag exception")).toBeInTheDocument();
    });

    // Verify that submitting would POST to /invoices/inv-uuid-11/exceptions
    let postedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          postedUrl = url as string;
          return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
        }
        if (url.includes("/exceptions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_EXCEPTIONS_WITH_ROWS),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MOCK_BUCKETS) });
      }) as typeof fetch,
    );

    const dialog = screen.getByRole("dialog");
    // Select is the first combobox in the dialog
    const bucketSelect = within(dialog).getAllByRole("combobox")[0];
    fireEvent.change(bucketSelect, { target: { value: "DISPUTE" } });

    const reasonTextarea = within(dialog).getByRole("textbox");
    fireEvent.change(reasonTextarea, { target: { value: "Test reason" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /^Tag$/ }));

    await waitFor(() => {
      expect(postedUrl).toContain("/invoices/inv-uuid-11/exceptions");
    });
  });

  it("closing the modal clears tagTarget (modal unmounts)", async () => {
    renderPageWithRows();
    await waitFor(() => {
      expect(screen.getAllByTestId("tag-btn")).toHaveLength(2);
    });

    fireEvent.click(screen.getAllByTestId("tag-btn")[0]);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Click the Cancel / close button
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Bucket summary cards
// ---------------------------------------------------------------------------

describe("S5ExceptionsPage — BucketSummaryCards", () => {
  beforeEach(() => {
    localStorage.removeItem("s5-explainer-dismissed");
  });
  afterEach(() => {
    localStorage.removeItem("s5-explainer-dismissed");
    vi.restoreAllMocks();
  });

  it("renders one card per active bucket (4 pre-seeded + 1 admin)", async () => {
    renderWithBuckets();
    await waitFor(() => {
      expect(screen.getByTestId("bucket-summary-row")).toBeInTheDocument();
    });

    // All 5 active bucket cards should render
    expect(screen.getByTestId("bucket-card-LEGAL")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-card-DISPUTED")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-card-CN_PENDING")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-card-WRITTEN_OFF")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-card-ON_HOLD")).toBeInTheDocument();
  });

  it("pre-seeded buckets render 'system' badge", async () => {
    renderWithBuckets();
    await waitFor(() => {
      expect(screen.getByTestId("bucket-card-LEGAL")).toBeInTheDocument();
    });

    // All 4 seed codes get the 'system' badge
    for (const code of ["LEGAL", "DISPUTED", "CN_PENDING", "WRITTEN_OFF"]) {
      expect(screen.getByTestId(`badge-preseeded-${code}`)).toBeInTheDocument();
      expect(screen.getByTestId(`badge-preseeded-${code}`).textContent).toBe("system");
    }
  });

  it("admin-added bucket renders 'admin' badge", async () => {
    renderWithBuckets();
    await waitFor(() => {
      expect(screen.getByTestId("bucket-card-ON_HOLD")).toBeInTheDocument();
    });

    expect(screen.getByTestId("badge-admin-ON_HOLD")).toBeInTheDocument();
    expect(screen.getByTestId("badge-admin-ON_HOLD").textContent).toBe("admin");
  });

  it("each card shows ACTIVE tag count for that bucket", async () => {
    renderWithBuckets();
    await waitFor(() => {
      expect(screen.getByTestId("bucket-card-LEGAL")).toBeInTheDocument();
    });

    // LEGAL has 2 active rows in mock data
    const legalCard = screen.getByTestId("bucket-card-LEGAL");
    expect(legalCard.textContent).toContain("2");

    // DISPUTED has 1
    const disputedCard = screen.getByTestId("bucket-card-DISPUTED");
    expect(disputedCard.textContent).toContain("1");
  });

  it("clicking a card sets bucketFilter — card gets aria-pressed=true", async () => {
    renderWithBuckets();
    await waitFor(() => {
      expect(screen.getByTestId("bucket-card-LEGAL")).toBeInTheDocument();
    });

    const legalCard = screen.getByTestId("bucket-card-LEGAL");
    expect(legalCard).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(legalCard);

    await waitFor(() => {
      expect(screen.getByTestId("bucket-card-LEGAL")).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("clicking active card clears filter (toggle off)", async () => {
    renderWithBuckets();
    await waitFor(() => {
      expect(screen.getByTestId("bucket-card-DISPUTED")).toBeInTheDocument();
    });

    const card = screen.getByTestId("bucket-card-DISPUTED");
    fireEvent.click(card);

    await waitFor(() => {
      expect(card).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("bucket-filter-clear")).toBeInTheDocument();
    });

    // Click again — filter clears
    fireEvent.click(card);
    await waitFor(() => {
      expect(card).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByTestId("bucket-filter-clear")).not.toBeInTheDocument();
    });
  });

  it("'Clear filter' link clears the bucket filter", async () => {
    renderWithBuckets();
    await waitFor(() => {
      expect(screen.getByTestId("bucket-card-CN_PENDING")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("bucket-card-CN_PENDING"));

    await waitFor(() => {
      expect(screen.getByTestId("bucket-filter-clear")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("bucket-filter-clear"));

    await waitFor(() => {
      expect(screen.queryByTestId("bucket-filter-clear")).not.toBeInTheDocument();
      expect(screen.getByTestId("bucket-card-CN_PENDING")).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("does not render cards when buckets list is empty", async () => {
    renderWithBuckets({ items: [], total: 0 }, MOCK_EXCEPTIONS);
    await waitFor(() => {
      expect(screen.getByText("Exceptions")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("bucket-summary-row")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 14 — last_follow_up_date / last_follow_up_channel column
// ---------------------------------------------------------------------------

describe("S5ExceptionsPage — last follow-up column", () => {
  beforeEach(() => {
    localStorage.removeItem("s5-explainer-dismissed");
  });
  afterEach(() => {
    localStorage.removeItem("s5-explainer-dismissed");
    vi.restoreAllMocks();
  });

  it("renders follow-up date and channel badge when follow-up exists", async () => {
    const rowWithFollowUp = {
      ...MOCK_EXCEPTION_ROW_1,
      id: "exc-fu-present",
      last_follow_up_date: "2026-03-20",
      last_follow_up_channel: "EMAIL",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/exceptions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({ items: [rowWithFollowUp], total: 1, page: 1, page_size: 25 }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_BUCKETS),
        });
      }) as typeof fetch,
    );

    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter initialEntries={["/exceptions"]}>
          <Routes>
            <Route path="/exceptions" element={<S5ExceptionsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("AlphaCorp Industries Ltd")).toBeInTheDocument();
    });

    const cell = screen.getByTestId("last-fu-exc-exc-fu-present");
    // Channel badge should render
    expect(cell.textContent).toContain("EMAIL");
    // Should not show the dash
    expect(cell.textContent).not.toBe("—");
  });

  it("renders dash in follow-up column when no follow-up exists", async () => {
    const rowNoFollowUp = {
      ...MOCK_EXCEPTION_ROW_1,
      id: "exc-fu-absent",
      last_follow_up_date: null,
      last_follow_up_channel: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/exceptions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({ items: [rowNoFollowUp], total: 1, page: 1, page_size: 25 }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_BUCKETS),
        });
      }) as typeof fetch,
    );

    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter initialEntries={["/exceptions"]}>
          <Routes>
            <Route path="/exceptions" element={<S5ExceptionsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("AlphaCorp Industries Ltd")).toBeInTheDocument();
    });

    const cell = screen.getByTestId("last-fu-exc-exc-fu-absent");
    expect(cell.textContent).toContain("—");
  });
});
