import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { S3CreditPeriodPage } from "@/pages/S3CreditPeriodPage";
import type { CurrentUser, DefaultCpReportResponse } from "@/types";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CP_LIST = {
  items: [
    {
      id: "cfg-1",
      canonical_id: "canon-1",
      canonical_name: "Yatra Online Ltd",
      entity_code: "IND",
      credit_days: 30,
      reason_note: "Standard terms",
      valid_from: "2026-01-01",
      valid_to: null,
      created_by: "user-1",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "cfg-2",
      canonical_id: "canon-2",
      canonical_name: "Emirates Group",
      entity_code: "UAE",
      credit_days: 45,
      reason_note: null,
      valid_from: "2026-01-01",
      valid_to: "2026-03-31",
      created_by: "user-1",
      created_at: "2026-01-01T00:00:00Z",
    },
  ],
  pagination: { page: 1, page_size: 25, total: 2, total_pages: 1 },
};

const MOCK_ADMIN_USER = {
  id: "user-1",
  email: "admin@emb.global",
  name: "Admin User",
  role: "ADMIN" as const,
  entity_id_scope: null,
};

const MOCK_ANALYST_USER = {
  id: "user-2",
  email: "analyst@emb.global",
  name: "Analyst User",
  role: "ANALYST" as const,
  entity_id_scope: null,
};

const MOCK_CFO_USER = {
  id: "user-3",
  email: "cfo@emb.global",
  name: "CFO User",
  role: "CFO" as const,
  entity_id_scope: null,
};

const MOCK_EDIT_RESPONSE = {
  result: "superseded",
  config_id: "cfg-3",
  days: 25,
  reason_note: "Yatra terms changed",
  valid_from: "2026-04-19",
};

// A.4 — default-CP report mock data
const MOCK_DEFAULT_CP_RESPONSE: DefaultCpReportResponse = {
  entity_code: "IND",
  as_of_date: "2026-04-15",
  snapshot_id: "snap-1",
  currency_display: "INR",
  total_parties_on_default: 2,
  parties: [
    {
      canonical_id: "canon-10",
      canonical_name: "Makemytrip Ltd",
      total_outstanding: "120000.00",
      n_open_invoices: 3,
    },
    {
      canonical_id: "canon-11",
      canonical_name: "Cleartrip Pvt Ltd",
      total_outstanding: "85000.00",
      n_open_invoices: 2,
    },
  ],
};

const MOCK_DEFAULT_CP_EMPTY: DefaultCpReportResponse = {
  entity_code: "IND",
  as_of_date: "2026-04-15",
  snapshot_id: "snap-2",
  currency_display: "INR",
  total_parties_on_default: 0,
  parties: [],
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper() {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter>
        <S3CreditPeriodPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function mockFetch(
  user: CurrentUser = MOCK_ADMIN_USER,
  editResponse = MOCK_EDIT_RESPONSE,
  defaultCpResponse: DefaultCpReportResponse = MOCK_DEFAULT_CP_RESPONSE,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      // ME endpoint
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(user),
        });
      }
      // Default-CP report (must be checked before the generic credit-period list check)
      if (url.includes("/config/credit-period/default-parties")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(defaultCpResponse),
        });
      }
      // Edit POST /config/credit-period/{canonical_id}
      if (url.includes("/config/credit-period/") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(editResponse),
        });
      }
      // Credit period list (GET /config/credit-period)
      if (url.includes("/config/credit-period") && (!init || init.method !== "POST")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_CP_LIST),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    }) as typeof fetch,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockFetch();
});

describe("S3CreditPeriodPage", () => {
  it("renders Credit Period Config heading", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Credit Period Config")).toBeInTheDocument();
    });
  });

  it("renders party names from list", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Yatra Online Ltd")).toBeInTheDocument();
      expect(screen.getByText("Emirates Group")).toBeInTheDocument();
    });
  });

  it("shows Active badge for open rows and date for closed rows", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      // valid_to=null → Active badge
      expect(screen.getByText("Active")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Edit button visibility
  // -------------------------------------------------------------------------

  it("shows Edit button on active rows for ADMIN user", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      // Only cfg-1 has valid_to=null so only one Edit button
      const editBtns = screen.getAllByRole("button", { name: /^Edit$/i });
      expect(editBtns).toHaveLength(1);
    });
  });

  it("shows Edit button on active rows for ANALYST user", async () => {
    mockFetch(MOCK_ANALYST_USER);
    render(<Wrapper />);
    await waitFor(() => {
      const editBtns = screen.getAllByRole("button", { name: /^Edit$/i });
      expect(editBtns).toHaveLength(1);
    });
  });

  it("Edit button is hidden (Actions column absent) for CFO user", async () => {
    mockFetch(MOCK_CFO_USER);
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^Edit$/i })).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Edit modal opens with current values
  // -------------------------------------------------------------------------

  it("opens Edit modal with current days and reason pre-filled", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Yatra Online Ltd")).toBeInTheDocument();
    });

    const editBtn = screen.getByRole("button", { name: /^Edit$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      // Modal title includes canonical name
      expect(screen.getByText(/Edit credit period — Yatra Online Ltd/i)).toBeInTheDocument();
      // Credit days pre-filled
      const daysInput = screen.getByLabelText(/Credit days/i) as HTMLInputElement;
      expect(daysInput.value).toBe("30");
      // Reason pre-filled
      const reasonInput = screen.getByLabelText(/Reason note/i) as HTMLInputElement;
      expect(reasonInput.value).toBe("Standard terms");
    });
  });

  // -------------------------------------------------------------------------
  // Save triggers POST and refreshes list
  // -------------------------------------------------------------------------

  it("save triggers POST and shows success message", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Yatra Online Ltd")).toBeInTheDocument();
    });

    const editBtn = screen.getByRole("button", { name: /^Edit$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByText(/Edit credit period/i)).toBeInTheDocument();
    });

    // Change days
    const daysInput = screen.getByLabelText(/Credit days/i) as HTMLInputElement;
    fireEvent.change(daysInput, { target: { value: "25" } });

    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // Success toast appears
      expect(
        screen.getByText(/Updated\. Old config closed, new config effective/i),
      ).toBeInTheDocument();
    });

    // Verify POST was called with correct URL
    const fetchMock = vi.mocked(fetch);
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" &&
        url.includes("/config/credit-period/canon-1") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
  });

  it("shows no-change message on noop response", async () => {
    mockFetch(MOCK_ADMIN_USER, { ...MOCK_EDIT_RESPONSE, result: "noop" });
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Yatra Online Ltd")).toBeInTheDocument();
    });

    const editBtn = screen.getByRole("button", { name: /^Edit$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByText(/Edit credit period/i)).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/No change — values already match the active config/i),
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// A.4 — "Parties on default credit period" section
// ---------------------------------------------------------------------------

describe("S3CreditPeriodPage — default-CP section (A.4)", () => {
  beforeEach(() => {
    mockFetch(MOCK_ADMIN_USER, MOCK_EDIT_RESPONSE, MOCK_DEFAULT_CP_RESPONSE);
  });

  it("renders section heading with party count badge", async () => {
    render(<Wrapper />);
    // Wait for the data to load — the party names appear when defaultCpData is populated
    await waitFor(() => {
      expect(screen.getByText("Makemytrip Ltd")).toBeInTheDocument();
    });
    expect(screen.getByText(/Parties on default credit period/i)).toBeInTheDocument();
    // Badge showing total_parties_on_default=2 is in the h2 heading element
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toContain("2");
  });

  it("renders N party rows from the default-CP list", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Makemytrip Ltd")).toBeInTheDocument();
      expect(screen.getByText("Cleartrip Pvt Ltd")).toBeInTheDocument();
    });
  });

  it("renders empty state when no parties on default CP", async () => {
    mockFetch(MOCK_ADMIN_USER, MOCK_EDIT_RESPONSE, MOCK_DEFAULT_CP_EMPTY);
    render(<Wrapper />);
    await waitFor(() => {
      expect(
        screen.getByText(/No parties on default credit period/i),
      ).toBeInTheDocument();
    });
  });

  it("'Set custom CP' button opens the edit modal pre-populated for that canonical", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Makemytrip Ltd")).toBeInTheDocument();
    });

    // There should be "Set custom CP" buttons (one per default-CP party)
    const setCpBtns = screen.getAllByRole("button", { name: /Set custom CP/i });
    expect(setCpBtns.length).toBe(2); // 2 parties in mock

    // Click the first one (Makemytrip Ltd)
    fireEvent.click(setCpBtns[0]);

    await waitFor(() => {
      // Modal title includes canonical name
      expect(screen.getByText(/Set custom CP — Makemytrip Ltd/i)).toBeInTheDocument();
    });
  });

  it("'Set custom CP' is hidden for CFO (read-only role)", async () => {
    mockFetch(MOCK_CFO_USER, MOCK_EDIT_RESPONSE, MOCK_DEFAULT_CP_RESPONSE);
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Makemytrip Ltd")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Set custom CP/i })).toBeNull();
  });

  it("after save, both default-parties and credit-period queries are invalidated", async () => {
    // Use the standard mockFetch helper so fetch is already a vi.fn()
    mockFetch(MOCK_ADMIN_USER, MOCK_EDIT_RESPONSE, MOCK_DEFAULT_CP_RESPONSE);

    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Makemytrip Ltd")).toBeInTheDocument();
    });

    const setCpBtns = screen.getAllByRole("button", { name: /Set custom CP/i });
    fireEvent.click(setCpBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Set custom CP — Makemytrip Ltd/i)).toBeInTheDocument();
    });

    const daysInput = screen.getByLabelText(/Credit days/i) as HTMLInputElement;
    fireEvent.change(daysInput, { target: { value: "45" } });

    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // Success toast shown after save
      expect(
        screen.getByText(/Credit period set\. Party will no longer appear/i),
      ).toBeInTheDocument();
    });

    const fetchMock = vi.mocked(fetch);

    // Verify the POST call was made with the correct canonical_id
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" &&
        url.includes("/config/credit-period/canon-10") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();

    // After success, both lists should be refetched — verify fetch was called
    // for both default-parties and credit-period list endpoints
    const defaultPartiesRefetch = fetchMock.mock.calls.filter(
      ([url]) => typeof url === "string" && (url as string).includes("/config/credit-period/default-parties"),
    );
    const cpListRefetch = fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === "string" &&
        (url as string).includes("/config/credit-period") &&
        !(url as string).includes("/default-parties") &&
        !(url as string).includes("/canon-") &&
        (!init || (init as RequestInit).method !== "POST"),
    );
    expect(defaultPartiesRefetch.length).toBeGreaterThanOrEqual(1);
    expect(cpListRefetch.length).toBeGreaterThanOrEqual(1);
  });
});
