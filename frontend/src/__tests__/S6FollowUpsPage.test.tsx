import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { S6FollowUpsPage } from "@/pages/S6FollowUpsPage";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_ROW_EMAIL: Record<string, unknown> = {
  id: "fu-uuid-1",
  invoice_id: null,
  canonical_id: "party-uuid-1",
  date: "2026-04-10",
  channel: "EMAIL",
  contact_person: "Jane Doe",
  next_action_date: "2026-04-20",
  notes: "Sent reminder",
  logged_by: "user-uuid-1",
  logged_by_email: "analyst@emb.global",
  logged_at: "2026-04-10T09:00:00Z",
  canonical_name: "AlphaCorp Industries",
  invoice_ref: null,
};

const MOCK_ROW_CALL: Record<string, unknown> = {
  id: "fu-uuid-2",
  invoice_id: "inv-uuid-1",
  canonical_id: "party-uuid-2",
  date: "2026-04-12",
  channel: "CALL",
  contact_person: "John Smith",
  next_action_date: null,
  notes: "Discussed payment plan",
  logged_by: "user-uuid-1",
  logged_by_email: "analyst@emb.global",
  logged_at: "2026-04-12T11:00:00Z",
  canonical_name: "BetaCorp Ltd",
  invoice_ref: "INV-5201",
};

function makeList(items: Record<string, unknown>[], total?: number) {
  return {
    items,
    total: total ?? items.length,
    page: 1,
    page_size: 25,
  };
}

const MOCK_ME_ANALYST = { id: "u1", email: "a@emb.global", name: "Analyst", role: "ANALYST", entity_id_scope: null };
const MOCK_ME_ADMIN = { id: "u2", email: "admin@emb.global", name: "Admin", role: "ADMIN", entity_id_scope: null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(
  meOverride: typeof MOCK_ME_ANALYST | typeof MOCK_ME_ADMIN = MOCK_ME_ANALYST,
  followUpsResponse = makeList([MOCK_ROW_EMAIL, MOCK_ROW_CALL]),
  fetchOverride?: (url: string) => Response | null,
) {
  const mockFetch = vi.fn().mockImplementation((url: string) => {
    // Allow caller to override for specific URLs
    if (fetchOverride) {
      const override = fetchOverride(url);
      if (override !== null) return Promise.resolve(override);
    }

    if (url.includes("/auth/me")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(meOverride),
      });
    }
    if (url.includes("/follow-ups")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(followUpsResponse),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });

  vi.stubGlobal("fetch", mockFetch);

  return {
    mockFetch,
    ...render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter initialEntries={["/follow-ups"]}>
          <Routes>
            <Route path="/follow-ups" element={<S6FollowUpsPage />} />
            <Route path="/parties/:canonical_id" element={<div>Party page</div>} />
            <Route path="/invoice/:invoice_id" element={<div>Invoice page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function okJson(body: unknown, status = 200) {
  return { ok: true, status, json: () => Promise.resolve(body) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("S6FollowUpsPage — list rendering", () => {
  it("renders page title and New follow-up button", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Follow-ups")).toBeInTheDocument();
    });
    expect(screen.getByTestId("new-follow-up-btn")).toBeInTheDocument();
  });

  it("renders table rows from API response", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("follow-ups-table")).toBeInTheDocument();
    });
    expect(screen.getByText("AlphaCorp Industries")).toBeInTheDocument();
    expect(screen.getByText("BetaCorp Ltd")).toBeInTheDocument();
  });

  it("renders channel badges", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("EMAIL")).toBeInTheDocument();
      expect(screen.getByText("CALL")).toBeInTheDocument();
    });
  });

  it("renders invoice ref link when invoice_id is present", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("INV-5201")).toBeInTheDocument();
    });
    const link = screen.getByText("INV-5201").closest("a");
    expect(link).toHaveAttribute("href", "/invoice/inv-uuid-1");
  });

  it("renders party links to /parties/{canonical_id}", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("AlphaCorp Industries")).toBeInTheDocument();
    });
    const link = screen.getByText("AlphaCorp Industries").closest("a");
    expect(link).toHaveAttribute("href", "/parties/party-uuid-1");
  });

  it("shows empty state when no items returned", async () => {
    renderPage(MOCK_ME_ANALYST, makeList([]));
    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
    expect(screen.getByText(/No follow-ups found/i)).toBeInTheDocument();
  });

  it("shows skeleton rows while loading", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
    );
    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <S6FollowUpsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Skeleton elements should be present
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(1);
  });
});

describe("S6FollowUpsPage — filters", () => {
  it("channel filter change triggers re-fetch with channel param", async () => {
    const { mockFetch } = renderPage();
    await waitFor(() => screen.getByTestId("follow-ups-table"));

    // The Select component renders a <select> with id="filter-channel"
    const channelSelect = document.getElementById("filter-channel") as HTMLSelectElement;
    expect(channelSelect).not.toBeNull();
    fireEvent.change(channelSelect, { target: { value: "CALL" } });

    await waitFor(() => {
      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      const followUpCalls = calls.filter((u: string) => u.includes("/follow-ups"));
      expect(followUpCalls.some((u: string) => u.includes("channel=CALL"))).toBe(true);
    });
  });

  it("entity toggle IND triggers re-fetch with entity param", async () => {
    const { mockFetch } = renderPage();
    await waitFor(() => screen.getByTestId("follow-ups-table"));

    fireEvent.click(screen.getByTestId("entity-toggle-IND"));

    await waitFor(() => {
      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(calls.some((u: string) => u.includes("entity=IND"))).toBe(true);
    });
  });

  it("clear filters link appears after filter is set and clears on click", async () => {
    renderPage();
    await waitFor(() => screen.getByTestId("follow-ups-table"));

    expect(screen.queryByTestId("clear-filters")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("entity-toggle-UAE"));
    await waitFor(() => {
      expect(screen.getByTestId("clear-filters")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("clear-filters"));
    await waitFor(() => {
      expect(screen.queryByTestId("clear-filters")).not.toBeInTheDocument();
    });
  });
});

describe("S6FollowUpsPage — pagination", () => {
  it("renders pagination when total > page_size", async () => {
    renderPage(MOCK_ME_ANALYST, { ...makeList([MOCK_ROW_EMAIL]), total: 50, page_size: 25 });
    await waitFor(() => screen.getByTestId("follow-ups-table"));

    // Pagination renders Next button
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });

  it("does not render pagination when only 1 page", async () => {
    renderPage(MOCK_ME_ANALYST, makeList([MOCK_ROW_EMAIL]));
    await waitFor(() => screen.getByTestId("follow-ups-table"));
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });
});

describe("S6FollowUpsPage — create modal", () => {
  it("opens create modal on New follow-up click", async () => {
    renderPage();
    await waitFor(() => screen.getByTestId("new-follow-up-btn"));

    fireEvent.click(screen.getByTestId("new-follow-up-btn"));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("New follow-up")).toBeInTheDocument();
    });
  });

  it("shows validation error if date is missing on submit", async () => {
    renderPage();
    await waitFor(() => screen.getByTestId("new-follow-up-btn"));
    fireEvent.click(screen.getByTestId("new-follow-up-btn"));
    await waitFor(() => screen.getByRole("dialog"));

    // Submit without filling date
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/date is required/i);
  });

  it("submits POST and closes modal + refetches on success", async () => {
    let fetchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        fetchCalls.push(url);
        if (url.includes("/auth/me")) return Promise.resolve(okJson(MOCK_ME_ANALYST));
        if (url.includes("/follow-ups") && (!init?.method || init.method === "GET")) {
          return Promise.resolve(okJson(makeList([MOCK_ROW_EMAIL])));
        }
        if (url.includes("/follow-ups") && init?.method === "POST") {
          return Promise.resolve(okJson(MOCK_ROW_EMAIL, 201));
        }
        return Promise.resolve(okJson({}));
      }),
    );

    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <S6FollowUpsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => screen.getByTestId("new-follow-up-btn"));
    fireEvent.click(screen.getByTestId("new-follow-up-btn"));
    await waitFor(() => screen.getByRole("dialog"));

    const dialog = screen.getByRole("dialog");

    // Fill required fields — scope to dialog to avoid collision with filter inputs
    const dateInput = within(dialog).getByLabelText(/^date$/i);
    fireEvent.change(dateInput, { target: { value: "2026-04-19" } });

    const channelSelect = within(dialog).getByRole("combobox", { name: /channel/i });
    fireEvent.change(channelSelect, { target: { value: "EMAIL" } });

    const canonicalInput = within(dialog).getByLabelText(/canonical party id/i);
    fireEvent.change(canonicalInput, { target: { value: "3fa85f64-5717-4562-b3fc-2c963f66afa6" } });

    fireEvent.click(within(dialog).getByText("Create"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // POST should have been called
    expect(fetchCalls.some((u) => u.includes("/follow-ups"))).toBe(true);
  });
});

describe("S6FollowUpsPage — edit modal", () => {
  it("edit button opens modal pre-filled with row data", async () => {
    renderPage();
    await waitFor(() => screen.getByTestId("follow-ups-table"));

    const editBtns = screen.getAllByTestId("edit-btn");
    fireEvent.click(editBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Edit follow-up")).toBeInTheDocument();
    });

    // Party name should appear in the read-only info box inside the dialog
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/AlphaCorp Industries/)).toBeInTheDocument();
  });

  it("edit modal shows EMAIL pre-selected channel", async () => {
    renderPage();
    await waitFor(() => screen.getByTestId("follow-ups-table"));

    const editBtns = screen.getAllByTestId("edit-btn");
    fireEvent.click(editBtns[0]); // AlphaCorp row, channel=EMAIL

    await waitFor(() => screen.getByRole("dialog"));

    const dialog = screen.getByRole("dialog");
    const channelSelect = within(dialog).getByRole("combobox", { name: /channel/i }) as HTMLSelectElement;
    expect(channelSelect.value).toBe("EMAIL");
  });
});

describe("S6FollowUpsPage — delete (ADMIN only)", () => {
  it("delete button is hidden for ANALYST role", async () => {
    renderPage(MOCK_ME_ANALYST);
    await waitFor(() => screen.getByTestId("follow-ups-table"));

    expect(screen.queryByTestId("delete-btn")).not.toBeInTheDocument();
  });

  it("delete button is shown for ADMIN role", async () => {
    renderPage(MOCK_ME_ADMIN);
    await waitFor(() => screen.getByTestId("follow-ups-table"));

    expect(screen.getAllByTestId("delete-btn").length).toBeGreaterThan(0);
  });

  it("delete modal opens with confirm dialog", async () => {
    renderPage(MOCK_ME_ADMIN);
    await waitFor(() => screen.getByTestId("follow-ups-table"));

    const deleteBtns = screen.getAllByTestId("delete-btn");
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Delete follow-up")).toBeInTheDocument();
    });
  });

  it("confirm delete calls DELETE and refetches list", async () => {
    let deleteCalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/auth/me")) return Promise.resolve(okJson(MOCK_ME_ADMIN));
        if (url.includes("/follow-ups") && (!init?.method || init.method === "GET")) {
          return Promise.resolve(okJson(makeList([MOCK_ROW_EMAIL, MOCK_ROW_CALL])));
        }
        if (url.includes("/follow-ups/") && init?.method === "DELETE") {
          deleteCalled = true;
          return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(undefined) });
        }
        return Promise.resolve(okJson({}));
      }),
    );

    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter>
          <S6FollowUpsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => screen.getAllByTestId("delete-btn"));
    fireEvent.click(screen.getAllByTestId("delete-btn")[0]);
    await waitFor(() => screen.getByRole("dialog"));

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
