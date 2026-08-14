import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {AuthPage} from "./auth-page";
import {AuthProvider} from "@/app/auth";
import "@/i18n";

describe("AuthPage",()=>{
  beforeEach(()=>{
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps readable foregrounds on the white login card in dark mode",async()=>{
    document.documentElement.classList.add("dark");
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("offline")));
    render(<MemoryRouter><AuthProvider><AuthPage/></AuthProvider></MemoryRouter>);
    const heading=await screen.findByRole("heading",{name:"Log in"});
    expect(heading.closest("form")).toHaveClass("text-slate-950");
    expect(screen.getByRole("textbox",{name:/Username or email/})).toHaveClass("bg-white","text-slate-950");
    document.documentElement.classList.remove("dark");
  });
  it("shows required validation without submitting",async()=>{
    const login=vi.fn();
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("offline")));
    render(<MemoryRouter><AuthProvider><AuthPage/></AuthProvider></MemoryRouter>);
    await screen.findByRole("heading",{name:"Log in"});
    const form=screen.getByRole("button",{name:"Sign in"});
    form.click();
    expect(login).not.toHaveBeenCalled();
    expect(await screen.findAllByText("This field is required")).toHaveLength(2);
  });

  it("sends riders to the app download page after login",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes("/auth/refresh")){
        return{ok:false,status:401,json:async()=>({success:false,error:{message:"unauthorized"}})};
      }
      return{
        ok:true,
        json:async()=>({
          success:true,
          data:{
            user:{id:"rider-1",name:"Rider One",email:"rider@example.com",role:"RIDER"},
            accessToken:"rider-token",
          },
        }),
      };
    }));
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<AuthPage/>}/>
            <Route path="/rider-app" element={<div>rider-destination</div>}/>
            <Route path="/" element={<div>erp-destination</div>}/>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("heading",{name:"Log in"});
    fireEvent.change(screen.getByRole("textbox",{name:/Username or email/}),{target:{value:"rider@example.com"}});
    fireEvent.change(screen.getByLabelText(/^Password/),{target:{value:"password123"}});
    fireEvent.click(screen.getByRole("button",{name:"Sign in"}));
    await waitFor(()=>expect(screen.getByText("rider-destination")).toBeInTheDocument());
    expect(screen.queryByText("erp-destination")).not.toBeInTheDocument();
  });
});
