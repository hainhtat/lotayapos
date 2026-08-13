import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { datePresetRange } from "@/lib/date-presets";
import { manifestStatusList } from "@/lib/manifest-filters";
import { ReportsPage } from "./reports-page";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock, apiRaw: vi.fn() }));

describe("ReportsPage", () => {
  beforeEach(() => {
    apiMock.mockImplementation((path: string, init?: { method?: string; body?: string }) => {
      if (path === "/master-data/dashboard") {
        return Promise.resolve({ data: { totalParcels: 12, delivered: 8, pendingReturn: 2, cashCollected: 90000, grossProfit: 10000 } });
      }
      if (path === "/master-data") {
        return Promise.resolve({ data: { riders: [{ id: "rider-1", user: { name: "Aung Aung" } }] } });
      }
      if (path === "/operations/parcels/manifest/preview") {
        const body = init?.body ? JSON.parse(init.body) as { statuses?: string[]; dateFrom?: string } : {};
        return Promise.resolve({
          data: {
            riderCount: 1,
            parcelCount: 1,
            summary: { parcelCount: 1, delivered: 1, partial: 0, failed: 0, rejected: 0, pendingReturn: 0, toDeliver: 0, totalCod: 25000, totalFees: 1500 },
            sections: [
              {
                riderId: "rider-1",
                riderName: "Aung Aung",
                parcels: [{ trackingNumber: "LTY-001", orderId: "OS-1", status: "DELIVERED", customerName: "Ma Ma", township: "Yangon", codAmount: 25000, deliveryFee: 1500, address: "No. 1" }],
              },
            ],
            requested: body,
          },
        });
      }
      return Promise.resolve({
        data: {
          accounts: [{ account: "WALLET_CASH", debit: 100000, credit: 10000, balance: 90000 }],
          entries: [],
          totalDebit: 100000,
          totalCredit: 10000,
          difference: 90000,
          balanced: false,
        },
      });
    });
  });

  it("shows operational totals and runs a filtered ledger report", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportsPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("12")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Account"), { target: { value: "WALLET_CASH" } });
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/finance/ledger?from=2026-08-01&account=WALLET_CASH"));
    expect(await screen.findByText("WALLET_CASH")).toBeInTheDocument();
  });

  it("loads on-screen daily delivery status with today and all statuses", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportsPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Daily delivery status")).toBeInTheDocument();
    expect(await screen.findByText("LTY-001")).toBeInTheDocument();
    await waitFor(() => {
      const call = apiMock.mock.calls.find(([path]) => path === "/operations/parcels/manifest/preview");
      expect(call?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
      const body = JSON.parse(String(call?.[1]?.body ?? "{}")) as {
        riderIds?: string[];
        statuses?: string[];
        dateFrom?: string;
        dateTo?: string;
      };
      expect(body.riderIds).toBeUndefined();
      expect(body.statuses).toEqual(manifestStatusList("all"));
      expect(body).toMatchObject(datePresetRange("today"));
    });
  });

  it("retries daily delivery status after a preview failure", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data/dashboard") {
        return Promise.resolve({ data: { totalParcels: 12, delivered: 8, pendingReturn: 2, cashCollected: 90000, grossProfit: 10000 } });
      }
      if (path === "/master-data") {
        return Promise.resolve({ data: { riders: [{ id: "rider-1", user: { name: "Aung Aung" } }] } });
      }
      if (path === "/operations/parcels/manifest/preview") {
        return Promise.reject(new Error("preview failed"));
      }
      return Promise.resolve({ data: { accounts: [], entries: [], totalDebit: 0, totalCredit: 0, difference: 0, balanced: true } });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportsPage />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => {
      const previewCalls = apiMock.mock.calls.filter(([path]) => path === "/operations/parcels/manifest/preview");
      expect(previewCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
