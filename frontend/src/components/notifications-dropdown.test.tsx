import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { NotificationsDropdown } from "./notifications-dropdown";

const apiMock = vi.hoisted(() => vi.fn());
const role = vi.hoisted(() => ({ current: "OPERATIONS_MANAGER" }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/app/auth", () => ({ useAuth: () => ({ user: { role: role.current } }) }));

describe("notification dropdown", () => {
  it("opens, retains alerts, and dismisses with Escape", async () => {
    role.current = "OPERATIONS_MANAGER";
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => Promise.resolve({ data: path === "/operations/wallet-alerts" ? [] : [{ id: "a1", type: "PARTIAL", message: "Needs review", createdAt: "2026-10-07T06:00:00Z", parcel: null }] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><NotificationsDropdown /></QueryClientProvider></MemoryRouter>);
    const bell = screen.getByRole("button", { name: "View operational alerts" });
    fireEvent.click(bell);
    expect(await screen.findByText("Needs review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/operations/review");
    expect(apiMock).not.toHaveBeenCalledWith("/operations/alerts/a1/acknowledge", expect.anything());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bell).toHaveFocus();
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
  });

  it("shows a Finance wallet shortfall without requesting parcel alerts", async () => {
    role.current = "FINANCE";
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => Promise.resolve({ data: path === "/operations/wallet-alerts"
      ? [{ id: "hub-1:CASH", hubId: "hub-1", hubName: "Yangon", wallet: "CASH", balance: -500, shortfall: 500 }]
      : [] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><NotificationsDropdown /></QueryClientProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "View operational alerts" }));
    expect(await screen.findByText("Balance: -500 MMK")).toBeInTheDocument();
    expect(await screen.findByText("Shortfall: 500 MMK")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("/operations/alerts");
  });
});
