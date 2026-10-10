import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { LinkSuggestionsPanel } from "./link-suggestions-panel";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));

const suggestion = {
  key: "shop-phone-name", hubId: "hub-1", shopName: "Shop A", normalizedName: "customer", normalizedPhone: "09123456789",
  parcels: [
    { id: "a", trackingNumber: "LTY-1", customerName: "Customer", customerPhone: "09 123456789", address: "Road 1", townshipName: "Hlaing", status: "ASSIGNED", riderId: "rider-1", deliveryFee: 4000 },
    { id: "b", trackingNumber: "LTY-2", customerName: "Customer", customerPhone: "09123456789", address: "Road 2", townshipName: "Hlaing", status: "ASSIGNED", riderId: "rider-1", deliveryFee: 4000 },
  ],
};

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LinkSuggestionsPanel enabled riders={[{ id: "rider-1", hubId: "hub-1", user: { name: "Rider One" } }, { id: "rider-2", hubId: "hub-2", user: { name: "Other hub rider" } }]} /></QueryClientProvider>);
}

describe("Link suggestions", () => {
  beforeEach(() => { apiMock.mockReset(); });

  it("requires address review and a reason before linking candidates across pages", async () => {
    apiMock.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith("link-suggestions") ? { groups: [suggestion], scanned: 2, omittedCandidates: 0 } : {} }));
    show();
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Find likely links" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review possible link" }));
    const dialog = screen.getByRole("dialog", { name: "Review possible link" });
    expect(dialog).toHaveTextContent("Road 1");
    expect(dialog).toHaveTextContent("Road 2");
    expect(dialog).toHaveTextContent("Rider One");
    expect(screen.queryByRole("option", { name: "Other hub rider" })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("5,000 MMK");
    expect(screen.getByRole("button", { name: "Confirm link" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked the addresses/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "Same delivery confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm link" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/parcels/link", expect.objectContaining({ method: "POST" })));
    const body = JSON.parse(apiMock.mock.calls.find(([path]) => path === "/operations/parcels/link")![1].body);
    expect(body).toEqual({ parcelIds: ["a", "b"], responsibleRiderId: "rider-1", reason: "Same delivery confirmed" });
  });

  it("does not offer suggestions to a role without dispatch edit access", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><LinkSuggestionsPanel enabled={false} riders={[]} /></QueryClientProvider>);
    expect(screen.queryByRole("heading", { name: "Possible linked deliveries" })).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
