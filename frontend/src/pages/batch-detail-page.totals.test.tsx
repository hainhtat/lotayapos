import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { BatchDetailPage } from "./batch-detail-page";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));

describe("BatchDetailPage settlement totals", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches/batch-1") {
        return Promise.resolve({
          data: {
            id: "batch-1",
            label: "Shop 11.08.2026",
            advancePaid: 40000,
            totalCod: 100000,
            remainingToOs: 60000,
            nextTrackingSequence: 1,
            shop: { name: "Shop One" },
            parcels: [],
          },
        });
      }
      if (path === "/master-data/locations/regions") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
  });

  it("renders totalCod and remainingToOs from the batch detail response", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/batches/batch-1"]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/batches/:id" element={<BatchDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Total COD \(OS\): 100,000 MMK/)).toBeInTheDocument());
    expect(screen.getByText(/Remaining to OS: 60,000 MMK/)).toBeInTheDocument();
  });

  it("shows bordered inputs in the add-parcel modal instead of spreadsheet cells", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/batches/batch-1"]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/batches/:id" element={<BatchDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Total COD \(OS\): 100,000 MMK/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Form" }));
    fireEvent.click(screen.getByRole("button", { name: "Add parcel" }));
    const customer = screen.getByLabelText("Customer");
    expect(customer).toHaveClass("border-slate-200");
    expect(customer).not.toHaveClass("border-0");
  });
});
