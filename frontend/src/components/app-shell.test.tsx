import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { AppShell } from "./app-shell";

vi.mock("@/lib/api", () => ({ api: () => Promise.resolve({ data: [] }) }));

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
  it("exposes the focused operations workspaces as primary nav items", () => {
    render(
      <MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppShell />
      </QueryClientProvider></MemoryRouter>,
    );

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav.querySelector('a[href="/operations/batches"]')).toHaveTextContent("All batches");
    expect(nav.querySelector('a[href="/operations/dispatch"]')).toHaveTextContent("Dispatch queue");
    expect(nav.querySelector('a[href="/operations/returns"]')).toHaveTextContent("Return to OS");
    expect(nav.querySelector('a[href="/operations/review"]')).toHaveTextContent("Operations review");
    expect(nav.querySelector('a[href="/operations"]')).toBeNull();
  });
});
