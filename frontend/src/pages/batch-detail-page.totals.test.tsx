import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { BatchDetailPage } from "./batch-detail-page";
import { isParcelRowComplete, normalizeManifestRow, parseParcelGrid } from "@/features/batches/detail/parcel-draft-rules";

const apiMock = vi.hoisted(() => vi.fn());
const apiRawMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock, apiRaw: apiRawMock }));
vi.mock("@/app/auth", () => ({ useAuth: () => ({ user: { id: "ops-1", role: "OPERATIONS_MANAGER" } }) }));

describe("BatchDetailPage settlement totals", () => {
  beforeEach(() => {
    localStorage.clear();
    apiMock.mockReset();
    apiRawMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches/batch-1") {
        return Promise.resolve({
          data: {
            id: "batch-1",
            hubId: "hub-1",
            label: "Shop 11.08.2026",
            advancePaid: 40000,
            advancePayments: [{ id: "advance-1", businessDate: "2026-08-11T00:00:00.000Z", postedAt: "2026-08-11T08:00:00.000Z", recordedBy: "Aye Aye", wallets: { cash: 10000, kbzPay: 20000, wavePay: 10000 } }],
            totalCod: 100000,
            remainingToOs: 60000,
            nextTrackingSequence: 1,
            shop: { name: "Shop One" },
            parcels: [],
          },
        });
      }
      if (path === "/master-data/locations/regions") {
        return Promise.resolve({
          data: [
            { id: "r-yangon", nameEn: "Yangon" },
            { id: "r-mandalay", nameEn: "Mandalay" },
          ],
        });
      }
      if (path === "/master-data/locations/townships") {
        return Promise.resolve({
          data: [
            {
              id: "t-hlaing",
              nameEn: "Hlaing",
              deliveryFee: 2500,
              district: {
                id: "d-west",
                nameEn: "West Yangon",
                regionStateId: "r-yangon",
                regionState: { id: "r-yangon", nameEn: "Yangon" },
              },
            },
            {
              id: "t-thingangyun",
              nameEn: "Thingangyun",
              deliveryFee: 2800,
              district: {
                id: "d-east",
                nameEn: "East Yangon",
                regionStateId: "r-yangon",
                regionState: { id: "r-yangon", nameEn: "Yangon" },
              },
            },
            {
              id: "t-chanayethazan",
              nameEn: "Chanayethazan",
              deliveryFee: 3000,
              district: {
                id: "d-mandalay",
                nameEn: "Mandalay",
                regionStateId: "r-mandalay",
                regionState: { id: "r-mandalay", nameEn: "Mandalay" },
              },
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
  });

  it("parses quoted CSV addresses and formatted MMK amounts as saveable parcel rows", () => {
    const [row] = parseParcelGrid('ORDER-1,Ma Su,"Road, between 30 and 50 feet",Yangon,West Yangon,Hlaing,,091234567,25,000 MMK');

    expect(row).toMatchObject({
      orderId: "ORDER-1",
      customerName: "Ma Su",
      address: "Road, between 30 and 50 feet",
      codAmount: "25000",
    });
    expect(isParcelRowComplete({ ...row!, townshipId: "t-hlaing" })).toBe(true);
  });

  it("normalizes numeric PDF COD values before grid validation", () => {
    const row = normalizeManifestRow({ customerName: "Customer", address: "Road", townshipId: "t-hlaing", codAmount: 125000 });
    expect(row.codAmount).toBe("125000");
    expect(isParcelRowComplete(row)).toBe(true);
  });

  it("renders totalCod and remainingToOs from the batch detail response", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/batches/batch-1"]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/batches/:id" element={<BatchDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("100,000 MMK")).toBeInTheDocument());
    expect(screen.getByText("60,000 MMK")).toBeInTheDocument();
    expect(screen.getByText(/Remaining to OS/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Advance payment breakdown" })).toHaveTextContent("Aye Aye");
    expect(screen.getByRole("region", { name: "Advance payment breakdown" })).toHaveTextContent("20,000 MMK");
  });

  it("reviews the deferred credit calculation before finalizing parcel entry", async () => {
    let finalized = false;
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/operations/batches/finalize-batch/finalize" && options?.method === "POST") {
        finalized = true;
        return Promise.resolve({ data: { finalizedAt: "2026-09-20T12:00:00.000Z" } });
      }
      if (path === "/operations/batches/finalize-batch") return Promise.resolve({ data: {
        id: "finalize-batch", hubId: "hub-1", label: "Shop 11.08.2026", automaticAccounting: true,
        advancePaid: 40000, totalCod: 100000, remainingToOs: 45000, availableOsCredit: 20000,
        expectedOsCreditApplied: 15000, expectedOutstanding: 45000, expectedCarryForwardCredit: 0,
        finalizedAt: finalized ? "2026-09-20T12:00:00.000Z" : null, nextTrackingSequence: 2,
        shop: { name: "Shop One" }, parcels: [{ id: "parcel-1", trackingNumber: "LTY-1", customerName: "Ma Su", address: "Road", status: "CREATED", codAmount: 100000 }],
      } });
      return original(path, options);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/finalize-batch"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);

    const finalizeButton = await screen.findByRole("button", { name: "Finalize batch" });
    await waitFor(() => expect(finalizeButton).toBeEnabled());
    fireEvent.click(finalizeButton);
    const dialog = screen.getByRole("dialog", { name: "Finalize batch" });
    expect(dialog).toHaveTextContent("100,000 mmk");
    expect(dialog).toHaveTextContent("40,000 mmk");
    expect(dialog).toHaveTextContent("20,000 mmk");
    expect(dialog).toHaveTextContent("15,000 mmk");
    expect(dialog).toHaveTextContent("45,000 mmk");
    expect(dialog).toHaveTextContent("Existing credit remaining");
    fireEvent.click(screen.getByRole("button", { name: "Finalize and create OS payable" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/batches/finalize-batch/finalize", { method: "POST" }));
    expect(await screen.findByText(/Parcel entry is finalized/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add parcel" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Upload manifest PDF")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit parcel/ })).not.toBeInTheDocument();
  });

  it("lists region townships across districts and fills district without changing region", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/batches/batch-1"]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/batches/:id" element={<BatchDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const region = await screen.findByLabelText("Region / State 1");
    await waitFor(() => expect(region.querySelector('option[value="r-yangon"]')).not.toBeNull());
    fireEvent.change(region, { target: { value: "r-yangon" } });
    const township = await screen.findByLabelText("Township 1");
    await waitFor(() => expect(township).not.toBeDisabled());
    expect(township.querySelector('option[value="t-hlaing"]')).not.toBeNull();
    expect(township.querySelector('option[value="t-thingangyun"]')).not.toBeNull();
    expect(township.querySelector('option[value="t-chanayethazan"]')).toBeNull();
    expect(township.querySelector('option[value="t-hlaing"]')).toHaveTextContent("Hlaing");
    expect(township.querySelector('option[value="t-hlaing"]')?.textContent).not.toContain("West Yangon");
    fireEvent.change(township, { target: { value: "t-thingangyun" } });
    expect(screen.getByLabelText("Region / State 1")).toHaveValue("r-yangon");
    expect(screen.getByLabelText("District 1")).toHaveTextContent("East Yangon");
    expect(screen.getByText("2,800 MMK")).toBeInTheDocument();
  });

  it("clears district township and zone when region changes", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/batches/batch-1"]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/batches/:id" element={<BatchDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const region = await screen.findByLabelText("Region / State 1");
    await waitFor(() => expect(region.querySelector('option[value="r-yangon"]')).not.toBeNull());
    fireEvent.change(region, { target: { value: "r-yangon" } });
    const township = await screen.findByLabelText("Township 1");
    await waitFor(() => expect(township).not.toBeDisabled());
    fireEvent.change(township, { target: { value: "t-hlaing" } });
    expect(screen.getByLabelText("District 1")).toHaveTextContent("West Yangon");

    fireEvent.change(region, { target: { value: "r-mandalay" } });
    expect(screen.getByLabelText("Region / State 1")).toHaveValue("r-mandalay");
    expect(screen.getByLabelText("District 1")).toHaveTextContent("—");
    expect(screen.getByLabelText("Township 1")).toHaveValue("");
    expect(screen.getByLabelText("Zone 1")).toHaveValue("");
    expect(screen.getByLabelText("Zone 1")).toBeDisabled();
  });

  it("shows bordered inputs in the add-parcel modal instead of spreadsheet cells", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/batches/batch-1"]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/batches/:id" element={<BatchDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("100,000 MMK")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Form" }));
    fireEvent.click(screen.getByRole("button", { name: "Add parcel" }));
    const customer = screen.getByLabelText("Customer");
    expect(customer).toHaveClass("border-slate-200");
    expect(customer).not.toHaveClass("border-0");
  });

  it("scopes zone options to the batch hub", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/batches/batch-1"]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/batches/:id" element={<BatchDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const region = await screen.findByLabelText("Region / State 1");
    await waitFor(() => expect(region.querySelector('option[value="r-yangon"]')).not.toBeNull());
    fireEvent.change(region, { target: { value: "r-yangon" } });
    const township = screen.getByLabelText("Township 1");
    await waitFor(() => expect(township.querySelector('option[value="t-hlaing"]')).not.toBeNull());
    fireEvent.change(township, { target: { value: "t-hlaing" } });

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/master-data/locations/zones?townshipId=t-hlaing&hubId=hub-1"),
    );
  });

  it("leaves failed parcel drafts editable, reports the error, and lets the server allocate tracking numbers", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches/batch-1/parcels/bulk") return Promise.reject(new Error("Zone is outside the batch hub"));
      if (path === "/operations/batches/batch-1") return Promise.resolve({ data: {
        id: "batch-1", hubId: "hub-1", label: "Shop 11.08.2026", advancePaid: 40000,
        totalCod: 100000, remainingToOs: 60000, nextTrackingSequence: 1, shop: { name: "Shop One" }, parcels: [],
      } });
      if (path === "/master-data/locations/regions") return Promise.resolve({ data: [{ id: "r-yangon", nameEn: "Yangon" }] });
      if (path === "/master-data/locations/townships") return Promise.resolve({ data: [{
        id: "t-hlaing", nameEn: "Hlaing", deliveryFee: 2500,
        district: { id: "d-west", nameEn: "West Yangon", regionStateId: "r-yangon", regionState: { id: "r-yangon", nameEn: "Yangon" } },
      }] });
      return Promise.resolve({ data: [] });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/batches/batch-1"]}>
        <QueryClientProvider client={client}>
          <Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("Customer 1"), { target: { value: "Ma Su" } });
    fireEvent.change(screen.getByLabelText("Address 1"), { target: { value: "Hlaing" } });
    fireEvent.change(screen.getByLabelText("Region / State 1"), { target: { value: "r-yangon" } });
    fireEvent.change(screen.getByLabelText("Township 1"), { target: { value: "t-hlaing" } });
    fireEvent.change(screen.getByLabelText("COD 1"), { target: { value: "25000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save parcels (1)" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Zone is outside the batch hub");
    expect(screen.getByLabelText("Customer 1")).toHaveValue("Ma Su");
    expect(screen.getByLabelText("COD 1")).toHaveValue("25000");
    const bulkCall = apiMock.mock.calls.find(([path]) => path === "/operations/batches/batch-1/parcels/bulk");
    expect(JSON.parse(bulkCall?.[1]?.body as string).parcels[0]).not.toHaveProperty("trackingNumber");
  });

  it("saves complete rows while retaining an incomplete spreadsheet draft", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/batches/batch-1"]}>
        <QueryClientProvider client={client}>
          <Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("Customer 1"), { target: { value: "Ma Su" } });
    fireEvent.change(screen.getByLabelText("Address 1"), { target: { value: "Hlaing" } });
    fireEvent.change(screen.getByLabelText("Region / State 1"), { target: { value: "r-yangon" } });
    fireEvent.change(screen.getByLabelText("Township 1"), { target: { value: "t-hlaing" } });
    fireEvent.change(screen.getByLabelText("COD 1"), { target: { value: "25,000" } });
    fireEvent.change(screen.getByLabelText("Customer 2"), { target: { value: "unfinished" } });

    const saveButton = screen.getByRole("button", { name: "Save parcels (1)" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/operations/batches/batch-1/parcels/bulk",
      expect.objectContaining({ method: "POST" }),
    ));
    const call = apiMock.mock.calls.find(([path]) => path === "/operations/batches/batch-1/parcels/bulk");
    expect(JSON.parse(call?.[1]?.body as string).parcels).toEqual([
      expect.objectContaining({ customerName: "Ma Su", codAmount: 25000 }),
    ]);
    await waitFor(() => expect(screen.getByLabelText("Customer 2")).toHaveValue("unfinished"));
  });

  it("restores drafts after refresh and preserves edits made while a save is pending", async () => {
    localStorage.setItem("lotaya-parcel-draft:batch-1", JSON.stringify([
      { customerName: "Restored", address: "Road", townshipId: "t-hlaing", codAmount: 25000 },
    ]));
    const original = apiMock.getMockImplementation()!;
    let completeSave!: (value: unknown) => void;
    apiMock.mockImplementation((path: string, options: unknown) => path.endsWith("/parcels/bulk")
      ? new Promise((resolve) => { completeSave = resolve; })
      : original(path, options));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/batch-1"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);
    expect(await screen.findByLabelText("Customer 1")).toHaveValue("Restored");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save parcels (1)" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save parcels (1)" }));
    await waitFor(() => expect(completeSave).toBeDefined());
    fireEvent.change(screen.getByLabelText("Customer 1"), { target: { value: "Edited while saving" } });
    completeSave({ data: [] });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/saved/i));
    expect(screen.getByLabelText("Customer 1")).toHaveValue("Edited while saving");
    expect(localStorage.getItem("lotaya-parcel-draft:batch-1")).toContain("Edited while saving");
  });

  it("keeps existing drafts after a failed manifest upload and applies a successful retry only after review", async () => {
    localStorage.setItem("lotaya-parcel-draft:batch-1", JSON.stringify([
      { customerName: "Existing draft", address: "Road", townshipId: "t-hlaing", codAmount: 25000 },
    ]));
    apiRawMock
      .mockRejectedValueOnce(new Error("Could not read PDF"))
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: {
        rows: [{ customerName: "Imported draft", address: "Street", townshipId: "t-hlaing", codAmount: 12000, sourcePage: 1, confidence: 1, warnings: [] }],
        pageCount: 1, truncated: false, extraction: "LOCAL_TEXT", saved: false,
      } }) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/batch-1"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);

    expect(await screen.findByLabelText("Customer 1")).toHaveValue("Existing draft");
    const upload = screen.getByLabelText("Upload OS manifest PDF");
    const file = new File(["%PDF-1.4"], "manifest.pdf", { type: "application/pdf" });
    fireEvent.change(upload, { target: { files: [file] } });
    expect(await screen.findByText("Could not read PDF")).toBeInTheDocument();
    expect(screen.getByLabelText("Customer 1")).toHaveValue("Existing draft");

    fireEvent.change(upload, { target: { files: [file] } });
    expect(await screen.findByText("Imported draft")).toBeInTheDocument();
    expect(screen.getByLabelText("Customer 1")).toHaveValue("Existing draft");
    expect(screen.queryByLabelText("Customer 2")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Use as editable draft" }));
    expect(await screen.findByLabelText("Customer 2")).toHaveValue("Imported draft");
    expect(localStorage.getItem("lotaya-parcel-draft:batch-1")).toContain("Existing draft");
    expect(localStorage.getItem("lotaya-parcel-draft:batch-1")).toContain("Imported draft");
    expect(apiRawMock).toHaveBeenCalledTimes(2);
  });

  it("fills only safe PDF locations in bulk and preserves the PDF address for conflicts", async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, options: { body?: string }) => path.endsWith("/location-suggestions")
      ? Promise.resolve({ data: { rows: [
        { index: 0, kind: "SAFE", candidates: [{ customerName: "First", address: "PDF road", townshipId: "t-hlaing", township: "Hlaing", districtId: "d-west", district: "West Yangon", regionStateId: "r-yangon", regionState: "Yangon", lastUsedAt: "2026-10-01T00:00:00.000Z", source: "PHONE" }] },
        { index: 1, kind: "CONFLICT", candidates: [{ customerName: "Second", address: "Old road", townshipId: "t-thingangyun", township: "Thingangyun", districtId: "d-east", district: "East Yangon", regionStateId: "r-yangon", regionState: "Yangon", lastUsedAt: "2026-10-01T00:00:00.000Z", source: "PHONE" }] },
      ] } }) : original(path, options));
    apiRawMock.mockResolvedValue({ json: async () => ({ success: true, data: { rows: [
      { customerName: "First", customerPhone: "09111111111", address: "PDF road", codAmount: 1000, sourcePage: 1, confidence: 1, warnings: [] },
      { customerName: "Second", customerPhone: "09222222222", address: "New PDF road", codAmount: 2000, sourcePage: 1, confidence: 1, warnings: [] },
    ], pageCount: 1, truncated: false, extraction: "LOCAL_TEXT", saved: false } }) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/batch-1"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);
    const upload = await screen.findByLabelText("Upload OS manifest PDF");
    fireEvent.change(upload, { target: { files: [new File(["%PDF-1.4"], "manifest.pdf", { type: "application/pdf" })] } });
    const bulk = await screen.findByRole("button", { name: "Fill 1 matching locations" });
    fireEvent.click(bulk);
    fireEvent.click(screen.getByRole("button", { name: "Use as editable draft" }));
    expect(await screen.findByLabelText("Address 1")).toHaveValue("PDF road");
    expect(screen.getByLabelText("Township 1")).toHaveValue("t-hlaing");
    expect(screen.getByLabelText("Address 2")).toHaveValue("New PDF road");
    expect(screen.getByLabelText("Township 2")).toHaveValue("");
  });

  it("offers a saved customer and location after entering a phone in the manual form", async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, options: { body?: string }) => path.endsWith("/location-suggestions")
      ? Promise.resolve({ data: { rows: [{ index: 0, kind: "SAFE", candidates: [{ customerName: "Ma Su", address: "Saved road", townshipId: "t-hlaing", township: "Hlaing", districtId: "d-west", district: "West Yangon", regionStateId: "r-yangon", regionState: "Yangon", lastUsedAt: "2026-10-01T00:00:00.000Z", source: "PHONE" }] }] } }) : original(path, options));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/batch-1"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Form" }));
    fireEvent.click(screen.getByRole("button", { name: "Add parcel" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Customer phone").compareDocumentPosition(within(dialog).getByLabelText("Customer")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Customer phone"), { target: { value: "09123456789" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Use this location" }));
    expect(within(dialog).getByLabelText("Customer")).toHaveValue("Ma Su");
    expect(within(dialog).getByLabelText("Address")).toHaveValue("Saved road");
    expect(within(dialog).getByLabelText("Township")).toHaveValue("t-hlaing");
    fireEvent.change(within(dialog).getByLabelText("COD"), { target: { value: "1000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.change(within(dialog).getByLabelText("Customer phone"), { target: { value: "09123456789" } });
    expect(await within(dialog).findByRole("button", { name: "Use this location" })).toBeInTheDocument();
  });

  it("shows the saved customer beside a phone entered in the spreadsheet", async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, options: { body?: string }) => path.endsWith("/location-suggestions")
      ? Promise.resolve({ data: { rows: [{ index: 0, kind: "SAFE", candidates: [{ customerName: "Ma Su", address: "Saved road", townshipId: "t-hlaing", township: "Hlaing", districtId: "d-west", district: "West Yangon", regionStateId: "r-yangon", regionState: "Yangon", lastUsedAt: "2026-10-01T00:00:00.000Z", source: "PHONE" }] }] } }) : original(path, options));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/batch-1"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);
    const phone = await screen.findByLabelText("Customer phone 1");
    const customer = screen.getByLabelText("Customer 1");
    expect(phone.closest("td")?.cellIndex).toBeLessThan(customer.closest("td")!.cellIndex);
    fireEvent.focus(phone);
    fireEvent.change(phone, { target: { value: "09123456789" } });
    fireEvent.click(await screen.findByRole("button", { name: "Use this location" }));
    expect(customer).toHaveValue("Ma Su");
    expect(screen.getByLabelText("Address 1")).toHaveValue("Saved road");
    expect(screen.getByLabelText("Township 1")).toHaveValue("t-hlaing");
  });

  it("explains when a spreadsheet phone has no saved location", async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, options: { body?: string }) => path.endsWith("/location-suggestions")
      ? Promise.resolve({ data: { rows: [{ index: 0, kind: "NONE", candidates: [] }] } }) : original(path, options));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/batch-1"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);
    const phone = await screen.findByLabelText("Customer phone 1");
    fireEvent.focus(phone);
    fireEvent.change(phone, { target: { value: "09123456789" } });
    expect(await screen.findByText("No saved location found")).toBeInTheDocument();
  });

  it("explains when a manual form phone has no saved location", async () => {
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, options: { body?: string }) => path.endsWith("/location-suggestions")
      ? Promise.resolve({ data: { rows: [{ index: 0, kind: "NONE", candidates: [] }] } }) : original(path, options));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter initialEntries={["/batches/batch-1"]}><QueryClientProvider client={client}><Routes><Route path="/batches/:id" element={<BatchDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Form" }));
    fireEvent.click(screen.getByRole("button", { name: "Add parcel" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Customer phone"), { target: { value: "09123456789" } });
    expect(await within(dialog).findByText("No saved location found")).toBeInTheDocument();
  });
});
