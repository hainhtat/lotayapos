import {fireEvent,render,waitFor} from "@testing-library/react-native";
import {StyleSheet} from "react-native";
import Login from "../../app/login";
import {i18n} from "@/i18n";

const mockSignIn=jest.fn();let mockTheme:"light"|"dark"="light";let mockRemembered:string|null=null;
jest.mock("@/providers/auth",()=>({useAuth:()=>({signIn:mockSignIn})}));
jest.mock("@/providers/theme",()=>({useTheme:()=>({theme:mockTheme})}));
jest.mock("@/lib/session-store",()=>({getRememberedIdentifier:()=>Promise.resolve(mockRemembered)}));
const mockReplace=jest.fn();
jest.mock("expo-router",()=>({router:{replace:mockReplace}}));

describe("rider login",()=>{
  beforeEach(()=>{mockSignIn.mockReset();mockSignIn.mockResolvedValue(undefined);mockTheme="light";mockRemembered=null;i18n.locale="en"});

  it.each(["rider.one","rider@example.com"])("submits %s as the identifier without persisting a password",async identifier=>{
    const screen=await render(<Login/>);
    await fireEvent.changeText(screen.getByLabelText(i18n.t("identifier")),identifier);
    await fireEvent.changeText(screen.getByLabelText("Password"),"secret-value");
    await fireEvent.press(screen.getByText("Sign in"));
    await waitFor(()=>expect(mockSignIn).toHaveBeenCalledWith(identifier,"secret-value",true));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("restores remember choice and toggles password visibility accessibly",async()=>{
    mockRemembered="rider.one";const screen=await render(<Login/>);
    await waitFor(()=>expect(screen.getByLabelText(i18n.t("identifier")).props.value).toBe("rider.one"));
    expect(screen.getByLabelText("Remember me").props.accessibilityState.checked).toBe(true);
    const password=screen.getByLabelText("Password");expect(password.props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByLabelText("Show password"));expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(false);
  });

  it("renders Myanmar labels and the dark surface",async()=>{
    i18n.locale="my";mockTheme="dark";const screen=await render(<Login/>);
    expect(screen.getByLabelText(i18n.t("identifier"))).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId("login-screen").props.style).backgroundColor).toBe("#111315");
  });
});
