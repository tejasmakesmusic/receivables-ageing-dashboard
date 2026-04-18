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

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/?entity=IND"]}>
        <Routes>
          <Route path="/" element={<>{children}</>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // Mock /snapshots list (recent uploads table)
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ items: [], total: 0, page: 1, page_size: 10 }),
    } as unknown as Response),
  );
});

describe("S1UploadPage", () => {
  it("renders upload heading", async () => {
    render(
      <Wrapper>
        <S1UploadPage />
      </Wrapper>,
    );
    expect(screen.getByText(/upload snapshot/i)).toBeInTheDocument();
  });

  it("renders source type selector", async () => {
    render(
      <Wrapper>
        <S1UploadPage />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/source type/i)).toBeInTheDocument();
  });

  it("upload button is disabled when no file selected", async () => {
    render(
      <Wrapper>
        <S1UploadPage />
      </Wrapper>,
    );
    const uploadBtn = screen.getByRole("button", { name: /upload/i });
    expect(uploadBtn).toBeDisabled();
  });

  it("shows credit period note when source is CREDIT_PERIOD", async () => {
    render(
      <Wrapper>
        <S1UploadPage />
      </Wrapper>,
    );
    const select = screen.getByLabelText(/source type/i);
    fireEvent.change(select, { target: { value: "CREDIT_PERIOD" } });
    await waitFor(() => {
      expect(screen.getByText(/india/i)).toBeInTheDocument();
    });
  });

  it("renders recent uploads table", async () => {
    render(
      <Wrapper>
        <S1UploadPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/recent uploads/i)).toBeInTheDocument();
    });
  });
});
