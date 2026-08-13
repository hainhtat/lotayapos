import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,describe,expect,it,vi} from "vitest";
import "@/i18n";
import {UserAdminSection} from "./user-admin-section";
const apiMock=vi.hoisted(()=>vi.fn());vi.mock("@/lib/api",()=>({api:apiMock}));
const existing={id:"user-1",name:"Finance User",username:"finance",email:"finance@example.com",role:"FINANCE",active:true,hubId:"hub-1",hub:{id:"hub-1",name:"Main Hub"}};
function renderPage(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><UserAdminSection hubs={[{id:"hub-1",name:"Main Hub"}]}/></QueryClientProvider>)}
describe("UserAdminSection",()=>{beforeEach(()=>apiMock.mockImplementation((path?:string)=>path?.startsWith("/users?")?Promise.resolve({data:{items:[existing],pagination:{page:1,pageSize:10,total:1,totalPages:1}}}):Promise.resolve({data:{id:"ok"}})));
 it("creates a scoped user without exposing the password",async()=>{const user=userEvent.setup();renderPage();await screen.findByText("Finance User");await user.type(screen.getByLabelText("Name"),"Ops Manager");await user.type(screen.getByLabelText("Username"),"ops.manager");await user.type(screen.getByLabelText("Email address"),"ops@example.com");await user.type(screen.getByLabelText("Temporary password"),"SecurePassword1");await user.selectOptions(screen.getAllByLabelText("Role")[0],"OPERATIONS_MANAGER");await user.selectOptions(screen.getByLabelText("Hub"),"hub-1");await user.click(screen.getByRole("button",{name:"Create user"}));await waitFor(()=>expect(apiMock).toHaveBeenCalledWith("/users",expect.objectContaining({method:"POST",body:JSON.stringify({name:"Ops Manager",username:"ops.manager",email:"ops@example.com",password:"SecurePassword1",role:"OPERATIONS_MANAGER",hubId:"hub-1"})})));await waitFor(()=>expect(screen.queryByDisplayValue("SecurePassword1")).not.toBeInTheDocument())});
 it("requires confirmation before deactivation",async()=>{const user=userEvent.setup();renderPage();await user.click(await screen.findByRole("button",{name:"Deactivate Finance User"}));expect(screen.getByRole("dialog")).toHaveTextContent("Deactivate Finance User?");expect(apiMock).not.toHaveBeenCalledWith("/users/user-1/status",expect.anything());await user.click(screen.getByRole("button",{name:"Confirm"}));await waitFor(()=>expect(apiMock).toHaveBeenCalledWith("/users/user-1/status",{method:"PATCH",body:JSON.stringify({active:false})}))});
});
