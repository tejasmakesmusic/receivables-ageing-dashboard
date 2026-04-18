import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoginPage } from "@/pages/LoginPage";

describe("LoginPage", () => {
  it("renders sign in button", () => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
  });

  it("redirects to /auth/google/login on click", () => {
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(window.location.href).toBe("/auth/google/login");
  });

  it("shows domain restriction note", () => {
    render(<LoginPage />);
    expect(screen.getByText(/emb\.global/i)).toBeInTheDocument();
  });
});
