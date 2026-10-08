import { useEffect } from "react";
import { TO_DELIVER_STATUSES } from "@/lib/manifest-filters";
import type { Parcel } from "./dispatch-types";
import type { DispatchFilters as Filters } from "@/lib/dispatch-filters";
import { useDispatchState } from "./use-dispatch-state";
import { useDispatchCommands } from "./use-dispatch-commands";
const assignmentEligibleStatuses = new Set(["CREATED", "PICKED_UP"]);
const OPS_REASSIGN_REASON = "Ops inline reassignment";
const OPS_CORRECTION_NOTE = "Ops correction";
export function useDispatchController({ workspace = "dispatch" }: { workspace?: "dispatch" | "returns" }) {
  const state = useDispatchState({ workspace });
  const commands = useDispatchCommands(state);
  const { t, searchParams, setSearchParams, setFilters, setPage, selected, setSelected, setManifestOpen, setManifestRiderIds, setManifestStatuses, setManifestDatePreset, setManifestDateFrom, setManifestDateTo, setPartial, setDeliveryChoice, setCorrectingRider, setCorrectRiderId, setCorrectReason, setReasonPrompt, setFailedDecision, setRejectAsCancelled, setActualCod, setCollectionWallet, setReasonCode, setReasonNote, setMessage, masters, visible, parcels, queryString } = state;
  const { assign, reassignOne, updateStatus, savePaidToOs, selectedParcels } = commands;
  useEffect(() => {
    const decisionId = searchParams.get("decision");
    if (workspace !== "dispatch" || !decisionId || !parcels.isSuccess) return;
    // The text filter is debounced. Keep the link intact until this result set
    // belongs to the tracking number requested by the alert.
    if (new URLSearchParams(queryString).get("trackingNumber") !== searchParams.get("trackingNumber")) return;
    const parcel = visible.find((item) => item.id === decisionId && item.status === "FAILED");
    if (parcel) setFailedDecision(parcel);
    const next = new URLSearchParams(searchParams);
    next.delete("decision");
    setSearchParams(next, { replace: true });
  }, [workspace, searchParams, queryString, parcels.isSuccess, visible, setFailedDecision, setSearchParams]);
  const setFilter = (key: keyof Filters, value: string) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const eligible = (parcel: Parcel) => !parcel.rider && assignmentEligibleStatuses.has(parcel.status);
  const selectedAssignmentEligible = selectedParcels.length > 0 && selectedParcels.every(eligible);
  const allSelected = visible.length > 0 && visible.every((p) => selected.includes(p.id));
  const toggleAll = () =>
    setSelected(allSelected ? [] : visible.map((p) => p.id));
  const toggleOne = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));

  const openManifestModal = () => {
    const assignedRiderIds = [
      ...new Set(visible.filter((parcel) => parcel.rider?.id).map((parcel) => parcel.rider!.id!)),
    ];
    setManifestRiderIds(assignedRiderIds.length ? assignedRiderIds : []);
    setManifestStatuses([...TO_DELIVER_STATUSES]);
    setManifestDatePreset("today");
    setManifestDateFrom("");
    setManifestDateTo("");
    setManifestOpen(true);
  };
  const toggleManifestRider = (id: string) =>
    setManifestRiderIds((current) => (current.includes(id) ? current.filter((rider) => rider !== id) : [...current, id]));

  const handleRiderChange = async (parcel: Parcel, nextRiderId: string) => {
    if (!nextRiderId || nextRiderId === (parcel.rider?.id ?? "")) return;
    if (parcel.status === "DELIVERED") {
      setCorrectingRider(parcel);
      setCorrectRiderId(nextRiderId);
      setCorrectReason("");
      return;
    }
    if (!parcel.rider?.id) {
      if (!assignmentEligibleStatuses.has(parcel.status)) {
        setMessage(t("assignmentSelectionHint"));
        return;
      }
      assign.mutate({ parcelIds: [parcel.id], riderId: nextRiderId });
      return;
    }
    reassignOne.mutate({ parcelId: parcel.id, riderId: nextRiderId, reason: OPS_REASSIGN_REASON });
  };

  const handleStatusChange = (parcel: Parcel, nextStatus: string) => {
    if (!nextStatus || nextStatus === parcel.status) return;
    if (nextStatus === "PARTIAL") {
      setPartial(parcel);
      setReasonCode("");
      setReasonNote("");
      setActualCod("");
      setCollectionWallet("");
      return;
    }
    if (nextStatus === "DELIVERED") {
      updateStatus.reset();
      savePaidToOs.reset();
      setDeliveryChoice(parcel);
      return;
    }
    if (nextStatus === "FAILED" || nextStatus === "REJECTED" || nextStatus === "PENDING_RETURN") {
      setReasonPrompt({ parcel, status: nextStatus });
      setRejectAsCancelled(false);
      setReasonCode("");
      setReasonNote("");
      return;
    }
    updateStatus.mutate({ parcelId: parcel.id, status: nextStatus, note: OPS_CORRECTION_NOTE });
  };

  const riders = masters.data?.riders ?? [];

  return { ...state, ...commands, setFilter, eligible, selectedAssignmentEligible, allSelected, toggleAll, toggleOne, openManifestModal, toggleManifestRider, handleRiderChange, handleStatusChange, riders };
}
