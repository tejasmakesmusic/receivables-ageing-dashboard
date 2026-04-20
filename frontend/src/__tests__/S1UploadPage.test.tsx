import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { S1UploadPage } from "@/pages/S1UploadPage";

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper() {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/?entity=IND"]}>
        <Routes>
          <Route path="/" element={<S1UploadPage />} />
          <Route path="/staging/:snapshot_id" element={<div>Staging</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      // cp-diff endpoint
      if (typeof url === "string" && url.includes("/cp-diff")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              overrides["cp-diff"] ?? {
                snapshot_id: "snap-cp-001",
                added: [
                  {
                    canonical_name: "NewClient Ltd",
                    entity_code: "IND",
                    days: 30,
                    reason_note: null,
                    prior_days: null,
                    prior_reason_note: null,
                  },
                ],
                superseded: [
                  {
                    canonical_name: "OldClient LLC",
                    entity_code: "UAE",
                    days: 45,
                    reason_note: "contract",
                    prior_days: 30,
                    prior_reason_note: null,
                  },
                ],
                unchanged: [
                  {
                    canonical_name: "SameClient Ltd",
                    entity_code: "IND",
                    days: 60,
                    reason_note: "key account",
                    prior_days: 60,
                    prior_reason_note: "key account",
                  },
                ],
              },
            ),
        });
      }
      // Default: snapshots list
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            overrides["snapshots"] ?? {
              items: [],
              total: 0,
              page: 1,
              page_size: 10,
            },
          ),
      });
    }) as typeof fetch,
  );
}

beforeEach(() => {
  mockFetch();
});

describe("S1UploadPage — two-panel layout", () => {
  it("renders upload heading", () => {
    render(<Wrapper />);
    expect(screen.getByText(/upload snapshot/i)).toBeInTheDocument();
  });

  it("renders both branch cards", () => {
    render(<Wrapper />);
    expect(screen.getByTestId("branch-transactional")).toBeInTheDocument();
    expect(screen.getByTestId("branch-credit-period")).toBeInTheDocument();
  });

  it("transactional card is selected by default — shows source type selector", () => {
    render(<Wrapper />);
    // The transactional form is rendered (has source type select)
    expect(screen.getByLabelText(/source type/i)).toBeInTheDocument();
  });

  it("selecting CP card swaps to CP form — hides source type selector", () => {
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId("branch-credit-period"));
    expect(screen.queryByLabelText(/source type/i)).not.toBeInTheDocument();
    // CP form shows the india+UAE note (the <strong>India</strong> text inside the info box)
    expect(screen.getByText(/covers both entities/i)).toBeInTheDocument();
  });

  it("selecting transactional card swaps back to transactional form", () => {
    render(<Wrapper />);
    // Switch to CP
    fireEvent.click(screen.getByTestId("branch-credit-period"));
    expect(screen.queryByLabelText(/source type/i)).not.toBeInTheDocument();
    // Switch back
    fireEvent.click(screen.getByTestId("branch-transactional"));
    expect(screen.getByLabelText(/source type/i)).toBeInTheDocument();
  });

  it("transactional upload button is disabled when no file is selected", () => {
    render(<Wrapper />);
    const btn = screen.getByRole("button", { name: /upload/i });
    expect(btn).toBeDisabled();
  });

  it("CP 'Parse & preview diff' button is disabled when no file is selected", () => {
    render(<Wrapper />);
    fireEvent.click(screen.getByTestId("branch-credit-period"));
    const btn = screen.getByRole("button", { name: /parse.*preview diff/i });
    expect(btn).toBeDisabled();
  });
});

describe("S1UploadPage — CP diff preview", () => {
  it("after CP upload success, 'View config diff' toggle appears", async () => {
    // Mock upload → returns snapshot, then cp-diff
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (typeof url === "string" && url.includes("/cp-diff")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                snapshot_id: "snap-cp-001",
                added: [],
                superseded: [],
                unchanged: [],
              }),
          });
        }
        if (opts?.method === "POST") {
          // upload mutation
          return Promise.resolve({
            ok: true,
            status: 201,
            json: () =>
              Promise.resolve({
                snapshot_id: "snap-cp-001",
                status: "STAGED",
                source_hint: "CREDIT_PERIOD",
                as_of_date: null,
                file_sha256: "abc123abc123abc123abc123",
                parse_summary: {
                  invoices_parsed: 0,
                  credit_periods_parsed: 5,
                  parse_error_count: 0,
                  warnings: [],
                },
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ items: [], total: 0, page: 1, page_size: 10 }),
        });
      }) as typeof fetch,
    );

    render(<Wrapper />);
    fireEvent.click(screen.getByTestId("branch-credit-period"));

    // Simulate file selection via the hidden input
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["content"], "cp-master.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(input, { target: { files: [file] } });

    // Click Parse & preview diff
    const btn = screen.getByRole("button", { name: /parse.*preview diff/i });
    fireEvent.click(btn);

    // Success card + diff toggle should appear
    await waitFor(() => {
      expect(screen.getByTestId("cp-diff-toggle")).toBeInTheDocument();
    });
  });

  it("clicking 'View config diff' toggle fetches and displays diff categories", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (typeof url === "string" && url.includes("/cp-diff")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                snapshot_id: "snap-cp-001",
                added: [
                  {
                    canonical_name: "NewClient Ltd",
                    entity_code: "IND",
                    days: 30,
                    reason_note: null,
                    prior_days: null,
                    prior_reason_note: null,
                  },
                ],
                superseded: [
                  {
                    canonical_name: "OldClient LLC",
                    entity_code: "UAE",
                    days: 45,
                    reason_note: "contract",
                    prior_days: 30,
                    prior_reason_note: null,
                  },
                ],
                unchanged: [],
              }),
          });
        }
        if (opts?.method === "POST") {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: () =>
              Promise.resolve({
                snapshot_id: "snap-cp-001",
                status: "STAGED",
                source_hint: "CREDIT_PERIOD",
                as_of_date: null,
                file_sha256: "abc123abc123abc123abc123",
                parse_summary: {
                  invoices_parsed: 0,
                  credit_periods_parsed: 2,
                  parse_error_count: 0,
                  warnings: [],
                },
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ items: [], total: 0, page: 1, page_size: 10 }),
        });
      }) as typeof fetch,
    );

    render(<Wrapper />);
    fireEvent.click(screen.getByTestId("branch-credit-period"));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["content"], "cp-master.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /parse.*preview diff/i }));

    await waitFor(() => {
      expect(screen.getByTestId("cp-diff-toggle")).toBeInTheDocument();
    });

    // Open the diff panel
    fireEvent.click(screen.getByTestId("cp-diff-toggle"));

    await waitFor(() => {
      expect(screen.getByText(/Added \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Superseded \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText("NewClient Ltd")).toBeInTheDocument();
      expect(screen.getByText("OldClient LLC")).toBeInTheDocument();
    });
  });
});

describe("S1UploadPage — recent uploads table", () => {
  it("renders recent uploads heading", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText(/recent uploads/i)).toBeInTheDocument();
    });
  });

  it("shows 'View config diff' link for CREDIT_PERIOD STAGED row", async () => {
    mockFetch({
      snapshots: {
        items: [
          {
            id: "aaaaaaaa-0000-0000-0000-000000000001",
            entity_code: "IND",
            source_hint: "CREDIT_PERIOD",
            as_of_date: null,
            status: "STAGED",
            uploaded_at: "2026-04-19T10:00:00Z",
            row_count: null,
            total_outstanding: null,
            reconciliation: null,
          },
        ],
        total: 1,
        page: 1,
        page_size: 10,
      },
    });
    render(<Wrapper />);
    const link = await screen.findByRole("link", { name: /view config diff/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      "/snapshots/aaaaaaaa-0000-0000-0000-000000000001/staging",
    );
  });

  it("shows 'Review' link (not 'View config diff') for TALLY STAGED row", async () => {
    mockFetch({
      snapshots: {
        items: [
          {
            id: "bbbbbbbb-0000-0000-0000-000000000002",
            entity_code: "IND",
            source_hint: "TALLY",
            as_of_date: "2026-03-31",
            status: "STAGED",
            uploaded_at: "2026-04-19T10:00:00Z",
            row_count: null,
            total_outstanding: null,
            reconciliation: null,
          },
        ],
        total: 1,
        page: 1,
        page_size: 10,
      },
    });
    render(<Wrapper />);
    const link = await screen.findByRole("link", { name: /^Review →$/ });
    expect(link).toBeInTheDocument();
    expect(screen.queryByText(/view config diff/i)).not.toBeInTheDocument();
  });
});
