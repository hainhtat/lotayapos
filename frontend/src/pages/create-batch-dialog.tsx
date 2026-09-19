import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/lib/api";
import { useRef, useState } from "react";
import { useAuth } from "@/app/auth";
import { hubBusinessDate } from "@/lib/business-date";
import { notifySuccess } from "@/lib/notifications";

type Shop = { id: string; name: string };
type Hub = { id: string; name: string };
type Values = { shopId: string; hubId: string; pickupDate: string; batchName: string; requestedAdvance: number; cash: number; kbzPay: number; wavePay: number };
type CreatedBatch = { id: string };
type OsAccounts = { shops?: Array<{ shop: { id: string }; creditAvailable: number }> };
const amountFromInput = (value: unknown) => value === "" || value == null ? 0 : Number(value);
const safeAmount = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const control = "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416]";

export function CreateBatchDialog({ shops, hubs, onClose }: { shops: Shop[]; hubs: Hub[]; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Operations Managers are explicitly authorized by the batch-advance workflow
  // to record the pickup advance while creating the batch. Dispatchers remain
  // limited to zero-advance batch creation.
  const canPay = ["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER"].includes(user?.role ?? "");
  const storageKey = `lotaya:batch-create:${user?.id ?? ""}`;
  const forgetRequest = () => { try { sessionStorage.removeItem(storageKey); } catch { /* Replaying the saved key remains safe if cleanup is unavailable. */ } };
  const persistRequest = (body: string) => { try { sessionStorage.setItem(storageKey, body); } catch { throw new ApiError("Browser storage is unavailable. Enable storage before recording an advance.", "STORAGE_UNAVAILABLE", locked ? 503 : 400); } };
  const [recovered] = useState(() => { try { return sessionStorage.getItem(storageKey); } catch { return null; } });
  const restored = (() => { try { return recovered ? JSON.parse(recovered) as { shopId: string; hubId?: string; pickupDate: string; batchName: string; advancePaid?: number; wallets: { cash: number; kbzPay: number; wavePay: number } } : null; } catch { return null; } })();
  const idempotencyKey = useRef(`batch-${crypto.randomUUID()}`);
  const request = useRef<string | null>(recovered);
  const sending = useRef(false);
  const [locked, setLocked] = useState(Boolean(recovered));
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Values>({ defaultValues: restored ? { shopId: restored.shopId, hubId: restored.hubId ?? "", pickupDate: restored.pickupDate, batchName: restored.batchName, requestedAdvance: restored.advancePaid ?? 0, ...restored.wallets } : { shopId: shops.length === 1 ? shops[0].id : "", hubId: hubs.length === 1 ? hubs[0].id : "", pickupDate: hubBusinessDate(), batchName: "", requestedAdvance: 0, cash: 0, kbzPay: 0, wavePay: 0 } });
  const selectedShopId = watch("shopId");
  const selectedHubId = watch("hubId") || (hubs.length === 1 ? hubs[0].id : "");
  const requestedAdvance = watch("requestedAdvance") || 0;
  const walletAmounts = watch(["cash", "kbzPay", "wavePay"]);
  const walletTotal = walletAmounts.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  const requestedAdvanceValid = Number.isSafeInteger(requestedAdvance) && requestedAdvance >= 0;
  const walletAmountsValid = walletAmounts.every(value => Number.isSafeInteger(value) && value >= 0);
  const osAccounts = useQuery({
    queryKey: ["batch-create-os-credit", selectedShopId, selectedHubId],
    enabled: canPay && requestedAdvance > 0 && Boolean(selectedShopId && selectedHubId),
    queryFn: () => api<OsAccounts>(`/finance/os-accounts?shopId=${encodeURIComponent(selectedShopId)}&hubId=${encodeURIComponent(selectedHubId)}`).then(response => response.data),
  });
  const availableOsCredit = osAccounts.data?.shops?.find(account => account.shop.id === selectedShopId)?.creditAvailable ?? 0;
  const osCreditApplied = Math.min(requestedAdvance, availableOsCredit);
  const requiredWalletAdvance = Math.max(0, requestedAdvance - osCreditApplied);
  const advanceSplitValid = requestedAdvanceValid && walletAmountsValid && walletTotal === requiredWalletAdvance;
  const create = useMutation({
    mutationFn: (values: Values) => { request.current ??= JSON.stringify({ shopId: values.shopId, pickupDate: values.pickupDate, batchName: values.batchName, advancePaid: canPay ? safeAmount(values.requestedAdvance) : 0, wallets: { cash: canPay ? safeAmount(values.cash) : 0, kbzPay: canPay ? safeAmount(values.kbzPay) : 0, wavePay: canPay ? safeAmount(values.wavePay) : 0 }, idempotencyKey: idempotencyKey.current, ...(values.hubId ? { hubId: values.hubId } : {}) }); persistRequest(request.current); return api<CreatedBatch>("/operations/batches", { method: "POST", body: request.current }); },
    onError: error => { sending.current = false; if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) { forgetRequest(); request.current = null; idempotencyKey.current = `batch-${crypto.randomUUID()}`; setLocked(false); } else setLocked(true); },
    onSuccess: async ({ data }) => { forgetRequest(); notifySuccess(t("batchCreated")); await Promise.all(["dashboard", "operations-batches", "ledger", "os-accounts"].map(key => queryClient.invalidateQueries({ queryKey: [key] }))); navigate(`/batches/${data.id}`); },
  });
  return <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/50 p-4"><div role="dialog" aria-modal="true" aria-labelledby="batch-title" className="w-full max-w-2xl rounded-3xl bg-white p-6 text-slate-950 shadow-2xl dark:bg-[#181a1d] dark:text-white">
    <div className="flex items-center justify-between"><div><h2 id="batch-title" className="font-display text-2xl font-bold">{t("createBatch")}</h2><p className="mt-1 text-sm text-slate-500">{t("createBatchDescription")}</p></div><button disabled={locked || create.isPending} aria-label={t("cancel")} onClick={onClose}><X /></button></div>
    <form onSubmit={handleSubmit(values => { if (sending.current) return; sending.current = true; create.mutate(values); })} className="mt-6 grid gap-4 md:grid-cols-2">
      <fieldset disabled={locked || create.isPending} className="contents">
      <label className="text-sm font-bold">{t("shopName")}<select aria-label={t("shopName")} {...register("shopId", { required: true })} className={`${control} mt-2 w-full`}><option value="">{t("selectShop")}</option>{shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></label>
      <label className="text-sm font-bold">{t("hub")}<select aria-label={t("hub")} {...register("hubId", { required: hubs.length > 1 })} className={`${control} mt-2 w-full`}><option value="">{t("assignedHub")}</option>{hubs.map(hub => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
      <label className="text-sm font-bold">{t("pickupDate")}<input aria-label={t("pickupDate")} type="date" {...register("pickupDate", { required: true })} className={`${control} mt-2 w-full`} /></label>
      <label className="text-sm font-bold">{t("batchLabel")}<input aria-label={t("batchLabel")} {...register("batchName", { required: true, minLength: 2 })} className={`${control} mt-2 w-full`} /></label>
      {canPay && <div className="rounded-xl bg-slate-50 p-4 dark:bg-white/5 md:col-span-2">
        <h3 className="font-bold">{t("totalAdvancePaid")}</h3>
        <p className="mt-1 text-sm text-slate-500">{t("advanceAutomaticHelp")}</p>
        <label className="mt-3 block text-sm font-bold">{t("requestedAdvance")}<input aria-label={t("requestedAdvance")} type="number" min="0" step="1" {...register("requestedAdvance", { setValueAs: amountFromInput, min: 0, validate: value => Number.isSafeInteger(value) })} className={`${control} mt-2 w-full`} /></label>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{osAccounts.isError ? <>{t("osCreditUnavailable")} <button type="button" onClick={() => void osAccounts.refetch()} className="font-bold text-[#0787df]">{t("retry")}</button></> : osAccounts.isPending && selectedShopId && selectedHubId ? t("loadingOsCredit") : `${t("availableOsCredit")}: ${availableOsCredit.toLocaleString()} ${t("mmk")}`}</p>
        {!osAccounts.isError && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t("osCreditApplied")}: {osCreditApplied.toLocaleString()} {t("mmk")} · {t("requiredWalletAdvance")}: {requiredWalletAdvance.toLocaleString()} {t("mmk")}</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">{(["cash", "kbzPay", "wavePay"] as const).map(wallet => <label key={wallet} className="text-sm font-bold">{t(wallet)}<input aria-label={t(wallet)} type="number" min="0" step="1" {...register(wallet, { setValueAs: amountFromInput, min: 0, validate: value => Number.isSafeInteger(value) })} className={`${control} mt-2 w-full`} /></label>)}</div>
        <p className="mt-3 font-semibold">{t("walletAmountEntered")}: {walletTotal.toLocaleString()} {t("mmk")}</p>
        {!advanceSplitValid && <p role="alert" className="mt-2 text-sm text-rose-600">{t("advanceWalletSplitMismatch", { amount: requiredWalletAdvance.toLocaleString() })}</p>}
      </div>}
      </fieldset>
      {(Object.keys(errors).length > 0 || create.isError) && <p role="alert" className="text-sm text-rose-600 md:col-span-2">{create.error instanceof Error ? create.error.message : t("checkRequiredFields")}</p>}
      {locked && <p role="alert" className="text-sm text-amber-700 md:col-span-2">{t("paymentRetryUnchanged")}</p>}
      <div className="flex justify-end gap-3 md:col-span-2"><button type="button" disabled={locked || create.isPending} onClick={onClose} className={control}>{t("cancel")}</button><button type={locked ? "button" : "submit"} onClick={locked ? () => { if (!sending.current && (!canPay || advanceSplitValid)) { sending.current = true; create.mutate(watch()); } } : undefined} disabled={create.isPending || Boolean(canPay && (!advanceSplitValid || (requestedAdvance > 0 && (osAccounts.isError || (selectedShopId && selectedHubId && osAccounts.isPending)))))} className="rounded-xl bg-[#1598ef] px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{create.isPending ? t("loading") : locked ? t("retry") : t("saveAndAddParcels")}</button></div>
    </form>
  </div></div>;
}
