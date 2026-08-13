import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { AppShell } from "./app-shell";

vi.mock("@/app/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Ops", email: "ops@example.com", role: "OPERATIONS_MANAGER" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/app/theme", () => ({
  useTheme: () => ({ mode: "light", resolved: "light", toggle: vi.fn() }),
}));

describe("AppShell operations navigation", () => {
  it("exposes All batches and Dispatch queue as primary nav items", () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav.querySelector('a[href="/operations/batches"]')).toHaveTextContent("All batches");
    expect(nav.querySelector('a[href="/operations/dispatch"]')).toHaveTextContent("Dispatch queue");
    expect(nav.querySelector('a[href="/operations"]')).toBeNull();
  });
});
