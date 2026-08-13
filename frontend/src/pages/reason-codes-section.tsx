import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";

type Outcome = "PARTIAL" | "FAILED" | "REJECTED";
type ReasonCode = {
  id: string;
  code: string;
  labelEn: string;
  labelMy: string;
  outcome: Outcome;
  noteRequired: boolean;
  active: boolean;
};

const control = "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1598ef] dark:border-white/10 dark:bg-[#121416]";
const initialForm = { code: "", labelEn: "", labelMy: "", outcome: "PARTIAL" as Outcome, noteRequired: false };

export function ReasonCodesSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const reasons = useQuery({
    queryKey: ["reason-codes"],
    queryFn: () => api<ReasonCode[]>("/master-data/reason-codes").then((response) => response.data),
  });
  const createReason = useMutation({
    mutationFn: () => api("/master-data/reason-codes", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: async () => {
      setForm(initialForm);
      await queryClient.invalidateQueries({ queryKey: ["reason-codes"] });
    },
  });
  const toggleReason = useMutation({
    mutationFn: (reason: ReasonCode) => api(`/master-data/reason-codes/${reason.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !reason.active }),
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["reason-codes"] }),
  });
  const valid = form.code.trim().length >= 2 && form.labelEn.trim().length >= 2 && form.labelMy.trim().length >= 1;

  return <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d] lg:col-span-2">
    <h2 className="font-display text-lg font-bold">{t("reasonCodeManagement")}</h2>
    <p className="mt-1 text-sm text-slate-500">{t("reasonCodeManagementDescription")}</p>
    <form className="mt-4 grid gap-2 md:grid-cols-6" onSubmit={(event) => { event.preventDefault(); if (valid) createReason.mutate(); }}>
      <input aria-label={t("reasonCode")} value={form.code} onChange={(event) => setForm((value) => ({ ...value, code: event.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") }))} className={control} placeholder={t("reasonCode")} />
      <input aria-label={t("reasonLabelEnglish")} value={form.labelEn} onChange={(event) => setForm((value) => ({ ...value, labelEn: event.target.value }))} className={control} placeholder={t("reasonLabelEnglish")} />
      <input aria-label={t("reasonLabelMyanmar")} value={form.labelMy} onChange={(event) => setForm((value) => ({ ...value, labelMy: event.target.value }))} className={control} placeholder={t("reasonLabelMyanmar")} />
      <select aria-label={t("reasonOutcome")} value={form.outcome} onChange={(event) => setForm((value) => ({ ...value, outcome: event.target.value as Outcome }))} className={control}>
        <option value="PARTIAL">{t("partial")}</option><option value="FAILED">{t("failed")}</option><option value="REJECTED">{t("rejected")}</option>
      </select>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.noteRequired} onChange={(event) => setForm((value) => ({ ...value, noteRequired: event.target.checked }))} />{t("noteRequired")}</label>
      <button disabled={!valid || createReason.isPending} className="rounded-xl bg-[#1598ef] px-4 text-sm font-bold text-white disabled:opacity-50">{t("addReasonCode")}</button>
    </form>
    {reasons.isLoading ? <p className="mt-5">{t("loading")}</p> : reasons.isError ? <button className={`${control} mt-5`} onClick={() => void reasons.refetch()}>{t("retry")}</button> : <ul className="mt-5 grid gap-2 md:grid-cols-2">{reasons.data?.map((reason) => <li key={reason.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm dark:bg-white/5"><span><b>{i18n.resolvedLanguage === "my" ? reason.labelMy : reason.labelEn}</b><span className="ml-2 text-slate-500">{reason.code} · {t(reason.outcome.toLowerCase())}</span></span><button aria-label={t(reason.active ? "deactivateReason" : "activateReason", { reason: reason.code })} disabled={toggleReason.isPending} onClick={() => toggleReason.mutate(reason)} className="rounded-lg border px-3 py-1.5 font-bold">{t(reason.active ? "active" : "inactive")}</button></li>)}</ul>}
  </section>;
}
