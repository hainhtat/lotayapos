export type PaymentForm = { date:string; cash:string; kbzPay:string; wavePay:string; note:string; reference:string };

export function paymentBlockers(form: PaymentForm, outstanding: number | null, credit: number, reason?: string) {
  const amounts = [form.cash, form.kbzPay, form.wavePay];
  const valid = amounts.every(value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)));
  const total = amounts.reduce((sum, value) => sum + Number(value), 0);
  const errors: string[] = [];
  if (!valid || !Number.isSafeInteger(total)) errors.push('paymentWholeAmounts');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || Number.isNaN(Date.parse(form.date)) || new Date(form.date).toISOString().slice(0,10) !== form.date) errors.push('paymentDateRequired');
  if (form.note.trim().length < 3) errors.push('paymentNoteRequired');
  if (form.note.trim().length > 500) errors.push('paymentNoteTooLong');
  if (form.reference.trim().length > 150) errors.push('paymentReferenceTooLong');
  if (reason !== undefined && reason.trim().length < 3) errors.push('paymentReasonRequired');
  if (reason !== undefined && reason.trim().length > 500) errors.push('paymentReasonTooLong');
  if (valid && total + credit <= 0) errors.push('paymentAmountRequired');
  if (valid && outstanding !== null && total > Math.max(0, outstanding - credit)) errors.push('paymentExceedsPayable');
  return errors;
}

export function paymentWalletFields(wallets:Array<{wallet:string;amount:number}>) {
  const amounts:Record<string,number>={cash:0,kbzPay:0,wavePay:0};
  const aliases:Record<string,string>={CASH:"cash",KBZ_PAY:"kbzPay",WAVE_PAY:"wavePay",cash:"cash",kbzPay:"kbzPay",wavePay:"wavePay"};
  for(const entry of wallets){const key=aliases[entry.wallet];if(key)amounts[key]+=entry.amount;}
  return {cash:String(amounts.cash),kbzPay:String(amounts.kbzPay),wavePay:String(amounts.wavePay)};
}

/** Preserve the exact request after an uncertain result; never reuse a key with edited money. */
export class PaymentAttempt {
  request: {path:string; body:string} | null = null;
  storageError = false;
  constructor(private readonly storageKey?:string) {
    if(!storageKey)return;
    try {
      const saved=sessionStorage.getItem(storageKey);
      if(!saved)return;
      const value:unknown=JSON.parse(saved);
      if(!value||typeof value!=="object"||!("path" in value)||!("body" in value)||typeof value.path!=="string"||typeof value.body!=="string")throw new Error("Invalid pending payment");
      if(!/^\/finance\/os-payments(?:\/[^/?#]+\/replace)?$/.test(value.path))throw new Error("Invalid pending payment path");
      const payload=JSON.parse(value.body) as {idempotencyKey?:unknown;replacement?:{idempotencyKey?:unknown}};
      if(typeof payload.idempotencyKey!=="string"||!payload.idempotencyKey||value.path.endsWith("/replace")&&typeof payload.replacement?.idempotencyKey!=="string")throw new Error("Invalid pending payment key");
      this.request={path:value.path,body:value.body};
    } catch { this.storageError=true; }
  }
  begin(path:string, payload:object) {
    if(this.storageError)throw new Error("Payment recovery storage unavailable");
    if(!this.request) {
      const request={path,body:JSON.stringify(payload)};
      try { if(this.storageKey)sessionStorage.setItem(this.storageKey,JSON.stringify(request)); }
      catch {this.storageError=true;throw new Error("Payment recovery storage unavailable");}
      this.request=request;
    }
    return this.request;
  }
  clear() {
    try {if(this.storageKey)sessionStorage.removeItem(this.storageKey);}
    catch {this.storageError=true;return;}
    this.request=null;
  }
}
