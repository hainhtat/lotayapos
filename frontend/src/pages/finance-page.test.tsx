import {fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
import "@/i18n";
import {FinancePage} from "./finance-page";

const apiMock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({api:apiMock}));
const ledger=[
  {account:"WALLET_CASH",debit:125000,credit:25000,balance:100000},
  {account:"WALLET_KBZ_PAY",debit:50000,credit:10000,balance:40000},
  {account:"WALLET_WAVE_PAY",debit:75000,credit:15000,balance:60000},
];
const ledgerReport={accounts:ledger,entries:[],totalDebit:250000,totalCredit:50000,difference:200000,balanced:false};
const batch={id:"batch-1",label:"Shop 11.08.2026",pickupDate:"2026-08-11T00:00:00.000Z",shop:{name:"Shop"},parcels:[{status:"CREATED"},{status:"CREATED"}]};
function renderPage(initialEntry="/finance"){const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<MemoryRouter initialEntries={[initialEntry]}><QueryClientProvider client={queryClient}><FinancePage/></QueryClientProvider></MemoryRouter>)}

describe("FinancePage",()=>{
  beforeEach(()=>{apiMock.mockReset();apiMock.mockImplementation((path:string)=>{
    if(path==="/operations/batches")return Promise.resolve({data:[batch]});
    if(path==="/finance/expense-categories")return Promise.resolve({data:[{id:"fuel",code:"FUEL",nameEn:"Fuel",nameMy:"ဆီဖိုး",active:true}]});
    if(path.startsWith("/finance/expenses?"))return Promise.resolve({data:[]});
    return Promise.resolve({data:ledgerReport});
  })});

  it("renders wallet cards from ledger balances",async()=>{
    renderPage();
    await waitFor(()=>expect(within(screen.getByText("Cash wallet").parentElement!).getByText("100,000 MMK")).toBeInTheDocument());
    expect(screen.getAllByText("40,000 MMK")).toHaveLength(2);
    expect(screen.getAllByText("60,000 MMK")).toHaveLength(2);
  });

  it("requires review and confirmation before posting pickup advances",async()=>{
    apiMock.mockImplementation((path:string,init?:RequestInit)=>{
      if(path==="/operations/batches")return Promise.resolve({data:[batch]});
      if(path==="/operations/batches/batch-1/pickup-advances"&&init)return Promise.resolve({data:{batchId:"batch-1",postedCount:2,alreadyPosted:false}});
      if(path==="/finance/expense-categories")return Promise.resolve({data:[]});
      if(path.startsWith("/finance/expenses?"))return Promise.resolve({data:[]});
      return Promise.resolve({data:ledgerReport});
    });
    const user=userEvent.setup();
    renderPage();
    await screen.findByRole("option",{name:/Shop 11\.08\.2026/});
    await user.selectOptions(screen.getByLabelText("Batch"),"batch-1");
    await user.selectOptions(screen.getByLabelText("Funding wallet"),"KBZ_PAY");
    await waitFor(()=>expect(screen.getByRole("button",{name:"Review posting"})).toBeEnabled());
    await user.click(screen.getByRole("button",{name:"Review posting"}));
    const dialog=screen.getByRole("dialog");
    expect(within(dialog).getByText("Shop 11.08.2026")).toBeInTheDocument();
    expect(within(dialog).getByText("KBZ PAY")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button",{name:"Confirm and post"}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith("/operations/batches/batch-1/pickup-advances",{method:"POST",body:JSON.stringify({fundingWallet:"KBZ_PAY"})}));
    expect(await screen.findByRole("status")).toHaveTextContent("2 parcels");
  });

  it("applies ledger reconciliation filters",async()=>{
    renderPage();
    fireEvent.click(screen.getByRole("button",{name:/view reconciliation/i}));
    fireEvent.change(screen.getByLabelText("From date"),{target:{value:"2026-08-01"}});
    fireEvent.change(screen.getByLabelText("Account"),{target:{value:"WALLET_CASH"}});
    fireEvent.click(screen.getByRole("button",{name:"Apply filters"}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith("/finance/ledger?from=2026-08-01&account=WALLET_CASH"));
  });

  it("records a categorized wallet expense with integer MMK",async()=>{
    apiMock.mockImplementation((path:string,init?:RequestInit)=>{
      if(path==="/operations/batches")return Promise.resolve({data:[batch]});
      if(path==="/finance/expense-categories")return Promise.resolve({data:[{id:"fuel",code:"FUEL",nameEn:"Fuel",nameMy:"ဆီဖိုး",active:true}]});
      if(path.startsWith("/finance/expenses?")&&!init)return Promise.resolve({data:[]});
      if(path==="/finance/expenses"&&init)return Promise.resolve({data:{id:"expense-1"}});
      return Promise.resolve({data:ledgerReport});
    });
    const user=userEvent.setup();
    renderPage();
    await screen.findByRole("option",{name:"Fuel"});
    await user.selectOptions(screen.getByLabelText("Expense category"),"fuel");
    await user.selectOptions(screen.getByLabelText("Expense wallet"),"WAVE_PAY");
    await user.type(screen.getByLabelText("Amount"),"12500");
    await user.type(screen.getByLabelText("Description"),"Rider fuel");
    await user.click(screen.getByRole("button",{name:"Record expense"}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith("/finance/expenses",expect.objectContaining({
      method:"POST",
      body:expect.stringContaining('"categoryId":"fuel","wallet":"WAVE_PAY","amount":12500,"description":"Rider fuel"'),
    })));
  });

  it("shows rider outstanding and records an auditable manual payment", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/operations/batches") return Promise.resolve({ data: [] });
      if (path === "/finance/expense-categories") return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/expenses?")) return Promise.resolve({ data: [] });
      if (path === "/master-data/shops") return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/os-settlement-drafts")) return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/rider-outstanding?")) return Promise.resolve({ data: [{
        rider: { id: "rider-1", name: "Aung Rider", username: "aung" },
        parcelCount: 3,
        cod: 30000,
        fees: 6000,
        commission: 2400,
        salaryDeduction: 0,
        expectedAmount: 33600,
        declaredAmount: null,
        paidAmount: 0,
        outstandingAmount: 33600,
        settlementStatus: null,
      }] });
      if (path === "/finance/rider-settlements" && init) return Promise.resolve({ data: { id: "settlement-1" } });
      return Promise.resolve({ data: ledgerReport });
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("tab", { name: "OS & riders" }));

    expect(await screen.findByText("Aung Rider")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    const dialog = screen.getByText("Record rider payment").closest("form")!;
    await user.type(within(dialog).getByLabelText("Reason"), "Counter payment");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/finance/rider-settlements", expect.anything()));
    const paymentCall = apiMock.mock.calls.find(([path]) => path === "/finance/rider-settlements")!;
    expect(paymentCall[1].method).toBe("POST");
    expect(JSON.parse(paymentCall[1].body)).toEqual({
      riderId: "rider-1",
      businessDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      cash: 33600,
      kbzPay: 0,
      wavePay: 0,
      manualEntryReason: "Counter payment",
      varianceReason: "Counter payment",
      idempotencyKey: expect.stringMatching(/^rider-receipt-/),
    });
  });

  it("keeps partial rider receivables payable and shows accumulated wallet receipts", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/finance/rider-outstanding?")) return Promise.resolve({ data: [{
        rider: { id: "rider-1", name: "Aung Rider" }, parcelCount: 3, cod: 30000, fees: 6000,
        commission: 2400, salaryDeduction: 0, expectedAmount: 33600, declaredAmount: 10000,
        paidAmount: 10000, outstandingAmount: 23600, settlementStatus: "PARTIAL",
        receipts: [{ id: "receipt-1", lines: [{ wallet: "KBZ_PAY", amount: 6000 }, { wallet: "CASH", amount: 4000 }] }],
      }] });
      if (path === "/operations/batches" || path === "/finance/expense-categories" || path.startsWith("/finance/expenses?") || path === "/master-data/shops" || path.startsWith("/finance/os-settlement")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: ledgerReport });
    });
    renderPage("/finance?tab=settlements&businessDate=2026-08-12#rider-outstanding");
    expect(await screen.findByText("Received: Cash 4,000 MMK · KBZ 6,000 MMK · Wave 0 MMK")).toBeInTheDocument();
    expect(screen.getByText("1 receipt(s) posted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record another payment" })).toBeEnabled();
    expect(within(screen.getByText("Rider outstanding payments").closest("section")!).getByLabelText("Business date")).toHaveValue("2026-08-12");
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/finance/rider-outstanding?businessDate=2026-08-12"));
  });

  it("uses the cumulative recognized receivable as the expected total", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/finance/rider-outstanding?")) return Promise.resolve({ data: [{
        rider: { id: "rider-1", name: "Aung Rider" }, parcelCount: 1, cod: 52000, fees: 4000,
        commission: 2000, salaryDeduction: 0, expectedAmount: 56000, recognizedAmount: 54000,
        declaredAmount: null, paidAmount: 10000, outstandingAmount: 44000, settlementStatus: "PARTIAL",
        receipts: [{ id: "one", lines: [{ wallet: "CASH", amount: 4000 }, { wallet: "CASH", amount: 6000 }] }],
      }] });
      if (path === "/operations/batches" || path === "/finance/expense-categories" || path.startsWith("/finance/expenses?") || path === "/master-data/shops" || path.startsWith("/finance/os-settlement")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: ledgerReport });
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("tab", { name: "OS & riders" }));
    const rider = await screen.findByText("Aung Rider");
    expect(rider.closest("tr")).toHaveTextContent("54,000 MMK");
    expect(rider.closest("tr")).toHaveTextContent("Received: Cash 10,000 MMK");
    expect(rider.closest("tr")).toHaveTextContent("44,000 MMK");
  });

  it("renders previous batch settlement components and filters by online shop", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches") return Promise.resolve({ data: [] });
      if (path === "/finance/expense-categories") return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/expenses?")) return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/rider-outstanding?")) return Promise.resolve({ data: [] });
      if (path === "/master-data/shops") return Promise.resolve({ data: [{ id: "shop-1", name: "SNMD" }] });
      if (path.startsWith("/finance/os-settlements")) return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/os-settlement-drafts")) return Promise.resolve({ data: [{
        id: "batch-old", label: "SNMD old batch", pickupDate: "2026-08-10T00:00:00.000Z",
        shop: { id: "shop-1", name: "SNMD" }, parcelCount: 2, advancePaid: 20000,
        collectedCod: 18000, deliveryFees: 4000, returnedAdvance: 2000, unresolvedCount: 1,
        eligible: false, ineligibleReason: "unresolved", settled: false,
      }] });
      return Promise.resolve({ data: ledgerReport });
    });
    const user = userEvent.setup();
    renderPage("/finance?tab=settlements");

    await screen.findByRole("option", { name: "SNMD" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Online shop" }), "shop-1");
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/finance/os-settlement-drafts?shopId=shop-1"));
    expect(await screen.findByText("SNMD old batch")).toBeInTheDocument();
    expect(screen.getByText("18,000 MMK")).toBeInTheDocument();
  });

  it("previews selected completed batches and posts the reviewed immutable OS settlement", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/operations/batches") return Promise.resolve({ data: [] });
      if (path === "/finance/expense-categories" || path.startsWith("/finance/expenses?")) return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/rider-outstanding?")) return Promise.resolve({ data: [] });
      if (path === "/master-data/shops") return Promise.resolve({ data: [{ id: "shop-1", name: "SNMD" }] });
      if (path.startsWith("/finance/os-settlements?") || path === "/finance/os-settlements") {
        if (init) return Promise.resolve({ data: { id: "os-settlement-1" } });
        return Promise.resolve({ data: [] });
      }
      if (path.startsWith("/finance/os-settlement-drafts")) return Promise.resolve({ data: [{
        id: "batch-1", label: "June batch", pickupDate: "2026-06-01", shop: { id: "shop-1", name: "SNMD" },
        hubId: "hub-1", hub: { id: "hub-1", name: "Main Hub" }, parcelCount: 2, advancePaid: 15000,
        collectedCod: 30000, deliveryFees: 4000, returnedAdvance: 1000, unresolvedCount: 0, eligible: true, settled: false,
      }] });
      if (path === "/finance/os-settlements/preview" && init) return Promise.resolve({ data: {
        shop: { id: "shop-1", name: "SNMD" }, hubId: "hub-1",
        batches: [{ batchId: "batch-1", label: "June batch", collectedCod: 30000, deliveryFees: 4000, returnedAdvance: 1000, advanceAmount: 15000 }],
        defaults: { grossCollectedCod: 30000, advanceDeduction: 15000, returnDeduction: 1000, deliveryFeeDeduction: 4000, adjustmentAmount: 0, netAmount: 10000 },
      } });
      return Promise.resolve({ data: ledgerReport });
    });
    const user = userEvent.setup();
    renderPage("/finance?tab=settlements");
    await screen.findByRole("option", { name: "SNMD" });
    await user.selectOptions(await screen.findByRole("combobox", { name: "Online shop" }), "shop-1");
    await user.click(await screen.findByRole("checkbox", { name: "Select June batch for settlement" }));
    await user.click(screen.getByRole("button", { name: "Review settlement" }));
    expect(await screen.findByRole("form", { name: "Review settlement" })).toHaveTextContent("10,000 MMK");
    await user.click(screen.getByRole("button", { name: "Post settlement" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/finance/os-settlements", expect.objectContaining({ method: "POST" })));
    const call = apiMock.mock.calls.find(([path, init]) => path === "/finance/os-settlements" && init)!;
    expect(JSON.parse(call[1].body)).toMatchObject({ shopId: "shop-1", hubId: "hub-1", batchIds: ["batch-1"], advanceDeduction: 15000, returnDeduction: 1000, deliveryFeeDeduction: 4000, adjustmentAmount: 0 });
  });

  it("marks under-collected batches as not selectable for OS settlement", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data/shops") return Promise.resolve({ data: [{ id: "shop-1", name: "SNMD" }] });
      if (path.startsWith("/finance/os-settlement-drafts")) return Promise.resolve({ data: [{
        id: "batch-1", label: "Over-advanced batch", pickupDate: "2026-08-11T00:00:00.000Z",
        shop: { id: "shop-1", name: "SNMD" }, hubId: "hub-1", hub: { id: "hub-1", name: "Sanchaung" },
        parcelCount: 1, advancePaid: 2000000, collectedCod: 512000, deliveryFees: 0, returnedAdvance: 0,
        unresolvedCount: 0, eligible: false, ineligibleReason: "underCollected", settled: false,
      }] });
      if (path.startsWith("/finance/os-settlements")) return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/rider-outstanding")) return Promise.resolve({ data: [] });
      if (path === "/operations/batches") return Promise.resolve({ data: [] });
      if (path === "/finance/expense-categories" || path.startsWith("/finance/expenses?")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: ledgerReport });
    });
    const user = userEvent.setup();
    renderPage("/finance?tab=settlements");
    await screen.findByRole("option", { name: "SNMD" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Online shop" }), "shop-1");
    expect(await screen.findByText("Under-collected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Over-advanced batch for settlement" })).toBeDisabled();
  });

  it("opens the settlements tab from the os-settlements deep-link hash", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches" || path === "/master-data/shops") return Promise.resolve({ data: [] });
      if (path === "/finance/expense-categories" || path.startsWith("/finance/expenses?")) return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/rider-outstanding") || path.startsWith("/finance/os-settlement")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: ledgerReport });
    });
    renderPage("/finance#os-settlements");
    expect(await screen.findByRole("tab", { name: "OS & riders" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Online-shop settlements" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Post pickup advances" })).not.toBeInTheDocument();
  });

  it("returns to Finance overview after a settlements deep-link hash", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches" || path === "/master-data/shops") return Promise.resolve({ data: [] });
      if (path === "/finance/expense-categories" || path.startsWith("/finance/expenses?")) return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/rider-outstanding") || path.startsWith("/finance/os-settlement")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: ledgerReport });
    });
    const user = userEvent.setup();
    renderPage("/finance#os-settlements");
    expect(await screen.findByRole("tab", { name: "OS & riders" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Finance overview" }));
    expect(await screen.findByRole("tab", { name: "Finance overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Post pickup advances" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Online-shop settlements" })).not.toBeInTheDocument();
  });

  it("retries settlement history without sending a hubId", async () => {
    let historyCalls = 0;
    apiMock.mockImplementation((path: string) => {
      if (path === "/operations/batches" || path === "/master-data/shops") return Promise.resolve({ data: [] });
      if (path === "/finance/expense-categories" || path.startsWith("/finance/expenses?")) return Promise.resolve({ data: [] });
      if (path.startsWith("/finance/rider-outstanding") || path.startsWith("/finance/os-settlement-drafts")) return Promise.resolve({ data: [] });
      if (path === "/finance/os-settlements" || path.startsWith("/finance/os-settlements?")) {
        historyCalls += 1;
        if (historyCalls === 1) return Promise.reject(new Error("offline"));
        return Promise.resolve({ data: [{
          id: "os-1",
          businessDate: "2026-08-12T00:00:00.000Z",
          status: "POSTED",
          netAmount: 9000,
          wallet: "CASH",
          shop: { id: "shop-1", name: "SNMD" },
          batches: [{ batchId: "batch-1" }],
        }] });
      }
      return Promise.resolve({ data: ledgerReport });
    });
    const user = userEvent.setup();
    renderPage("/finance?tab=settlements");
    expect(await screen.findByText("Settlement history could not be loaded.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("SNMD")).toBeInTheDocument();
    const historyGets = apiMock.mock.calls.filter(
      ([path, init]) => typeof path === "string" && path.startsWith("/finance/os-settlements") && !path.includes("/preview") && !init,
    );
    expect(historyGets.length).toBeGreaterThanOrEqual(2);
    expect(historyGets.every(([path]) => !String(path).includes("hubId="))).toBe(true);
  });
});
