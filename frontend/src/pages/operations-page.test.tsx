import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { datePresetRange } from "@/lib/date-presets";
import { manifestStatusList } from "@/lib/manifest-filters";
import { OperationsPage } from "./operations-page";

const apiMock = vi.hoisted(() => vi.fn());
const apiRawMock = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ role: "OPERATIONS_MANAGER" }));

vi.mock("@/lib/api", () => ({ api: apiMock, apiRaw: apiRawMock, ApiError: class ApiError extends Error {} }));
vi.mock("@/app/auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Ops", email: "ops@example.com", role: authState.role },
  }),
}));

function mockParcelList(data: unknown[], pagination?: { page: number; pageSize: number; total: number; totalPages: number }) {
  apiRawMock.mockImplementation((path: string) => {
    if (path.startsWith("/parcels")) {
      return Promise.resolve({
        json: async () => ({
          data,
          pagination: pagination ?? { page: 1, pageSize: 100, total: data.length, totalPages: 1 },
        }),
      });
    }
    return Promise.resolve({ json: async () => ({ data: [] }), blob: async () => new Blob() });
  });
}

function renderPage(initialEntry = "/operations/dispatch") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <OperationsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("OperationsPage", () => {
  beforeEach(() => {
    authState.role = "OPERATIONS_MANAGER";
    apiMock.mockReset();
    apiRawMock.mockReset();
  });

  it("submits the backend status field with actual COD collected", async () => {
    const parcel = {
      id: "parcel-1",
      trackingNumber: "TRK-1",
      customerName: "Customer",
      address: "Address",
      status: "OUT_FOR_DELIVERY",
      codAmount: 25000,
      deliveryFee: 3000,
      batch: { label: "Batch", pickupDate: "2026-08-11T00:00:00.000Z", shop: { name: "Shop" } },
      rider: { id: "rider-1", user: { name: "Rider" } },
    };
    mockParcelList([parcel]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data/reason-codes") {
        return Promise.resolve({
          data: [
            {
              id: "reason-1",
              code: "CUSTOMER_SHORT",
              labelEn: "Customer short-paid",
              labelMy: "ငွေလျော့ပေး",
              outcome: "PARTIAL",
              noteRequired: false,
              active: true,
            },
          ],
        });
      }
      if (path === "/master-data") {
        return Promise.resolve({ data: { shops: [], riders: [{ id: "rider-1", user: { name: "Rider" } }] } });
      }
      if (path === "/operations/batches") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("TRK-1")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Status TRK-1"), { target: { value: "PARTIAL" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason code"), { target: { value: "CUSTOMER_SHORT" } });
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "15000" } });
    fireEvent.change(within(dialog).getByLabelText("Collection wallet"), { target: { value: "KBZ_PAY" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/parcels/parcel-1/status",
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
  });

  it("sends an ops correction note when changing status without an exception dialog", async () => {
    const parcel = {
      id: "parcel-1",
      trackingNumber: "TRK-1",
      customerName: "Customer",
      address: "Address",
      status: "ASSIGNED",
      codAmount: 25000,
      batch: { label: "Batch", pickupDate: "2026-08-11T00:00:00.000Z", shop: { name: "Shop" } },
      rider: { id: "rider-1", user: { name: "Rider" } },
    };
    mockParcelList([parcel]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") {
        return Promise.resolve({ data: { riders: [{ id: "rider-1", user: { name: "Rider" } }] } });
      }
      if (path === "/operations/batches") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    });

    renderPage();
    await screen.findByText("TRK-1");
    fireEvent.change(screen.getByLabelText("Status TRK-1"), { target: { value: "OUT_FOR_DELIVERY" } });

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/parcels/parcel-1/status",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ status: "OUT_FOR_DELIVERY", note: "Ops correction" }),
        }),
      ),
    );
  });

  it("blocks failed status save when the reason requires a note", async () => {
    const parcel = {
      id: "parcel-1",
      trackingNumber: "TRK-1",
      customerName: "Customer",
      address: "Address",
      status: "OUT_FOR_DELIVERY",
      codAmount: 25000,
      batch: { label: "Batch", pickupDate: "2026-08-11T00:00:00.000Z", shop: { name: "Shop" } },
      rider: { id: "rider-1", user: { name: "Rider" } },
    };
    mockParcelList([parcel]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data/reason-codes") {
        return Promise.resolve({
          data: [
            {
              id: "reason-1",
              code: "NO_ANSWER",
              labelEn: "No answer",
              labelMy: "မကိုင်",
              outcome: "FAILED",
              noteRequired: true,
              active: true,
            },
          ],
        });
      }
      if (path === "/master-data") {
        return Promise.resolve({ data: { riders: [{ id: "rider-1", user: { name: "Rider" } }] } });
      }
      if (path === "/operations/batches") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    });

    renderPage();
    await screen.findByText("TRK-1");
    fireEvent.change(screen.getByLabelText("Status TRK-1"), { target: { value: "FAILED" } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason code"), { target: { value: "NO_ANSWER" } });
    expect(within(dialog).getByRole("button", { name: /save/i })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason note"), { target: { value: "Called twice" } });
    expect(within(dialog).getByRole("button", { name: /save/i })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/parcels/parcel-1/status",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            status: "FAILED",
            reasonCode: "NO_ANSWER",
            note: "Called twice",
          }),
        }),
      ),
    );
  });

  it("opens the edit parcel modal for assigned parcels", async () => {
    mockParcelList([
      {
        id: "assigned",
        trackingNumber: "TRK-ASSIGNED",
        orderId: "99",
        customerName: "Customer",
        customerPhone: "09111",
        address: "Address line",
        status: "ASSIGNED",
        codAmount: 25000,
        townshipId: "tw-1",
        zoneId: null,
        township: "Ahlone",
        batch: { label: "Batch", pickupDate: "2026-08-11T00:00:00.000Z", shop: { name: "Shop" } },
        rider: { id: "rider-1", user: { name: "Rider" } },
      },
    ]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") {
        return Promise.resolve({ data: { riders: [{ id: "rider-1", user: { name: "Rider" } }] } });
      }
      if (path === "/master-data/locations/townships") {
        return Promise.resolve({
          data: [{ id: "tw-1", nameEn: "Ahlone", district: { nameEn: "West", regionState: { nameEn: "Yangon" } } }],
        });
      }
      if (path === "/operations/batches") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    renderPage();
    await screen.findByText("TRK-ASSIGNED");
    fireEvent.click(screen.getByRole("button", { name: /edit parcel TRK-ASSIGNED/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit parcel")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Customer")).toBeInTheDocument();
  });

  it("opens delivered parcels for contact corrections while locking delivery fields", async () => {
    mockParcelList([{
      id: "delivered", trackingNumber: "TRK-DELIVERED", customerName: "Customer", address: "Address",
      status: "DELIVERED", codAmount: 52000, batch: { label: "Batch", shop: { name: "Shop" } }, rider: null,
    }]);
    apiMock.mockImplementation((path: string) => path === "/master-data"
      ? Promise.resolve({ data: { riders: [] } })
      : Promise.resolve({ data: [] }));

    renderPage();
    await screen.findByText("TRK-DELIVERED");
    const edit = screen.getByRole("button", { name: /edit parcel TRK-DELIVERED/i });
    expect(edit).toBeEnabled();
    fireEvent.click(edit);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("note")).toHaveTextContent("customer contact details");
    expect(within(dialog).getByLabelText("Customer")).toBeEnabled();
    expect(within(dialog).getByLabelText("COD")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("populates the batch filter dropdown from operations batches", async () => {
    mockParcelList([]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches") {
        return Promise.resolve({
          data: [
            {
              id: "batch-1",
              label: "SNMD 11.08.2026",
              pickupDate: "2026-08-11T00:00:00.000Z",
              shop: { name: "SNMD" },
              parcels: [],
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "SNMD 11.08.2026 · SNMD" })).toBeInTheDocument();
    });
  });

  it("applies a dashboard status deep link to the visible filter and parcel request", async () => {
    mockParcelList([]);
    apiMock.mockResolvedValue({ data: [] });
    renderPage("/operations/dispatch?status=PENDING_RETURN");
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("PENDING_RETURN");
    await waitFor(() =>
      expect(apiRawMock).toHaveBeenCalledWith(expect.stringContaining("status=PENDING_RETURN")),
    );
  });

  it("keeps status select available for non-delivery parcels", async () => {
    mockParcelList([
      {
        id: "assigned",
        trackingNumber: "TRK-ASSIGNED",
        customerName: "Customer",
        status: "ASSIGNED",
        codAmount: 25000,
        batch: { label: "Batch", shop: { name: "Shop" } },
        rider: { id: "rider-1", user: { name: "Rider" } },
      },
    ]);
    apiMock.mockImplementation((path: string) =>
      path === "/master-data"
        ? Promise.resolve({ data: { riders: [{ id: "rider-1", user: { name: "Rider" } }] } })
        : Promise.resolve({ data: [] }),
    );
    renderPage();
    await screen.findByText("TRK-ASSIGNED");
    expect(screen.getByLabelText("Status TRK-ASSIGNED")).toHaveValue("ASSIGNED");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("allows selecting an unassigned exception parcel for multi-edit", async () => {
    mockParcelList([
      {
        id: "parcel-failed",
        trackingNumber: "TRK-FAILED",
        customerName: "Customer",
        address: "Address",
        status: "FAILED",
        codAmount: 25000,
        batch: { label: "Batch", shop: { name: "Shop" } },
        rider: null,
      },
    ]);
    apiMock.mockResolvedValue({ data: [] });

    renderPage();

    await waitFor(() => expect(screen.getByText("TRK-FAILED")).toBeInTheDocument());
    const checkbox = screen.getByRole("checkbox", { name: /select TRK-FAILED/i });
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("reassigns an eligible parcel via inline rider select", async () => {
    const parcel = {
      id: "parcel-1",
      trackingNumber: "TRK-1",
      customerName: "Customer",
      address: "Address",
      status: "ASSIGNED",
      codAmount: 25000,
      batch: { label: "Batch", shop: { name: "Shop" } },
      rider: { id: "rider-1", user: { name: "Current Rider" } },
    };
    mockParcelList([parcel]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") {
        return Promise.resolve({
          data: {
            riders: [
              { id: "rider-1", user: { name: "Current Rider" } },
              { id: "rider-2", user: { name: "New Rider" } },
            ],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("TRK-1")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Rider TRK-1"), { target: { value: "rider-2" } });

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/operations/parcels/parcel-1/reassign", {
        method: "POST",
        body: JSON.stringify({ riderId: "rider-2", reason: "Ops inline reassignment" }),
      }),
    );
  });

  it("uses the dashboard batch link as a parcel query filter", async () => {
    mockParcelList([]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches") {
        return Promise.resolve({
          data: [
            {
              id: "batch-7",
              label: "Batch 7",
              pickupDate: "2026-08-11T00:00:00.000Z",
              shop: { name: "Shop" },
              parcels: [],
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    renderPage("/operations/dispatch?batchId=batch-7");
    await waitFor(() =>
      expect(apiRawMock).toHaveBeenCalledWith(expect.stringMatching(/^\/parcels\?.*batchId=batch-7/)),
    );
    await waitFor(() => expect(screen.getByLabelText("Batch")).toHaveValue("batch-7"));
  });

  it("requests parcel pages with pageSize 100", async () => {
    mockParcelList([]);
    apiMock.mockResolvedValue({ data: [] });
    renderPage();
    await waitFor(() =>
      expect(apiRawMock).toHaveBeenCalledWith(expect.stringMatching(/^\/parcels\?.*pageSize=100(?:&|$)/)),
    );
  });

  it("hides assign and multi-edit controls for non-dispatch roles", async () => {
    authState.role = "FINANCE";
    mockParcelList([
      {
        id: "parcel-1",
        trackingNumber: "TRK-1",
        customerName: "Customer",
        address: "Address",
        status: "CREATED",
        codAmount: 25000,
        batch: { label: "Batch", shop: { name: "Shop" } },
        rider: null,
      },
    ]);
    apiMock.mockResolvedValue({ data: [] });
    renderPage();

    await screen.findByText("TRK-1");
    expect(screen.queryByRole("button", { name: /assign/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assign to rider")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /select TRK-1/i }));
    expect(screen.queryByText(/multi-edit/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Rider TRK-1")).toBeDisabled();
    expect(screen.getByLabelText("Status TRK-1")).toBeDisabled();
  });

  it("previews the dispatch manifest for all hub riders when none are selected", async () => {
    mockParcelList([]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") {
        return Promise.resolve({ data: { riders: [{ id: "rider-1", user: { name: "Aung Aung" } }] } });
      }
      if (path === "/operations/parcels/manifest/preview") {
        return Promise.resolve({
          data: {
            riderCount: 0,
            parcelCount: 0,
            summary: { parcelCount: 0, delivered: 0, partial: 0, failed: 0, rejected: 0, pendingReturn: 0, toDeliver: 0, totalCod: 0, totalFees: 0 },
            sections: [],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Download manifest" }));
    expect(await screen.findByRole("dialog", { name: "Download manifest" })).toBeInTheDocument();
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
      expect(body.statuses).toEqual(manifestStatusList("toDeliver"));
      expect(body).toMatchObject(datePresetRange("today"));
    });
  });
});
