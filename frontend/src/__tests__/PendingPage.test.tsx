import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PendingPage } from "@/pages/PendingPage";

describe("PendingPage", () => {
  it("renders awaiting message", () => {
    render(<PendingPage />);
    expect(screen.getByText(/awaiting role assignment/i)).toBeInTheDocument();
  });

  it("renders sign out button", () => {
    render(<PendingPage />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});
