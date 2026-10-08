import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { OperationsReviewPage } from "./operations-review-page";

const apiMock = vi.hoisted(() => vi.fn());
const role = vi.hoisted(() => ({ current: "OPERATIONS_MANAGER" }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/app/auth", () => ({ useAuth: () => ({ user: { role: role.current } }) }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><OperationsReviewPage /></QueryClientProvider></MemoryRouter>);
}

describe("Operations review", () => {
  beforeEach(() => {
    role.current = "OPERATIONS_MANAGER";
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/wallet-alerts") return Promise.resolve({ data: [] });
      if (path === "/operations/alerts") return Promise.resolve({ data: [{ id: "alert-1", type: "FAILED", message: "Parcel LTY-1929 requires operations review", createdAt: "2026-10-07T06:00:00Z", parcel: { id: "parcel-1", trackingNumber: "LTY-1929", orderId: "OS-55", status: "FAILED", reasonCode: "NO_ANSWER" } }] });
      if (path === "/finance/os-pending-returns") return Promise.resolve({ data: { items: [], summary: { count: 0, totalRecoverableAmount: 0 } } });
      if (path.startsWith("/operations/parcels/overdue-unsent")) return Promise.resolve({ data: [{ id: "parcel-2", trackingNumber: "LTY-1930", status: "ASSIGNED", createdAt: "2026-10-01T00:00:00Z", batch: { id: "batch-1", label: "October", shop: { name: "Shop" } } }], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
      return Promise.resolve({ data: {} });
    });
  });

  it("shows linked alert context and only clears after acknowledgement", async () => {
    renderPage();
    expect(await screen.findByText("Parcel LTY-1929 requires operations review")).toBeInTheDocument();
    expect(screen.getByText(/OS-55/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View parcel details LTY-1929" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose next step" })).toHaveAttribute("href", "/operations/dispatch?trackingNumber=LTY-1929&decision=parcel-1");
    expect(screen.getByText(/In hand since/)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("/operations/alerts/alert-1/acknowledge", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/alerts/alert-1/acknowledge", { method: "POST" }));
  });

  it("does not request restricted review data for other roles", () => {
    role.current = "DISPATCHER";
    renderPage();
    expect(screen.queryByRole("heading", { name: "Operations review" })).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("shows Finance only hub wallet shortfalls, without parcel review data", async () => {
    role.current = "FINANCE";
    apiMock.mockImplementation((path: string) => path === "/operations/wallet-alerts"
      ? Promise.resolve({ data: [{ id: "hub-1:KBZ_PAY", hubId: "hub-1", hubName: "Yangon", wallet: "KBZ_PAY", balance: -2000, shortfall: 2000 }] })
      : Promise.resolve({ data: {} }));
    renderPage();
    expect(await screen.findByText("Shortfall: 2,000 MMK")).toBeInTheDocument();
    expect(screen.getByText("Yangon · KBZ Pay")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("/operations/alerts");
    expect(apiMock.mock.calls.some(([path]) => path.startsWith("/operations/parcels/overdue-unsent"))).toBe(false);
    expect(screen.queryByRole("heading", { name: "Overdue pending returns" })).not.toBeInTheDocument();
  });

  it("shows overdue return deadlines and records a reasoned extension", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/wallet-alerts") return Promise.resolve({ data: [] });
      if (path === "/operations/alerts") return Promise.resolve({ data: [] });
      if (path === "/finance/os-pending-returns") return Promise.resolve({ data: { items: [{ id: "parcel-return", trackingNumber: "LTY-1940", status: "PENDING_RETURN", returnDueAt: "2020-01-01T00:00:00Z", batch: { id: "batch-1", label: "October" }, shop: { id: "shop-1", name: "Shop" } }, { id: "parcel-future", trackingNumber: "LTY-1941", status: "FAILED", returnDueAt: null, batch: { id: "batch-1", label: "October" }, shop: { id: "shop-1", name: "Shop" } }], summary: { count: 2, totalRecoverableAmount: 0 } } });
      if (path.startsWith("/operations/parcels/overdue-unsent")) return Promise.resolve({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    expect(await screen.findByText("LTY-1940")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overdue pending returns" })).toBeInTheDocument();
    expect(screen.queryByText("LTY-1941")).not.toBeInTheDocument();
    expect(screen.getByText(/1 Jan 2020.*Overdue/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    fireEvent.change(screen.getByLabelText("Additional days"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Reason for extension"), { target: { value: "Customer requested time" } });
    fireEvent.click(screen.getByRole("button", { name: "Save extension" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/parcels/parcel-return/return-extension", { method: "POST", body: JSON.stringify({ days: 3, reason: "Customer requested time" }) }));
  });

  it("shows only overdue Pending Return parcels in the review return queue", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/wallet-alerts") return Promise.resolve({ data: [] });
      if (path === "/operations/alerts") return Promise.resolve({ data: [] });
      if (path === "/finance/os-pending-returns") return Promise.resolve({ data: { items: [
        { id: "overdue", trackingNumber: "LTY-2001", status: "PENDING_RETURN", returnDueAt: "2020-01-01T00:00:00Z", batch: { id: "batch-1", label: "October" }, shop: { id: "shop-1", name: "Shop" } },
        { id: "future", trackingNumber: "LTY-2002", status: "PENDING_RETURN", returnDueAt: "2099-01-01T00:00:00Z", batch: { id: "batch-1", label: "October" }, shop: { id: "shop-1", name: "Shop" } },
        { id: "failed", trackingNumber: "LTY-2003", status: "FAILED", returnDueAt: "2020-01-01T00:00:00Z", batch: { id: "batch-1", label: "October" }, shop: { id: "shop-1", name: "Shop" } },
      ], summary: { count: 3, totalRecoverableAmount: 0 } } });
      if (path.startsWith("/operations/parcels/overdue-unsent")) return Promise.resolve({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    expect(await screen.findByText("LTY-2001")).toBeInTheDocument();
    expect(screen.queryByText("LTY-2002")).not.toBeInTheDocument();
    expect(screen.queryByText("LTY-2003")).not.toBeInTheDocument();
  });
});
