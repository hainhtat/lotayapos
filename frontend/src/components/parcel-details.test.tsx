import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ParcelDetailsButton } from "./parcel-details";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));

beforeEach(() => apiMock.mockReset());
afterEach(async () => { await i18n.changeLanguage("en"); });

it("opens one read-only parcel record and restores the table trigger on close", async () => {
  apiMock.mockResolvedValue({ data: {
    id: "parcel-1", trackingNumber: "LTY-100", orderId: "OS-100", customerName: "Customer One",
    customerPhone: "0912345678", address: "Main Street", township: "Sanchaung", status: "DELIVERED",
    reasonCode: null, codAmount: 20000, deliveryFee: 4000, collectionMode: "PAID_BY_OS",
    paidToOsFeeIncluded: true, actualCodCollected: null, batch: { label: "Batch A", shop: { name: "Shop A" } },
    rider: { user: { name: "Rider A" } }, statusHistory: [
      { id: "history-0", fromStatus: "PICKED_UP", toStatus: "ASSIGNED", reasonCode: null, note: null, createdAt: "2026-09-23T07:00:00.000Z" },
      { id: "history-1", fromStatus: "ASSIGNED", toStatus: "OUT_FOR_DELIVERY", reasonCode: null, note: null, createdAt: "2026-09-23T08:00:00.000Z" },
      { id: "history-2", fromStatus: "OUT_FOR_DELIVERY", toStatus: "DELIVERED", reasonCode: null, note: "Received by customer", createdAt: "2026-09-23T09:00:00.000Z" },
    ],
  } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ParcelDetailsButton id="parcel-1" trackingNumber="LTY-100"/></QueryClientProvider>);
  const trigger = screen.getByRole("button", { name: "View parcel details LTY-100" });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Parcel details" });
  await waitFor(() => expect(dialog).toHaveTextContent("Customer One"));
  expect(dialog).toHaveTextContent("Received by customer");
  expect(dialog).toHaveTextContent("Parcel journey");
  const events = dialog.querySelectorAll("ol > li");
  expect(events).toHaveLength(3);
  expect(events[0]).toHaveTextContent("Assigned");
  expect(events[1]).toHaveTextContent("Out for delivery");
  expect(events[2]).toHaveTextContent("Delivered");
  expect(dialog).toHaveTextContent("24,000 MMK");
  expect(apiMock).toHaveBeenCalledWith("/parcels/parcel-1");
  expect(dialog.querySelector("input, select, textarea")).toBeNull();
  expect(fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).toBe(false);
  expect(dialog.querySelector("button")).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("shows failure and the later retry decision as distinct journey events with the rider note", async () => {
  apiMock.mockResolvedValue({ data: {
    id: "parcel-2", trackingNumber: "LTY-200", orderId: null, customerName: "Customer", customerPhone: null,
    address: "Road", township: null, status: "DELIVERED", reasonCode: null, codAmount: 1000, deliveryFee: 0,
    collectionMode: "CASH_RECEIPT_EXCEPTION", paidToOsFeeIncluded: false, actualCodCollected: 1000,
    batch: { label: "Batch", shop: { name: "Shop" } }, rider: null, statusHistory: [
      { id: "out", fromStatus: "ASSIGNED", toStatus: "OUT_FOR_DELIVERY", reasonCode: null, note: null, createdAt: "2026-10-01T08:00:00.000Z" },
      { id: "failed", fromStatus: "OUT_FOR_DELIVERY", toStatus: "FAILED", reasonCode: "CUSTOMER_UNAVAILABLE", note: "Customer asked for Friday", createdAt: "2026-10-01T09:00:00.000Z" },
      { id: "retry", fromStatus: "FAILED", toStatus: "PICKED_UP", reasonCode: "RETRY_TOMORROW", note: "Try again tomorrow", createdAt: "2026-10-01T10:00:00.000Z" },
      { id: "out-again", fromStatus: "PICKED_UP", toStatus: "OUT_FOR_DELIVERY", reasonCode: null, note: null, createdAt: "2026-10-02T08:00:00.000Z" },
      { id: "delivered", fromStatus: "OUT_FOR_DELIVERY", toStatus: "DELIVERED", reasonCode: null, note: null, createdAt: "2026-10-02T09:00:00.000Z" },
    ],
  } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ParcelDetailsButton id="parcel-2" trackingNumber="LTY-200"/></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "View parcel details LTY-200" }));
  const dialog = await screen.findByRole("dialog", { name: "Parcel details" });
  await waitFor(() => expect(dialog).toHaveTextContent("Customer asked for Friday"));
  const events = dialog.querySelectorAll("ol > li");
  expect(events).toHaveLength(5);
  expect(events[1]).toHaveTextContent("Failed");
  expect(events[1]).toHaveTextContent("Customer unavailable");
  expect(events[2]).toHaveTextContent("Retry scheduled");
  expect(events[2]).not.toHaveTextContent("Picked up");
  expect(events[4]).toHaveTextContent("Delivered");
});

it("shows the planned date when present and retains legacy reschedule explanations", async () => {
  apiMock.mockResolvedValue({ data: {
    id: "parcel-3", trackingNumber: "LTY-300", orderId: null, customerName: "Customer", customerPhone: null,
    address: "Road", township: null, status: "PICKED_UP", reasonCode: "RESCHEDULE", codAmount: 1000, deliveryFee: 0,
    collectionMode: "CASH_RECEIPT_EXCEPTION", paidToOsFeeIncluded: false, actualCodCollected: null,
    batch: { label: "Batch", shop: { name: "Shop" } }, rider: null, statusHistory: [
      { id: "failed", fromStatus: "OUT_FOR_DELIVERY", toStatus: "FAILED", reasonCode: "RESCHEDULE", note: "Customer requested a new date", createdAt: "2026-10-01T09:00:00.000Z" },
      { id: "old", fromStatus: "FAILED", toStatus: "PICKED_UP", reasonCode: "RESCHEDULE", note: "Agreed by phone", createdAt: "2026-10-01T10:00:00.000Z" },
      { id: "new", fromStatus: "PICKED_UP", toStatus: "PICKED_UP", reasonCode: "RESCHEDULE", note: "2026-10-09: Customer asked for Friday", createdAt: "2026-10-02T10:00:00.000Z" },
    ],
  } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ParcelDetailsButton id="parcel-3" trackingNumber="LTY-300"/></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "View parcel details LTY-300" }));
  const dialog = await screen.findByRole("dialog", { name: "Parcel details" });
  await waitFor(() => expect(dialog).toHaveTextContent("Agreed by phone"));
  const events = dialog.querySelectorAll("ol > li");
  expect(events[0]).toHaveTextContent("Failed");
  expect(events[0]).toHaveTextContent("Delivery date change requested");
  expect(events[1]).toHaveTextContent("Delivery rescheduled");
  expect(events[2]).toHaveTextContent("Delivery rescheduled for 9 Oct 2026");
  expect(events[2]).toHaveTextContent("2026-10-09: Customer asked for Friday");
});

it("localizes the journey for Myanmar readers", async () => {
  await i18n.changeLanguage("my");
  apiMock.mockResolvedValue({ data: {
    id: "parcel-4", trackingNumber: "LTY-400", orderId: null, customerName: "Customer", customerPhone: null,
    address: "Road", township: null, status: "PICKED_UP", reasonCode: "RETRY_TOMORROW", codAmount: 1000, deliveryFee: 0,
    collectionMode: "CASH_RECEIPT_EXCEPTION", paidToOsFeeIncluded: false, actualCodCollected: null,
    batch: { label: "Batch", shop: { name: "Shop" } }, rider: null, statusHistory: [
      { id: "retry", fromStatus: "FAILED", toStatus: "PICKED_UP", reasonCode: "RETRY_TOMORROW", note: "ထပ်ပို့ရန်", createdAt: "2026-10-01T10:00:00.000Z" },
    ],
  } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ParcelDetailsButton id="parcel-4" trackingNumber="LTY-400"/></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /LTY-400/ }));
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog).toHaveTextContent("ပါဆယ် ပို့ဆောင်မှု မှတ်တမ်း"));
  expect(dialog).toHaveTextContent("ထပ်မံပို့ဆောင်ရန် စီစဉ်ပြီး");
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
