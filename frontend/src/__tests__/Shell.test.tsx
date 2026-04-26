import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "@/components/Shell";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { role: "ANALYST", email: "t@emb.global" }, isLoading: false }),
}));

function Wrapper() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<div>content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Shell nav links", () => {
  it("shows Workspace link for ANALYST", () => {
    render(<Wrapper />);
    expect(screen.getByRole("link", { name: /workspace/i })).toBeInTheDocument();
  });

  it("shows Follow-ups link for ANALYST", () => {
    render(<Wrapper />);
    expect(screen.getByRole("link", { name: /follow.ups/i })).toBeInTheDocument();
  });

  it("Workspace link points to /snapshots", () => {
    render(<Wrapper />);
    expect(screen.getByRole("link", { name: /workspace/i })).toHaveAttribute("href", "/snapshots");
  });
});
