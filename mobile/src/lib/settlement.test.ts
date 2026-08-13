import {buildSettlementDeclaration,localBusinessDate,parseWalletAmount} from "./settlement";

describe("rider settlement declaration",()=>{
  it.each(["-1","1.5","1,000",""," "])("rejects invalid wallet amount %p",value=>expect(parseWalletAmount(value)).toBeUndefined());
  it("builds integer wallet payload and total",()=>expect(buildSettlementDeclaration("2026-08-11",{cash:"1000",kbzPay:"2500",wavePay:"0"})).toEqual({payload:{businessDate:"2026-08-11",cash:1000,kbzPay:2500,wavePay:0},total:3500}));
  it("uses the hub calendar date in Asia/Yangon",()=>{
    expect(localBusinessDate(new Date("2026-08-11T23:30:00+06:30"))).toBe("2026-08-11");
    expect(localBusinessDate(new Date("2026-08-11T20:00:00.000Z"))).toBe("2026-08-12");
  });
});
