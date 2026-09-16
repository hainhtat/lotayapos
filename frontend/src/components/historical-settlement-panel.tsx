import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";

type Batch = { id: string; label: string; pickupDate: string; shopName: string; adjustmentAmount?: number; alreadyAdjusted?: boolean; blocker?: string };
type Preview = { fingerprint: string; retainedBatches: Batch[]; batches: Batch[]; totalAdjustment: number; canApply: boolean; blockers: { batchId: string; message: string }[] };
type Command = { fingerprint: string; batchIds: string[]; retainedBatchIds: string[]; businessDate: string; reason: string; idempotencyKey: string };
const copy = {
  en: { title: "Settle older batches historically", explain: "Keep the newest three batches unchanged. Clear older OS amounts still owed without changing wallets, parcel statuses, or rider debts. Existing OS credits remain available.", preview: "Review older batches", retained: "These three batches stay unchanged", older: "Older batches", amount: "Historical settlement total", date: "Business date", reason: "Reason / paper record reference", confirm: "Confirm historical settlement", retry: "Retry same settlement", done: "Historical settlement recorded. Wallet balances unchanged.", blocked: "Resolve the listed issues and review again.", required: "Enter a valid date and a reason of 3–500 characters.", uncertain: "The result is uncertain. Retry this same request before making changes.", cancel: "Close review" },
  my: { title: "အဟောင်းဘတ်ချ်များ စာရင်းရှင်းပြီးအဖြစ် မှတ်တမ်းတင်ရန်", explain: "နောက်ဆုံး ဘတ်ချ်သုံးခုကို မပြောင်းပါ။ Wallet၊ ပါဆယ်အခြေအနေ၊ Rider ကြွေးမြီများ မပြောင်းဘဲ အဟောင်း OS ပေးရန်ငွေကို ရှင်းပါမည်။ OS လက်ကျန်ခရက်ဒစ်ကို ဆက်ထားပါမည်။", preview: "အဟောင်းဘတ်ချ်များ စစ်ဆေးရန်", retained: "မပြောင်းလဲမည့် နောက်ဆုံးဘတ်ချ်သုံးခု", older: "အဟောင်းဘတ်ချ်များ", amount: "စာရင်းရှင်းမည့် စုစုပေါင်း", date: "စာရင်းရက်စွဲ", reason: "အကြောင်းရင်း / စာရွက်စာရင်းအညွှန်း", confirm: "အဟောင်းစာရင်းရှင်းမှု အတည်ပြုရန်", retry: "တူညီသောစာရင်းရှင်းမှု ထပ်ကြိုးစားရန်", done: "မှတ်တမ်းတင်ပြီးပါပြီ။ Wallet လက်ကျန် မပြောင်းပါ။", blocked: "ဖော်ပြထားသော ပြဿနာများကို ဖြေရှင်းပြီး ပြန်စစ်ပါ။", required: "ရက်စွဲမှန်နှင့် စာလုံး ၃–၅၀၀ ပါ အကြောင်းရင်း ထည့်ပါ။", uncertain: "ရလဒ်မသေချာပါ။ မပြောင်းမီ တူညီသောတောင်းဆိုမှုကို ပြန်ကြိုးစားပါ။", cancel: "ပိတ်ရန်" },
};

export function HistoricalSettlementPanel() {
  const { i18n } = useTranslation();
  const c = copy[i18n.language.startsWith("my") ? "my" : "en"];
  const client = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [locked, setLocked] = useState(false);
  const command = useRef<Command | null>(null);
  const reviewing = useMutation({ mutationFn: () => api<Preview>("/finance/os-history/preview", { method: "POST", body: "{}" }), onSuccess: r => { setPreview(r.data); setError(""); setDone(false); }, onError: e => setError(e.message) });
  const applying = useMutation({ mutationFn: (body: Command) => api("/finance/os-history/apply", { method: "POST", body: JSON.stringify(body) }), onSuccess: async () => {
    command.current = null; setLocked(false); setPreview(null); setDone(true); setError("");
    await client.invalidateQueries();
  }, onError: e => {
    setError(e.message);
    if (e instanceof ApiError && e.status && e.status >= 400 && e.status < 500) { command.current = null; setLocked(false); }
  } });
  const busy = reviewing.isPending || applying.isPending;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && reason.trim().length >= 3 && reason.trim().length <= 500;
  const submit = () => {
    if (busy || !preview || (!locked && (!valid || !preview.canApply))) return;
    command.current ??= { fingerprint: preview.fingerprint, batchIds: preview.batches.map(b => b.id), retainedBatchIds: preview.retainedBatches.map(b => b.id), businessDate: date, reason: reason.trim(), idempotencyKey: crypto.randomUUID() };
    setLocked(true); applying.mutate(command.current);
  };
  return <section className="mt-5 rounded-xl border border-amber-200 bg-white p-4 dark:bg-[#181a1d]">
    <h2 className="font-bold">{c.title}</h2><p className="mt-2 text-sm text-slate-500">{c.explain}</p>
    {done && <p role="status" className="mt-3 text-emerald-600">{c.done}</p>}
    {error && <p role="alert" className="mt-3 text-red-600">{error}</p>}
    {!locked && <button className="mt-3 rounded-lg border px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => reviewing.mutate()}>{c.preview}</button>}
    {preview && <div className="mt-4 space-y-4">
      <div className="rounded-lg bg-sky-50 p-3 dark:bg-sky-950"><h3 className="font-bold">{c.retained}</h3>{preview.retainedBatches.map(b => <p key={b.id}>{b.pickupDate.slice(0, 10)} · {b.shopName} · {b.label}</p>)}</div>
      <details><summary>{c.older} ({preview.batches.length})</summary><ul className="max-h-60 overflow-auto">{preview.batches.map(b => <li key={b.id} className="py-1">{b.pickupDate.slice(0, 10)} · {b.label} · {(b.adjustmentAmount ?? 0).toLocaleString()} MMK {b.blocker && <span className="text-red-600">— {b.blocker}</span>}</li>)}</ul></details>
      <p className="font-bold">{c.amount}: {preview.totalAdjustment.toLocaleString()} MMK</p>
      {!preview.canApply && <p role="status">{c.blocked}</p>}
      <fieldset disabled={locked || busy} className="space-y-3"><label className="block">{c.date}<input className="ml-3 rounded border bg-transparent p-2" type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label className="block">{c.reason}<textarea className="mt-1 w-full rounded border bg-transparent p-2" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></label></fieldset>
      {!valid && !locked && <p className="text-amber-700">{c.required}</p>}{locked && !busy && <p role="status">{c.uncertain}</p>}
      <button disabled={busy || (!locked && (!valid || !preview.canApply))} onClick={submit} className="rounded-lg bg-sky-600 px-4 py-2 text-white disabled:opacity-40">{locked ? c.retry : c.confirm}</button>
      {!locked && <button className="ml-3 rounded-lg border px-4 py-2" disabled={busy} onClick={() => setPreview(null)}>{c.cancel}</button>}
    </div>}
  </section>;
}
