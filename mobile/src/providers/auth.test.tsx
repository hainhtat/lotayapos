import {act,fireEvent,render,waitFor} from "@testing-library/react-native";
import {Pressable,Text} from "react-native";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AuthProvider,useAuth} from "./auth";

const mockApi=jest.fn();const mockClear=jest.fn();const mockRestoreAccess=jest.fn();const mockRestoreRefresh=jest.fn();const mockSetAccess=jest.fn();const mockSetRefresh=jest.fn();const mockSaveIdentifier=jest.fn();const mockGetRefresh=jest.fn();const mockRefreshSession=jest.fn();
jest.mock("@/lib/api",()=>({api:(...args:unknown[])=>mockApi(...args),onUnauthorized:()=>()=>{},refreshSession:(...args:unknown[])=>mockRefreshSession(...args)}));
jest.mock("@/lib/session-store",()=>({clearAccessToken:(...args:unknown[])=>mockClear(...args),getRefreshToken:(...args:unknown[])=>mockGetRefresh(...args),restoreAccessToken:(...args:unknown[])=>mockRestoreAccess(...args),restoreRefreshToken:(...args:unknown[])=>mockRestoreRefresh(...args),saveRememberedIdentifier:(...args:unknown[])=>mockSaveIdentifier(...args),setAccessToken:(...args:unknown[])=>mockSetAccess(...args),setRefreshToken:(...args:unknown[])=>mockSetRefresh(...args)}));

function Probe(){const auth=useAuth();return <><Text>{auth.loading?"loading":auth.user?.name??"anonymous"}</Text><Pressable accessibilityRole="button" onPress={()=>void auth.signIn(" rider.one ","secret",true).catch(()=>undefined)}><Text>sign in</Text></Pressable><Pressable accessibilityRole="button" onPress={()=>void auth.signOut()}><Text>sign out</Text></Pressable></>}
async function setup(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const clear=jest.spyOn(client,"clear");const view=await render(<QueryClientProvider client={client}><AuthProvider><Probe/></AuthProvider></QueryClientProvider>);return{clear,view}}

describe("AuthProvider",()=>{
 beforeEach(()=>{jest.clearAllMocks();mockRestoreAccess.mockResolvedValue(null);mockRestoreRefresh.mockResolvedValue(null);mockGetRefresh.mockResolvedValue(null);mockClear.mockResolvedValue(undefined);mockSetAccess.mockResolvedValue(undefined);mockSetRefresh.mockResolvedValue(undefined);mockSaveIdentifier.mockResolvedValue(undefined)});
 it("finishes anonymous bootstrap when no session exists",async()=>{const {view}=await setup();expect(await view.findByText("anonymous")).toBeTruthy();expect(mockApi).not.toHaveBeenCalledWith("/auth/verify")});
 it("restores and verifies a rider session before authentication",async()=>{mockRestoreAccess.mockResolvedValue("token");mockApi.mockResolvedValue({data:{id:"r1",name:"Rider",email:"rider@example.com",role:"RIDER"}});const {view}=await setup();expect(await view.findByText("Rider")).toBeTruthy();expect(mockApi).toHaveBeenCalledWith("/auth/verify")});
 it("recovers an expired access token by refreshing the rider session before clearing it",async()=>{
  mockRestoreAccess.mockResolvedValue("expired-token");
  mockRestoreRefresh.mockResolvedValue("refresh-token");
  mockRefreshSession.mockResolvedValue(true);
  mockApi
   .mockRejectedValueOnce(new Error("expired"))
   .mockResolvedValueOnce({data:{id:"r1",name:"Rider",email:"rider@example.com",role:"RIDER"}});
  const {view}=await setup();
  expect(await view.findByText("Rider")).toBeTruthy();
  expect(mockApi).toHaveBeenNthCalledWith(1,"/auth/verify");
  expect(mockApi).toHaveBeenNthCalledWith(2,"/auth/verify");
  expect(mockRefreshSession).toHaveBeenCalled();
 });
 it("rejects a non-rider login and clears returned credentials",async()=>{mockApi.mockResolvedValue({data:{accessToken:"token",user:{id:"u1",name:"Admin",email:"admin@example.com",role:"SUPERADMIN"}}});const {view}=await setup();await view.findByText("anonymous");await act(async()=>{fireEvent.press(view.getByText("sign in"));await waitFor(()=>expect(mockClear).toHaveBeenCalled())});expect(mockSetAccess).not.toHaveBeenCalled();expect(view.getByText("anonymous")).toBeTruthy()});
 it("clears protected query data on logout",async()=>{mockRestoreAccess.mockResolvedValue("token");mockApi.mockImplementation((path:string)=>Promise.resolve(path==="/auth/verify"?{data:{id:"r1",name:"Rider",email:"rider@example.com",role:"RIDER"}}:{data:{}}));const {clear,view}=await setup();await view.findByText("Rider");await act(async()=>{fireEvent.press(view.getByText("sign out"));await waitFor(()=>expect(clear).toHaveBeenCalled())});expect(mockClear).toHaveBeenCalled();expect(view.getByText("anonymous")).toBeTruthy()});
});
