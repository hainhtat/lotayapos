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
      if (path === "/master-data/locations/regions") {
        return Promise.resolve({
          data: [
            { id: "r-yangon", nameEn: "Yangon" },
            { id: "r-mandalay", nameEn: "Mandalay" },
          ],
        });
      }
      if (path === "/master-data/locations/townships") {
        return Promise.resolve({
          data: [
            {
              id: "t-hlaing",
              nameEn: "Hlaing",
              deliveryFee: 2500,
              district: {
                id: "d-west",
                nameEn: "West Yangon",
                regionStateId: "r-yangon",
                regionState: { id: "r-yangon", nameEn: "Yangon" },
              },
            },
            {
              id: "t-thingangyun",
              nameEn: "Thingangyun",
              deliveryFee: 2800,
              district: {
                id: "d-east",
                nameEn: "East Yangon",
                regionStateId: "r-yangon",
                regionState: { id: "r-yangon", nameEn: "Yangon" },
              },
            },
            {
              id: "t-chanayethazan",
              nameEn: "Chanayethazan",
              deliveryFee: 3000,
              district: {
                id: "d-mandalay",
                nameEn: "Mandalay",
                regionStateId: "r-mandalay",
                regionState: { id: "r-mandalay", nameEn: "Mandalay" },
              },
            },
          ],
        });
      }
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

    await waitFor(() => expect(screen.getByText("100,000 MMK")).toBeInTheDocument());
    expect(screen.getByText("60,000 MMK")).toBeInTheDocument();
    expect(screen.getByText(/Remaining to OS/i)).toBeInTheDocument();
  });

  it("lists region townships across districts and fills district without changing region", async () => {
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

    const region = await screen.findByLabelText("Region / State 1");
    await waitFor(() => expect(region.querySelector('option[value="r-yangon"]')).not.toBeNull());
    fireEvent.change(region, { target: { value: "r-yangon" } });
    const township = await screen.findByLabelText("Township 1");
    await waitFor(() => expect(township).not.toBeDisabled());
    expect(township.querySelector('option[value="t-hlaing"]')).not.toBeNull();
    expect(township.querySelector('option[value="t-thingangyun"]')).not.toBeNull();
    expect(township.querySelector('option[value="t-chanayethazan"]')).toBeNull();
    fireEvent.change(township, { target: { value: "t-thingangyun" } });
    expect(screen.getByLabelText("Region / State 1")).toHaveValue("r-yangon");
    expect(screen.getByLabelText("District 1")).toHaveTextContent("East Yangon");
    expect(screen.getByText("2,800 MMK")).toBeInTheDocument();
  });

  it("clears district township and zone when region changes", async () => {
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

    const region = await screen.findByLabelText("Region / State 1");
    await waitFor(() => expect(region.querySelector('option[value="r-yangon"]')).not.toBeNull());
    fireEvent.change(region, { target: { value: "r-yangon" } });
    const township = await screen.findByLabelText("Township 1");
    await waitFor(() => expect(township).not.toBeDisabled());
    fireEvent.change(township, { target: { value: "t-hlaing" } });
    expect(screen.getByLabelText("District 1")).toHaveTextContent("West Yangon");

    fireEvent.change(region, { target: { value: "r-mandalay" } });
    expect(screen.getByLabelText("Region / State 1")).toHaveValue("r-mandalay");
    expect(screen.getByLabelText("District 1")).toHaveTextContent("—");
    expect(screen.getByLabelText("Township 1")).toHaveValue("");
    expect(screen.getByLabelText("Zone 1")).toHaveValue("");
    expect(screen.getByLabelText("Zone 1")).toBeDisabled();
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

    await waitFor(() => expect(screen.getByText("100,000 MMK")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Form" }));
    fireEvent.click(screen.getByRole("button", { name: "Add parcel" }));
    const customer = screen.getByLabelText("Customer");
    expect(customer).toHaveClass("border-slate-200");
    expect(customer).not.toHaveClass("border-0");
  });
});
