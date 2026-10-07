import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { hubBusinessDate } from "@/lib/business-date";
import { TO_DELIVER_STATUSES, type ManifestDatePreset, type ManifestStatus } from "@/lib/manifest-filters";
import { dispatchFiltersFromSearch, type DispatchFilters as Filters } from "@/lib/dispatch-filters";
import type { Parcel, ReasonCode } from "./dispatch-types";
import { useDispatchData } from "./use-dispatch-data";
export function useDispatchState({ workspace = "dispatch" }: { workspace?: "dispatch" | "returns" }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const canDispatchEdit = ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(user?.role ?? "");
  const canPaidToOsHandover = ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "FINANCE", "AUDITOR"].includes(user?.role ?? "");
  const workspaceQueue = workspace === "returns" ? "return-to-os" : "";
  const [filters, setFilters] = useState<Filters>(() => dispatchFiltersFromSearch(searchParams,workspaceQueue));
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [riderId, setRiderId] = useState("");
  const [linkRiderId, setLinkRiderId] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkReason, setLinkReason] = useState("");
  const [unlinkingGroupId, setUnlinkingGroupId] = useState<string | null>(null);
  const [unlinkReason, setUnlinkReason] = useState("");
  const [bulkRiderId, setBulkRiderId] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkReasonCode, setBulkReasonCode] = useState("");
  const [bulkOverrideNote, setBulkOverrideNote] = useState("");
  const [manifestOpen, setManifestOpen] = useState(false);
  const [manifestRiderIds, setManifestRiderIds] = useState<string[]>([]);
  const [manifestStatuses, setManifestStatuses] = useState<ManifestStatus[]>([...TO_DELIVER_STATUSES]);
  const [manifestDatePreset, setManifestDatePreset] = useState<ManifestDatePreset>("all");
  const [manifestDateFrom, setManifestDateFrom] = useState("");
  const [manifestDateTo, setManifestDateTo] = useState("");
  const [partial, setPartial] = useState<Parcel | null>(null);
  const [deliveryChoice, setDeliveryChoice] = useState<Parcel | null>(null);
  const [paidToOs, setPaidToOs] = useState<Parcel | null>(null);
  const [bulkDeliveryChoice, setBulkDeliveryChoice] = useState(false);
  const [bulkPaidToOs, setBulkPaidToOs] = useState(false);
  const [includeDeliveryFee, setIncludeDeliveryFee] = useState(false);
  const [editing, setEditing] = useState<Parcel | null>(null);
  const [voiding, setVoiding] = useState<Parcel | null>(null);
  const [historyParcel,setHistoryParcel]=useState<{id:string;trackingNumber:string}|null>(null);
  const [editForm, setEditForm] = useState({
    orderId: "",
    customerName: "",
    address: "",
    customerPhone: "",
    codAmount: "",
    deliveryFee: "",
    townshipId: "",
    zoneId: "",
  });
  const [correctingRider, setCorrectingRider] = useState<Parcel | null>(null);
  const [correctRiderId, setCorrectRiderId] = useState("");
  const [correctReason, setCorrectReason] = useState("");
  const [reasonPrompt, setReasonPrompt] = useState<{ parcel: Parcel; status: "FAILED" | "REJECTED" | "PENDING_RETURN" } | null>(null);
  const [rejectAsCancelled, setRejectAsCancelled] = useState(false);
  const [actualCod, setActualCod] = useState("");
  const [collectionWallet, setCollectionWallet] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(hubBusinessDate());
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnListOpen, setReturnListOpen] = useState(false);
  const [includePaidToOsHandover, setIncludePaidToOsHandover] = useState(false);
  const [paidToOsDateFrom, setPaidToOsDateFrom] = useState(hubBusinessDate());
  const [paidToOsDateTo, setPaidToOsDateTo] = useState(hubBusinessDate());
  const [paidToOsShopId, setPaidToOsShopId] = useState("");
  const [paidToOsRiderId, setPaidToOsRiderId] = useState("");
  const [failedDecision, setFailedDecision] = useState<Parcel | null>(null);
  const [failedDecisionReason, setFailedDecisionReason] = useState("");
  const [returnDate, setReturnDate] = useState(hubBusinessDate());
  const returnRequest = useRef<string | null>(null);
  const selectionScope = useRef("");

  useEffect(() => {
    const next=dispatchFiltersFromSearch(searchParams,workspaceQueue);
    setFilters((current) =>
      (Object.keys(next) as Array<keyof Filters>).every((key) => current[key] === next[key]) ? current : next,
    );
  }, [searchParams, workspaceQueue]);

  const { queryString, parcels, overdueUnsent, masters, batches, reasons, townships, editZones } = useDispatchData(filters, page, editing, editForm.townshipId);
  useEffect(() => {
    if (!selectionScope.current) {
      selectionScope.current = queryString;
      return;
    }
    if (selectionScope.current !== queryString) {
      selectionScope.current = queryString;
      setSelected([]);
    }
  }, [queryString]);

  useEffect(() => {
    if (!editing) return;
    setEditForm({
      orderId: editing.orderId ?? "",
      customerName: editing.customerName,
      address: editing.address ?? "",
      customerPhone: editing.customerPhone ?? "",
      codAmount: String(editing.codAmount),
      deliveryFee: String(editing.deliveryFee ?? 0),
      townshipId: editing.townshipId ?? "",
      zoneId: editing.zoneId ?? "",
    });
  }, [editing]);

  const visible = parcels.data?.items ?? [];
  const pagination = parcels.data?.pagination;
  const reasonList = Array.isArray(reasons.data) ? reasons.data : [];
  const reasonLabel = (reason: ReasonCode) => (i18n.resolvedLanguage === "my" ? reason.labelMy : reason.labelEn);
  const selectedReason = reasonList.find((reason) => reason.code === reasonCode);
  const promptReasons = reasonList.filter(
    (reason) => reason.active && reason.outcome === (reasonPrompt?.status ?? "FAILED"),
  );
  const partialReasons = reasonList.filter((reason) => reason.active && reason.outcome === "PARTIAL");
  const bulkReasons = reasonList.filter(
    (reason) => reason.active && (bulkStatus === "FAILED" || bulkStatus === "REJECTED") && reason.outcome === bulkStatus,
  );

  return { t, i18n, user, searchParams, setSearchParams, queryClient, canDispatchEdit, canPaidToOsHandover, workspaceQueue, filters, setFilters, page, setPage, selected, setSelected, riderId, setRiderId, linkRiderId, setLinkRiderId, linkOpen, setLinkOpen, linkReason, setLinkReason, unlinkingGroupId, setUnlinkingGroupId, unlinkReason, setUnlinkReason, bulkRiderId, setBulkRiderId, bulkStatus, setBulkStatus, bulkReasonCode, setBulkReasonCode, bulkOverrideNote, setBulkOverrideNote, manifestOpen, setManifestOpen, manifestRiderIds, setManifestRiderIds, manifestStatuses, setManifestStatuses, manifestDatePreset, setManifestDatePreset, manifestDateFrom, setManifestDateFrom, manifestDateTo, setManifestDateTo, partial, setPartial, deliveryChoice, setDeliveryChoice, paidToOs, setPaidToOs, bulkDeliveryChoice, setBulkDeliveryChoice, bulkPaidToOs, setBulkPaidToOs, includeDeliveryFee, setIncludeDeliveryFee, editing, setEditing, voiding, setVoiding, historyParcel, setHistoryParcel, editForm, setEditForm, correctingRider, setCorrectingRider, correctRiderId, setCorrectRiderId, correctReason, setCorrectReason, reasonPrompt, setReasonPrompt, rejectAsCancelled, setRejectAsCancelled, actualCod, setActualCod, collectionWallet, setCollectionWallet, reasonCode, setReasonCode, reasonNote, setReasonNote, message, setMessage, rescheduleOpen, setRescheduleOpen, rescheduleDate, setRescheduleDate, rescheduleReason, setRescheduleReason, returnOpen, setReturnOpen, returnListOpen, setReturnListOpen, includePaidToOsHandover, setIncludePaidToOsHandover, paidToOsDateFrom, setPaidToOsDateFrom, paidToOsDateTo, setPaidToOsDateTo, paidToOsShopId, setPaidToOsShopId, paidToOsRiderId, setPaidToOsRiderId, failedDecision, setFailedDecision, failedDecisionReason, setFailedDecisionReason, returnDate, setReturnDate, returnRequest, selectionScope, queryString, parcels, overdueUnsent, masters, batches, reasons, townships, editZones, visible, pagination, reasonList, reasonLabel, selectedReason, promptReasons, partialReasons, bulkReasons };
}
