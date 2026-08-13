import {buildOutcomePayload,hasRequiredReason,reasonErrorKey} from "./outcomes";

describe("delivery outcome reasons",()=>{
  it.each(["PARTIAL", "FAILED", "REJECTED"] as const)("requires a reason for %s outcomes",(outcome)=>{
    expect(reasonErrorKey(outcome)).toBe(`${outcome.toLowerCase()}Reason`);
    expect(hasRequiredReason(outcome," ")).toBe(false);
    expect(hasRequiredReason(outcome,"CUSTOMER_REFUSED")).toBe(true);
  });

  it("does not require a reason for successful delivery",()=>{
    expect(reasonErrorKey("DELIVERED")).toBeUndefined();
    expect(hasRequiredReason("DELIVERED","")).toBe(true);
  });

  it("accepts partial COD within the original amount",()=>{
    const {parseCollectedCod}=require("./outcomes") as typeof import("./outcomes");
    expect(parseCollectedCod("4500",10000)).toBe(4500);
    expect(parseCollectedCod("10001",10000)).toBeUndefined();
    expect(parseCollectedCod("4,500",10000)).toBeUndefined();
  });

  it("builds a trimmed exception payload",()=>{
    expect(buildOutcomePayload({outcome:"FAILED",reason:"  NO_ANSWER  ",actualCod:"",originalCod:10000,collectionWallet:""})).toEqual({payload:{status:"FAILED",reasonCode:"NO_ANSWER"}});
  });

  it("enforces and submits a required reason note",()=>{
    const base={outcome:"FAILED" as const,reason:"OTHER",actualCod:"",originalCod:10000,collectionWallet:"" as const,noteRequired:true};
    expect(buildOutcomePayload({...base,note:" "})).toEqual({error:"noteRequired"});
    expect(buildOutcomePayload({...base,note:"  Gate was locked  "})).toEqual({payload:{status:"FAILED",reasonCode:"OTHER",note:"Gate was locked"}});
  });

  it("requires a wallet and valid collected COD for a partial return",()=>{
    const base={outcome:"PARTIAL" as const,reason:"CUSTOMER_PARTIAL",originalCod:10000};
    expect(buildOutcomePayload({...base,actualCod:"",collectionWallet:""})).toEqual({error:"actualCodRequired"});
    expect(buildOutcomePayload({...base,actualCod:"10001",collectionWallet:"CASH"})).toEqual({error:"actualCodInvalid"});
    expect(buildOutcomePayload({...base,actualCod:"4500",collectionWallet:""})).toEqual({error:"collectionWalletRequired"});
    expect(buildOutcomePayload({...base,actualCod:"4500",collectionWallet:"KBZ_PAY"})).toEqual({payload:{status:"PARTIAL",reasonCode:"CUSTOMER_PARTIAL",actualCodCollected:4500,collectionWallet:"KBZ_PAY"}});
  });

  it("accepts zero Actual COD when original COD allows it",()=>{
    expect(buildOutcomePayload({outcome:"PARTIAL",reason:"CUSTOMER_PARTIAL",actualCod:"0",originalCod:10000,collectionWallet:"CASH"})).toEqual({
      payload:{status:"PARTIAL",reasonCode:"CUSTOMER_PARTIAL",actualCodCollected:0,collectionWallet:"CASH"},
    });
  });

  it("rejects Failed/Rejected without a reason and omits reason for Delivered",()=>{
    expect(buildOutcomePayload({outcome:"REJECTED",reason:"",actualCod:"",originalCod:10000,collectionWallet:""})).toEqual({error:"reason"});
    expect(buildOutcomePayload({outcome:"DELIVERED",reason:"",actualCod:"",originalCod:10000,collectionWallet:""})).toEqual({payload:{status:"DELIVERED"}});
  });
});
