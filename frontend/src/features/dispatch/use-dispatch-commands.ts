import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, api, apiRaw } from "@/lib/api";
import { resolveManifestPdfFilename } from "@/lib/content-disposition";
import { hubBusinessDate } from "@/lib/business-date";
import { buildManifestBody } from "@/lib/manifest-filters";
import type { Parcel } from "./dispatch-types";
import { useDispatchPreviews } from "./use-dispatch-data";
import { useDispatchState } from "./use-dispatch-state";
const assignmentEligibleStatuses = new Set(["CREATED", "PICKED_UP"]);
const fieldEditableStatuses = new Set(["CREATED", "PICKED_UP", "ASSIGNED"]);
const OPS_CORRECTION_NOTE = "Ops correction";
const OPS_REASSIGN_REASON = "Ops inline reassignment";

export function useDispatchCommands(state: ReturnType<typeof useDispatchState>) {
  const { t, queryClient, canPaidToOsHandover, selected, setSelected, linkRiderId, setLinkRiderId, setLinkOpen, linkReason, setLinkReason, unlinkingGroupId, setUnlinkingGroupId, unlinkReason, setUnlinkReason, bulkRiderId, setBulkRiderId, bulkStatus, setBulkStatus, bulkReasonCode, setBulkReasonCode, bulkOverrideNote, setBulkOverrideNote, manifestOpen, setManifestOpen, manifestRiderIds, manifestStatuses, manifestDatePreset, manifestDateFrom, manifestDateTo, partial, setPartial, setDeliveryChoice, paidToOs, setPaidToOs, setBulkDeliveryChoice, setBulkPaidToOs, includeDeliveryFee, setIncludeDeliveryFee, editing, setEditing, editForm, correctingRider, setCorrectingRider, correctRiderId, setCorrectRiderId, correctReason, setCorrectReason, setReasonPrompt, actualCod, setActualCod, collectionWallet, setCollectionWallet, reasonCode, setReasonCode, reasonNote, setReasonNote, setMessage, setRescheduleOpen, rescheduleDate, rescheduleReason, setReturnOpen, returnListOpen, includePaidToOsHandover, paidToOsDateFrom, paidToOsDateTo, paidToOsShopId, paidToOsRiderId, setFailedDecision, failedDecisionReason, setFailedDecisionReason, returnDate, returnRequest, visible } = state;
  const invalidateParcels = async () => {
    await Promise.all(["parcels", "operations-batches", "overdue-unsent", "dashboard"].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  const reschedule = useMutation({
    mutationFn: () => api("/parcels/reschedule", { method: "POST", body: JSON.stringify({ parcelIds: selected, plannedDeliveryDate: rescheduleDate, reason: rescheduleReason.trim() }) }),
    onSuccess: async () => { setRescheduleOpen(false); setSelected([]); setMessage(t("rescheduleComplete")); await invalidateParcels(); },
  });
  const confirmReturns = useMutation({
    mutationFn: () => { returnRequest.current ??= JSON.stringify({ parcelIds: selected, businessDate: returnDate, idempotencyKey: `bulk-return-${crypto.randomUUID()}` }); return api("/finance/os-returns/receive-bulk", { method: "POST", body: returnRequest.current }); },
    onSuccess: async () => { returnRequest.current = null; setReturnOpen(false); setSelected([]); setMessage(t("osReturnReceived")); await invalidateParcels(); await Promise.all(["os-accounts", "ledger", "operations-return-queue"].map(key => queryClient.invalidateQueries({ queryKey: [key] }))); },
    onError: error => { if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) returnRequest.current = null; },
  });

  const assign = useMutation({
    mutationFn: (input: { parcelIds: string[]; riderId: string; dispatch?: boolean }) =>
      api<{ assignedCount: number }>("/operations/parcels/bulk-assign", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: async (result) => {
      setSelected([]);
      setMessage(t("assignmentComplete", { count: result.data.assignedCount }));
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  const reassignOne = useMutation({
    mutationFn: (input: { parcelId: string; riderId: string; reason: string }) =>
      api(`/operations/parcels/${input.parcelId}/reassign`, {
        method: "POST",
        body: JSON.stringify({ riderId: input.riderId, reason: input.reason }),
      }),
    onSuccess: async () => {
      setMessage(t("reassignmentComplete"));
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  const correctRider = useMutation({
    mutationFn: () =>
      api(`/operations/parcels/${correctingRider!.id}/correct-rider`, {
        method: "POST",
        body: JSON.stringify({ riderId: correctRiderId, reason: correctReason.trim() }),
      }),
    onSuccess: async () => {
      setCorrectingRider(null);
      setCorrectRiderId("");
      setCorrectReason("");
      setMessage(t("correctRiderComplete"));
      await invalidateParcels();
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.code : undefined;
      setMessage(
        code && ["PARCEL_NOT_DELIVERED", "PARCEL_LINKED", "MONEY_POSTED", "RECOGNITION_NOT_FOUND", "SAME_RIDER", "HUB_MISMATCH", "ASSIGNMENT_CONFLICT", "DAY_CLOSED", "PARCEL_UNASSIGNED"].includes(code)
          ? t(`correctRiderError.${code}`)
          : e instanceof Error
            ? e.message
            : t("loadError"),
      );
    },
  });

  const updateStatus = useMutation({
    mutationFn: (input: { parcelId: string; status: string; reasonCode?: string; note?: string; collectionMode?: "CASH_RECEIPT_EXCEPTION"; returnToOs?: boolean }) =>
      api(`/parcels/${input.parcelId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: input.status,
          ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
          ...(input.collectionMode ? { collectionMode: input.collectionMode } : {}),
          ...(input.returnToOs ? { returnToOs: true } : {}),
          ...(input.note ? { note: input.note } : { note: OPS_CORRECTION_NOTE }),
        }),
      }),
    onSuccess: async (_result, input) => {
      setDeliveryChoice(null);
      setReasonPrompt(null);
      setReasonCode("");
      setReasonNote("");
      setMessage(t("statusUpdated"));
      await invalidateParcels();
      if (input.status === "FAILED") setFailedDecision(visible.find((parcel) => parcel.id === input.parcelId) ?? null);
      if (input.status === "REJECTED" && input.returnToOs) setMessage(t("cancelledMovedToReturn"));
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  const decideFailed = useMutation({
    mutationFn: (input: { parcel: Parcel; action: "RETRY_TOMORROW" | "RESCHEDULE" | "RETURN_TO_OS"; plannedDeliveryDate?: string; reason?:string }) => api(`/operations/parcels/${input.parcel.id}/failed-decision`, { method: "POST", body: JSON.stringify({ action: input.action, ...(input.plannedDeliveryDate ? { plannedDeliveryDate: input.plannedDeliveryDate } : {}), reason: input.reason?.trim()??failedDecisionReason.trim() }) }),
    onSuccess: async () => { setFailedDecision(null); setFailedDecisionReason(""); setMessage(t("statusUpdated")); await invalidateParcels(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
  });

  const manifestBody = useMemo(
    () =>
      buildManifestBody({
        riderIds: manifestRiderIds,
        statuses: manifestStatuses,
        datePreset: manifestDatePreset,
        dateFrom: manifestDateFrom,
        dateTo: manifestDateTo,
      }),
    [manifestRiderIds, manifestStatuses, manifestDatePreset, manifestDateFrom, manifestDateTo],
  );
  const downloadManifest = useMutation({
    mutationFn: () =>
      apiRaw("/operations/parcels/manifest", {
        method: "POST",
        body: JSON.stringify(manifestBody),
      }),
    onSuccess: async (response) => {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = resolveManifestPdfFilename(response.headers.get("Content-Disposition"));
      link.click();
      URL.revokeObjectURL(url);
      setManifestOpen(false);
      setMessage(t("manifestDownloaded"));
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  const savePartial = useMutation({
    mutationFn: () =>
      api(`/parcels/${partial?.id}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: "PARTIAL",
          reasonCode,
          actualCodCollected: Number(actualCod),
          collectionWallet,
          ...(reasonNote.trim() ? { note: reasonNote.trim() } : {}),
        }),
      }),
    onSuccess: async () => {
      setPartial(null);
      setActualCod("");
      setCollectionWallet("");
      setReasonCode("");
      setReasonNote("");
      setMessage(t("partialReturnSaved"));
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  const savePaidToOs = useMutation({
    mutationFn: () =>
      api(`/parcels/${paidToOs?.id}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: "DELIVERED",
          collectionMode: "PAID_BY_OS",
          paidToOsIncludeDeliveryFee: includeDeliveryFee,
          note: OPS_CORRECTION_NOTE,
        }),
      }),
    onSuccess: async () => {
      setPaidToOs(null);
      setIncludeDeliveryFee(false);
      setMessage(t("paidToOsSaved"));
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  const updateParcel = useMutation({
    mutationFn: () => {
      const canEditDeliveryFields = fieldEditableStatuses.has(editing!.status) && !editing!.linkGroup;
      return api(`/parcels/${editing!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          orderId: editForm.orderId.trim() || null,
          customerName: editForm.customerName.trim(),
          address: editForm.address.trim(),
          customerPhone: editForm.customerPhone.trim() || null,
          ...(canEditDeliveryFields
            ? {
                codAmount: Number(editForm.codAmount),
                deliveryFee: Number(editForm.deliveryFee),
                townshipId: editForm.townshipId,
                zoneId: editForm.zoneId || null,
              }
            : {}),
        }),
      });
    },
    onSuccess: async () => {
      setEditing(null);
      setMessage(t("parcelUpdated"));
      await invalidateParcels();
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.code : undefined;
      setMessage(
        code && ["MONEY_POSTED", "ADVANCE_POSTED", "PARCEL_NOT_EDITABLE", "PARCEL_LINKED"].includes(code)
          ? t(`parcelUpdateError.${code}`)
          : e instanceof Error ? e.message : t("loadError"),
      );
    },
  });

  const selectedParcels = visible.filter((parcel) => selected.includes(parcel.id));
  const bulkPaidToOsHasLinkedParcel = selectedParcels.some((parcel) => Boolean(parcel.linkGroup));
  const returnListEligible = selectedParcels.length > 0 && selectedParcels.length <= 500 && selectedParcels.every((parcel) => ["PENDING_RETURN", "REJECTED"].includes(parcel.status));
  const downloadReturnList = useMutation({
    mutationFn: () => apiRaw("/operations/parcels/returns/pdf", { method: "POST", body: JSON.stringify({ parcelIds: selectedParcels.map((parcel) => parcel.id) }) }),
    onSuccess: async (response) => { const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = resolveManifestPdfFilename(response.headers.get("Content-Disposition")); link.click(); URL.revokeObjectURL(url); },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
  });
  const paidToOsHandoverBody = useMemo(
    () => ({
      ...(paidToOsDateFrom ? { dateFrom: paidToOsDateFrom } : {}),
      ...(paidToOsDateTo ? { dateTo: paidToOsDateTo } : {}),
      ...(paidToOsShopId ? { shopId: paidToOsShopId } : {}),
      ...(paidToOsRiderId ? { riderId: paidToOsRiderId } : {}),
    }),
    [paidToOsDateFrom, paidToOsDateTo, paidToOsShopId, paidToOsRiderId],
  );
  const { manifestPreview, returnListPreview, paidToOsListPreview } = useDispatchPreviews({
    manifestBody, manifestOpen, selectedParcelIds: selectedParcels.map((parcel) => parcel.id),
    returnListOpen, returnListEligible, includePaidToOsHandover, canPaidToOsHandover, paidToOsHandoverBody,
  });
  const downloadPaidToOsList = useMutation({
    mutationFn: () =>
      apiRaw("/operations/parcels/paid-to-os/pdf", {
        method: "POST",
        body: JSON.stringify(paidToOsHandoverBody),
      }),
    onSuccess: async (response) => {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = resolveManifestPdfFilename(response.headers.get("Content-Disposition"));
      link.click();
      URL.revokeObjectURL(url);
      setMessage(t("paidToOsHandoverDownloaded"));
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
  });
  const linkValidation =
    selectedParcels.length < 2
      ? t("selectAtLeastTwoForLink")
      : selectedParcels.some((parcel) => parcel.linkGroup || ["DELIVERED", "RETURNED"].includes(parcel.status))
        ? t("selectedParcelsNotLinkable")
        : null;

  const selectedLinkGroupIds = [...new Set(selectedParcels.map((parcel) => parcel.linkGroup?.id).filter(Boolean))] as string[];
  const unlinkGroupId = selectedParcels.length > 0 && selectedLinkGroupIds.length === 1 && selectedParcels.every((parcel) => parcel.linkGroup?.id === selectedLinkGroupIds[0])
    ? selectedLinkGroupIds[0]!
    : null;

  const link = useMutation({
    mutationFn: () =>
      api("/operations/parcels/link", {
        method: "POST",
        // Never submit IDs retained from a different filter/page.
        body: JSON.stringify({ parcelIds: selectedParcels.map((parcel) => parcel.id), responsibleRiderId: linkRiderId, reason: linkReason.trim() }),
      }),
    onSuccess: async () => {
      setSelected([]);
      setLinkOpen(false);
      setLinkReason("");
      setLinkRiderId("");
      setMessage(t("parcelsLinked"));
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  const openLinkModal = () => {
    // Linking reassesses responsibility. When every chosen parcel already has
    // the same rider, make that safe, obvious default instead of disabling the
    // action behind the separate dispatch-rider selector.
    const existingRiderIds = [...new Set(selectedParcels.map((parcel) => parcel.rider?.id).filter((id): id is string => Boolean(id)))];
    setLinkRiderId(existingRiderIds.length === 1 ? existingRiderIds[0] : "");
    setLinkOpen(true);
  };

  const unlink = useMutation({
    mutationFn: () => api(`/operations/parcel-link-groups/${unlinkingGroupId}/unlink`, {
      method: "POST",
      body: JSON.stringify({
        reason: unlinkReason.trim(),
        businessDate: hubBusinessDate(),
        idempotencyKey: `unlink-${crypto.randomUUID()}`,
      }),
    }),
    onSuccess: async () => {
      setSelected([]);
      setUnlinkingGroupId(null);
      setUnlinkReason("");
      setMessage(t("parcelsUnlinked"));
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  const applyRiderBulk = useMutation({
    mutationFn: async () => {
      const target = bulkRiderId;
      if (!target || !selectedParcels.length) return { assigned: 0, reassigned: 0 };
      const toAssign = selectedParcels.filter((p) => !p.rider?.id && assignmentEligibleStatuses.has(p.status));
      const toReassign = selectedParcels.filter((p) => p.rider?.id && p.rider.id !== target);
      let assigned = 0;
      if (toAssign.length) {
        const result = await api<{ assignedCount: number }>("/operations/parcels/bulk-assign", {
          method: "POST",
          body: JSON.stringify({ parcelIds: toAssign.map((p) => p.id), riderId: target }),
        });
        assigned = result.data.assignedCount;
      }
      for (const parcel of toReassign) {
        await api(`/operations/parcels/${parcel.id}/reassign`, {
          method: "POST",
          body: JSON.stringify({ riderId: target, reason: OPS_REASSIGN_REASON }),
        });
      }
      return { assigned, reassigned: toReassign.length };
    },
    onSuccess: async (result) => {
      setSelected([]);
      setBulkRiderId("");
      setMessage(
        t("multiEditRiderApplied", {
          assigned: result.assigned,
          reassigned: result.reassigned,
        }),
      );
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  const applyStatusBulk = useMutation({
    mutationFn: async (delivery?: { collectionMode: "PAID_BY_OS" | "CASH_RECEIPT_EXCEPTION"; paidToOsIncludeDeliveryFee?: boolean }) => {
      if (!bulkStatus || bulkStatus === "PARTIAL" || !selectedParcels.length) return 0;
      if ((bulkStatus === "FAILED" || bulkStatus === "REJECTED") && !bulkReasonCode) {
        throw new Error(t("reasonRequired"));
      }
      const note = bulkOverrideNote.trim() || OPS_CORRECTION_NOTE;
      if (selectedParcels.length > 50) {
        throw new Error(t("bulkStatusCap"));
      }
      const parcelIds = selectedParcels.filter((parcel) => parcel.status !== bulkStatus).map((parcel) => parcel.id);
      if (!parcelIds.length) return 0;
      const result = await api<{ updatedCount: number }>("/parcels/bulk-status", {
        method: "POST",
        body: JSON.stringify({
          parcelIds,
          status: bulkStatus,
          note,
          ...(bulkStatus === "DELIVERED" ? delivery : {}),
          ...((bulkStatus === "FAILED" || bulkStatus === "REJECTED") && bulkReasonCode
            ? { reasonCode: bulkReasonCode }
            : {}),
        }),
      });
      return result.data.updatedCount;
    },
    onSuccess: async (count) => {
      setSelected([]);
      setBulkStatus("");
      setBulkReasonCode("");
      setBulkOverrideNote("");
      setBulkDeliveryChoice(false);
      setBulkPaidToOs(false);
      setMessage(t("multiEditStatusApplied", { count }));
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

  return { invalidateParcels, reschedule, confirmReturns, assign, reassignOne, correctRider, updateStatus, decideFailed, manifestBody, manifestPreview, downloadManifest, savePartial, savePaidToOs, updateParcel, selectedParcels, bulkPaidToOsHasLinkedParcel, returnListEligible, returnListPreview, downloadReturnList, paidToOsHandoverBody, paidToOsListPreview, downloadPaidToOsList, linkValidation, selectedLinkGroupIds, unlinkGroupId, link, openLinkModal, unlink, applyRiderBulk, applyStatusBulk };
}
