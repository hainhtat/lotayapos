import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

type Shop = { id: string; name: string };
type Hub = { id: string; name: string };
type Values = { shopId: string; hubId: string; pickupDate: string; batchName: string; advancePaid: number };
type CreatedBatch = { id: string };
const control = "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416]";

export function CreateBatchDialog({ shops, hubs, onClose }: { shops: Shop[]; hubs: Hub[]; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({ defaultValues: { shopId: "", hubId: hubs.length === 1 ? hubs[0].id : "", pickupDate: new Date().toISOString().slice(0, 10), batchName: "", advancePaid: 0 } });
  const create = useMutation({
    mutationFn: (values: Values) => api<CreatedBatch>("/operations/batches", { method: "POST", body: JSON.stringify({ ...values, advancePaid: Number(values.advancePaid), ...(values.hubId ? { hubId: values.hubId } : {}) }) }),
    onSuccess: async ({ data }) => { await queryClient.invalidateQueries({ queryKey: ["dashboard"] }); navigate(`/batches/${data.id}`); },
  });
  return <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/50 p-4"><div role="dialog" aria-modal="true" aria-labelledby="batch-title" className="w-full max-w-2xl rounded-3xl bg-white p-6 text-slate-950 shadow-2xl dark:bg-[#181a1d] dark:text-white">
    <div className="flex items-center justify-between"><div><h2 id="batch-title" className="font-display text-2xl font-bold">{t("createBatch")}</h2><p className="mt-1 text-sm text-slate-500">{t("createBatchDescription")}</p></div><button aria-label={t("cancel")} onClick={onClose}><X /></button></div>
    <form onSubmit={handleSubmit(values => create.mutate(values))} className="mt-6 grid gap-4 md:grid-cols-2">
      <label className="text-sm font-bold">{t("shopName")}<select aria-label={t("shopName")} {...register("shopId", { required: true })} className={`${control} mt-2 w-full`}><option value="">{t("selectShop")}</option>{shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></label>
      <label className="text-sm font-bold">{t("hub")}<select aria-label={t("hub")} {...register("hubId", { required: hubs.length > 1 })} className={`${control} mt-2 w-full`}><option value="">{t("assignedHub")}</option>{hubs.map(hub => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
      <label className="text-sm font-bold">{t("pickupDate")}<input aria-label={t("pickupDate")} type="date" {...register("pickupDate", { required: true })} className={`${control} mt-2 w-full`} /></label>
      <label className="text-sm font-bold">{t("batchLabel")}<input aria-label={t("batchLabel")} {...register("batchName", { required: true, minLength: 2 })} className={`${control} mt-2 w-full`} /></label>
      <label className="text-sm font-bold md:col-span-2">{t("totalAdvancePaid")}<input aria-label={t("totalAdvancePaid")} type="number" min="0" {...register("advancePaid", { required: true, valueAsNumber: true, min: 0 })} className={`${control} mt-2 w-full`} /></label>
      {(Object.keys(errors).length > 0 || create.isError) && <p role="alert" className="text-sm text-rose-600 md:col-span-2">{create.error instanceof Error ? create.error.message : t("checkRequiredFields")}</p>}
      <div className="flex justify-end gap-3 md:col-span-2"><button type="button" onClick={onClose} className={control}>{t("cancel")}</button><button disabled={create.isPending} className="rounded-xl bg-[#1598ef] px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{create.isPending ? t("loading") : t("saveAndAddParcels")}</button></div>
    </form>
  </div></div>;
}
