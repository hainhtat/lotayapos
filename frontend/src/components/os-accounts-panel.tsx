import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { OsPaymentModal } from "./os-payment-modal";
import { PaymentAttempt, paymentBlockers, paymentWalletFields, type PaymentForm } from "./os-payment-rules";
import { ApiError, api } from "@/lib/api";
import { hubBusinessDate } from "@/lib/business-date";

type BatchBalance = { batchId:string; label:string; pickupDate:string; hubId:string; originalCod:number; advancePaid:number; paymentPaid:number; returnedCod:number; creditAvailable:number; outstanding:number };
type ShopAccount = { shop:{id:string;name:string}; hubId:string; originalCod:number; advancesPaid:number; paymentsPaid:number; returnedCod:number; outstanding:number; creditAvailable:number; batches:BatchBalance[] };
type Accounts = { shops:ShopAccount[] };
type Payment = { id:string; businessDate:string; note:string; reference?:string|null; status:string; wallets:Array<{wallet:string;amount:number}>; allocations:Array<{batchId:string;amount:number}> };
const input = "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1598ef] dark:border-white/10 dark:bg-[#121416]";
const money = (value:number) => `${value.toLocaleString()} MMK`;
const freshForm = ():PaymentForm => ({ date:hubBusinessDate(), cash:"0", kbzPay:"0", wavePay:"0", note:"", reference:"" });

export function OsAccountsPanel({ initialBatchId, initialHubId, onPaymentClose }: { initialBatchId?: string; initialHubId?: string; onPaymentClose?: () => void } = {}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [paying,setPaying] = useState<ShopAccount|null>(null);
  const [selected,setSelected] = useState<string[]>([]);
  const [form,setForm] = useState<PaymentForm>(freshForm);
  const [historyShop,setHistoryShop] = useState<ShopAccount|null>(null);
  const [correcting,setCorrecting] = useState<Payment|null>(null);
  const [correctionReason,setCorrectionReason] = useState("");
  const [message,setMessage] = useState("");
  const [selectedHubId,setSelectedHubId]=useState(initialHubId ?? "");
  const [balanceFilter,setBalanceFilter]=useState<"OUTSTANDING"|"SETTLED"|"ALL">("OUTSTANDING");
  const [batchSearch,setBatchSearch]=useState("");
  const [fromDate,setFromDate]=useState("");
  const [toDate,setToDate]=useState("");
  const openedInitial = useRef(false);
  const attempt = useMemo(()=>new PaymentAttempt(`lotaya-pending-os-payment:${user?.id??"anonymous"}`),[user?.id]);
  const submitting = useRef(false);
  const [modalError,setModalError]=useState("");
  const [locked,setLocked]=useState(false);
  const isSuperadmin=user?.role==="SUPERADMIN";
  const hubs=useQuery({queryKey:["master-data","os-account-hubs"],enabled:isSuperadmin,queryFn:()=>api<{hubs:Array<{id:string;name:string}>}>("/master-data").then(r=>r.data.hubs)});
  const accounts = useQuery({queryKey:["os-accounts",selectedHubId],enabled:!isSuperadmin||Boolean(selectedHubId),queryFn:()=>api<Accounts>(`/finance/os-accounts${selectedHubId?`?hubId=${encodeURIComponent(selectedHubId)}`:""}`).then(r=>r.data)});
  const shops = accounts.data?.shops ?? [];
  const visibleAccounts = useMemo(() => shops.map((account) => {
    const batches = account.batches.filter((batch) => {
      const matchesBalance = balanceFilter === "ALL" || (balanceFilter === "OUTSTANDING" ? batch.outstanding > 0 : batch.outstanding === 0);
      const term = batchSearch.trim().toLocaleLowerCase();
      const matchesSearch = !term || account.shop.name.toLocaleLowerCase().includes(term) || batch.label.toLocaleLowerCase().includes(term);
      const date = batch.pickupDate.slice(0, 10);
      return matchesBalance && matchesSearch && (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
    });
    return { ...account, batches,
      originalCod: batches.reduce((sum, batch) => sum + batch.originalCod, 0),
      advancesPaid: batches.reduce((sum, batch) => sum + batch.advancePaid, 0),
      paymentsPaid: batches.reduce((sum, batch) => sum + batch.paymentPaid, 0),
      returnedCod: batches.reduce((sum, batch) => sum + batch.returnedCod, 0),
      outstanding: batches.reduce((sum, batch) => sum + batch.outstanding, 0),
    };
  }).filter((account) => account.batches.length > 0), [shops, balanceFilter, batchSearch, fromDate, toDate]);
  useEffect(() => { if (!selectedHubId && hubs.data?.length === 1) setSelectedHubId(hubs.data[0].id); }, [selectedHubId, hubs.data]);
  useEffect(() => {
    if (!initialBatchId || openedInitial.current || !accounts.data || attempt.request || attempt.storageError) return;
    const account = accounts.data.shops.find(row => row.batches.some(batch => batch.batchId === initialBatchId));
    const batch = account?.batches.find(row => row.batchId === initialBatchId);
    if (!account || !batch) return;
    openedInitial.current = true;
    setPaying(account); setSelected([initialBatchId]);
    setForm({ ...freshForm(), cash: String(Math.max(0, batch.outstanding - account.creditAvailable)) });
  }, [initialBatchId, accounts.data, attempt]);
  const history = useQuery({ queryKey:["os-account-history",historyShop?.shop.id,historyShop?.hubId], enabled:Boolean(historyShop), queryFn:()=>api<{payments:Payment[]}>(`/finance/os-accounts/${historyShop!.shop.id}/history?hubId=${encodeURIComponent(historyShop!.hubId)}`).then(r=>r.data) });
  const selectedRows = useMemo(()=>paying?.batches.filter(b=>selected.includes(b.batchId)).sort((a,b)=>new Date(a.pickupDate).getTime()-new Date(b.pickupDate).getTime())??[],[paying,selected]);
  const selectedOutstanding = selectedRows.reduce((sum,b)=>sum+b.outstanding,0);
  const creditApplied = Math.min(paying?.creditAvailable??0,selectedOutstanding);
  const refresh = async()=>Promise.all(["os-accounts","ledger","ledger-summary","dashboard","batch","batches","batch-detail","operations-batches","os-account-history"].map(name=>qc.invalidateQueries({queryKey:[name]})));
  const fail=(error:unknown)=>{
    // A 4xx rejection is definitive; transport and server errors may follow a committed write.
    if(error instanceof ApiError && error.status && error.status>=400 && error.status<500){attempt.clear();setLocked(false)}
    else setLocked(Boolean(attempt.request));
    submitting.current=false;
    setModalError(attempt.storageError?t("paymentStorageUnavailable"):error instanceof Error?error.message:t("loadError"));
    if(!paying&&!correcting)setMessage(error instanceof Error?error.message:t("loadError"));
  };
  const send=async(correct:boolean)=>{
    const account=correct?historyShop:paying;
    const body={shopId:account!.shop.id,hubId:account!.hubId,batchIds:selected,businessDate:form.date,wallets:{cash:Number(form.cash),kbzPay:Number(form.kbzPay),wavePay:Number(form.wavePay)},note:form.note.trim(),reference:form.reference.trim()||undefined,idempotencyKey:`os-payment-${crypto.randomUUID()}`};
    const path=correct?`/finance/os-payments/${correcting!.id}/replace`:"/finance/os-payments";
    const request=attempt.begin(path,correct?{hubId:account!.hubId,businessDate:form.date,reason:correctionReason.trim(),idempotencyKey:`replace-${crypto.randomUUID()}`,replacement:body}:body);
    return api(request.path,{method:"POST",body:request.body});
  };
  const success=async()=>{
    attempt.clear();submitting.current=false;setLocked(false);setModalError("");
    setPaying(null);setCorrecting(null);setCorrectionReason("");setSelected([]);
    setMessage(t("osPaymentRecorded"));await refresh();onPaymentClose?.();
  };
  const payment=useMutation({mutationFn:()=>send(false),onSuccess:success,onError:fail});
  const replacePayment=useMutation({mutationFn:()=>send(true),onSuccess:success,onError:fail});
  const openPayment=(account:ShopAccount,batch:BatchBalance)=>{if(attempt.request||attempt.storageError)return;setModalError("");setLocked(false);setPaying(account);setSelected([batch.batchId]);setForm({...freshForm(),cash:String(Math.max(0,batch.outstanding-account.creditAvailable))})};
  const openCorrection=(p:Payment)=>{if(attempt.request||attempt.storageError)return;setModalError("");setLocked(false);setCorrecting(p);setCorrectionReason("");setSelected(p.allocations.map(a=>a.batchId));setForm({...freshForm(),...paymentWalletFields(p.wallets),note:p.note,reference:p.reference??""})};
  const recover=useMutation({mutationFn:()=>{
    const request=attempt.request;if(!request)throw new Error(t("loadError"));
    return api(request.path,{method:"POST",body:request.body});
  },onSuccess:success,onError:fail});
  if(attempt.storageError||attempt.request&&!paying&&!correcting)return <section className="mt-6 rounded-2xl border border-amber-300 bg-white p-6 dark:bg-[#181a1d]">
    <h2 className="font-bold">{t("paymentRecoveryTitle")}</h2>
    <p role="alert" className="mt-3">{t(attempt.storageError?"paymentStorageUnavailable":"paymentRetryUnchanged")}</p>
    {modalError&&<p role="alert" className="mt-3 text-red-700 dark:text-red-200">{modalError}</p>}
    {!attempt.storageError&&["SUPERADMIN","FINANCE"].includes(user?.role??"")&&<button disabled={recover.isPending} onClick={()=>{if(submitting.current)return;submitting.current=true;recover.mutate()}} className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-white disabled:opacity-40">{t(recover.isPending?"loading":"retry")}</button>}
  </section>;
  if(isSuperadmin&&!selectedHubId)return <section id="os-settlements" className="mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#181a1d]"><h2 className="font-display text-lg font-bold">{t("osOutstandingPayments")}</h2><p className="mt-1 text-sm text-slate-500">{t("selectHubForOsAccounts")}</p><label className="mt-4 block max-w-sm text-xs font-bold">{t("hub")}<select aria-label={t("hub")} value={selectedHubId} onChange={e=>setSelectedHubId(e.target.value)} className={`${input} mt-1 w-full`}><option value="">{t("selectHub")}</option>{(hubs.data??[]).map(hub=><option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label></section>;
  const modal=(correct:boolean)=>{
    const account=correct?historyShop:paying;if(!account)return null;
    const correctionCredit=correcting?Math.max(0,correcting.allocations.reduce((sum,row)=>sum+row.amount,0)-correcting.wallets.reduce((sum,row)=>sum+row.amount,0)):0;
    const blockers=paymentBlockers(form,correct?null:selectedOutstanding,correct?correctionCredit:creditApplied,correct?correctionReason:undefined);
    if(!selected.length)blockers.push("paymentBatchRequired");
    const pending=correct?replacePayment.isPending:payment.isPending;
    return <OsPaymentModal correct={correct} shop={account.shop.name} rows={account.batches.filter(b=>selected.includes(b.batchId))} form={form} change={setForm} reason={correctionReason} changeReason={setCorrectionReason} credit={creditApplied} outstanding={selectedOutstanding} pending={pending} locked={locked} error={modalError} blockers={blockers} submit={()=>{if(submitting.current||pending||blockers.length)return;submitting.current=true;setModalError("");if(correct)replacePayment.mutate();else payment.mutate()}} close={()=>{attempt.clear();if(correct)setCorrecting(null);else setPaying(null);onPaymentClose?.()}}/>;
  };
  if (initialBatchId) return <>{paying ? modal(false) : <div role="status" className="mt-4 rounded-xl border p-4">{accounts.isError ? <button onClick={() => void accounts.refetch()}>{t("retry")}</button> : t(accounts.isLoading ? "loading" : "noOsOutstanding")}<button className="ml-4 text-sky-600" onClick={onPaymentClose}>{t("close")}</button></div>}</>;
  return <section id="os-settlements" className="mt-6 scroll-mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#181a1d]"><div><h2 className="font-display text-lg font-bold">{t("osOutstandingPayments")}</h2><p className="mt-1 text-sm text-slate-500">{t("osOutstandingExplanation")}</p></div><div className="mt-4 grid gap-3 md:grid-cols-4"><label className="text-xs font-bold">{t("status")}<select aria-label={t("status")} value={balanceFilter} onChange={e=>setBalanceFilter(e.target.value as typeof balanceFilter)} className={`${input} mt-1 w-full`}><option value="OUTSTANDING">{t("outstanding")}</option><option value="SETTLED">{t("settled")}</option><option value="ALL">{t("all")}</option></select></label><label className="text-xs font-bold">{t("searchBatches")}<input aria-label={t("searchBatches")} value={batchSearch} onChange={e=>setBatchSearch(e.target.value)} className={`${input} mt-1 w-full`}/></label><label className="text-xs font-bold">{t("dateFrom")}<input aria-label={t("dateFrom")} type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} className={`${input} mt-1 w-full`}/></label><label className="text-xs font-bold">{t("dateTo")}<input aria-label={t("dateTo")} type="date" value={toDate} onChange={e=>setToDate(e.target.value)} className={`${input} mt-1 w-full`}/></label></div>{message&&<p role="status" className="mt-4 rounded-xl bg-sky-50 p-3 text-sm font-semibold text-sky-700">{message}</p>}{accounts.isLoading?<p className="py-8 text-center">{t("loading")}</p>:accounts.isError?<button onClick={()=>void accounts.refetch()}>{t("retry")}</button>:!visibleAccounts.length?<p className="py-8 text-center text-slate-400">{t("noOsOutstanding")}</p>:<div className="mt-5 space-y-5">{visibleAccounts.map(account=><article key={`${account.shop.id}-${account.hubId}`} className="rounded-xl border border-slate-200 p-4 dark:border-white/10"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">{account.shop.name}</h3><p className="text-xs text-slate-500">{t("osAccountSummary",{cod:money(account.originalCod),advance:money(account.advancesPaid),returns:money(account.returnedCod),paid:money(account.paymentsPaid)})}</p></div><div className="text-right"><p className="text-xs text-slate-500">{t("outstanding")}</p><strong className="text-xl text-amber-600">{money(account.outstanding)}</strong>{account.creditAvailable>0&&<p className="text-xs font-semibold text-emerald-600">{t("creditAvailable")}: {money(account.creditAvailable)}</p>}</div></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-400"><th>{t("batch")}</th><th className="text-right">{t("originalCod")}</th><th className="text-right">{t("advancePaid")}</th><th className="text-right">{t("payments")}</th><th className="text-right">{t("returnedCod")}</th><th className="text-right">{t("outstanding")}</th><th/></tr></thead><tbody>{account.batches.map(b=><tr key={b.batchId} className="border-b dark:border-white/5"><td className="py-2 font-semibold">{b.label}</td><td className="text-right">{money(b.originalCod)}</td><td className="text-right">{money(b.advancePaid)}</td><td className="text-right">{money(b.paymentPaid)}</td><td className="text-right">{money(b.returnedCod)}</td><td className="text-right font-bold">{money(b.outstanding)}</td><td className="text-right">{b.outstanding>0&&["SUPERADMIN","FINANCE"].includes(user?.role??"")&&<button onClick={()=>openPayment(account,b)} className="rounded-lg border border-[#1598ef] px-3 py-1 text-xs font-bold text-[#0787df]">{t("settle")}</button>}</td></tr>)}</tbody></table></div><button onClick={()=>setHistoryShop(account)} className="mt-3 text-xs font-bold text-[#0787df]">{t("viewOsAccountHistory")}</button></article>)}</div>}{paying&&modal(false)}{correcting&&modal(true)}{historyShop&&!correcting&&<div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4"><section className="my-6 w-full max-w-3xl rounded-2xl bg-white p-6 dark:bg-[#181a1d]"><h2 className="text-xl font-bold">{t("osAccountHistory")} · {historyShop.shop.name}</h2>{history.isLoading?<p>{t("loading")}</p>:!history.data?.payments.length?<p className="py-6 text-slate-400">{t("empty")}</p>:<ul className="mt-4 space-y-2">{history.data.payments.map(p=><li key={p.id} className="rounded-xl border p-3"><div className="flex justify-between"><div><b>{p.note}</b><p className="text-xs text-slate-500">{p.businessDate} · {p.status}</p></div><b>{money(p.wallets.reduce((s,w)=>s+w.amount,0))}</b></div>{p.status==="POSTED"&&["SUPERADMIN","FINANCE"].includes(user?.role??"")&&<button onClick={()=>openCorrection(p)} className="mt-2 text-xs font-bold text-amber-700">{t("correctPayment")}</button>}</li>)}</ul>}<div className="mt-5 text-right"><button onClick={()=>setHistoryShop(null)} className={input}>{t("close")}</button></div></section></div>}</section>;
}
