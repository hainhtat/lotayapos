import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import "@/i18n";
import { VoidParcelDialog } from "./void-parcel-dialog";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), api: apiMock }));

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => path.endsWith("/void-preview")
    ? Promise.resolve({ data: { proposedObligationReduction: 0, currentOsBalance: 8000, projectedOsBalance: 8000, advancePaid: 2000, availableOsCredit: 0 } })
    : Promise.resolve({ data: { parcelId: "parcel-1", status: "VOIDED", reversedCod: 0, remainingOsBalance: 8000, replay: false } }));
});

function setup(finalized = true) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><VoidParcelDialog parcel={{ id: "parcel-1", trackingNumber: "LTY-100", codAmount: 0, deliveryFee: 0 }} batchId="batch-1" finalized={finalized} onClose={onClose} onSuccess={onSuccess} /></QueryClientProvider>);
  return { onClose, onSuccess };
}

it("requires an attributable reason and sends a stable idempotent correction", async () => {
  const { onSuccess } = setup();
  expect(await screen.findByText(/OS outstanding: 8,000 MMK/)).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Void parcel entry LTY-100" })).toHaveTextContent("If these fields were changed to zero");
  fireEvent.click(screen.getByRole("button", { name: "Confirm void" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a reason of 3 to 500 characters");
  expect(apiMock).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole("textbox", { name: "Reason for entered-in-error correction" }), { target: { value: "Not on OS manifest" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm void" }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.stringContaining("Remaining OS balance: 8,000 MMK")));
  const [path, init] = apiMock.mock.calls.find(([path]) => path === "/parcels/parcel-1/void")!;
  expect(path).toBe("/parcels/parcel-1/void");
  expect(JSON.parse(init.body)).toEqual({ reason: "Not on OS manifest", idempotencyKey: expect.any(String) });
});

it("handles a draft response without an OS balance", async () => {
  apiMock.mockImplementation((path: string) => path.endsWith("/void-preview")
    ? Promise.resolve({ data: { proposedObligationReduction: 0, currentOsBalance: null, projectedOsBalance: null, advancePaid: null, availableOsCredit: null } })
    : Promise.resolve({ data: { parcelId: "parcel-1", status: "VOIDED", reversedCod: 0, remainingOsBalance: null, replay: false } }));
  const { onSuccess } = setup(false);
  await screen.findByText(/If these fields were changed to zero/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm void" })).toBeEnabled());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Added by mistake" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm void" }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("Draft parcel entry voided. Review the batch totals before finalizing."));
});
