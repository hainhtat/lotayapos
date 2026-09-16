import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import "@/i18n";
import { HistoricalSettlementPanel } from "./historical-settlement-panel";
afterEach(() => vi.unstubAllGlobals());
it("submits the exact preview selection including all three protected batches and no wallet fields", async () => {
  let command: Record<string, unknown> | undefined;
  const batch = (id: string) => ({ id, label: id, pickupDate: "2037-01-01", shopName: "Shop", adjustmentAmount: 100 });
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith("/apply")) { command = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ success: true, data: { walletChange: 0 } })); }
    return new Response(JSON.stringify({ success: true, data: { fingerprint: "a".repeat(64), retainedBatches: [batch("new-3"), batch("new-2"), batch("new-1")], batches: [batch("old")], totalAdjustment: 100, canApply: true, blockers: [] } }));
  }));
  render(<QueryClientProvider client={new QueryClient()}><HistoricalSettlementPanel /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Review older batches" }));
  await screen.findByText("These three batches stay unchanged");
  await user.type(screen.getByLabelText("Reason / paper record reference"), "Paid on paper");
  await user.click(screen.getByRole("button", { name: "Confirm historical settlement" }));
  await waitFor(() => expect(command).toBeDefined());
  expect(command).toMatchObject({ fingerprint: "a".repeat(64), batchIds: ["old"], retainedBatchIds: ["new-3", "new-2", "new-1"], reason: "Paid on paper", idempotencyKey: expect.any(String) });
  expect(command).not.toHaveProperty("wallets");
  expect(await screen.findByRole("status")).toHaveTextContent("Wallet balances unchanged");
});
