const mockValues=new Map<string,string>();
jest.mock("expo-secure-store",()=>({
  isAvailableAsync:jest.fn(()=>Promise.resolve(true)),
  getItemAsync:jest.fn((key:string)=>Promise.resolve(mockValues.get(key)??null)),
  setItemAsync:jest.fn((key:string,value:string)=>{mockValues.set(key,value);return Promise.resolve()}),
  deleteItemAsync:jest.fn((key:string)=>{mockValues.delete(key);return Promise.resolve()}),
}));
import {clearAccessToken,getAccessToken,getRefreshToken,getRememberedIdentifier,restoreAccessToken,restoreRefreshToken,saveRememberedIdentifier,setAccessToken,setRefreshToken} from "./session-store";

describe("remembered rider session",()=>{
  beforeEach(async()=>{mockValues.clear();await clearAccessToken()});
  it("persists the access token even when remember-me is off",async()=>{await setAccessToken("session-token",false);expect(await getAccessToken()).toBe("session-token");expect(mockValues.get("lotaya-access-token")).toBe("session-token")});
  it("persists a token and normalized identifier when remember-me is on",async()=>{await setAccessToken("saved-token",true);await saveRememberedIdentifier("  rider.one  ",true);expect(mockValues.get("lotaya-access-token")).toBe("saved-token");expect(await getRememberedIdentifier()).toBe("rider.one")});
  it("persists the refresh token under a distinct SecureStore key",async()=>{
    await setRefreshToken("refresh-token");
    expect(await getRefreshToken()).toBe("refresh-token");
    expect(mockValues.get("lotaya-refresh-token")).toBe("refresh-token");
    expect(mockValues.has("lotaya-access-token")).toBe(false);
  });
  it("removes previously remembered data when remember is cleared",async()=>{await saveRememberedIdentifier("rider.one",true);await saveRememberedIdentifier("",false);expect(await getRememberedIdentifier()).toBeNull()});
  it("restores a persisted token into the runtime session for verify bootstrap",async()=>{
    mockValues.set("lotaya-access-token","persisted-token");
    expect(await restoreAccessToken()).toBe("persisted-token");
    expect(await getAccessToken()).toBe("persisted-token");
  });
  it("restores a persisted refresh token into the runtime session",async()=>{
    mockValues.set("lotaya-refresh-token","persisted-refresh");
    expect(await restoreRefreshToken()).toBe("persisted-refresh");
    expect(await getRefreshToken()).toBe("persisted-refresh");
  });
  it("clears runtime and persisted access and refresh tokens on logout",async()=>{
    await setAccessToken("saved-token",true);
    await setRefreshToken("saved-refresh");
    await clearAccessToken();
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
    expect(mockValues.has("lotaya-access-token")).toBe(false);
    expect(mockValues.has("lotaya-refresh-token")).toBe(false);
  });
});
