import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { BatchDetailPage } from "./batch-detail-page";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock, apiRaw: vi.fn() }));
vi.mock("@/app/auth", () => ({ useAuth: () => ({ user: { id: "ops-1", role: "OPERATIONS_MANAGER" } }) }));

describe("BatchDetailPage aged parcels", () => {
  beforeEach(() => {
    apiMock.mockReset();
    const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const newDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const parcel = (id: string, status: string, createdAt: string) => ({
      id, trackingNumber: id, customerName: id, address: "Road", status, createdAt, codAmount: 1000, deliveryFee: 0,
    });
    apiMock.mockImplementation((path: string) => Promise.resolve({ data: path === "/operations/batches/batch-1" ? {
      id: "batch-1", hubId: "hub-1", label: "October", finalizedAt: old, advancePaid: 0,
      totalCod: 4000, remainingToOs: 4000, nextTrackingSequence: 5, shop: { name: "Shop" },
      parcels: [
        parcel("LTY-1", "CREATED", old),
        parcel("LTY-2", "PENDING_RETURN", old),
        parcel("LTY-3", "DELIVERED", old),
        parcel("LTY-4", "CREATED", newDate),
        parcel("LTY-5", "VOIDED", old),
      ],
    } : [] }));
  });

  it("shows the batch count and filters its saved rows from the summary link", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/batch-1"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);

    const link = await screen.findByRole("link", { name: "Show these parcels" });
    expect(within(link.parentElement!).getByText("2")).toBeInTheDocument();
    fireEvent.click(link);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("LTY-1").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("LTY-2").length).toBeGreaterThan(0);
    expect(within(table).queryByText("LTY-3")).not.toBeInTheDocument();
    expect(within(table).queryByText("LTY-4")).not.toBeInTheDocument();
    expect(within(table).queryByText("LTY-5")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All parcels" }));
    expect(within(table).getAllByText("LTY-4").length).toBeGreaterThan(0);
  });

  it("refreshes the server count when the next parcel reaches three days", async () => {
    const original = apiMock.getMockImplementation()!;
    const calculatedAt = new Date();
    const nextDueAt = new Date(calculatedAt.getTime() + 250).toISOString();
    let reads = 0;
    apiMock.mockImplementation(async (path: string) => {
      const result = await original(path);
      if (path !== "/operations/batches/batch-1") return result;
      reads += 1;
      return { data: {
        ...result.data,
        threeDaysInHand: reads === 1
          ? { parcelIds: [], nextDueAt, calculatedAt: calculatedAt.toISOString() }
          : { parcelIds: ["LTY-1"], nextDueAt: null, calculatedAt: new Date().toISOString() },
      } };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/batch-1"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);

    expect(await screen.findByRole("link", { name: "Show these parcels" }, { timeout: 5000 })).toBeInTheDocument();
    expect(reads).toBeGreaterThanOrEqual(2);
  });
});
