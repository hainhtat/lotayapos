import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Link2, Pencil, RefreshCw, Search, UserPlus, UserRoundPen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { DeliveryStatusPanel, type ManifestPreviewData } from "@/components/delivery-status-panel";
import { ApiError, api, apiRaw } from "@/lib/api";
import { resolveManifestPdfFilename } from "@/lib/content-disposition";
import { isDateChangeReason } from "@/lib/exception-reasons";
import { hubBusinessDate } from "@/lib/business-date";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { ParcelFieldHistory } from "@/components/parcel-field-history";
import {
  buildManifestBody,
  MANIFEST_DATE_PRESETS,
  MANIFEST_STATUS_FILTERS,
  manifestStatusLabelKey,
  type ManifestDatePreset,
  type ManifestStatusKey,
} from "@/lib/manifest-filters";

type Parcel = {
  id: string;
  trackingNumber: string;
  orderId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  address?: string | null;
  status: string;
  codAmount: number;
  deliveryFee?: number | null;
  actualCodCollected?: number | null;
  townshipId?: string | null;
  zoneId?: string | null;
  batch: { id?: string; label: string; pickupDate?: string; shop: { name: string } };
  rider?: { id?: string; user?: { name?: string } } | null;
  zone?: string | null;
  township?: string | null;
  linkGroup?: { id: string; address: string; baseDeliveryFee: number; totalDeliveryFee: number } | null;
  reasonCode?: string | null;
  plannedDeliveryDate?: string | null;
  createdAt?: string;
};
type Township = {
  id: string;
  nameEn: string;
  nameMy?: string | null;
  deliveryFee: number;
  district?: { nameEn: string; regionState?: { nameEn: string } };
};
type Zone = { id: string; name: string };
type BatchSummary = {
  id: string;
  label: string;
  pickupDate: string;
  shop: { name: string };
  parcels: Array<{ status: string }>;
};
type Filters = {
  queue: string;
  shopId: string;
  batchId: string;
  riderId: string;
  assignmentStatus: string;
  township: string;
  trackingNumber: string;
  orderId: string;
  customerName: string;
  status: string;
  from: string;
  to: string;
};
type MasterData = {
  shops?: Array<{ id: string; name: string }>;
  riders: Array<{ id: string; user: { name: string }; hub?: { name: string } | null }>;
};
type ReasonCode = {
  id: string;
  code: string;
  labelEn: string;
  labelMy: string;
  outcome: "PARTIAL" | "FAILED" | "REJECTED";
  noteRequired: boolean;
  active: boolean;
};
type OsReturnListPreview = { parcelCount: number; totalCod: number; parcels: Array<{ id?: string; trackingNumber: string; orderId?: string | null; customerName: string; address?: string | null; codAmount: number; status?: string; reasonCode?: string | null; batch?: { label?: string; shop?: { name?: string } } }> };

const emptyFilters: Filters = {
  queue: "",
  shopId: "",
  batchId: "",
  riderId: "",
  assignmentStatus: "",
  township: "",
  trackingNumber: "",
  orderId: "",
  customerName: "",
  status: "",
  from: "",
  to: "",
};
const ALL_STATUSES = [
  "CREATED",
  "PICKED_UP",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "PARTIAL",
  "FAILED",
  "REJECTED",
  "PENDING_RETURN",
  "RETURNED",
] as const;
const assignmentEligibleStatuses = new Set(["CREATED", "PICKED_UP"]);
const fieldEditableStatuses = new Set(["CREATED", "PICKED_UP", "ASSIGNED"]);
const OPS_CORRECTION_NOTE = "Ops correction";
const OPS_REASSIGN_REASON = "Ops inline reassignment";

const control =
  "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";
const controlSm = `${control} py-1`;

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return value.toLocaleString();
}

function statusLabel(t: (key: string) => string, status: string) {
  if (status === "ASSIGNED") return t("assignedAwaitingHandover");
  if (status === "OUT_FOR_DELIVERY") return t("outForDeliveryWithRider");
  return status.replaceAll("_", " ");
}

function formatPickupDate(parcel: Parcel) {
  if (parcel.batch.pickupDate) {
    const date = new Date(parcel.batch.pickupDate);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
  }
  return parcel.batch.label;
}

export function OperationsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const canDispatchEdit = ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(user?.role ?? "");
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters,
    ...Object.fromEntries(
      (Object.keys(emptyFilters) as Array<keyof Filters>).map((key) => [key, searchParams.get(key) ?? ""]),
    ),
  }));
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
  const [manifestStatus, setManifestStatus] = useState<ManifestStatusKey>("toDeliver");
  const [manifestDatePreset, setManifestDatePreset] = useState<ManifestDatePreset>("all");
  const [manifestDateFrom, setManifestDateFrom] = useState("");
  const [manifestDateTo, setManifestDateTo] = useState("");
  const [partial, setPartial] = useState<Parcel | null>(null);
  const [deliveryChoice, setDeliveryChoice] = useState<Parcel | null>(null);
  const [paidToOs, setPaidToOs] = useState<Parcel | null>(null);
  const [includeDeliveryFee, setIncludeDeliveryFee] = useState(false);
  const [editing, setEditing] = useState<Parcel | null>(null);
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
  const [reasonPrompt, setReasonPrompt] = useState<{ parcel: Parcel; status: "FAILED" | "REJECTED" } | null>(null);
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
  const [failedDecision, setFailedDecision] = useState<Parcel | null>(null);
  const [failedDecisionReason, setFailedDecisionReason] = useState("");
  const [returnDate, setReturnDate] = useState(hubBusinessDate());
  const returnRequest = useRef<string | null>(null);
  const selectionScope = useRef("");

  useEffect(() => {
    const next = Object.fromEntries(
      (Object.keys(emptyFilters) as Array<keyof Filters>).map((key) => [key, searchParams.get(key) ?? ""]),
    ) as Filters;
    setFilters((current) =>
      (Object.keys(next) as Array<keyof Filters>).every((key) => current[key] === next[key]) ? current : next,
    );
  }, [searchParams]);

  const debouncedTextFilters=useDebouncedValue({trackingNumber:filters.trackingNumber,orderId:filters.orderId,customerName:filters.customerName,township:filters.township},350);
  const queryFilters={...filters,...debouncedTextFilters};
  const query = Object.entries(queryFilters)
    .filter(([, value]) => value)
    .map(([key, value]) => [key === "from" ? "dateFrom" : key === "to" ? "dateTo" : key, value]);
  const queryString = new URLSearchParams([...query, ["page", String(page)], ["pageSize", "100"]]).toString();

  const parcels = useQuery({
    queryKey: ["parcels", queryString],
    queryFn: async () => {
      const response = await apiRaw(`/parcels?${queryString}`);
      const body = (await response.json()) as {
        data: Parcel[];
        pagination?: { page: number; pageSize: number; total: number; totalPages: number };
      };
      return { items: body.data ?? [], pagination: body.pagination };
    },
  });
  const overdueUnsent = useQuery({
    queryKey: ["overdue-unsent", 3],
    queryFn: () => apiRaw("/operations/parcels/overdue-unsent?days=3&pageSize=100").then(async response => {
      const body = await response.json() as { data?: Parcel[]; pagination?: { total: number } };
      return { items: body.data ?? [], total: body.pagination?.total ?? body.data?.length ?? 0 };
    }),
  });
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
  const masters = useQuery({
    queryKey: ["master-data"],
    queryFn: () => api<MasterData>("/master-data").then((r) => r.data),
  });
  const batches = useQuery({
    queryKey: ["operations-batches"],
    queryFn: () => api<BatchSummary[]>("/operations/batches").then((r) => r.data),
  });
  const reasons = useQuery({
    queryKey: ["reason-codes"],
    queryFn: () => api<ReasonCode[]>("/master-data/reason-codes").then((r) => r.data),
  });
  const townships = useQuery({
    queryKey: ["locations", "townships", "all"],
    enabled: Boolean(editing),
    queryFn: () => api<Township[]>("/master-data/locations/townships").then((r) => r.data),
  });
  const editZones = useQuery({
    queryKey: ["locations", "zones", editForm.townshipId],
    enabled: Boolean(editing && editForm.townshipId),
    queryFn: () =>
      api<Zone[]>(`/master-data/locations/zones?townshipId=${encodeURIComponent(editForm.townshipId)}`).then((r) => r.data),
  });

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
    mutationFn: (input: { parcel: Parcel; action: "RETRY_TOMORROW" | "RESCHEDULE" | "RETURN_TO_OS"; plannedDeliveryDate?: string }) => api(`/operations/parcels/${input.parcel.id}/failed-decision`, { method: "POST", body: JSON.stringify({ action: input.action, ...(input.plannedDeliveryDate ? { plannedDeliveryDate: input.plannedDeliveryDate } : {}), reason: failedDecisionReason.trim() }) }),
    onSuccess: async () => { setFailedDecision(null); setFailedDecisionReason(""); setMessage(t("statusUpdated")); await invalidateParcels(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
  });

  const manifestBody = useMemo(
    () =>
      buildManifestBody({
        riderIds: manifestRiderIds,
        status: manifestStatus,
        datePreset: manifestDatePreset,
        dateFrom: manifestDateFrom,
        dateTo: manifestDateTo,
      }),
    [manifestRiderIds, manifestStatus, manifestDatePreset, manifestDateFrom, manifestDateTo],
  );
  const manifestPreview = useQuery({
    queryKey: ["manifest-preview", manifestBody],
    enabled: manifestOpen,
    queryFn: () =>
      api<ManifestPreviewData>("/operations/parcels/manifest/preview", {
        method: "POST",
        body: JSON.stringify(manifestBody),
      }).then((r) => r.data),
  });
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
  const returnListEligible = selectedParcels.length > 0 && selectedParcels.length <= 500 && selectedParcels.every((parcel) => ["PENDING_RETURN", "REJECTED"].includes(parcel.status));
  const returnListPreview = useQuery({
    queryKey: ["os-return-list-preview", selectedParcels.map((parcel) => parcel.id)],
    enabled: returnListOpen && returnListEligible,
    queryFn: () => api<OsReturnListPreview>("/operations/parcels/returns/preview", { method: "POST", body: JSON.stringify({ parcelIds: selectedParcels.map((parcel) => parcel.id) }) }).then((result) => result.data),
  });
  const downloadReturnList = useMutation({
    mutationFn: () => apiRaw("/operations/parcels/returns/pdf", { method: "POST", body: JSON.stringify({ parcelIds: selectedParcels.map((parcel) => parcel.id) }) }),
    onSuccess: async (response) => { const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = resolveManifestPdfFilename(response.headers.get("Content-Disposition")); link.click(); URL.revokeObjectURL(url); },
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
    mutationFn: async () => {
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
      setMessage(t("multiEditStatusApplied", { count }));
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
  });

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
    setManifestStatus("toDeliver");
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
      setDeliveryChoice(parcel);
      return;
    }
    if (nextStatus === "FAILED" || nextStatus === "REJECTED") {
      setReasonPrompt({ parcel, status: nextStatus });
      setRejectAsCancelled(false);
      setReasonCode("");
      setReasonNote("");
      return;
    }
    updateStatus.mutate({ parcelId: parcel.id, status: nextStatus, note: OPS_CORRECTION_NOTE });
  };

  const riders = masters.data?.riders ?? [];

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("dispatchQueue")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("dispatchQueueDescription")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void parcels.refetch();
            void batches.refetch();
          }}
          className={`${control} flex items-center gap-2 font-bold`}
        >
          <RefreshCw size={14} />
          {t("refresh")}
        </button>
      </div>

      <nav aria-label={t("dispatchWorkQueues")} className="mt-5 flex flex-wrap gap-2">
        {[["", "all"], ["to-assign", "queueToAssign"], ["with-riders", "queueWithRiders"], ["rescheduled", "queueRescheduled"], ["return-to-os", "queueReturnToOs"], ["overdue", "queueOverdue"]].map(([value, label]) => <button key={value} type="button" aria-pressed={filters.queue === value} onClick={() => { setPage(1); setSelected([]); const next = { ...emptyFilters, batchId: filters.batchId, queue: value }; setFilters(next); setSearchParams(Object.fromEntries(Object.entries(next).filter(([, entry]) => entry)), { replace: true }); }} className={`rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${filters.queue === value ? "bg-sky-600 text-white" : "bg-white text-slate-600 dark:bg-white/5 dark:text-slate-200"}`}>{t(label)}</button>)}
      </nav>
      {filters.queue === "return-to-os" && <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={!returnListEligible} onClick={() => { returnListPreview.refetch(); setReturnListOpen(true); }} className={`${control} font-bold disabled:opacity-40`}><Download size={14} className="mr-1 inline" />{t("generateOsReturnList")}</button>{selected.length > 0 && !returnListEligible && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t("returnListEligibilityHelp")}</p>}</div>}
      {["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "DISPATCHER"].includes(user?.role ?? "") && <button type="button" disabled={!selected.length || selected.length > 50} onClick={() => { confirmReturns.reset(); setReturnOpen(true); }} className={`${control} mt-3 font-bold disabled:opacity-40`}>{t("confirmReturnedToOs")}</button>}

      {(overdueUnsent.data?.total ?? 0) > 0 && (
        <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-amber-900 dark:text-amber-100">{t("overdueUnsentTitle")}</h2>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{t("overdueUnsentDescription", { count: overdueUnsent.data?.total ?? 0 })}</p>
            </div>
            <button type="button" onClick={() => { setPage(1); setSelected([]); setFilters({ ...emptyFilters, queue: "overdue" }); setSearchParams({ queue: "overdue" }, { replace: true }); }} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white">
              {t("showOverdueUnsent")}
            </button>
          </div>
        </section>
      )}

      <section className="mt-5 rounded-xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">{t("dispatchQueue")}</h2>
            <p className="text-xs text-slate-500">{t("dispatchQueueDescription")}</p>
          </div>
          <span className="rounded-full bg-[#eaf6ff] px-2.5 py-0.5 text-[11px] font-bold text-[#0787df] dark:bg-[#1598ef]/15">
            {pagination
              ? t("showingOfTotal", { shown: visible.length, total: pagination.total })
              : `${visible.length} ${t("records")}`}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-10">
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("batch")}
            <select
              aria-label={t("batch")}
              value={filters.batchId}
              onChange={(e) => setFilter("batchId", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              {(batches.data ?? []).map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.label} · {batch.shop.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("tracking")}
            <input
              value={filters.trackingNumber}
              onChange={(e) => setFilter("trackingNumber", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
              placeholder={t("tracking")}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("orderId")}
            <input
              value={filters.orderId}
              onChange={(e) => setFilter("orderId", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
              placeholder={t("orderId")}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("customer")}
            <input
              value={filters.customerName}
              onChange={(e) => setFilter("customerName", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
              placeholder={t("customer")}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("shopName")}
            <select
              aria-label={t("shopName")}
              value={filters.shopId}
              onChange={(e) => setFilter("shopId", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              {masters.data?.shops?.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("rider")}
            <select
              aria-label={t("rider")}
              value={filters.riderId}
              onChange={(e) => setFilter("riderId", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.user.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("status")}
            <select
              aria-label={t("status")}
              value={filters.status}
              onChange={(e) => setFilter("status", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              {ALL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(t, status)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("township")}
            <input
              value={filters.township}
              onChange={(e) => setFilter("township", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
              placeholder={t("township")}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("assignmentStatus")}
            <select
              aria-label={t("assignmentStatus")}
              value={filters.assignmentStatus}
              onChange={(e) => setFilter("assignmentStatus", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              <option value="UNASSIGNED">{t("unassigned")}</option>
              <option value="ASSIGNED">{t("assigned")}</option>
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("dateFrom")}
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilter("from", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("dateTo")}
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilter("to", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            />
          </label>
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setFilters(emptyFilters);
              const next = new URLSearchParams(searchParams);
              (Object.keys(emptyFilters) as Array<keyof Filters>).forEach((key) => next.delete(key));
              setSearchParams(next, { replace: true });
            }}
            className={`${controlSm} font-bold`}
          >
            <Search size={12} className="mr-1 inline" />
            {t("clearFilters")}
          </button>
        </div>

        {canDispatchEdit && (
          <>
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2 dark:bg-white/5">
          <button type="button" disabled={!selected.length || selected.length > 50} onClick={() => { reschedule.reset(); setRescheduleOpen(true); }} className={`${control} font-bold disabled:opacity-40`}>{t("rescheduleParcels")}</button>
          <label className="min-w-[200px] flex-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("targetRiderId")}
            <select
              aria-label={t("targetRiderId")}
              value={riderId}
              onChange={(e) => setRiderId(e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("selectRider")}</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.user.name}
                  {rider.hub?.name ? ` · ${rider.hub.name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!selectedAssignmentEligible || !riderId || assign.isPending}
            onClick={() => assign.mutate({ parcelIds: selected, riderId, dispatch: true })}
            className="rounded-md bg-[#1598ef] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            <UserPlus size={14} className="mr-1 inline" />
            {assign.isPending ? t("loading") : `${t("assignAndDispatch")} (${selected.length})`}
          </button>
          <button
            type="button"
            onClick={openManifestModal}
            className="rounded-md border border-[#1598ef] px-3 py-1.5 text-xs font-bold text-[#0787df]"
          >
            <Download size={14} className="mr-1 inline" />
            {t("downloadManifest")}
          </button>
          <button
            type="button"
            disabled={Boolean(linkValidation) || selected.length !== selectedParcels.length || link.isPending}
            onClick={openLinkModal}
            className="rounded-md border border-[#1598ef] px-3 py-1.5 text-xs font-bold text-[#0787df] disabled:opacity-50"
          >
            <Link2 size={14} className="mr-1 inline" />
            {link.isPending ? t("loading") : `${t("linkParcels")} (${selectedParcels.length})`}
          </button>
          <button
            type="button"
            disabled={!unlinkGroupId || unlink.isPending}
            onClick={() => setUnlinkingGroupId(unlinkGroupId)}
            className="rounded-md border border-amber-500 px-3 py-1.5 text-xs font-bold text-amber-700 disabled:opacity-50 dark:text-amber-300"
          >
            {t("unlinkParcels")}
          </button>
        </div>

        {selected.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[#1598ef]/25 bg-[#eaf6ff]/40 px-2 py-1.5 dark:border-[#1598ef]/30 dark:bg-[#1598ef]/10">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#0787df]">
              {t("multiEdit")} · {selected.length}
            </span>
            <select
              aria-label={t("applyRider")}
              value={bulkRiderId}
              onChange={(e) => setBulkRiderId(e.target.value)}
              className={`${controlSm} min-w-[120px]`}
            >
              <option value="">{t("selectRider")}</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.user.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!bulkRiderId || applyRiderBulk.isPending}
              onClick={() => applyRiderBulk.mutate()}
              className="rounded-md bg-[#1598ef] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
            >
              {applyRiderBulk.isPending ? t("loading") : t("applyRider")}
            </button>
            <span className="hidden h-4 w-px bg-slate-300 sm:block dark:bg-white/20" />
            <select
              aria-label={t("applyStatus")}
              value={bulkStatus}
              onChange={(e) => {
                setBulkStatus(e.target.value);
                setBulkReasonCode("");
              }}
              className={`${controlSm} min-w-[120px]`}
            >
              <option value="">{t("selectStatus")}</option>
              {ALL_STATUSES.filter((status) => status !== "PARTIAL").map((status) => (
                <option key={status} value={status}>
                  {statusLabel(t, status)}
                </option>
              ))}
            </select>
            {(bulkStatus === "FAILED" || bulkStatus === "REJECTED") && (
              <select
                aria-label={t("reasonCode")}
                value={bulkReasonCode}
                onChange={(e) => setBulkReasonCode(e.target.value)}
                className={`${controlSm} min-w-[120px]`}
              >
                <option value="">{t("selectReasonCode")}</option>
                {bulkReasons.map((reason) => (
                  <option key={reason.id} value={reason.code}>
                    {reasonLabel(reason)}
                  </option>
                ))}
              </select>
            )}
            {bulkStatus && (
              <input
                aria-label={t("overrideNote")}
                value={bulkOverrideNote}
                onChange={(e) => setBulkOverrideNote(e.target.value)}
                placeholder={t("overrideNotePlaceholder")}
                className={`${controlSm} min-w-[160px] flex-1`}
              />
            )}
            <button
              type="button"
              disabled={
                !bulkStatus ||
                bulkStatus === "PARTIAL" ||
                applyStatusBulk.isPending ||
                ((bulkStatus === "FAILED" || bulkStatus === "REJECTED") && !bulkReasonCode)
              }
              onClick={() => applyStatusBulk.mutate()}
              className="rounded-md border border-[#1598ef] px-2.5 py-1 text-[11px] font-bold text-[#0787df] disabled:opacity-50"
            >
              {applyStatusBulk.isPending ? t("loading") : t("applyStatus")}
            </button>
          </div>
        )}
          </>
        )}

        {selected.length > 0 && linkValidation && (
          <p role="alert" className="mt-2 text-xs text-rose-500">
            {linkValidation}
          </p>
        )}
        {selected.length > 0 && !selectedAssignmentEligible && (
          <p className="mt-2 text-xs text-slate-500">{t("assignmentSelectionHint")}</p>
        )}
        {message && (
          <p role="status" className="mt-2 text-xs font-semibold text-[#0787df]">
            {message}
          </p>
        )}

        {parcels.isLoading ? (
          <p className="py-10 text-center text-sm text-slate-400">{t("loading")}</p>
        ) : parcels.isError ? (
          <div className="py-10 text-center">
            <p className="text-sm text-rose-500">{t("loadError")}</p>
            <button type="button" onClick={() => void parcels.refetch()} className="mt-2 text-sm font-bold text-[#0787df]">
              {t("retry")}
            </button>
          </div>
        ) : !visible.length ? (
          <p className="py-10 text-center text-sm text-slate-400">{t("empty")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400 dark:border-white/10">
                  <th className="py-2 pr-2">
                    <input aria-label={t("selectAll")} type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <th className="py-2 pr-2">{t("rowNumber")}</th>
                  <th className="py-2 pr-2">{t("orderId")}</th>
                  <th className="py-2 pr-2">{t("tracking")}</th>
                  <th className="py-2 pr-2">{t("pickupDate")}</th>
                  <th className="py-2 pr-2">{t("merchant")}</th>
                  <th className="py-2 pr-2">{t("customer")}</th>
                  <th className="py-2 pr-2">{t("township")}</th>
                  <th className="py-2 pr-2 text-right">{t("fee")}</th>
                  <th className="py-2 pr-2 text-right">{t("cod")}</th>
                  <th className="py-2 pr-2 text-right">{t("total")}</th>
                  <th className="py-2 pr-2">{t("rider")}</th>
                  <th className="py-2 pr-2">{t("status")}</th>
                  <th className="py-2 text-right">{t("edit")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p, index) => {
                  const fee = p.deliveryFee ?? 0;
                  const total = p.codAmount + fee;
                  const canEditFields = fieldEditableStatuses.has(p.status) && !p.linkGroup;
                  const canCorrectRider = p.status === "DELIVERED" && Boolean(p.rider?.id) && !p.linkGroup;
  return (
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/80 dark:border-white/5 dark:hover:bg-white/[0.03]">
                      <td className="py-1.5 pr-2">
                        <input
                          aria-label={`${t("select")} ${p.trackingNumber}`}
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={() => toggleOne(p.id)}
                        />
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums text-slate-400">{index + 1}</td>
                      <td className="py-1.5 pr-2">
                        <p className="font-bold text-[#0787df] dark:text-[#5eb8ff]">{p.orderId?.trim() || "—"}</p>
                      </td>
                      <td className="py-1.5 pr-2">
                        <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{p.trackingNumber}</p>
                        {isDateChangeReason(p.reasonCode) ? (
                          <p role="alert" className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            {t("dateChangeAlert")}
                            {p.plannedDeliveryDate && <span className="block">{t("plannedDeliveryDate")}: {p.plannedDeliveryDate.slice(0, 10)}</span>}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatPickupDate(p)}</td>
                      <td className="py-1.5 pr-2 font-semibold">{p.batch.shop.name}</td>
                      <td className="py-1.5 pr-2">{p.customerName}</td>
                      <td className="py-1.5 pr-2 text-slate-500">{p.township || "—"}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{money(p.deliveryFee)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{money(p.codAmount)}</td>
                      <td className="py-1.5 pr-2 text-right font-bold tabular-nums text-[#0787df]">{money(total)}</td>
                      <td className="py-1.5 pr-2">
                        <select
                          aria-label={`${t("rider")} ${p.trackingNumber}`}
                          value={p.rider?.id ?? ""}
                          disabled={!canDispatchEdit || assign.isPending || reassignOne.isPending || correctRider.isPending}
                          title={p.status === "DELIVERED" ? t("correctRider") : undefined}
                          onChange={(e) => void handleRiderChange(p, e.target.value)}
                          className={`${controlSm} max-w-[140px]`}
                        >
                          <option value="">{t("unassigned")}</option>
                          {riders.map((rider) => (
                            <option key={rider.id} value={rider.id}>
                              {rider.user.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <select
                          aria-label={`${t("status")} ${p.trackingNumber}`}
                          value={p.status}
                          disabled={!canDispatchEdit || updateStatus.isPending}
                          onChange={(e) => handleStatusChange(p, e.target.value)}
                          className={`${controlSm} max-w-[150px]`}
                        >
                          {ALL_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {statusLabel(t, status)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          <button type="button" aria-label={`${t("viewFieldHistory")} ${p.trackingNumber}`} onClick={()=>setHistoryParcel({id:p.id,trackingNumber:p.trackingNumber})} className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600 dark:border-white/15 dark:text-slate-300">{t("history")}</button>
                          {canCorrectRider ? (
                            <button
                              type="button"
                              aria-label={`${t("correctRider")} ${p.trackingNumber}`}
                              disabled={!canDispatchEdit || correctRider.isPending}
                              title={t("correctRider")}
                              onClick={() => {
                                setCorrectingRider(p);
                                setCorrectRiderId("");
                                setCorrectReason("");
                              }}
                              className="rounded-md border border-amber-500 px-2 py-1 text-[11px] font-bold text-amber-700 disabled:opacity-40 dark:text-amber-300"
                            >
                              <UserRoundPen size={12} className="mr-1 inline" />
                              {t("correctRider")}
                            </button>
                          ) : null}
                          <button
                          type="button"
                          aria-label={`${t("editParcel")} ${p.trackingNumber}`}
                          disabled={!canDispatchEdit}
                          title={
                            !canDispatchEdit
                              ? t("parcelEditForbidden")
                              : !canEditFields
                                ? p.linkGroup
                                ? t("selectedParcelsNotLinkable")
                                : t("parcelEditDisabled")
                              : t("editParcel")
                          }
                          onClick={() => {
                            if (!canDispatchEdit) return;
                            setEditing(p);
                          }}
                          className="rounded-md border border-[#1598ef] px-2 py-1 text-[11px] font-bold text-[#0787df] disabled:opacity-40"
                        >
                          <Pencil size={12} className="mr-1 inline" />
                          {t("edit")}
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pagination && pagination.totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {t("pageOf", { page: pagination.page, total: pagination.totalPages })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || parcels.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className={`${controlSm} font-bold disabled:opacity-50`}
              >
                {t("previous")}
              </button>
              <button
                type="button"
                disabled={page >= pagination.totalPages || parcels.isFetching}
                onClick={() => setPage((p) => p + 1)}
                className={`${controlSm} font-bold disabled:opacity-50`}
              >
                {t("next")}
              </button>
            </div>
          </div>
        )}
      </section>

      {manifestOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="manifest-title" className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-black/40 p-4">
          <div className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]">
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="manifest-title" className="font-display text-xl font-bold">
              {t("downloadManifest")}
            </h2><button type="button" aria-label={t("close")} onClick={() => setManifestOpen(false)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-2 text-sm text-slate-500">{t("downloadManifestDescription")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {MANIFEST_DATE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setManifestDatePreset(preset)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${manifestDatePreset === preset ? "border-[#1598ef] bg-[#eaf6ff] text-[#0787df] dark:bg-[#1598ef]/15" : "border-slate-200 dark:border-white/10"}`}
                >
                  {preset === "all" ? t("allDates") : preset === "custom" ? t("customRange") : t(preset)}
                </button>
              ))}
            </div>
            {manifestDatePreset === "custom" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-500">
                  {t("dateFrom")}
                  <input aria-label={`${t("downloadManifest")} ${t("dateFrom")}`} type="date" value={manifestDateFrom} onChange={(e) => setManifestDateFrom(e.target.value)} className={`${control} mt-1 w-full`} />
                </label>
                <label className="text-xs font-bold text-slate-500">
                  {t("dateTo")}
                  <input aria-label={`${t("downloadManifest")} ${t("dateTo")}`} type="date" value={manifestDateTo} onChange={(e) => setManifestDateTo(e.target.value)} className={`${control} mt-1 w-full`} />
                </label>
              </div>
            )}
            <label className="mt-4 block text-xs font-bold text-slate-500">
              {t("status")}
              <select aria-label={t("status")} value={manifestStatus} onChange={(e) => setManifestStatus(e.target.value as ManifestStatusKey)} className={`${control} mt-1 w-full max-w-sm`}>
                {MANIFEST_STATUS_FILTERS.map((key) => (
                  <option key={key} value={key}>
                    {t(manifestStatusLabelKey(key))}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setManifestRiderIds(riders.map((rider) => rider.id))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold dark:border-white/10"
              >
                {t("selectAll")}
              </button>
              <button
                type="button"
                onClick={() => setManifestRiderIds([])}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold dark:border-white/10"
              >
                {t("allRiders")}
              </button>
            </div>
            <div className="mt-4 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-white/10">
              {riders.map((rider) => {
                const checked = manifestRiderIds.includes(rider.id);
                return (
                  <label
                    key={rider.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${checked ? "bg-[#eaf6ff] dark:bg-[#1598ef]/15" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleManifestRider(rider.id)} className="accent-[#1598ef]" />
                    <span className="font-semibold">{rider.user.name}</span>
                    {rider.hub?.name && <span className="text-xs text-slate-400">{rider.hub.name}</span>}
                  </label>
                );
              })}
            </div>
            <div className="mt-5">
              <DeliveryStatusPanel preview={manifestPreview.data} loading={manifestPreview.isLoading} error={manifestPreview.isError} onRetry={() => void manifestPreview.refetch()} />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setManifestOpen(false)} className={control}>
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={downloadManifest.isPending || !manifestPreview.data?.parcelCount}
                onClick={() => downloadManifest.mutate()}
                className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                <Download size={16} className="mr-2 inline" />
                {downloadManifest.isPending ? t("loading") : t("downloadPdf")}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div role="dialog" aria-modal="true" aria-labelledby="edit-parcel-title" className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const canEditDeliveryFields = fieldEditableStatuses.has(editing.status) && !editing.linkGroup;
              if (!editForm.customerName.trim() || !editForm.address.trim() ||
                (canEditDeliveryFields && (!editForm.townshipId || !/^\d+$/.test(editForm.codAmount) || !/^\d+$/.test(editForm.deliveryFee)))) {
                return;
              }
              updateParcel.mutate();
            }}
            className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="edit-parcel-title" className="font-display text-xl font-bold">
              {t("editParcel")}
            </h2><button type="button" aria-label={t("close")} onClick={() => setEditing(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-1 text-sm text-slate-500">{editing.trackingNumber}</p>
            {!fieldEditableStatuses.has(editing.status) || editing.linkGroup ? (
              <p role="note" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {t("parcelContactOnly")}
              </p>
            ) : null}
            {updateParcel.isError && message ? (
              <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{message}</p>
            ) : null}
            <div className="mt-4 grid gap-3">
              <label className="text-xs font-bold text-slate-500">
                {t("orderId")}
                <input
                  value={editForm.orderId}
                  onChange={(e) => setEditForm((v) => ({ ...v, orderId: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("customer")}
                <input
                  required
                  value={editForm.customerName}
                  onChange={(e) => setEditForm((v) => ({ ...v, customerName: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("address")}
                <input
                  required
                  value={editForm.address}
                  onChange={(e) => setEditForm((v) => ({ ...v, address: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("customerPhone")}
                <input
                  value={editForm.customerPhone}
                  onChange={(e) => setEditForm((v) => ({ ...v, customerPhone: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("township")}
                <select
                  required
                  disabled={!fieldEditableStatuses.has(editing.status) || Boolean(editing.linkGroup)}
                  aria-label={t("township")}
                  value={editForm.townshipId}
                  onChange={(e) => {
                    const townshipId = e.target.value;
                    const township = townships.data?.find((item) => item.id === townshipId);
                    setEditForm((v) => ({
                      ...v,
                      townshipId,
                      zoneId: "",
                      ...(township ? { deliveryFee: String(township.deliveryFee) } : {}),
                    }));
                  }}
                  className={`${control} mt-1 w-full`}
                >
                  <option value="">{t("township")}</option>
                  {(townships.data ?? []).map((township) => (
                    <option key={township.id} value={township.id}>
                      {township.district?.regionState?.nameEn ? `${township.district.regionState.nameEn} · ` : ""}
                      {township.district?.nameEn ? `${township.district.nameEn} · ` : ""}
                      {township.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("zone")}
                <select
                  disabled={!fieldEditableStatuses.has(editing.status) || Boolean(editing.linkGroup)}
                  aria-label={t("zone")}
                  value={editForm.zoneId}
                  onChange={(e) => setEditForm((v) => ({ ...v, zoneId: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                >
                  <option value="">—</option>
                  {(editZones.data ?? []).map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("deliveryFee")}
                <input
                  required
                  disabled={!fieldEditableStatuses.has(editing.status) || Boolean(editing.linkGroup)}
                  type="number"
                  min={0}
                  aria-label={t("deliveryFee")}
                  value={editForm.deliveryFee}
                  onChange={(e) => setEditForm((v) => ({ ...v, deliveryFee: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("cod")}
                <input
                  required
                  disabled={!fieldEditableStatuses.has(editing.status) || Boolean(editing.linkGroup)}
                  type="number"
                  min={0}
                  value={editForm.codAmount}
                  onChange={(e) => setEditForm((v) => ({ ...v, codAmount: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={()=>{setHistoryParcel({id:editing.id,trackingNumber:editing.trackingNumber});setEditing(null)}} className={control}>{t("viewFieldHistory")}</button>
              <button type="button" onClick={() => setEditing(null)} className={control}>
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={updateParcel.isPending}
                className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {updateParcel.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </form>
        </div>
      )}
      {historyParcel&&<ParcelFieldHistory parcel={historyParcel} onClose={()=>setHistoryParcel(null)}/>}

      {correctingRider && (
        <div role="dialog" aria-modal="true" aria-labelledby="correct-rider-title" className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!correctRiderId || correctReason.trim().length < 3 || correctRiderId === correctingRider.rider?.id) return;
              correctRider.mutate();
            }}
            className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="correct-rider-title" className="font-display text-xl font-bold">
              {t("correctRider")}
            </h2><button type="button" aria-label={t("close")} onClick={() => setCorrectingRider(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-1 text-sm text-slate-500">{correctingRider.trackingNumber}</p>
            <p role="note" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {t("correctRiderDescription")}
            </p>
            {message && correctRider.isError ? (
              <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                {message}
              </p>
            ) : null}
            <div className="mt-4 grid gap-3">
              <label className="text-xs font-bold text-slate-500">
                {t("newRider")}
                <select
                  required
                  aria-label={t("newRider")}
                  value={correctRiderId}
                  onChange={(e) => setCorrectRiderId(e.target.value)}
                  className={`${control} mt-1 w-full`}
                >
                  <option value="">{t("selectRider")}</option>
                  {riders
                    .filter((rider) => rider.id !== correctingRider.rider?.id)
                    .map((rider) => (
                      <option key={rider.id} value={rider.id}>
                        {rider.user.name}
                        {rider.hub?.name ? ` · ${rider.hub.name}` : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("correctRiderReason")}
                <textarea
                  required
                  minLength={3}
                  aria-label={t("correctRiderReason")}
                  value={correctReason}
                  onChange={(e) => setCorrectReason(e.target.value)}
                  className={`${control} mt-1 min-h-24 w-full`}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setCorrectingRider(null);
                  setCorrectRiderId("");
                  setCorrectReason("");
                }}
                className={control}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={correctRider.isPending || !correctRiderId || correctReason.trim().length < 3}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {correctRider.isPending ? t("loading") : t("correctRider")}
              </button>
            </div>
          </form>
        </div>
      )}

      {partial && (
        <div role="dialog" aria-modal="true" aria-labelledby="partial-title" className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (
                actualCod === "" ||
                !collectionWallet ||
                !reasonCode ||
                (selectedReason?.noteRequired && !reasonNote.trim()) ||
                Number(actualCod) < 0 ||
                Number(actualCod) > partial.codAmount
              ) {
                return;
              }
              savePartial.mutate();
            }}
            className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="partial-title" className="font-display text-xl font-bold">
              {t("partialReturn")}
            </h2><button type="button" aria-label={t("close")} onClick={() => setPartial(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-2 text-sm text-slate-500">
              {partial.trackingNumber} · {t("originalCod")}: {partial.codAmount.toLocaleString()} MMK
            </p>
            <label className="mt-5 block text-sm font-bold">
              {t("reasonCode")}
              <select
                aria-label={t("reasonCode")}
                required
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className={`${control} mt-2 w-full`}
              >
                <option value="">{t("selectReasonCode")}</option>
                {partialReasons.map((reason) => (
                  <option key={reason.id} value={reason.code}>
                    {reasonLabel(reason)}
                  </option>
                ))}
              </select>
            </label>
            {reasons.isError && <p className="mt-2 text-sm text-rose-500">{t("reasonCodesLoadError")}</p>}
            {selectedReason?.noteRequired && (
              <label className="mt-4 block text-sm font-bold">
                {t("reasonNote")}
                <textarea
                  aria-label={t("reasonNote")}
                  required
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  className={`${control} mt-2 w-full`}
                />
              </label>
            )}
            <label className="mt-5 block text-sm font-bold">
              {t("actualCodCollected")}
              <input
                autoFocus
                type="number"
                min="0"
                max={partial.codAmount}
                required
                value={actualCod}
                onChange={(e) => setActualCod(e.target.value)}
                className={`${control} mt-2 w-full`}
              />
            </label>
            <label className="mt-4 block text-sm font-bold">
              {t("collectionWallet")}
              <select
                aria-label={t("collectionWallet")}
                required
                value={collectionWallet}
                onChange={(e) => setCollectionWallet(e.target.value)}
                className={`${control} mt-2 w-full`}
              >
                <option value="">{t("selectWallet")}</option>
                <option value="CASH">{t("walletCash")}</option>
                <option value="KBZ_PAY">{t("walletKbzPay")}</option>
                <option value="WAVE_PAY">{t("walletWavePay")}</option>
              </select>
            </label>
            {Number(actualCod) > partial.codAmount && (
              <p className="mt-2 text-sm text-rose-500">{t("codCannotExceedOriginal")}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setPartial(null)} className={control}>
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={
                  savePartial.isPending ||
                  actualCod === "" ||
                  !collectionWallet ||
                  !reasonCode ||
                  (selectedReason?.noteRequired && !reasonNote.trim()) ||
                  Number(actualCod) > partial.codAmount
                }
                className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {savePartial.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </form>
        </div>
      )}

      {deliveryChoice && (
        <div role="dialog" aria-modal="true" aria-labelledby="delivery-choice-title" className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-black/40 p-4">
          <div className="relative my-6 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]">
            <button type="button" aria-label={t("close")} onClick={() => setDeliveryChoice(null)} className="absolute right-4 top-4 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button>
            <h2 id="delivery-choice-title" className="font-display text-xl font-bold">{t("recordDelivered")}</h2>
            <p className="mt-2 text-sm text-slate-500">{t("recordDeliveredHelp")}</p>
            <div className="mt-5 grid gap-3">
              <button type="button" onClick={() => updateStatus.mutate({ parcelId: deliveryChoice.id, status: "DELIVERED", collectionMode: "CASH_RECEIPT_EXCEPTION", note: OPS_CORRECTION_NOTE })} disabled={updateStatus.isPending} className="rounded-xl border border-[#1598ef] p-4 text-left hover:bg-sky-50 disabled:opacity-50 dark:hover:bg-sky-950/30"><span className="block font-bold text-[#0787df]">{t("deliveredRiderCollected")}</span><span className="mt-1 block text-sm text-slate-500">{t("deliveredRiderCollectedHelp")}</span></button>
              <button type="button" onClick={() => { setDeliveryChoice(null); setPaidToOs(deliveryChoice); setIncludeDeliveryFee(false); }} className="rounded-xl border border-slate-200 p-4 text-left hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"><span className="block font-bold">{t("deliveredPaidToOs")}</span><span className="mt-1 block text-sm text-slate-500">{t("deliveredPaidToOsHelp")}</span></button>
            </div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setDeliveryChoice(null)} className={control}>{t("cancel")}</button></div>
          </div>
        </div>
      )}

      {paidToOs && (
        <div role="dialog" aria-modal="true" aria-labelledby="paid-to-os-title" className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              savePaidToOs.mutate();
            }}
            className="relative my-6 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="flex items-start justify-between gap-4"><div><h2 id="paid-to-os-title" className="font-display text-xl font-bold">{t("deliveredPaidToOs")}</h2><p className="mt-2 text-sm text-slate-500">{t("deliveredPaidToOsHelp")}</p></div><button type="button" aria-label={t("close")} onClick={() => setPaidToOs(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <div className="mt-5 rounded-xl bg-sky-50 p-4 text-sm dark:bg-sky-950/50"><p className="font-bold">{paidToOs.trackingNumber}</p><p className="mt-1 text-slate-600 dark:text-slate-300">{t("cod")}: {money(paidToOs.codAmount)} MMK</p><p className="mt-1 text-slate-600 dark:text-slate-300">{t("fee")}: {money(paidToOs.deliveryFee ?? 0)} MMK</p></div>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-white/10"><input aria-label={t("includeFullDeliveryFee")} type="checkbox" checked={includeDeliveryFee} onChange={(event) => setIncludeDeliveryFee(event.target.checked)} className="mt-0.5 h-4 w-4"/><span><span className="block font-bold">{t("includeFullDeliveryFee")}</span><span className="mt-1 block text-slate-500">{t("includeFullDeliveryFeeHelp", { amount: money(paidToOs.deliveryFee ?? 0) })}</span></span></label>
            <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{t("osCreditWillBe", { amount: money(paidToOs.codAmount + (includeDeliveryFee ? paidToOs.deliveryFee ?? 0 : 0)) })}</p>
            <p className="mt-2 text-xs text-slate-500">{t("osCreditAutoOffsetHelp")}</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setPaidToOs(null)} className={control}>{t("cancel")}</button><button type="submit" disabled={savePaidToOs.isPending} className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{savePaidToOs.isPending ? t("loading") : t("confirmDeliveredPaidToOs")}</button></div>
          </form>
        </div>
      )}

      {reasonPrompt && (
        <div role="dialog" aria-modal="true" aria-labelledby="reason-prompt-title" className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!reasonCode) return;
              const noteNeeded = reasonList.find((r) => r.code === reasonCode)?.noteRequired;
              if (noteNeeded && !reasonNote.trim()) return;
              updateStatus.mutate({
                parcelId: reasonPrompt.parcel.id,
                status: reasonPrompt.status,
                reasonCode,
                note: reasonNote.trim() || OPS_CORRECTION_NOTE,
                ...(reasonPrompt.status === "REJECTED" && rejectAsCancelled ? { returnToOs: true } : {}),
              });
            }}
            className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="reason-prompt-title" className="font-display text-xl font-bold">
              {t("reasonCode")} · {reasonPrompt.status.replaceAll("_", " ")}
            </h2><button type="button" aria-label={t("close")} onClick={() => setReasonPrompt(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-2 text-sm text-slate-500">{reasonPrompt.parcel.trackingNumber}</p>
            <label className="mt-5 block text-sm font-bold">
              {t("reasonCode")}
              <select
                aria-label={t("reasonCode")}
                required
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className={`${control} mt-2 w-full`}
              >
                <option value="">{t("selectReasonCode")}</option>
                {promptReasons.map((reason) => (
                  <option key={reason.id} value={reason.code}>
                    {reasonLabel(reason)}
                  </option>
                ))}
              </select>
            </label>
            {reasonList.find((r) => r.code === reasonCode)?.noteRequired && (
              <label className="mt-4 block text-sm font-bold">
                {t("reasonNote")}
                <textarea
                  aria-label={t("reasonNote")}
                  required
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  className={`${control} mt-2 w-full`}
                />
              </label>
            )}
            {reasonPrompt.status === "REJECTED" && <label className="mt-4 flex items-start gap-2 text-sm"><input aria-label={t("customerCancelled")} type="checkbox" checked={rejectAsCancelled} onChange={event=>setRejectAsCancelled(event.target.checked)} /><span><span className="font-bold">{t("customerCancelled")}</span><span className="mt-1 block text-xs text-slate-500">{t("customerCancelledHelp")}</span></span></label>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setReasonPrompt(null);
                  setReasonCode("");
                  setReasonNote("");
                }}
                className={control}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={
                  updateStatus.isPending ||
                  !reasonCode ||
                  (Boolean(reasonList.find((r) => r.code === reasonCode)?.noteRequired) && !reasonNote.trim())
                }
                className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {updateStatus.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </form>
        </div>
      )}
      {failedDecision && <div role="dialog" aria-modal="true" aria-labelledby="failed-decision-title" className="fixed inset-0 z-30 grid place-items-center bg-black/55 p-4"><section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"><div className="flex items-start justify-between gap-3"><div><h2 id="failed-decision-title" className="text-xl font-bold">{t("failedDeliveryNextStep")}</h2><p className="mt-2 text-sm text-slate-500">{t("failedDeliveryNextStepHelp", { tracking: failedDecision.trackingNumber })}</p></div><button type="button" aria-label={t("close")} onClick={()=>setFailedDecision(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div><label className="mt-4 block text-xs font-bold text-slate-500">{t("reason")}<textarea aria-label={t("failedDecisionReason")} required minLength={3} value={failedDecisionReason} onChange={event=>setFailedDecisionReason(event.target.value)} className={`${control} mt-1 w-full`}/></label><div className="mt-5 grid gap-3"><button type="button" disabled={decideFailed.isPending||failedDecisionReason.trim().length<3} onClick={()=>decideFailed.mutate({parcel:failedDecision,action:"RETRY_TOMORROW"})} className="rounded-xl border border-sky-200 p-4 text-left font-bold text-sky-800 disabled:opacity-40 dark:border-sky-800 dark:text-sky-200">{t("tryAgainTomorrow")}</button><button type="button" disabled={decideFailed.isPending||failedDecisionReason.trim().length<3} onClick={()=>decideFailed.mutate({parcel:failedDecision,action:"RESCHEDULE",plannedDeliveryDate:rescheduleDate})} className="rounded-xl border border-slate-200 p-4 text-left font-bold disabled:opacity-40 dark:border-white/10">{t("rescheduleDate")}</button><button type="button" disabled={decideFailed.isPending||failedDecisionReason.trim().length<3} onClick={()=>decideFailed.mutate({parcel:failedDecision,action:"RETURN_TO_OS"})} className="rounded-xl border border-amber-300 p-4 text-left font-bold text-amber-800 disabled:opacity-40 dark:border-amber-800 dark:text-amber-200">{t("returnToOs")}</button></div><label className="mt-4 block text-xs font-bold text-slate-500">{t("rescheduleDate")}<input aria-label={t("rescheduleDate")} type="date" value={rescheduleDate} onChange={event=>setRescheduleDate(event.target.value)} className={`${control} mt-1 w-full`}/></label>{decideFailed.isError&&<p role="alert" className="mt-3 text-sm text-rose-600">{decideFailed.error instanceof Error?decideFailed.error.message:t("loadError")}</p>}<p className="mt-4 text-xs text-slate-500">{t("cancelledDeliveryHelp")}</p></section></div>}
      {returnListOpen && <div role="dialog" aria-modal="true" aria-labelledby="return-list-title" className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/55 p-4"><section className="my-6 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"><div className="flex items-start justify-between gap-3"><div><h2 id="return-list-title" className="font-display text-xl font-bold">{t("osReturnList")}</h2><p className="mt-1 text-sm text-slate-500">{t("osReturnListHelp")}</p></div><button type="button" aria-label={t("close")} onClick={()=>setReturnListOpen(false)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>{returnListPreview.isLoading?<p className="py-8 text-center">{t("loading")}</p>:returnListPreview.isError?<div className="py-8 text-center"><p role="alert" className="text-rose-600">{t("returnListPreviewError")}</p><button type="button" onClick={()=>void returnListPreview.refetch()} className="mt-3 text-sm font-bold text-sky-700">{t("retry")}</button></div>:<><p className="mt-4 rounded-xl bg-sky-50 p-3 text-sm dark:bg-sky-950/50">{t("returnListSummary",{count:returnListPreview.data?.parcelCount??0,amount:money(returnListPreview.data?.totalCod??0)})}</p><div className="mt-4 max-h-80 overflow-auto rounded-xl border dark:border-white/10"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">{t("tracking")}</th><th className="p-3">{t("merchant")}</th><th className="p-3">{t("customer")}</th><th className="p-3">{t("status")}</th><th className="p-3">{t("reasonCode")}</th><th className="p-3 text-right">{t("cod")}</th></tr></thead><tbody>{returnListPreview.data?.parcels.map(parcel=><tr key={parcel.id??parcel.trackingNumber} className="border-b dark:border-white/10"><td className="p-3 font-mono">{parcel.trackingNumber}</td><td className="p-3">{parcel.batch?.shop?.name??"—"}</td><td className="p-3">{parcel.customerName}</td><td className="p-3">{parcel.status?.replaceAll("_"," ")??"—"}</td><td className="p-3">{parcel.reasonCode??"—"}</td><td className="p-3 text-right">{money(parcel.codAmount)}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500">{t("returnListNoPostingHelp")}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>setReturnListOpen(false)} className={control}>{t("close")}</button><button type="button" disabled={downloadReturnList.isPending||!returnListPreview.data?.parcelCount} onClick={()=>downloadReturnList.mutate()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{t(downloadReturnList.isPending?"loading":"downloadPdf")}</button></div></>}</section></div>}
      {linkOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"><form aria-label={t("linkParcels")} onSubmit={e=>{e.preventDefault();link.mutate()}} className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]"><button type="button" aria-label={t("close")} onClick={()=>setLinkOpen(false)} className="absolute right-4 top-4 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button><h2 className="text-xl font-bold">{t("linkParcels")}</h2><p className="mt-2 text-sm text-slate-500">{t("linkParcelsExplanation",{count:selected.length})}</p><label className="mt-4 block text-xs font-bold">{t("responsibleRider")}<select aria-label={t("responsibleRider")} value={linkRiderId} onChange={e=>setLinkRiderId(e.target.value)} className={`${control} mt-1 w-full`}><option value="">{t("selectRider")}</option>{riders.map(r=><option key={r.id} value={r.id}>{r.user.name}</option>)}</select></label><label className="mt-4 block text-xs font-bold">{t("reason")}<textarea aria-label={t("linkReason")} required minLength={3} value={linkReason} onChange={e=>setLinkReason(e.target.value)} className={`${control} mt-1 w-full`}/></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={()=>setLinkOpen(false)} className={control}>{t("cancel")}</button><button disabled={link.isPending||!linkRiderId||linkReason.trim().length<3} className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{t("confirmLink")}</button></div></form></div>}
      {unlinkingGroupId && <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"><form aria-label={t("unlinkParcels")} onSubmit={e=>{e.preventDefault();unlink.mutate()}} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]"><h2 className="text-xl font-bold">{t("unlinkParcels")}</h2><p className="mt-2 text-sm text-slate-500">{t("unlinkParcelsExplanation")}</p><label className="mt-4 block text-xs font-bold">{t("reason")}<textarea aria-label={t("unlinkReason")} required minLength={3} value={unlinkReason} onChange={e=>setUnlinkReason(e.target.value)} className={`${control} mt-1 w-full`}/></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={()=>setUnlinkingGroupId(null)} className={control}>{t("cancel")}</button><button disabled={unlink.isPending||unlinkReason.trim().length<3} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{t("confirmUnlink")}</button></div></form></div>}
      {returnOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"><form role="dialog" aria-modal="true" aria-labelledby="return-bulk-title" onSubmit={event => { event.preventDefault(); if (!confirmReturns.isPending) confirmReturns.mutate(); }} className="w-full max-w-lg rounded-2xl bg-white p-6 dark:bg-[#181a1d]"><h2 id="return-bulk-title" className="text-xl font-bold">{t("confirmReturnedToOs")}</h2><p className="mt-3 text-sm text-slate-500">{t("confirmReturnedToOsHelp", { count: selected.length })}</p><label className="mt-4 block text-sm font-bold">{t("businessDate")}<input autoFocus required type="date" disabled={Boolean(returnRequest.current)} value={returnDate} onChange={event => setReturnDate(event.target.value)} className={`${control} mt-1 w-full`} /></label>{confirmReturns.isError && <p role="alert" className="mt-3 text-sm text-rose-600">{confirmReturns.error instanceof Error ? confirmReturns.error.message : t("loadError")}</p>}{returnRequest.current && confirmReturns.isError && <p role="alert">{t("paymentRetryUnchanged")}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={confirmReturns.isPending || Boolean(returnRequest.current)} onClick={() => setReturnOpen(false)} className={control}>{t("cancel")}</button><button disabled={confirmReturns.isPending} className="rounded-lg bg-sky-600 px-4 py-2 text-white disabled:opacity-40">{t(confirmReturns.isPending ? "loading" : "confirmReturnedToOs")}</button></div></form></div>}
      {rescheduleOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"><form role="dialog" aria-modal="true" aria-labelledby="reschedule-title" onSubmit={event => { event.preventDefault(); if (!reschedule.isPending) reschedule.mutate(); }} className="w-full max-w-lg rounded-2xl bg-white p-6 dark:bg-[#181a1d]"><h2 id="reschedule-title" className="text-xl font-bold">{t("rescheduleParcels")}</h2><p className="mt-2 text-sm text-slate-500">{t("rescheduleHelp")}</p><label className="mt-4 block text-sm font-bold">{t("plannedDeliveryDate")}<input autoFocus required type="date" value={rescheduleDate} onChange={event => setRescheduleDate(event.target.value)} className={`${control} mt-1 w-full`} /></label><label className="mt-4 block text-sm font-bold">{t("reason")}<textarea required minLength={3} value={rescheduleReason} onChange={event => setRescheduleReason(event.target.value)} className={`${control} mt-1 w-full`} /></label>{reschedule.isError && <p role="alert" className="mt-3 text-sm text-rose-600">{reschedule.error instanceof Error ? reschedule.error.message : t("loadError")}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={reschedule.isPending} onClick={() => setRescheduleOpen(false)} className={control}>{t("cancel")}</button><button disabled={reschedule.isPending} className="rounded-lg bg-sky-600 px-4 py-2 text-white disabled:opacity-40">{t(reschedule.isPending ? "loading" : "save")}</button></div></form></div>}
    </div>
  );
}
