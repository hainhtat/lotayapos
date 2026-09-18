import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import "@/i18n";
import { CreateBatchDialog } from "./create-batch-dialog";
vi.mock("@/app/auth", () => ({ useAuth: () => ({ user: { id: "test-finance", role: "FINANCE" } }) }));
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); vi.unstubAllGlobals(); });

it("does not send an advance when recovery storage cannot persist the request", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CreateBatchDialog shops={[{ id: "shop", name: "Shop" }]} hubs={[{ id: "hub", name: "Hub" }]} onClose={vi.fn()} /></MemoryRouter></QueryClientProvider>);
  const user = userEvent.setup();
  await user.type(screen.getAllByRole("textbox")[0], "Pickup batch");
  await user.click(screen.getByRole("button", { name: /save.*add parcels/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Browser storage is unavailable");
  expect(fetch).not.toHaveBeenCalled();
});

it("recovers an uncertain advance after remount and retries the exact original split and key", async () => {
  const bodies: string[] = [];
  let success = false;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("/finance/os-accounts")) return new Response(JSON.stringify({ success: true, data: { shops: [{ shop: { id: "shop" }, creditAvailable: 0 }] } }), { status: 200 });
    bodies.push(String(init?.body));
    return new Response(JSON.stringify(success ? { success: true, data: { id: "batch" } } : { error: { message: "Uncertain advance" } }), { status: success ? 201 : 500 });
  }));
  const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CreateBatchDialog shops={[{ id: "shop", name: "Shop" }]} hubs={[{ id: "hub", name: "Hub" }]} onClose={vi.fn()} /></MemoryRouter></QueryClientProvider>);
  const user = userEvent.setup(), first = mount();
  const inputs = screen.getAllByRole("textbox");
  await user.type(inputs[0], "Pickup batch");
  await user.type(screen.getByLabelText("Requested total advance"), "1000");
  const cash = screen.getByLabelText("Cash");
  await user.clear(cash); await user.type(cash, "1000");
  await user.click(screen.getByRole("button", { name: /save.*add parcels/i }));
  await screen.findByText("Uncertain advance");
  first.unmount(); mount();
  expect(screen.getByLabelText("Cash")).toBeDisabled();
  success = true;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[1]).wallets).toEqual({ cash: 1000, kbzPay: 0, wavePay: 0 });
  await waitFor(() => expect(sessionStorage.getItem("lotaya:batch-create:test-finance")).toBeNull());
});

it("normalizes cleared wallet fields to zero in a credit-aware advance request", async () => {
  let postedBody: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("/finance/os-accounts")) return new Response(JSON.stringify({ success: true, data: { shops: [{ shop: { id: "shop" }, creditAvailable: 0 }] } }), { status: 200 });
    postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ success: true, data: { id: "batch" } }), { status: 201 });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CreateBatchDialog shops={[{ id: "shop", name: "Shop" }]} hubs={[{ id: "hub", name: "Hub" }]} onClose={vi.fn()} /></MemoryRouter></QueryClientProvider>);
  const user = userEvent.setup();
  await user.type(screen.getAllByRole("textbox")[0], "Pickup batch");
  await user.type(screen.getByLabelText("Requested total advance"), "500");
  const cash = screen.getByLabelText("Cash");
  await user.type(cash, "1000");
  await user.clear(cash);
  await user.type(screen.getByLabelText("KBZ Pay"), "500");
  await user.click(screen.getByRole("button", { name: /save.*add parcels/i }));
  await waitFor(() => expect(postedBody).toBeDefined());
  expect(postedBody).toMatchObject({ advancePaid: 500, wallets: { cash: 0, kbzPay: 500, wavePay: 0 } });
});
