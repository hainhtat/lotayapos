import {describe,it,expect} from "vitest";
import {paymentBlockers,paymentWalletFields,PaymentAttempt,type PaymentForm} from "./os-payment-rules";
const form:PaymentForm={date:"2026-09-16",cash:"50",kbzPay:"30",wavePay:"0",note:"OS payment",reference:""};
describe("OS payment validation",()=>{
 it("restores persisted wallet splits for correction and accepts legacy uppercase names",()=>{
  expect(paymentWalletFields([{wallet:"cash",amount:10},{wallet:"kbzPay",amount:20},{wallet:"wavePay",amount:30}])).toEqual({cash:"10",kbzPay:"20",wavePay:"30"});
  expect(paymentWalletFields([{wallet:"CASH",amount:10},{wallet:"KBZ_PAY",amount:20},{wallet:"WAVE_PAY",amount:30}])).toEqual({cash:"10",kbzPay:"20",wavePay:"30"});
 });
 it("accepts split payment after credit and rejects overpayment",()=>{
  expect(paymentBlockers(form,100,20)).toEqual([]);
  expect(paymentBlockers({...form,cash:"51"},100,20)).toContain("paymentExceedsPayable");
 });
 it("explains invalid wallet amounts, dates and required attribution",()=>{
  for(const cash of ["-1","1.5","","Infinity","9007199254740992"])expect(paymentBlockers({...form,cash},100,0)).toContain("paymentWholeAmounts");
  expect(paymentBlockers({...form,date:"2026-02-30",note:""},100,0,"")).toEqual(expect.arrayContaining(["paymentDateRequired","paymentNoteRequired","paymentReasonRequired"]));
 });
 it("allows credit-only settlement and rejects zero-value requests",()=>{
  const zero={...form,cash:"0",kbzPay:"0"};
  expect(paymentBlockers(zero,100,100)).toEqual([]);
  expect(paymentBlockers(zero,100,0)).toContain("paymentAmountRequired");
 });
 it("retries the exact payment or correction including both idempotency keys",()=>{
  const attempt=new PaymentAttempt();
  const first=attempt.begin("/replace",{idempotencyKey:"void-1",replacement:{idempotencyKey:"pay-1",cash:80}});
  expect(attempt.begin("/replace",{idempotencyKey:"void-2",replacement:{idempotencyKey:"pay-2",cash:90}})).toEqual(first);
  attempt.clear();
  expect(attempt.begin("/replace",{cash:90})).not.toEqual(first);
 });
 it("restores a correction only for its user and preserves corrupt storage for investigation",()=>{
  sessionStorage.clear();
  const original=new PaymentAttempt("user-a");
  const request=original.begin("/finance/os-payments/one/replace",{idempotencyKey:"void",replacement:{idempotencyKey:"replace"}});
  expect(new PaymentAttempt("user-a").request).toEqual(request);
  expect(new PaymentAttempt("user-b").request).toBeNull();
  sessionStorage.setItem("corrupt","broken");
  const corrupt=new PaymentAttempt("corrupt");
  expect(corrupt.storageError).toBe(true);
  expect(()=>corrupt.begin("/finance/os-payments",{})).toThrow();
  expect(sessionStorage.getItem("corrupt")).toBe("broken");
  sessionStorage.clear();
 });
});
