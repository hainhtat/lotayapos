import {buildSettlementDeclaration,localBusinessDate,parseWalletAmount} from "./settlement";

describe("rider settlement declaration",()=>{
  it.each(["-1","1.5","1,000",""," "])("rejects invalid wallet amount %p",value=>expect(parseWalletAmount(value)).toBeUndefined());
  it("builds integer wallet payload and total",()=>expect(buildSettlementDeclaration("2026-08-11",{cash:"1000",kbzPay:"2500",wavePay:"0"})).toEqual({payload:{businessDate:"2026-08-11",cash:1000,kbzPay:2500,wavePay:0},total:3500}));
  it("uses the device calendar date rather than UTC slicing",()=>expect(localBusinessDate(new Date(2026,7,11,23,30))).toBe("2026-08-11"));
});
