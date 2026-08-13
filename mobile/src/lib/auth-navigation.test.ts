import {getAuthNavigationState} from "./auth-navigation";

describe("protected navigation state",()=>{
  it("does not expose anonymous or authenticated routes during token verification",()=>{
    expect(getAuthNavigationState(true,false)).toBe("loading");
    expect(getAuthNavigationState(true,true)).toBe("loading");
  });

  it("selects exactly one route group after verification",()=>{
    expect(getAuthNavigationState(false,false)).toBe("anonymous");
    expect(getAuthNavigationState(false,true)).toBe("authenticated");
  });
});
