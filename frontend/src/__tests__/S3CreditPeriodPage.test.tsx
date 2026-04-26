import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { S3CreditPeriodPage } from "@/pages/S3CreditPeriodPage";

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ items: [], total: 0, page: 1, page_size: 25 }),
    }),
  );
});

function Wrapper() {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/config/credit-period"]}>
        <Routes>
          <Route path="/config/credit-period" element={<S3CreditPeriodPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("S3CreditPeriodPage — entity filter", () => {
  it("default entity select placeholder says All not IND", () => {
    render(<Wrapper />);
    const selects = screen.getAllByRole("combobox");
    const placeholderOptions = selects.map(
      (s) => (s as HTMLSelectElement).options[0].text,
    );
    expect(placeholderOptions).not.toContain("IND");
    expect(placeholderOptions.some((t) => t === "All")).toBe(true);
  });

  it("entity select has IND and UAE as valid options (not duplicated)", () => {
    render(<Wrapper />);
    const selects = screen.getAllByRole("combobox");
    const entitySelect = selects[0] as HTMLSelectElement;
    const optionTexts = Array.from(entitySelect.options).map((o) => o.text);
    const indCount = optionTexts.filter((t) => t === "IND").length;
    expect(indCount).toBe(1);
  });
});
