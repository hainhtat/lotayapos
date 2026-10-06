import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import "@/i18n";
import { ParcelDetailsButton } from "./parcel-details";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));

beforeEach(() => apiMock.mockReset());

it("opens one read-only parcel record and restores the table trigger on close", async () => {
  apiMock.mockResolvedValue({ data: {
    id: "parcel-1", trackingNumber: "LTY-100", orderId: "OS-100", customerName: "Customer One",
    customerPhone: "0912345678", address: "Main Street", township: "Sanchaung", status: "DELIVERED",
    reasonCode: null, codAmount: 20000, deliveryFee: 4000, collectionMode: "PAID_BY_OS",
    paidToOsFeeIncluded: true, actualCodCollected: null, batch: { label: "Batch A", shop: { name: "Shop A" } },
    rider: { user: { name: "Rider A" } }, statusHistory: [{ id: "history-1", fromStatus: "OUT_FOR_DELIVERY", toStatus: "DELIVERED", reasonCode: null, note: "Received by customer", createdAt: "2026-09-23T09:00:00.000Z" }],
  } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ParcelDetailsButton id="parcel-1" trackingNumber="LTY-100"/></QueryClientProvider>);
  const trigger = screen.getByRole("button", { name: "View parcel details LTY-100" });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Parcel details" });
  await waitFor(() => expect(dialog).toHaveTextContent("Customer One"));
  expect(dialog).toHaveTextContent("Received by customer");
  expect(dialog).toHaveTextContent("24,000 MMK");
  expect(apiMock).toHaveBeenCalledWith("/parcels/parcel-1");
  expect(dialog.querySelector("input, select, textarea")).toBeNull();
  expect(fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).toBe(false);
  expect(dialog.querySelector("button")).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("shows a retryable error instead of crashing on an invalid detail response", async () => {
  apiMock.mockResolvedValueOnce({ data: { id: "parcel-1" } });
  apiMock.mockResolvedValueOnce({ data: {
    id: "parcel-1", trackingNumber: "LTY-100", orderId: null, customerName: "Customer", customerPhone: null,
    address: "Road", township: null, status: "ASSIGNED", reasonCode: null, codAmount: 1000, deliveryFee: 0,
    collectionMode: "CASH_RECEIPT_EXCEPTION", paidToOsFeeIncluded: false, actualCodCollected: null,
    batch: { label: "Batch", shop: { name: "Shop" } }, rider: null, statusHistory: [],
  } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ParcelDetailsButton id="parcel-1" trackingNumber="LTY-100"/></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "View parcel details LTY-100" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t load this data.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Road")).toBeInTheDocument();
  expect(apiMock).toHaveBeenCalledTimes(2);
});
