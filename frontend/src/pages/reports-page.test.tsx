import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { datePresetRange } from "@/lib/date-presets";
import { manifestStatusList } from "@/lib/manifest-filters";
import { ReportsPage } from "./reports-page";

const apiMock = vi.hoisted(() => vi.fn());
const apiRawMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock, apiRaw: apiRawMock }));
vi.mock("@/app/auth", () => ({ useAuth: () => ({ user: { id: "finance-1", role: "FINANCE" } }) }));

describe("ReportsPage", () => {
  beforeEach(() => {
    apiRawMock.mockReset();
    apiRawMock.mockResolvedValue({ blob: async () => new Blob(["csv"]), headers: new Headers() });
    apiMock.mockImplementation((path: string, init?: { method?: string; body?: string }) => {
      if (path === "/master-data/dashboard") {
        return Promise.resolve({ data: { totalParcels: 12, delivered: 8, pendingReturn: 2, cashCollected: 90000, grossProfit: 10000 } });
      }
      if (path === "/master-data") {
        return Promise.resolve({ data: { hubs: [{ id: "hub-1", name: "Main Hub" }], riders: [{ id: "rider-1", user: { name: "Aung Aung" } }] } });
      }
      if (path.startsWith("/reports/profit?")) return Promise.resolve({
        data: {
          period: { from: "2026-09-04", to: "2026-09-04", timezone: "Asia/Yangon" },
          currency: "MMK",
          components: {
            deliveryFeeRevenue: 50000,
            riderCommissionCost: 15000,
            riderSalaryCost: 5000,
            riderCompensationCost: 20000,
            returns: { advanceRecovery: 7000, includedInProfit: false, explanation: "Balance sheet recovery" },
            adjustments: { contribution: 2000 },
            expenses: { cost: 3000 },
          },
          grossProfit: 30000,
          netProfit: 29000,
          journalEntries: [{ id: "journal-1", businessDate: "2026-09-04", description: "Delivery fees", effectiveSourceType: "DELIVERY_COLLECTION", effects: {}, lines: [{ id: "line-1", account: "DELIVERY_FEE_REVENUE", debit: 0, credit: 50000 }] }],
        },
      });
      if (path.startsWith("/reports/monthly-operations?")) return Promise.resolve({ data: { totals: { statusTransitions: 4, uniqueParcels: 3 }, transitionCounts: { DELIVERED: 3, FAILED: 1 }, currentStatusCounts: { DELIVERED: 2, FAILED: 1 } } });
      if (path.startsWith("/reports/returns?")) return Promise.resolve({ data: { totals: { events: 1, uniqueParcels: 1, pendingReturnEvents: 1, returnedEvents: 0, advanceAmount: 5000 }, events: [{ id: "event-1", occurredAt: "2026-09-04T01:00:00Z", fromStatus: "FAILED", toStatus: "PENDING_RETURN", reasonCode: "CUSTOMER_REJECTED", overdue: true, parcel: { trackingNumber: "TRK-RETURN", orderId: "OS-1", status: "PENDING_RETURN", advanceAmount: 5000, batch: { label: "September" } } }] } });
      if (path.startsWith("/reports/rider-performance?")) return Promise.resolve({ data: { totals: { riders: 1, completedWays: 5, delivered: 4, commissionAmount: 2000 }, riders: [{ riderId: "rider-1", riderName: "Aung Aung", completedWays: 5, delivered: 4, partial: 0, failed: 1, rejected: 0, superseded: 0, commissionAmount: 2000 }] } });
      if (path.startsWith("/reports/os-statements?")) return Promise.resolve({ data: { source: "OS_ACCOUNT", totals: { records: 1, settlements: 1, reversedOrReplaced: 0, originalCod: 30000, advancesPaid: 10000, paymentsPaid: 5000, returnedCod: 2000, outstanding: 13000, creditAvailable: 0, walletPaid: 5000, creditApplied: 0 }, accountBatches: [{ batchId: "batch-1", label: "Finalized September", pickupDate: "2026-09-04", originalCod: 30000, advancePaid: 10000, paymentPaid: 5000, returnedCod: 2000, creditAvailable: 0, outstanding: 13000 }], settlements: [] } });
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
    const financialSection = screen.getByText("Financial report").closest("section")!;
    fireEvent.change(within(financialSection).getByLabelText("From date"), { target: { value: "2026-08-01" } });
    fireEvent.change(within(financialSection).getByLabelText("Account"), { target: { value: "WALLET_CASH" } });
    fireEvent.click(within(financialSection).getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/finance/ledger?from=2026-08-01&account=WALLET_CASH"));
    expect(await screen.findByText("WALLET_CASH")).toBeInTheDocument();
  });

  it("shows a transparent profit breakdown and journal drilldown", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ReportsPage /></QueryClientProvider>);

    expect(await screen.findByText("Profit breakdown")).toBeInTheDocument();
    expect(await screen.findByText("30,000 MMK")).toBeInTheDocument();
    expect(screen.getByText("29,000 MMK")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Delivery fees/));
    expect(screen.getByText("DELIVERY_FEE_REVENUE")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(expect.stringMatching(/^\/reports\/profit\?from=.*&to=.*/));
  });

  it("switches detailed report tabs and downloads supported CSV", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ReportsPage /></QueryClientProvider>);
    expect(await screen.findByText("Status transitions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Returns" }));
    expect(await screen.findByText("TRK-RETURN")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await waitFor(() => expect(apiRawMock).toHaveBeenCalledWith(expect.stringMatching(/^\/reports\/returns\?.*&format=csv$/)));
    fireEvent.click(screen.getByRole("tab", { name: "Rider performance" }));
    expect((await screen.findAllByText("Aung Aung")).length).toBeGreaterThan(0);
  });

  it("renders simplified OS account balances without legacy settlement arithmetic", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ReportsPage /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "OS statements" }));
    expect(await screen.findByText("Finalized September")).toBeInTheDocument();
    expect(screen.getAllByText("30,000 MMK").length).toBeGreaterThan(0);
    expect(screen.getAllByText("13,000 MMK").length).toBeGreaterThan(0);
    expect(screen.queryByText("Gross collected COD")).not.toBeInTheDocument();
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
      if (path.startsWith("/reports/profit?")) {
        return Promise.resolve({ data: { period: { from: "2026-09-04", to: "2026-09-04", timezone: "Asia/Yangon" }, components: { deliveryFeeRevenue: 0, riderCommissionCost: 0, riderSalaryCost: 0, riderCompensationCost: 0, returns: { advanceRecovery: 0, includedInProfit: false }, adjustments: { contribution: 0 }, expenses: { cost: 0 } }, grossProfit: 0, netProfit: 0, journalEntries: [] } });
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
