import {render,screen} from "@testing-library/react";
import {describe,expect,it,vi} from "vitest";
import "@/i18n";
import {ProfilePage} from "./profile-page";
vi.mock("@/app/auth",()=>({useAuth:()=>({user:{id:"user-1",name:"Finance User",email:"finance@example.com",role:"OPERATIONS_MANAGER"}})}));
describe("ProfilePage",()=>{it("renders canonical verified session identity",()=>{render(<ProfilePage/>);expect(screen.getByRole("heading",{name:"Finance User"})).toBeInTheDocument();expect(screen.getByText("finance@example.com")).toBeInTheDocument();expect(screen.getByText("OPERATIONS MANAGER")).toBeInTheDocument();expect(screen.getByText("user-1")).toBeInTheDocument()})});
