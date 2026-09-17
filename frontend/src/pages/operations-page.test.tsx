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

  it("uses server queues for rescheduled and overdue parcels without hiding assigned overdue work", async () => {
    mockParcelList([]); apiMock.mockResolvedValue({data:[]}); renderPage();
    fireEvent.click(screen.getByRole("button", {name:"Rescheduled"}));
    await waitFor(() => expect(apiRawMock).toHaveBeenCalledWith(expect.stringMatching(/^\/parcels\?queue=rescheduled/)));
    fireEvent.click(screen.getByRole("button", {name:"3+ days in hand"}));
    await waitFor(() => expect(apiRawMock).toHaveBeenCalledWith(expect.stringMatching(/^\/parcels\?queue=overdue/)));
    const last = apiRawMock.mock.calls.filter(([path]) => path.startsWith("/parcels?")).at(-1)![0];
    expect(last).not.toContain("assignmentStatus");
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

  it("previews selected Return to OS parcels without posting a physical return", async () => {
    const parcel = { id: "return-1", trackingNumber: "TRK-RETURN", customerName: "Customer", address: "Address", status: "PENDING_RETURN", codAmount: 12000, batch: { label: "Batch", shop: { name: "Shop" } }, rider: null };
    mockParcelList([parcel]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") return Promise.resolve({ data: { shops: [], riders: [] } });
      if (path === "/operations/batches" || path === "/master-data/reason-codes") return Promise.resolve({ data: [] });
      if (path === "/operations/parcels/returns/preview") return Promise.resolve({ data: { parcelCount: 1, totalCod: 12000, parcels: [{ ...parcel, reasonCode: "CUSTOMER_CANCELLED" }] } });
      return Promise.resolve({ data: {} });
    });
    renderPage("/operations/dispatch?queue=return-to-os");
    await waitFor(() => expect(screen.getByText("TRK-RETURN")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select TRK-RETURN"));
    fireEvent.click(screen.getByRole("button", { name: "Generate OS return list" }));
    await waitFor(() => expect(screen.getByText("OS return list")).toBeInTheDocument());
    expect(apiMock).toHaveBeenCalledWith("/operations/parcels/returns/preview", expect.objectContaining({ method: "POST", body: JSON.stringify({ parcelIds: ["return-1"] }) }));
    expect(apiMock.mock.calls.some(([path]) => path === "/finance/os-returns/receive-bulk")).toBe(false);
  });

  it("records a delivered parcel as paid to OS and creates credit without a wallet", async () => {
    const parcel = { id: "parcel-paid", trackingNumber: "TRK-PAID", customerName: "Customer", address: "Address", status: "OUT_FOR_DELIVERY", codAmount: 25000, deliveryFee: 3000, batch: { label: "Batch", shop: { name: "Shop" } }, rider: { id: "rider-1", user: { name: "Rider" } } };
    mockParcelList([parcel]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") return Promise.resolve({ data: { shops: [], riders: [{ id: "rider-1", user: { name: "Rider" } }] } });
      if (path === "/operations/batches" || path === "/master-data/reason-codes") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("TRK-PAID")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Status TRK-PAID"), { target: { value: "DELIVERED" } });
    fireEvent.click(screen.getByRole("button", { name: /Delivered — paid to OS/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("OS credit created: 25,000 MMK")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("Include the full delivery fee in OS credit"));
    expect(within(dialog).getByText("OS credit created: 28,000 MMK")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm paid to OS" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/parcels/parcel-paid/status", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ status: "DELIVERED", collectionMode: "PAID_BY_OS", paidToOsIncludeDeliveryFee: true, note: "Ops correction" }),
    })));
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
    const decision = await screen.findByRole("dialog", { name: "What should happen next?" });
    expect(within(decision).getByRole("button", { name: "Return to OS" })).toBeDisabled();
    fireEvent.change(within(decision).getByLabelText("Next-step reason"), { target: { value: "Customer asked us to return it" } });
    fireEvent.click(within(decision).getByRole("button", { name: "Return to OS" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/parcels/parcel-1/failed-decision", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "RETURN_TO_OS", reason: "Customer asked us to return it" }) })));
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

  it("lazy-loads attributable parcel field history",async()=>{
    mockParcelList([{id:"audit-1",trackingNumber:"TRK-AUDIT",customerName:"Customer",address:"Address",status:"DELIVERED",codAmount:25000,deliveryFee:3000,batch:{label:"Batch",pickupDate:"2026-08-11T00:00:00.000Z",shop:{name:"Shop"}},rider:{id:"rider-1",user:{name:"Rider"}}}]);
    apiMock.mockImplementation((path:string)=>{
      if(path==="/parcels/audit-1/field-history")return Promise.resolve({data:[{id:"audit-row-1",createdAt:"2026-08-12T10:00:00.000Z",before:{customerName:"Old customer",deliveryFee:2500},after:{customerName:"New customer",deliveryFee:3000},actor:{id:"ops-1",name:"Ops Manager",role:"OPERATIONS_MANAGER"}}]});
      if(path==="/master-data")return Promise.resolve({data:{riders:[]}});
      return Promise.resolve({data:[]});
    });
    renderPage();await screen.findByText("TRK-AUDIT");
    expect(apiMock).not.toHaveBeenCalledWith("/parcels/audit-1/field-history");
    fireEvent.click(screen.getByRole("button",{name:"Field history TRK-AUDIT"}));
    const dialog=await screen.findByRole("dialog",{name:"Parcel field history"});
    expect(await within(dialog).findByText("Ops Manager")).toBeInTheDocument();
    expect(within(dialog).getByText("Old customer")).toBeInTheDocument();
    expect(within(dialog).getByText("New customer")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/parcels/audit-1/field-history");
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

  it("updates selected parcel statuses in one atomic bulk request", async () => {
    mockParcelList([
      { id: "parcel-1", trackingNumber: "TRK-1", customerName: "One", address: "A", status: "ASSIGNED", codAmount: 1000, batch: { label: "Batch", shop: { name: "Shop" } }, rider: { id: "rider-1", user: { name: "Rider" } } },
      { id: "parcel-2", trackingNumber: "TRK-2", customerName: "Two", address: "B", status: "PICKED_UP", codAmount: 2000, batch: { label: "Batch", shop: { name: "Shop" } }, rider: null },
    ]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") return Promise.resolve({ data: { riders: [{ id: "rider-1", user: { name: "Rider" } }] } });
      if (path === "/operations/batches" || path === "/master-data/reason-codes") return Promise.resolve({ data: [] });
      if (path === "/parcels/bulk-status") return Promise.resolve({ data: { updatedCount: 2, parcels: [] } });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await screen.findByText("TRK-1");
    fireEvent.click(screen.getByRole("checkbox", { name: /select TRK-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select TRK-2/i }));
    fireEvent.change(screen.getByLabelText("Apply status"), { target: { value: "OUT_FOR_DELIVERY" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply status" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/parcels/bulk-status", {
      method: "POST",
      body: JSON.stringify({ parcelIds: ["parcel-1", "parcel-2"], status: "OUT_FOR_DELIVERY", note: "Ops correction" }),
    }));
    expect(apiMock.mock.calls.filter(([path]) => /^\/parcels\/[^/]+\/status$/.test(path))).toHaveLength(0);
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

  it("shows correct rider action for delivered parcels", async () => {
    mockParcelList([
      {
        id: "parcel-delivered",
        trackingNumber: "TRK-DLV",
        customerName: "Customer",
        address: "Address",
        status: "DELIVERED",
        codAmount: 25000,
        batch: { label: "Batch", shop: { name: "Shop" } },
        rider: { id: "rider-1", user: { name: "Wrong Rider" } },
      },
    ]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") {
        return Promise.resolve({
          data: {
            riders: [
              { id: "rider-1", user: { name: "Wrong Rider" } },
              { id: "rider-2", user: { name: "Correct Rider" } },
            ],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("TRK-DLV")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Correct rider TRK-DLV/i })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /Assign & dispatch/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assign to rider")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /select TRK-1/i }));
    expect(screen.queryByText(/multi-edit/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Rider TRK-1")).toBeDisabled();
    expect(screen.getByLabelText("Status TRK-1")).toBeDisabled();
  });

  it("shows a date-change alert when a parcel failed with a reschedule reason", async () => {
    mockParcelList([
      {
        id: "parcel-reschedule",
        trackingNumber: "TRK-RESCHED",
        orderId: "OS-900",
        customerName: "Customer",
        address: "Address",
        status: "FAILED",
        reasonCode: "RESCHEDULE",
        codAmount: 25000,
        deliveryFee: 3000,
        batch: { label: "Batch", pickupDate: "2026-08-11T00:00:00.000Z", shop: { name: "Shop" } },
        rider: { id: "rider-1", user: { name: "Rider" } },
      },
    ]);
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") {
        return Promise.resolve({ data: { shops: [], riders: [{ id: "rider-1", user: { name: "Rider" } }] } });
      }
      if (path === "/operations/batches") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    renderPage();
    expect(await screen.findByText("Customer requested another delivery day")).toBeInTheDocument();
    expect(screen.getByText("TRK-RESCHED")).toBeInTheDocument();
    expect(screen.getByText("OS-900")).toBeInTheDocument();
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
