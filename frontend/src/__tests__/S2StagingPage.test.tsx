import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { S2StagingPage } from "@/pages/S2StagingPage";

const MOCK_STAGING: Record<string, unknown> = {
  snapshot_id: "snap-001",
  snapshot_status: "STAGED",
  entity_code: "IND",
  as_of_date: "2025-04-18",
  source_hint: "TALLY",
  file_sha256: "abc123",
  uploaded_by: "analyst@emb.global",
  uploaded_at: "2025-04-18T10:00:00Z",
  totals: {
    invoices_total: 10,
    invoices_ok: 9,
    invoices_parse_error: 1,
    credit_periods_total: 0,
    parse_warnings: 1,
    parse_errors_file_level: 0,
  },
  publish_gate: {
    ok: false,
    unmapped_parties_count: 1,
    fuzzy_high_pending_count: 0,
    parse_errors_unresolved_count: 1,
    warnings_unacknowledged: ["GRAND_TOTAL_MISMATCH"],
    role_permits_publish: true,
  },
  rows: [
    {
      row_index: 0,
      status: "OK",
      party_name_raw: "Acme Corp",
      invoice_ref: "INV-001",
      invoice_date: "2025-04-01",
      amount: "100000",
      source_currency: "INR",
      parse_error_reason: null,
      alias_resolution: {
        resolution_state: "EXACT",
        raw_name: "Acme Corp",
        top_matches: [
          {
            canonical_id: "party-1",
            canonical_name: "Acme Corp India Pvt Ltd",
            ratio: 100,
            matched_on: "CANONICAL_NAME",
            matched_text: "Acme Corp India Pvt Ltd",
            is_exact: true,
          },
        ],
      },
      analyst_overrides: {
        resolved_canonical_id: null,
        credit_days_override: null,
        credit_days_source: "CONFIG",
        dismissed: false,
      },
      xero_metadata: null,
      raw_row_json: {},
    },
  ],
  pagination: { offset: 0, limit: 50, total: 1 },
};

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper() {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/staging/snap-001"]}>
        <Routes>
          <Route path="/staging/:snapshot_id" element={<S2StagingPage />} />
          <Route path="/upload" element={<div>Upload page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/staging")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_STAGING),
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

describe("S2StagingPage", () => {
  it("renders staging review heading", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText(/Staging Review/i)).toBeInTheDocument();
    });
  });

  it("shows totals tiles", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("Invoices")).toBeInTheDocument();
    });
  });

  it("shows publish gate panel", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText(/Publish gate/i)).toBeInTheDocument();
    });
  });

  it("shows invoice row with EXACT badge", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText(/EXACT/i)).toBeInTheDocument();
    });
  });

  it("publish button is disabled when gate is not ok", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      const publishBtn = screen.getByRole("button", { name: /^Publish$/i });
      expect(publishBtn).toBeDisabled();
    });
  });

  it("shows breadcrumb link to upload", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      // breadcrumb renders an <a href="/upload">Upload</a>
      const link = screen.getByRole("link", { name: /^Upload$/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/upload");
    });
  });

  it("dedupes repeated warning codes in the publish gate label", async () => {
    // Real Tally exports emit one warning per offending party, so the
    // unacknowledged list can contain 20+ entries of the same code. The gate
    // label must collapse those to "CODE ×N" rather than a comma-joined wall.
    // Mock with rows:[] to exercise only the gate panel, not the invoice-row
    // renderer (whose mock row has unrelated drift vs current types).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/staging")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                ...MOCK_STAGING,
                rows: [],
                pagination: { offset: 0, limit: 50, total: 0 },
                publish_gate: {
                  ...(MOCK_STAGING.publish_gate as Record<string, unknown>),
                  warnings_unacknowledged: [
                    "SUBTOTAL_MISMATCH",
                    "SUBTOTAL_MISMATCH",
                    "SUBTOTAL_MISMATCH",
                    "GRAND_TOTAL_MISMATCH",
                    "UNALLOCATED_CREDITS_DELTA",
                  ],
                },
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      }) as typeof fetch,
    );

    render(<Wrapper />);
    await waitFor(() => {
      expect(
        screen.getByText(
          /Warnings acknowledged: SUBTOTAL_MISMATCH ×3, GRAND_TOTAL_MISMATCH, UNALLOCATED_CREDITS_DELTA/,
        ),
      ).toBeInTheDocument();
    });

    // Button count reflects instance total (5), not unique code count (3).
    expect(
      screen.getByRole("button", { name: /Acknowledge all warnings \(5\)/ }),
    ).toBeInTheDocument();
  });
});
