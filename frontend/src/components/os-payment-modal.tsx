import { useTranslation } from "react-i18next";
import {useEffect,useRef} from "react";
import type { PaymentForm } from "./os-payment-rules";

type Props = {
  correct:boolean; shop:string; rows:Array<{batchId:string;label:string;outstanding:number}>;
  form:PaymentForm; change:(form:PaymentForm)=>void; reason:string; changeReason:(reason:string)=>void;
  credit:number; outstanding:number; pending:boolean; locked:boolean; error:string; blockers:string[];
  submit:()=>void; close:()=>void;
};
const input="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-sky-500 dark:border-white/10 dark:bg-[#121416]";

export function OsPaymentModal(p:Props) {
  const {t}=useTranslation();
  const dialog=useRef<HTMLFormElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.focus();
    return ()=>previous?.focus();
  },[]);
  const money=(value:number)=>t("paymentMoney",{amount:(Number.isFinite(value)?value:0).toLocaleString()});
  return <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/55 p-4">
    <form ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="os-payment-title" noValidate onKeyDown={e=>{
      if(e.key==="Escape"&&!p.pending&&!p.locked){e.preventDefault();p.close();}
      if(e.key!=="Tab")return;
      const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>("input:not(:disabled),textarea:not(:disabled),button:not(:disabled)")??[]);
      const first=controls[0],last=controls.at(-1);
      if(!first){e.preventDefault();return;}
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){e.preventDefault();first.focus();}
    }} onSubmit={e=>{e.preventDefault();if(!p.pending&&!p.blockers.length)p.submit()}} className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 dark:bg-[#181a1d]">
      <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-start justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="os-payment-title" className="text-xl font-bold">{t(p.correct?"correctPayment":"settle")}</h2><button type="button" aria-label={t("close")} disabled={p.pending||p.locked} onClick={p.close} className="rounded-lg p-2 text-xl leading-none hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-white/10">×</button></div>
      <p className="mt-1 text-sm text-slate-500">{p.shop}</p>
      <div className="mt-4 space-y-2">{p.rows.map(row=><div key={row.batchId} className="flex justify-between rounded-lg border p-3 text-sm"><span>{row.label}</span><strong>{money(row.outstanding)}</strong></div>)}</div>
      {!p.correct&&<div className="mt-4 rounded-xl bg-sky-50 p-4 text-sm dark:bg-sky-950"><p>{t("creditApplied")}: {money(p.credit)}</p><p className="mt-1 font-bold">{t("paymentAmountToSettle")}: {money(Math.max(0,p.outstanding-p.credit))}</p></div>}
      {p.correct&&<p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{t("atomicCorrectionExplanation")}</p>}
      <fieldset disabled={p.pending||p.locked}>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">{(["cash","kbzPay","wavePay"] as const).map(wallet=><label key={wallet} className="text-xs font-bold">{t(wallet)}<input type="number" inputMode="numeric" min="0" step="1" value={p.form[wallet]} onChange={e=>p.change({...p.form,[wallet]:e.target.value})} className={input}/></label>)}</div>
        <label className="mt-3 block text-xs font-bold">{t("businessDate")}<input type="date" value={p.form.date} onChange={e=>p.change({...p.form,date:e.target.value})} className={input}/></label>
        <label className="mt-3 block text-xs font-bold">{t("note")}<textarea value={p.form.note} onChange={e=>p.change({...p.form,note:e.target.value})} className={input}/></label>
        <label className="mt-3 block text-xs font-bold">{t("reference")}<input value={p.form.reference} onChange={e=>p.change({...p.form,reference:e.target.value})} className={input}/></label>
        {p.correct&&<label className="mt-3 block text-xs font-bold">{t("paymentCorrectionReason")}<textarea value={p.reason} onChange={e=>p.changeReason(e.target.value)} className={input}/></label>}
      </fieldset>
      <p className="mt-3 text-sm font-bold">{t("walletPayment")}: {money(Number(p.form.cash)+Number(p.form.kbzPay)+Number(p.form.wavePay))}</p>
      {p.blockers.length>0&&<ul aria-live="polite" className="mt-3 list-inside list-disc text-sm text-amber-700 dark:text-amber-300">{p.blockers.map(key=><li key={key}>{t(key)}</li>)}</ul>}
      {p.error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{p.error}</p>}
      {p.locked&&<p role="status" className="mt-3 text-sm">{t("paymentRetryUnchanged")}</p>}
      <div className="sticky bottom-0 mt-5 flex justify-end gap-2 bg-white py-2 dark:bg-[#181a1d]"><button type="button" disabled={p.pending||p.locked} onClick={p.close} className="rounded-xl border px-4 py-2 disabled:opacity-40">{t("cancel")}</button><button disabled={p.pending||p.blockers.length>0} className="rounded-xl bg-sky-600 px-4 py-2 font-bold text-white disabled:opacity-40">{t(p.pending?"loading":p.locked?"retry":p.correct?"confirmCorrection":"save")}</button></div>
    </form>
  </div>;
}
