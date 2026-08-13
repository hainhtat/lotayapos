import {hubCalendarDate} from "./hub-time";

export type WalletFields={cash:string;kbzPay:string;wavePay:string};

export function parseWalletAmount(value:string):number|undefined{
  const normalized=value.trim();
  if(!/^\d+$/.test(normalized))return undefined;
  const amount=Number(normalized);
  return Number.isSafeInteger(amount)?amount:undefined;
}

type DeclarationResult={error:"walletAmountInvalid"}|{payload:{businessDate:string;cash:number;kbzPay:number;wavePay:number};total:number};
export function buildSettlementDeclaration(businessDate:string,fields:WalletFields):DeclarationResult{
  const cash=parseWalletAmount(fields.cash);
  const kbzPay=parseWalletAmount(fields.kbzPay);
  const wavePay=parseWalletAmount(fields.wavePay);
  if(cash===undefined||kbzPay===undefined||wavePay===undefined)return {error:"walletAmountInvalid" as const};
  return {payload:{businessDate,cash,kbzPay,wavePay},total:cash+kbzPay+wavePay};
}

export function localBusinessDate(date=new Date()):string{
  return hubCalendarDate(date);
}
