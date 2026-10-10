import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { ModalPortal } from "@/components/modal-portal";
import type { MasterData } from "./dispatch-types";

type Candidate = {
  id: string;
  trackingNumber: string;
  customerName: string;
  customerPhone: string;
  address: string | null;
  townshipName: string | null;
  status: string;
  riderId: string | null;
  deliveryFee: number | null;
};
type Suggestion = {
  key: string;
  hubId: string;
  shopName: string;
  normalizedPhone: string;
  normalizedName: string;
  parcels: Candidate[];
};
type SuggestionsResponse = { groups: Suggestion[]; scanned: number; omittedGroups: number; omittedCandidates: number; unscannedParcelCount: number };

export function LinkSuggestionsPanel({ enabled, riders }: { enabled: boolean; riders: MasterData["riders"] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [review, setReview] = useState<Suggestion | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [riderId, setRiderId] = useState("");
  const [reason, setReason] = useState("");
  const [addressesChecked, setAddressesChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestions = useQuery({
    queryKey: ["parcel-link-suggestions"],
    enabled: enabled && expanded,
    queryFn: () => api<SuggestionsResponse>("/operations/parcels/link-suggestions").then((response) => response.data),
  });
  const link = useMutation({
    mutationFn: () => api("/operations/parcels/link", {
      method: "POST",
      body: JSON.stringify({ parcelIds: selectedIds, responsibleRiderId: riderId, reason: reason.trim() }),
    }),
    onSuccess: async () => {
      setReview(null);
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["parcels"] }),
        queryClient.invalidateQueries({ queryKey: ["parcel-link-suggestions"] }),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t("loadError")),
  });
  if (!enabled) return null;
  const openReview = (suggestion: Suggestion) => {
    setReview(suggestion);
    setSelectedIds(suggestion.parcels.map((parcel) => parcel.id));
    const eligibleRiderIds = new Set(riders.filter((rider) => rider.hubId === suggestion.hubId).map((rider) => rider.id));
    const existingRiders = [...new Set(suggestion.parcels.map((parcel) => parcel.riderId).filter((id): id is string => typeof id === "string" && eligibleRiderIds.has(id)))];
    setRiderId(existingRiders.length === 1 ? existingRiders[0]! : "");
    setReason("");
    setAddressesChecked(false);
    setError(null);
  };
  const closeReview = () => { if (!link.isPending) setReview(null); };
  const selectedParcels = review?.parcels.filter((parcel) => selectedIds.includes(parcel.id)) ?? [];
  const baseFee = Math.max(0, ...selectedParcels.map((parcel) => parcel.deliveryFee ?? 0));
  const linkedFee = baseFee + Math.max(0, selectedParcels.length - 1) * 1000;
  return <>
    <section aria-labelledby="link-suggestions-title" className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-800 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="link-suggestions-title" className="flex items-center gap-2 text-sm font-bold"><Link2 aria-hidden="true" size={16} />{t("linkSuggestionsTitle")}</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{t("linkSuggestionsHelp")}</p>
        </div>
        <button type="button" onClick={() => { if (expanded) void suggestions.refetch(); else setExpanded(true); }} disabled={suggestions.isFetching} className="rounded-md border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-800 disabled:opacity-50 dark:border-sky-700 dark:text-sky-200">{expanded ? t("refresh") : t("findLinkSuggestions")}</button>
      </div>
      {!expanded ? null : suggestions.isLoading ? <p className="mt-3 text-xs text-slate-500">{t("loading")}</p>
        : suggestions.isError ? <p role="alert" className="mt-3 text-xs text-rose-600">{t("linkSuggestionsError")}</p>
        : !suggestions.data?.groups?.length ? <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">{t("linkSuggestionsEmpty")}</p>
        : <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {suggestions.data.groups.map((suggestion) => <article key={suggestion.key} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#181a1d]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-sm font-semibold">{suggestion.parcels[0]?.customerName}</p><p className="text-xs text-slate-500">{suggestion.normalizedPhone} · {suggestion.shopName} · {t("linkSuggestionParcelCount", { count: suggestion.parcels.length })}</p></div>
              <button type="button" onClick={() => openReview(suggestion)} className="rounded-md border border-sky-400 px-3 py-1.5 text-xs font-bold text-sky-700 dark:text-sky-300">{t("reviewLinkSuggestion")}</button>
            </div>
          </article>)}
        </div>}
      {expanded && (suggestions.data?.omittedCandidates ?? 0) > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("linkSuggestionsOmitted", { count: suggestions.data!.omittedCandidates })}</p>}
      {expanded && (suggestions.data?.omittedGroups ?? 0) > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("linkSuggestionsOmittedGroups", { count: suggestions.data!.omittedGroups })}</p>}
      {expanded && (suggestions.data?.unscannedParcelCount ?? 0) > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("linkSuggestionsUnscanned", { count: suggestions.data!.unscannedParcelCount })}</p>}
    </section>
    {review && <ModalPortal><div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/55 p-4">
      <form role="dialog" aria-modal="true" aria-label={t("reviewLinkSuggestion")} onSubmit={(event) => { event.preventDefault(); if (selectedIds.length >= 2 && addressesChecked && riderId && reason.trim().length >= 3) link.mutate(); }} className="my-6 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#181a1d]">
        <div className="flex items-start justify-between gap-2"><div><h3 className="text-lg font-bold">{t("reviewLinkSuggestion")}</h3><p className="mt-1 text-sm text-slate-500">{review.shopName} · {review.parcels[0]?.customerName} · {review.normalizedPhone}</p></div><button type="button" onClick={closeReview} aria-label={t("close")} className="rounded-md p-1 focus-visible:outline-2 focus-visible:outline-sky-500"><X aria-hidden="true" size={20}/></button></div>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{t("linkSuggestionReviewHelp")}</p>
        <div className="mt-3 grid max-h-72 gap-2 overflow-auto sm:grid-cols-2">
          {review.parcels.map((parcel) => <label key={parcel.id} className="flex gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-white/10">
            <input type="checkbox" checked={selectedIds.includes(parcel.id)} onChange={(event) => { setSelectedIds((ids) => event.target.checked ? [...ids, parcel.id] : ids.filter((id) => id !== parcel.id)); setAddressesChecked(false); }} className="mt-1 h-4 w-4 accent-sky-600" aria-label={t("linkSuggestionSelectParcel", { tracking: parcel.trackingNumber })}/>
            <span><span className="font-semibold">{parcel.trackingNumber}</span> · {parcel.customerName} · {parcel.customerPhone}<span className="mt-1 block text-slate-600 dark:text-slate-300">{parcel.address || t("linkSuggestionNoAddress")} · {parcel.townshipName || "—"}</span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{t("status")}: {parcel.status.replaceAll("_", " ")} · {t("rider")}: {riders.find((rider) => rider.id === parcel.riderId)?.user.name || t("unassigned")} · {t("fee")}: {(parcel.deliveryFee ?? 0).toLocaleString()} MMK</span></span>
          </label>)}
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={addressesChecked} onChange={(event) => setAddressesChecked(event.target.checked)} className="mt-1 h-4 w-4 accent-sky-600"/>{t("linkSuggestionAddressChecked")}</label>
        <p className="mt-3 rounded-md bg-sky-50 p-2 text-sm dark:bg-sky-950/40">{t("linkSuggestionFeePreview", { amount: linkedFee.toLocaleString(), count: selectedParcels.length })}</p>
        <label className="mt-3 block text-xs font-bold">{t("responsibleRider")}<select value={riderId} onChange={(event) => setRiderId(event.target.value)} required className="mt-1 w-full rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-white/10 dark:bg-[#121416]"><option value="">{t("selectRider")}</option>{riders.filter((rider) => rider.hubId === review.hubId).map((rider) => <option key={rider.id} value={rider.id}>{rider.user.name}</option>)}</select></label>
        <label className="mt-3 block text-xs font-bold">{t("reason")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} required className="mt-1 w-full rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-white/10 dark:bg-[#121416]"/></label>
        {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={closeReview} className="rounded-md border border-slate-300 px-3 py-2 text-sm">{t("cancel")}</button><button type="submit" disabled={link.isPending || selectedIds.length < 2 || !addressesChecked || !riderId || reason.trim().length < 3} className="rounded-md bg-sky-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">{link.isPending ? t("loading") : t("confirmLink")}</button></div>
      </form>
    </div></ModalPortal>}
  </>;
}
