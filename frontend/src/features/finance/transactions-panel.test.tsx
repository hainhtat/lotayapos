import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { TransactionsPanel } from "./transactions-panel";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/app/auth", () => ({ useAuth: () => ({ user: { id: "user-1", role: "FINANCE" } }) }));

const statement = {
  summary: { wallets: [
    { wallet: "CASH", opening: 100000, in: 50000, out: 20000, closing: 130000 },
    { wallet: "KBZ_PAY", opening: 80000, in: 0, out: 30000, closing: 50000 },
    { wallet: "WAVE_PAY", opening: 0, in: 0, out: 0, closing: 0 },
  ] },
  items: [{ id: "journal-1", businessDate: "2026-10-09", createdAt: "2026-10-09T08:00:00.000Z", type: "RIDER_SETTLEMENT", description: "Rider settlement", sourceType: "RIDER_SETTLEMENT", sourceId: "receipt-1", reference: "receipt-1", counterparty: "Aung", recordedBy: "Finance", wallets: [{ wallet: "CASH", amount: 50000 }, { wallet: "KBZ_PAY", amount: 20000 }], balancesAfter: [{ wallet: "CASH", balance: 150000 }, { wallet: "KBZ_PAY", balance: 60000 }] }],
  pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><TransactionsPanel /></QueryClientProvider></MemoryRouter>);
}

describe("TransactionsPanel", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") return Promise.resolve({ data: { hubs: [{ id: "hub-1", name: "Yangon" }], riders: [{ id: "rider-1", hubId: "hub-1", user: { name: "Aung" } }], shops: [{ id: "shop-1", name: "SNMD" }] } });
      if (path === "/finance/transactions/hubs") return Promise.resolve({ data: { hubs: [{ id: "hub-1", name: "Yangon" }] } });
      if (path.startsWith("/finance/transactions?")) return Promise.resolve({ data: statement });
      if (path.startsWith("/finance/rider-outstanding?")) return Promise.resolve({ data: [{ rider: { id: "rider-1", name: "Aung" }, outstandingAmount: 25000 }] });
      if (path.startsWith("/finance/os-accounts?")) return Promise.resolve({ data: { shops: [{ creditAvailable: 10000 }] } });
      if (path.startsWith("/finance/os-pending-returns?")) return Promise.resolve({ data: { summary: { count: 2, totalRecoverableAmount: 36000 } } });
      throw new Error(`Unexpected request ${path}`);
    });
  });

  it("shows wallet movement and keeps outstanding rider money separate", async () => {
    renderPanel();
    expect(await screen.findByRole("heading", { name: "Transaction record" })).toBeInTheDocument();
    const cash = screen.getByRole("heading", { name: "Cash" }).parentElement!;
    expect(within(cash).getByText("130,000 MMK")).toBeInTheDocument();
    expect(within(cash).getByText("+50,000 MMK")).toBeInTheDocument();
    expect(await screen.findByText("Rider payments outstanding")).toBeInTheDocument();
    expect(screen.getAllByText("25,000 MMK").length).toBeGreaterThan(0);
    expect(screen.getByText("Current balances, shown for context. They are not wallet cash movements or historical totals for the selected dates.")).toBeInTheDocument();
    expect(screen.getByText("10,000 MMK")).toBeInTheDocument();
  });

  it("filters the record without changing the full wallet summary and expands a row", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("Received from rider");
    await user.selectOptions(screen.getByLabelText("Wallet"), "KBZ_PAY");
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => String(path).includes("wallet=KBZ_PAY"))).toBe(true));
    await user.selectOptions(screen.getByLabelText("Rider"), "rider-1");
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => String(path).includes("riderId=rider-1"))).toBe(true));
    await user.selectOptions(screen.getByLabelText("Online shop"), "shop-1");
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => String(path).includes("shopId=shop-1"))).toBe(true));
    expect(screen.getByLabelText("Rider")).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Cash" }).parentElement).toHaveTextContent("130,000 MMK");
    await user.click(screen.getByRole("button", { name: /Received from rider/ }));
    expect(screen.getByText("receipt-1")).toBeInTheDocument();
    expect(screen.getByText("Balance after")).toBeInTheDocument();
    expect(screen.getByText("Cash: 150,000 MMK")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yesterday" }));
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => String(path).includes("from=") && String(path).includes("to="))).toBe(true));
  });

  it("shows a retry for statement failures", async () => {
    apiMock.mockImplementation((path: string) => path === "/master-data" || path === "/finance/transactions/hubs" ? Promise.resolve({ data: { hubs: [{ id: "hub-1", name: "Yangon" }] } }) : Promise.reject(new Error("offline")));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t load this data.");
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
  });
});
