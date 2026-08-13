import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ThemeProvider,useTheme} from "./theme";
function Probe(){const {resolved,toggle}=useTheme();return <button onClick={toggle}>{resolved}</button>}
describe("ThemeProvider",()=>{afterEach(()=>{localStorage.clear();document.documentElement.classList.remove("dark");vi.unstubAllGlobals()});it("switches directly between light and dark and persists the choice",async()=>{vi.stubGlobal("matchMedia",vi.fn().mockReturnValue({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));render(<ThemeProvider><Probe/></ThemeProvider>);fireEvent.click(screen.getByRole("button",{name:"light"}));await waitFor(()=>expect(document.documentElement).toHaveClass("dark"));expect(localStorage.getItem("lotaya-theme")).toBe("dark");fireEvent.click(screen.getByRole("button",{name:"dark"}));await waitFor(()=>expect(document.documentElement).not.toHaveClass("dark"))})});
