import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { NotificationsDropdown } from "./notifications-dropdown";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));

describe("notification dropdown", () => {
  it("opens, retains alerts, and dismisses with Escape", async () => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ data: [{ id: "a1", type: "PARTIAL", message: "Needs review", createdAt: "2026-10-07T06:00:00Z", parcel: null }] });
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
});
