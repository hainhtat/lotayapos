import {shouldRetryQuery} from "./query-retry";

describe("query retry policy",()=>{
  it("retries transient failures at most twice",()=>{
    expect(shouldRetryQuery(0,new Error("offline"))).toBe(true);
    expect(shouldRetryQuery(1,new Error("offline"))).toBe(true);
    expect(shouldRetryQuery(2,new Error("offline"))).toBe(false);
  });

  it.each([401,403,404])("does not retry terminal HTTP %s responses",status=>{
    expect(shouldRetryQuery(0,{status})).toBe(false);
  });
});
