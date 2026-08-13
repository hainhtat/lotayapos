import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import Settlement from "../../app/(tabs)/settlement";
import { i18n } from "@/i18n";

const mockPreview = jest.fn();
const mockDeclare = jest.fn();

jest.mock("@/lib/api", () => ({
  getRiderSettlementPreview: (...args: unknown[]) => mockPreview(...args),
  declareRiderSettlement: (...args: unknown[]) => mockDeclare(...args),
}));
jest.mock("@/providers/theme", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("@/lib/settlement", () => {
  const actual = jest.requireActual("@/lib/settlement") as typeof import("@/lib/settlement");
  return { ...actual, localBusinessDate: () => "2026-08-13" };
});

async function renderSettlement() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const screen = await render(
    <QueryClientProvider client={client}>
      <Settlement />
    </QueryClientProvider>,
  );
  return { screen, client };
}

describe("rider settlement outstanding visibility", () => {
  const cleanups: Array<() => void | Promise<void>> = [];

  beforeEach(() => {
    mockPreview.mockReset();
    mockDeclare.mockReset();
    i18n.locale = "en";
  });

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  it("surfaces outstanding owed separately from delivered expectation", async () => {
    mockPreview.mockResolvedValue({
      riderId: "rider-1",
      businessDate: "2026-08-13",
      parcelCount: 2,
      cod: 10000,
      fees: 2000,
      commission: 500,
      salaryDeduction: 0,
      expectedAmount: 11500,
      outstandingAmount: 9000,
      paidAmount: 2500,
      declaration: null,
      settlement: null,
    });

    const { screen, client } = await renderSettlement();
    cleanups.push(async () => {
      screen.unmount();
      await client.cancelQueries();
      client.clear();
    });
    await waitFor(() => expect(screen.getByText("Still owed to hub")).toBeTruthy());
    expect(screen.getByText(`${(9000).toLocaleString()} MMK`)).toBeTruthy();
    expect(screen.getByText(`${(11500).toLocaleString()} MMK`)).toBeTruthy();
    expect(screen.getByText(/Delivered parcels create an amount owed/)).toBeTruthy();
  });

  it("shows hub-verified settled state when outstanding is cleared", async () => {
    mockPreview.mockResolvedValue({
      riderId: "rider-1",
      businessDate: "2026-08-13",
      parcelCount: 1,
      cod: 5000,
      fees: 1000,
      commission: 200,
      expectedAmount: 5800,
      outstandingAmount: 0,
      paidAmount: 5800,
      declaration: {
        id: "d1",
        cash: 5800,
        kbzPay: 0,
        wavePay: 0,
        status: "SUBMITTED",
        updatedAt: "2026-08-13T12:00:00Z",
      },
      settlement: {
        id: "s1",
        status: "POSTED",
        expectedAmount: 5800,
        actualAmount: 5800,
        variance: 0,
      },
    });

    const { screen, client } = await renderSettlement();
    cleanups.push(async () => {
      screen.unmount();
      await client.cancelQueries();
      client.clear();
    });
    await waitFor(() => expect(screen.getByText("Hub-verified settlement received")).toBeTruthy());
    expect(screen.getByText("Hub verified")).toBeTruthy();
  });

  it("rejects non-integer wallet amounts before declaring", async () => {
    mockPreview.mockResolvedValue({
      riderId: "rider-1",
      businessDate: "2026-08-13",
      parcelCount: 0,
      cod: 0,
      fees: 0,
      commission: 0,
      expectedAmount: 0,
      outstandingAmount: 0,
      paidAmount: 0,
      declaration: null,
      settlement: null,
    });

    const { screen, client } = await renderSettlement();
    cleanups.push(async () => {
      screen.unmount();
      await client.cancelQueries();
      client.clear();
    });
    await waitFor(() => expect(screen.getByLabelText("Cash")).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText("Cash"), "1.5");
    await fireEvent.press(screen.getByText("Submit wallet declaration"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a non-negative whole amount for every wallet",
    );
    expect(mockDeclare).not.toHaveBeenCalled();
  });
});