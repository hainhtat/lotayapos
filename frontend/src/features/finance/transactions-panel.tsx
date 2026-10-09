import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Download, ChevronDown, ChevronUp } from "lucide-react";
import { api, apiRaw } from "@/lib/api";
import { useAuth } from "@/app/auth";
import { hubBusinessDate } from "@/lib/business-date";
import { useTransactions, type Transaction, type WalletName } from "./transactions-api";

type Hub = { id: string; name: string };
type Rider = { id: string; hubId: string; user: { name: string } };
type Shop = { id: string; name: string };
type MasterData = { hubs: Hub[]; riders: Rider[]; shops: Shop[] };
type RiderOutstanding = { rider: { id: string; name: string }; outstandingAmount: number };
type OsAccounts = { shops?: Array<{ creditAvailable: number }> };
type PendingReturns = { summary: { count: number; totalRecoverableAmount: number } };

const wallets: WalletName[] = ["CASH", "KBZ_PAY", "WAVE_PAY"];
const walletKeys: Record<WalletName, string> = { CASH: "cash", KBZ_PAY: "kbzPay", WAVE_PAY: "wavePay" };
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";

function previousDate(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export function TransactionsPanel() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const today = hubBusinessDate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [hubId, setHubId] = useState("");
  const [wallet, setWallet] = useState("");
  const [type, setType] = useState("");
  const [riderId, setRiderId] = useState("");
  const [shopId, setShopId] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const masters = useQuery({ queryKey: ["master-data"], enabled: user?.role !== "AUDITOR", queryFn: () => api<MasterData>("/master-data").then((response) => response.data) });
  const hubs = useQuery({ queryKey: ["finance-transaction-hubs"], queryFn: () => api<{ hubs: Hub[] }>("/finance/transactions/hubs").then((response) => response.data.hubs) });
  useEffect(() => { if (!hubId && hubs.data?.length === 1) setHubId(hubs.data[0].id); }, [hubId, hubs.data]);
  const filters = { hubId, from, to, wallet, type, riderId, shopId, page };
  const statement = useTransactions(filters);
  const riderOutstanding = useQuery({ queryKey: ["rider-outstanding", to, hubId], enabled: Boolean(hubId && to && user?.role !== "AUDITOR"), queryFn: () => api<RiderOutstanding[]>(`/finance/rider-outstanding?businessDate=${to}&hubId=${encodeURIComponent(hubId)}`).then((response) => response.data) });
  const osCredits = useQuery({ queryKey: ["finance-os-credit-snapshot", hubId], enabled: Boolean(hubId), queryFn: () => api<OsAccounts>(`/finance/os-accounts?hubId=${encodeURIComponent(hubId)}`).then((response) => response.data) });
  const pendingReturns = useQuery({ queryKey: ["os-pending-returns", "transactions", hubId], enabled: Boolean(hubId), queryFn: () => api<PendingReturns>(`/finance/os-pending-returns?hubId=${encodeURIComponent(hubId)}`).then((response) => response.data) });
  const money = (amount: number) => `${amount.toLocaleString(i18n.language === "my" ? "my-MM" : "en-US")} MMK`;
  const dateTime = (value: string) => new Intl.DateTimeFormat(i18n.language === "my" ? "my-MM" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Yangon" }).format(new Date(value));
  const setDateRange = (date: string) => { setFrom(date); setTo(date); setPage(1); };
  const updateFrom = (value: string) => { setFrom(value); setPage(1); };
  const updateTo = (value: string) => { setTo(value); setPage(1); };
  const transactionType = (item: Transaction) => t(`transactionType_${item.type}`, { defaultValue: item.description || item.type });
  const typeOptions = ["BATCH_PICKUP_ADVANCE", "RIDER_SETTLEMENT", "OS_ACCOUNT_PAYMENT", "OS_SETTLEMENT", "CASHBOOK_EXPENSE", "CASHBOOK_ADJUSTMENT", "CASHBOOK_TRANSFER", "LEDGER_REVERSAL"];
  const exportCsv = async () => {
    if (!statement.data || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams({ hubId, from, to, format: "csv" });
      if (wallet) params.set("wallet", wallet);
      if (type) params.set("type", type);
      if (riderId) params.set("riderId", riderId);
      if (shopId) params.set("shopId", shopId);
      const response = await apiRaw(`/finance/transactions?${params}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `wallet-transactions-${from}-${to}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch { setExportError(t("transactionExportError")); }
    finally { setExporting(false); }
  };

  return <div className="mt-6 space-y-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-xl font-bold">{t("transactionRecord")}</h2><p className="mt-1 text-sm text-slate-500">{t("transactionRecordDescription")}</p></div><button type="button" onClick={() => void exportCsv()} disabled={!statement.data?.items.length || exporting} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-sky-700 disabled:opacity-40 dark:border-white/10 dark:text-sky-300"><Download size={16} aria-hidden="true" />{exporting ? t("loading") : t("transactionExportCsv")}</button></div>
      {exportError && <p role="alert" className="mt-3 text-sm text-rose-600">{exportError}</p>}
      <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => setDateRange(hubBusinessDate())} className="rounded-lg bg-sky-50 px-3 py-2 text-sm font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">{t("transactionToday")}</button><button type="button" onClick={() => setDateRange(previousDate(hubBusinessDate()))} className="rounded-lg bg-sky-50 px-3 py-2 text-sm font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">{t("transactionYesterday")}</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-bold text-slate-500">{t("dateFrom")}<input className={`${inputClass} mt-1`} type="date" value={from} onChange={(event) => updateFrom(event.target.value)} /></label>
        <label className="text-xs font-bold text-slate-500">{t("dateTo")}<input className={`${inputClass} mt-1`} type="date" value={to} onChange={(event) => updateTo(event.target.value)} /></label>
        <label className="text-xs font-bold text-slate-500">{t("hub")}<select className={`${inputClass} mt-1`} value={hubId} onChange={(event) => { setHubId(event.target.value); setRiderId(""); setShopId(""); setPage(1); }}><option value="">{t("selectHub")}</option>{hubs.data?.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-500">{t("walletToAdjust")}<select className={`${inputClass} mt-1`} value={wallet} onChange={(event) => { setWallet(event.target.value); setPage(1); }}><option value="">{t("transactionAllWallets")}</option>{wallets.map((name) => <option key={name} value={name}>{t(walletKeys[name])}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-500">{t("transactionType")}<select className={`${inputClass} mt-1`} value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="">{t("transactionAllTypes")}</option>{typeOptions.map((name) => <option key={name} value={name}>{t(`transactionType_${name}`)}</option>)}</select></label>
        {user?.role !== "AUDITOR" && <><label className="text-xs font-bold text-slate-500">{t("rider")}<select className={`${inputClass} mt-1`} value={riderId} onChange={(event) => { setRiderId(event.target.value); if (event.target.value) setShopId(""); setPage(1); }}><option value="">{t("transactionAllRiders")}</option>{masters.data?.riders?.filter((rider) => rider.hubId === hubId).map((rider) => <option key={rider.id} value={rider.id}>{rider.user.name}</option>)}</select></label><label className="text-xs font-bold text-slate-500">{t("onlineShop")}<select className={`${inputClass} mt-1`} value={shopId} onChange={(event) => { setShopId(event.target.value); if (event.target.value) setRiderId(""); setPage(1); }}><option value="">{t("transactionAllShops")}</option>{masters.data?.shops?.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></label></>}
      </div>
      {hubs.isError && <button type="button" onClick={() => void hubs.refetch()} className="mt-4 text-sm font-bold text-sky-700">{t("retry")}</button>}
      {masters.isError && <button type="button" onClick={() => void masters.refetch()} className="mt-4 text-sm font-bold text-sky-700">{t("retry")}</button>}
      {from > to && <p role="alert" className="mt-3 text-sm text-rose-600">{t("transactionInvalidRange")}</p>}
    </section>

    {hubId && from <= to && <>
      {statement.isLoading ? <p role="status" className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 dark:bg-[#181a1d]">{t("loading")}</p> : statement.isError ? <div role="alert" className="rounded-xl bg-white p-8 text-center dark:bg-[#181a1d]"><p>{t("loadError")}</p><button type="button" onClick={() => void statement.refetch()} className="mt-2 font-bold text-sky-700">{t("retry")}</button></div> : statement.data && <>
        <section aria-labelledby="transaction-balances" className="grid gap-3 md:grid-cols-3"><h2 id="transaction-balances" className="sr-only">{t("transactionWalletBalances")}</h2>{wallets.map((name) => { const data = statement.data!.summary.wallets.find((line) => line.wallet === name); return <div key={name} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#181a1d]"><h3 className="font-display font-bold">{t(walletKeys[name])}</h3><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt className="text-slate-500">{t("transactionOpening")}</dt><dd className="text-right">{money(data?.opening ?? 0)}</dd><dt className="text-emerald-700 dark:text-emerald-300">{t("transactionMoneyIn")}</dt><dd className="text-right font-semibold text-emerald-700 dark:text-emerald-300">+{money(data?.in ?? 0)}</dd><dt className="text-rose-700 dark:text-rose-300">{t("transactionMoneyOut")}</dt><dd className="text-right font-semibold text-rose-700 dark:text-rose-300">−{money(data?.out ?? 0)}</dd><dt className="border-t pt-2 font-bold dark:border-white/10">{t("transactionClosing")}</dt><dd className="border-t pt-2 text-right font-bold dark:border-white/10">{money(data?.closing ?? 0)}</dd></dl></div>; })}</section>
        <section aria-labelledby="transaction-list-heading" className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#181a1d]"><div className="flex items-baseline justify-between gap-3"><h2 id="transaction-list-heading" className="font-display text-lg font-bold">{t("transactionList")}</h2><span className="text-xs text-slate-500">{t("transactionCount", { count: statement.data.pagination.total })}</span></div><p className="mt-1 text-xs text-slate-500">{t("transactionSummaryScope")}</p>
          {!statement.data.items.length ? <p className="py-10 text-center text-sm text-slate-500">{t("transactionEmpty")}</p> : <ol className="mt-4 divide-y divide-slate-100 dark:divide-white/10">{statement.data.items.map((item) => <li key={item.id} className="py-3"><button type="button" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)} className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-white/5"><span className="min-w-0"><span className="block font-semibold">{transactionType(item)}</span><span className="block truncate text-xs text-slate-500">{t("transactionBusinessDate")}: {item.businessDate} · {t("transactionRecordedAt")}: {dateTime(item.createdAt)}{item.counterparty ? ` · ${item.counterparty}` : ""}</span></span><span className="flex shrink-0 items-center gap-2"><span className="text-right text-sm font-bold">{item.wallets.map((line) => <span key={line.wallet} className={`block ${line.amount >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>{line.amount > 0 ? "+" : ""}{money(line.amount)} <span className="font-normal text-slate-500">{t(walletKeys[line.wallet])}</span></span>)}</span>{expanded === item.id ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</span></button>{expanded === item.id && <dl className="mt-2 grid gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/5 sm:grid-cols-[minmax(8rem,auto)_1fr]"><dt className="text-slate-500">{t("transactionBusinessDate")}</dt><dd>{item.businessDate}</dd><dt className="text-slate-500">{t("transactionRecordedAt")}</dt><dd>{dateTime(item.createdAt)}</dd><dt className="text-slate-500">{t("description")}</dt><dd>{item.description}</dd><dt className="text-slate-500">{t("reference")}</dt><dd>{item.reference || "—"}</dd><dt className="text-slate-500">{t("transactionRecordedBy")}</dt><dd>{item.recordedBy || "—"}</dd><dt className="text-slate-500">{t("transactionSource")}</dt><dd>{item.sourceType}{item.sourceId ? ` · ${item.sourceId}` : ""}</dd><dt className="text-slate-500">{t("transactionBalanceAfter")}</dt><dd>{item.balancesAfter.map((line) => <span key={line.wallet} className="block">{t(walletKeys[line.wallet])}: {money(line.balance)}</span>)}</dd>{item.reverses && <><dt className="text-slate-500">{t("transactionReverses")}</dt><dd>{item.reverses.description} · {item.reverses.sourceType}{item.reverses.sourceId ? ` · ${item.reverses.sourceId}` : ""}</dd></>}</dl>}</li>)}</ol>}
          {statement.data.pagination.totalPages > 1 && <div className="mt-4 flex items-center justify-end gap-3"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">{t("previous")}</button><span className="text-sm text-slate-500">{page} / {statement.data.pagination.totalPages}</span><button type="button" disabled={page >= statement.data.pagination.totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">{t("next")}</button></div>}
        </section>
      </>}
      <section className="grid gap-3 md:grid-cols-2">{user?.role !== "AUDITOR" && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><h2 className="font-display font-bold">{t("transactionRiderOutstanding")}</h2><p className="mt-1 text-xs">{t("transactionRiderOutstandingHint")}</p>{riderOutstanding.isLoading ? <p className="mt-3 text-sm">{t("loading")}</p> : riderOutstanding.isError ? <button type="button" onClick={() => void riderOutstanding.refetch()} className="mt-3 text-sm font-bold underline">{t("retry")}</button> : <><p className="mt-3 text-xl font-bold">{money(riderOutstanding.data?.reduce((total, rider) => total + Math.max(0, rider.outstandingAmount), 0) ?? 0)}</p><ul className="mt-2 space-y-1 text-sm">{riderOutstanding.data?.filter((rider) => rider.outstandingAmount > 0).slice(0, 5).map((rider) => <li key={rider.rider.id} className="flex justify-between gap-2"><span>{rider.rider.name}</span><span>{money(rider.outstandingAmount)}</span></li>)}</ul></>}<Link to={`/finance/settlements?businessDate=${encodeURIComponent(to)}#rider-outstanding`} className="mt-3 inline-block text-sm font-bold underline">{t("transactionViewRiders")}</Link></div>}<div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#181a1d]"><h2 className="font-display font-bold">{t("transactionNonCashContext")}</h2><p className="mt-1 text-xs text-slate-500">{t("transactionNonCashHint")}</p><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt>{t("osCreditAvailable")}</dt><dd className="text-right font-semibold">{osCredits.isLoading ? "…" : osCredits.isError ? t("loadError") : money(osCredits.data?.shops?.reduce((sum, shop) => sum + shop.creditAvailable, 0) ?? 0)}</dd><dt>{t("osPendingReturns")}</dt><dd className="text-right font-semibold">{pendingReturns.isLoading ? "…" : pendingReturns.isError ? t("loadError") : pendingReturns.data?.summary.count ?? 0}</dd></dl><Link to="/finance/settlements#os-pending-returns" className="mt-3 inline-block text-sm font-bold text-sky-700 underline dark:text-sky-300">{t("transactionViewOs")}</Link></div></section>
    </>}
  </div>;
}
