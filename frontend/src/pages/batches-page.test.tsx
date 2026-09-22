import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { BatchesPage } from "./batches-page";

const apiMock = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ role: "OPERATIONS_MANAGER" }));

vi.mock("@/lib/api", () => ({ api: apiMock, ApiError: class ApiError extends Error {} }));
vi.mock("@/app/auth",()=>({useAuth:()=>({user:{id:"ops-1",name:"Ops",email:"ops@example.com",role:authState.role}})}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/operations/batches"]}>
      <QueryClientProvider client={queryClient}>
        <BatchesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("BatchesPage", () => {
  beforeEach(() => {
    apiMock.mockReset();
    authState.role="OPERATIONS_MANAGER";
  });
  afterEach(async () => { await i18n.changeLanguage("en"); });

  it("filters overdue returns and records a reasoned extension",async()=>{
    apiMock.mockImplementation((path:string,init?:RequestInit)=>{
      if(path==="/finance/os-pending-returns")return Promise.resolve({data:{items:[
        {id:"parcel-1",trackingNumber:"TRK-OVERDUE",status:"PENDING_RETURN",returnDueAt:"2020-01-01T00:00:00.000Z",batch:{id:"batch-1",label:"B-1"},shop:{id:"shop-1",name:"SNMD"}},
        {id:"parcel-2",trackingNumber:"TRK-FAILED",status:"FAILED",returnDueAt:null,batch:{id:"batch-2",label:"B-2"},shop:{id:"shop-1",name:"SNMD"}},
      ],summary:{count:2,totalRecoverableAmount:0}}});
      if(path==="/operations/parcels/parcel-1/return-extension"&&init)return Promise.resolve({data:{}});
      return Promise.resolve({data:[]});
    });
    renderPage();
    expect(await screen.findByRole("heading",{name:"Operations return queue"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Overdue"}));
    expect(screen.getByText("TRK-OVERDUE")).toBeInTheDocument();expect(screen.queryByText("TRK-FAILED")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Extend"}));
    fireEvent.change(screen.getByLabelText("Additional days"),{target:{value:"3"}});
    fireEvent.change(screen.getByLabelText("Reason for extension"),{target:{value:"Customer requested more time"}});
    fireEvent.click(screen.getByRole("button",{name:"Save extension"}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith("/operations/parcels/parcel-1/return-extension",{method:"POST",body:JSON.stringify({days:3,reason:"Customer requested more time"})}));
  });

  it("does not request the restricted queue for dispatchers",async()=>{
    authState.role="DISPATCHER";apiMock.mockResolvedValue({data:[]});renderPage();
    expect((await screen.findAllByRole("heading",{name:"All batches"})).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading",{name:"Operations return queue"})).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("/finance/os-pending-returns");
  });

  it("shows batch remaining counts", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/operations/batches?")) {
        return Promise.resolve({
          data: [
            {
              id: "batch-1",
              label: "SNMD 11.08.2026",
              pickupDate: "2026-08-11T00:00:00.000Z",
              shop: { name: "SNMD" },
              parcels: [{ status: "ASSIGNED" }, { status: "DELIVERED" }, { status: "PENDING_RETURN" }],
            },
          ], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
        });
      }
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await screen.findByText("SNMD 11.08.2026");
    expect(screen.getAllByText("All batches").length).toBeGreaterThan(0);
    const row = screen.getByText("SNMD 11.08.2026").closest("tr");
    expect(row).toHaveTextContent("3");
    expect(row).toHaveTextContent("2");
  });

  it("creates an advance once with all three wallet amounts and an idempotency key", async () => {
    authState.role = "SUPERADMIN";
    apiMock.mockImplementation((path: string) => path === "/master-data" ? Promise.resolve({data:{shops:[{id:"shop",name:"Shop"}],hubs:[{id:"hub",name:"Hub"}]}}) : path === "/operations/batches" ? Promise.resolve({data:{id:"created"}}) : Promise.resolve({data:[]}));
    renderPage();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/master-data"));
    fireEvent.click(screen.getByRole("button", {name:"Create new batch"}));
    const dialog = await screen.findByRole("dialog", {name:"Create batch"});
    fireEvent.change(within(dialog).getByLabelText("Batch label"), {target:{value:"September pickup"}});
    fireEvent.change(within(dialog).getByLabelText("Cash"), {target:{value:"100"}});
    fireEvent.change(within(dialog).getByLabelText("KBZ Pay"), {target:{value:"200"}});
    fireEvent.change(within(dialog).getByLabelText("Wave Pay"), {target:{value:"300"}});
    await waitFor(() => expect(within(dialog).getByRole("button", {name:"Save and add parcels"})).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", {name:"Save and add parcels"}));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/batches", expect.objectContaining({method:"POST"})));
    const body = JSON.parse(apiMock.mock.calls.find(([path]) => path === "/operations/batches")![1].body);
    expect(body).toMatchObject({advancePaid:600, wallets:{cash:100,kbzPay:200,wavePay:300}, shopId:"shop",hubId:"hub"});
    expect(body.idempotencyKey).toMatch(/^batch-/);
  });

  it("lets operations managers enter the pickup advance split when creating a batch", async () => {
    authState.role = "OPERATIONS_MANAGER";
    apiMock.mockImplementation((path: string) => path === "/master-data"
      ? Promise.resolve({data:{shops:[{id:"shop",name:"Shop"}],hubs:[{id:"hub",name:"Hub"}]}})
      : path === "/operations/batches" ? Promise.resolve({data:{id:"created"}}) : Promise.resolve({data:[]}));
    renderPage();

    fireEvent.click(await screen.findByRole("button", {name:"Create new batch"}));
    const dialog = await screen.findByRole("dialog", {name:"Create batch"});
    fireEvent.change(within(dialog).getByLabelText("Batch label"), {target:{value:"Ops pickup"}});
    fireEvent.change(within(dialog).getByLabelText("Cash"), {target:{value:"50000"}});
    fireEvent.change(within(dialog).getByLabelText("KBZ Pay"), {target:{value:"25000"}});
    await waitFor(() => expect(within(dialog).getByRole("button", {name:"Save and add parcels"})).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", {name:"Save and add parcels"}));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/batches", expect.objectContaining({method:"POST"})));
    const body = JSON.parse(apiMock.mock.calls.find(([path]) => path === "/operations/batches")![1].body);
    expect(body).toMatchObject({advancePaid:75000, wallets:{cash:50000,kbzPay:25000,wavePay:0}});
  });

  it("does not apply OS credit while creating the batch", async () => {
    authState.role = "OPERATIONS_MANAGER";
    apiMock.mockImplementation((path: string) => path === "/master-data"
      ? Promise.resolve({data:{shops:[{id:"shop",name:"Shop"}],hubs:[{id:"hub",name:"Hub"}]}})
      : path === "/operations/batches" ? Promise.resolve({data:{id:"created"}}) : Promise.resolve({data:[]}));
    renderPage();

    fireEvent.click(await screen.findByRole("button", {name:"Create new batch"}));
    const dialog = await screen.findByRole("dialog", {name:"Create batch"});
    fireEvent.change(within(dialog).getByLabelText("Batch label"), {target:{value:"Credit-funded pickup"}});
    await waitFor(() => expect(within(dialog).getByRole("button", {name:"Save and add parcels"})).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", {name:"Save and add parcels"}));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/batches", expect.objectContaining({method:"POST"})));
    const body = JSON.parse(apiMock.mock.calls.find(([path]) => path === "/operations/batches")![1].body);
    expect(body).toMatchObject({advancePaid:0, wallets:{cash:0,kbzPay:0,wavePay:0}});
    expect(apiMock).not.toHaveBeenCalledWith(expect.stringContaining("/finance/os-accounts"));
  });

  it("derives the total advance from the wallet amounts without a requested-total field", async () => {
    authState.role = "OPERATIONS_MANAGER";
    apiMock.mockImplementation((path: string) => path === "/master-data"
      ? Promise.resolve({data:{shops:[{id:"shop",name:"Shop"}],hubs:[{id:"hub",name:"Hub"}]}})
      : path === "/operations/batches" ? Promise.resolve({data:{id:"created"}}) : Promise.resolve({data:[]}));
    renderPage();

    fireEvent.click(await screen.findByRole("button", {name:"Create new batch"}));
    const dialog = await screen.findByRole("dialog", {name:"Create batch"});
    fireEvent.change(within(dialog).getByLabelText("Batch label"), {target:{value:"Partial-credit pickup"}});
    fireEvent.change(within(dialog).getByLabelText("Cash"), {target:{value:"60000"}});
    await waitFor(() => expect(within(dialog).getByRole("button", {name:"Save and add parcels"})).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", {name:"Save and add parcels"}));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/batches", expect.objectContaining({method:"POST"})));
    const body = JSON.parse(apiMock.mock.calls.find(([path]) => path === "/operations/batches")![1].body);
    expect(body).toMatchObject({advancePaid:60000, wallets:{cash:60000,kbzPay:0,wavePay:0}});
    expect(within(dialog).queryByLabelText("Requested total advance")).not.toBeInTheDocument();
  });

  it("explains the deferred OS-credit calculation in Myanmar", async () => {
    authState.role = "OPERATIONS_MANAGER";
    await i18n.changeLanguage("my");
    apiMock.mockImplementation((path: string) => path === "/master-data"
      ? Promise.resolve({data:{shops:[{id:"shop",name:"Shop"}],hubs:[{id:"hub",name:"Hub"}]}})
      : Promise.resolve({data:[]}));
    renderPage();

    fireEvent.click(await screen.findByRole("button", {name:"ဘတ်ချ်အသစ် ဖန်တီးရန်"}));
    const dialog = await screen.findByRole("dialog", {name:"ဘတ်ချ်ဖန်တီးမည်"});
    fireEvent.change(within(dialog).getByLabelText("အွန်လိုင်းဆိုင်"), {target:{value:"shop"}});
    expect(dialog).toHaveTextContent("ပါဆယ်အားလုံးထည့်ပြီး Batch အပြီးသတ်ချိန်မှသာ OS ခရက်ဒစ်ကို တွက်ချက်အသုံးပြုမည်");
    expect(within(dialog).getByLabelText("ငွေသား")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("KBZ Pay")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Wave Pay")).toBeInTheDocument();
  });

  it("filters History on the server and hides redundant single shop and hub filters", async () => {
    apiMock.mockImplementation((path:string) => path === "/master-data" ? Promise.resolve({data:{shops:[{id:"shop",name:"Shop"}],hubs:[{id:"hub",name:"Hub"}]}}) : Promise.resolve({data:[]}));
    renderPage();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining("view=active")));
    fireEvent.click(screen.getByRole("button",{name:"History"}));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining("view=history")));
    expect(screen.queryByLabelText("All batches Online shop")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("All batches Hub")).not.toBeInTheDocument();
  });

  it("queries filtered batch pages and navigates the server pagination", async () => {
    apiMock.mockImplementation((path: string) => path.startsWith("/operations/batches?")
      ? Promise.resolve({ data: [{ id: "batch-1", label: "September", pickupDate: "2026-09-01", shop: { name: "SNMD" }, parcels: [] }], pagination: { page: path.includes("page=2") ? 2 : 1, pageSize: 25, total: 30, totalPages: 2 } })
      : path === "/master-data"
        ? Promise.resolve({ data: { shops: [{ id: "shop-1", name: "SNMD" }], hubs: [{ id: "hub-1", name: "Main Hub" }] } })
        : Promise.resolve({ data: [] }));
    renderPage();
    await screen.findByText("September");
    fireEvent.change(screen.getByLabelText("Search batches"), { target: { value: "sep" } });
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringMatching(/\/operations\/batches\?page=1&pageSize=25&search=sep/)));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringMatching(/\/operations\/batches\?page=2&pageSize=25/)));
  });

  it("opens the create batch dialog from All batches with loaded shops and hubs", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/master-data") {
        return Promise.resolve({
          data: {
            shops: [{ id: "shop-1", name: "SNMD" }],
            hubs: [{ id: "hub-1", name: "Sanchaung" }],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Create new batch" }));

    const dialog = await screen.findByRole("dialog", { name: "Create batch" });
    expect(dialog).toBeInTheDocument();
    expect(await within(dialog).findByRole("option", { name: "SNMD" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("option", { name: "Sanchaung" })).toBeInTheDocument();
  });

  it("shows alerts on the batches page and acknowledges them", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/operations/alerts" && !init) {
        return Promise.resolve({
          data: [{ id: "alert-1", type: "FAILED", message: "Delivery failed", createdAt: "2026-08-11T00:00:00.000Z" }],
        });
      }
      return Promise.resolve({ data: {} });
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(document.getElementById("alerts")).toBeTruthy();
    expect(await screen.findByText("Delivery failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/operations/alerts/alert-1/acknowledge", { method: "POST" }));
  });
});
