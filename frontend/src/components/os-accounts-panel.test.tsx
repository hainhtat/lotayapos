import {render,screen,within,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,it,expect,vi} from "vitest";
import "@/i18n";
import {OsAccountsPanel} from "./os-accounts-panel";
vi.mock("@/app/auth",()=>({useAuth:()=>({user:{id:"finance",role:"FINANCE"}})}));
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();});
const account={shop:{id:"shop",name:"Shop"},hubId:"hub",originalCod:100,advancesPaid:0,paymentsPaid:0,returnedCod:0,outstanding:100,creditAvailable:0,batches:[{batchId:"batch",label:"Batch",pickupDate:"2026-09-16",hubId:"hub",originalCod:100,advancePaid:0,paymentPaid:0,returnedCod:0,creditAvailable:0,outstanding:100}]};
it("retries an uncertain payment unchanged and unlocks a definitive rejection",async()=>{
 const bodies:string[]=[];
 let status=500;
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
  if(init?.method==="POST"){bodies.push(String(init.body));return new Response(JSON.stringify({error:{message:"Payment unavailable"}}),{status});}
  return new Response(JSON.stringify({success:true,data:{shops:[account]}}),{status:200});
 }));
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><OsAccountsPanel/></QueryClientProvider>);
 const user=userEvent.setup();
 await user.click(await screen.findByRole("button",{name:"Settle"}));
 const dialog=screen.getByRole("dialog");
 await user.type(within(dialog).getByLabelText("note"),"Pay batch");
 await user.click(within(dialog).getByRole("button",{name:"Save"}));
 expect(await within(dialog).findByRole("alert")).toHaveTextContent("Payment unavailable");
 expect(within(dialog).getByLabelText("Cash")).toBeDisabled();
 status=409;
 await user.click(within(dialog).getByRole("button",{name:"Try again"}));
 await waitFor(()=>expect(bodies).toHaveLength(2));
 expect(bodies[1]).toBe(bodies[0]);
 await waitFor(()=>expect(within(dialog).getByLabelText("Cash")).toBeEnabled());
});

it("restores the exact unconfirmed request after remount and blocks a new payment",async()=>{
 const bodies:string[]=[];
 let succeed=false;
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
  if(init?.method==="POST"){bodies.push(String(init.body));return new Response(JSON.stringify(succeed?{success:true,data:{id:"paid"}}:{error:{message:"Uncertain result"}}),{status:succeed?200:500});}
  return new Response(JSON.stringify({success:true,data:{shops:[account]}}),{status:200});
 }));
 const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><OsAccountsPanel/></QueryClientProvider>);
 const first=mount(),user=userEvent.setup();
 await user.click(await screen.findByRole("button",{name:"Settle"}));
 await user.type(screen.getByLabelText("note"),"Same payment");
 await user.click(screen.getByRole("button",{name:"Save"}));
 await screen.findByText("Uncertain result");
 first.unmount();
 mount();
 expect(screen.getByText("Unconfirmed payment")).toBeVisible();
 expect(screen.queryByRole("button",{name:"Settle"})).not.toBeInTheDocument();
 succeed=true;
 await user.click(screen.getByRole("button",{name:"Try again"}));
 await waitFor(()=>expect(bodies).toHaveLength(2));
 expect(bodies[1]).toBe(bodies[0]);
 await waitFor(()=>expect(sessionStorage.getItem("lotaya-pending-os-payment:finance")).toBeNull());
});
