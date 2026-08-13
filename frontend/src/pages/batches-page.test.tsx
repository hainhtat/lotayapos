import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { BatchesPage } from "./batches-page";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: apiMock }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/operations/batches"]}>
      <QueryClientProvider client={queryClient}>
        <BatchesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("BatchesPage", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("shows batch remaining counts", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches") {
        return Promise.resolve({
          data: [
            {
              id: "batch-1",
              label: "SNMD 11.08.2026",
              pickupDate: "2026-08-11T00:00:00.000Z",
              shop: { name: "SNMD" },
              parcels: [{ status: "ASSIGNED" }, { status: "DELIVERED" }, { status: "PENDING_RETURN" }],
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await screen.findByText("SNMD 11.08.2026");
    expect(screen.getAllByText("All batches").length).toBeGreaterThan(0);
    const row = screen.getByText("SNMD 11.08.2026").closest("tr");
    expect(row).toHaveTextContent("3");
    expect(row).toHaveTextContent("2");
  });

  it("opens the create batch dialog from All batches with loaded shops and hubs", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") {
        return Promise.resolve({
          data: {
            shops: [{ id: "shop-1", name: "SNMD" }],
            hubs: [{ id: "hub-1", name: "Sanchaung" }],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Create new batch" }));

    const dialog = await screen.findByRole("dialog", { name: "Create batch" });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "SNMD" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Sanchaung" })).toBeInTheDocument();
  });

  it("shows alerts on the batches page and acknowledges them", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/operations/alerts" && !init) {
        return Promise.resolve({
          data: [{ id: "alert-1", type: "FAILED", message: "Delivery failed", createdAt: "2026-08-11T00:00:00.000Z" }],
        });
      }
      return Promise.resolve({ data: {} });
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(document.getElementById("alerts")).toBeTruthy();
    expect(await screen.findByText("Delivery failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/alerts/alert-1/acknowledge", { method: "POST" }));
  });
});
