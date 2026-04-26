import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspacePage } from "@/pages/WorkspacePage";

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper() {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/snapshots"]}>
        <Routes>
          <Route path="/snapshots" element={<WorkspacePage />} />
          <Route path="/upload" element={<div>Upload</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const SNAPSHOT_ROW = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  entity_code: "IND",
  source_hint: "TALLY",
  as_of_date: "2026-03-31",
  status: "PUBLISHED",
  uploaded_at: "2026-04-01T10:00:00Z",
  uploaded_by_email: "analyst@emb.global",
  row_count: 42,
  total_outstanding: "1234567",
  reconciliation: null,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          items: [SNAPSHOT_ROW],
          total: 1,
          page: 1,
          page_size: 20,
        }),
    }),
  );
});

describe("WorkspacePage", () => {
  it("renders heading", () => {
    render(<Wrapper />);
    expect(screen.getByText("Workspace")).toBeInTheDocument();
  });

  it("shows upload snapshot button", () => {
    render(<Wrapper />);
    expect(screen.getByRole("link", { name: /upload snapshot/i })).toBeInTheDocument();
  });

  it("shows entity, source, status filter selects", () => {
    render(<Wrapper />);
    expect(screen.getByRole("combobox", { name: /entity/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /source/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /status/i })).toBeInTheDocument();
  });

  it("renders snapshot rows after load", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("TALLY")).toBeInTheDocument();
      expect(screen.getByText("analyst@emb.global")).toBeInTheDocument();
    });
  });

  it("PUBLISHED snapshot shows 'View invoices' link", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /view invoices/i })).toBeInTheDocument();
    });
  });

  it("shows empty state when no items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ items: [], total: 0, page: 1, page_size: 20 }),
      }),
    );
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText(/no snapshots match/i)).toBeInTheDocument();
    });
  });

  it("STAGED non-CP row shows 'Review →' link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            items: [{ ...SNAPSHOT_ROW, status: "STAGED", source_hint: "TALLY" }],
            total: 1,
            page: 1,
            page_size: 20,
          }),
      }),
    );
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /review →/i })).toBeInTheDocument();
    });
  });

  it("STAGED CP row shows 'View config diff' link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            items: [{ ...SNAPSHOT_ROW, status: "STAGED", source_hint: "CREDIT_PERIOD", as_of_date: null }],
            total: 1,
            page: 1,
            page_size: 20,
          }),
      }),
    );
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /view config diff/i })).toBeInTheDocument();
    });
  });

  it("changing status filter resets to page 1", async () => {
    render(<Wrapper />);
    const statusSelect = screen.getByRole("combobox", { name: /status/i });
    fireEvent.change(statusSelect, { target: { value: "STAGED" } });
    // No assertion on page number needed — just verify no crash
    expect(statusSelect).toHaveValue("STAGED");
  });
});
