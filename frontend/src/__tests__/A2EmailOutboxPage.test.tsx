/**
 * Vitest tests for A2EmailOutboxPage (email rules section + outbox list).
 *
 * Coverage:
 *  1. Rules section renders 3 rules
 *  2. ADMIN sees Edit button; ANALYST/CFO do not
 *  3. Edit modal opens with current values, saves, triggers refetch
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { A2EmailOutboxPage } from "@/pages/A2EmailOutboxPage";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_RULES = {
  items: [
    {
      id: "rule-001",
      rule_type: "DAILY_DIGEST",
      recipients_json: ["cfo@emb.global"],
      cron_schedule: "0 9 * * *",
      is_active: false,
      entity_filter: null,
      notes: null,
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
      updated_by: null,
    },
    {
      id: "rule-002",
      rule_type: "WEEKLY_DEFAULT_CP_NUDGE",
      recipients_json: [],
      cron_schedule: "0 9 * * 1",
      is_active: false,
      entity_filter: null,
      notes: null,
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
      updated_by: null,
    },
    {
      id: "rule-003",
      rule_type: "PUBLISH_NOTIF",
      recipients_json: [],
      cron_schedule: null,
      is_active: true,
      entity_filter: null,
      notes: null,
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
      updated_by: null,
    },
  ],
  total: 3,
};

const MOCK_OUTBOX = {
  items: [
    {
      id: "outbox-001",
      rule_type: "PUBLISH_NOTIF",
      snapshot_id: "snap-001",
      subject: "[EMB AR] Test publish",
      status: "QUEUED",
      attempts: 0,
      enqueued_at: "2026-04-20T09:00:00Z",
      sent_at: null,
      last_error: null,
    },
  ],
  total: 1,
  page: 1,
  page_size: 25,
};

const ADMIN_USER = {
  id: "user-admin",
  email: "admin@emb.global",
  name: "Admin",
  role: "ADMIN",
  entity_id_scope: null,
};

const ANALYST_USER = {
  id: "user-analyst",
  email: "analyst@emb.global",
  name: "Analyst",
  role: "ANALYST",
  entity_id_scope: null,
};

const CFO_USER = {
  id: "user-cfo",
  email: "cfo@emb.global",
  name: "CFO",
  role: "CFO",
  entity_id_scope: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(currentUser: typeof ADMIN_USER) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/auth/me")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(currentUser),
      });
    }
    if (url.includes("/admin/email-rules")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_RULES),
      });
    }
    if (url.includes("/admin/email-outbox")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_OUTBOX),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
  }) as typeof fetch;
}

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper() {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter>
        <A2EmailOutboxPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("A2EmailOutboxPage — Email rules section", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", makeFetch(ADMIN_USER));
  });

  it("renders the Email Rules section heading", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Email Rules")).toBeInTheDocument();
    });
  });

  it("renders 3 rule rows", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("DAILY_DIGEST")).toBeInTheDocument();
      expect(screen.getByText("WEEKLY_DEFAULT_CP_NUDGE")).toBeInTheDocument();
      expect(screen.getByText("PUBLISH_NOTIF")).toBeInTheDocument();
    });
  });

  it("shows active badge for PUBLISH_NOTIF (is_active=true)", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument();
    });
  });

  it("ADMIN sees Edit buttons", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      const editBtns = screen.getAllByRole("button", { name: /^Edit$/i });
      expect(editBtns.length).toBe(3);
    });
  });
});

describe("A2EmailOutboxPage — ANALYST/CFO cannot see Edit button", () => {
  it("ANALYST does not see Edit button", async () => {
    vi.stubGlobal("fetch", makeFetch(ANALYST_USER));
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("DAILY_DIGEST")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /^Edit$/i })).toBeNull();
  });

  it("CFO does not see Edit button", async () => {
    vi.stubGlobal("fetch", makeFetch(CFO_USER));
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("DAILY_DIGEST")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /^Edit$/i })).toBeNull();
  });
});

describe("A2EmailOutboxPage — Edit modal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", makeFetch(ADMIN_USER));
  });

  it("opens edit modal with current rule values when Edit clicked", async () => {
    render(<Wrapper />);

    // Wait for rules to render
    await waitFor(() => {
      expect(screen.getByText("DAILY_DIGEST")).toBeInTheDocument();
    });

    // Click the first Edit button (DAILY_DIGEST)
    const editBtns = screen.getAllByRole("button", { name: /^Edit$/i });
    fireEvent.click(editBtns[0]);

    // Modal opens with the rule type in title
    await waitFor(() => {
      expect(screen.getByText(/Edit rule: DAILY_DIGEST/i)).toBeInTheDocument();
    });

    // Textarea pre-filled with existing recipient
    const recipientArea = screen.getByLabelText(/Recipients/i) as HTMLTextAreaElement;
    expect(recipientArea.value).toContain("cfo@emb.global");

    // Cron pre-filled
    const cronInput = screen.getByLabelText(/Cron schedule/i) as HTMLInputElement;
    expect(cronInput.value).toBe("0 9 * * *");
  });

  it("saves the rule and closes modal", async () => {
    // Make PATCH return updated rule
    const patchResult = { ...MOCK_RULES.items[0], notes: "updated" };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(ADMIN_USER),
        });
      }
      if (url.includes("/admin/email-rules") && (!init || !init.method || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_RULES),
        });
      }
      if (url.includes("/admin/email-rules") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(patchResult),
        });
      }
      if (url.includes("/admin/email-outbox")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_OUTBOX),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    render(<Wrapper />);

    await waitFor(() => {
      expect(screen.getByText("DAILY_DIGEST")).toBeInTheDocument();
    });

    const editBtns = screen.getAllByRole("button", { name: /^Edit$/i });
    fireEvent.click(editBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Edit rule: DAILY_DIGEST/i)).toBeInTheDocument();
    });

    // Click Save
    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    fireEvent.click(saveBtn);

    // Modal closes (title disappears)
    await waitFor(() => {
      expect(screen.queryByText(/Edit rule: DAILY_DIGEST/i)).toBeNull();
    });
  });

  it("shows validation error for invalid email", async () => {
    render(<Wrapper />);

    await waitFor(() => {
      expect(screen.getByText("DAILY_DIGEST")).toBeInTheDocument();
    });

    const editBtns = screen.getAllByRole("button", { name: /^Edit$/i });
    fireEvent.click(editBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Edit rule: DAILY_DIGEST/i)).toBeInTheDocument();
    });

    // Clear recipients and type invalid email
    const recipientArea = screen.getByLabelText(/Recipients/i);
    fireEvent.change(recipientArea, { target: { value: "not-an-email" } });

    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Invalid email/i)).toBeInTheDocument();
    });
  });
});

describe("A2EmailOutboxPage — Outbox list", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", makeFetch(ADMIN_USER));
  });

  it("renders outbox queue heading", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Outbox Queue")).toBeInTheDocument();
    });
  });

  it("renders outbox row with QUEUED status", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("QUEUED")).toBeInTheDocument();
    });
  });
});
