import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Link2, Pencil, RefreshCw, Search, UserPlus, UserRoundPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { DeliveryStatusPanel, type ManifestPreviewData } from "@/components/delivery-status-panel";
import { ApiError, api, apiRaw } from "@/lib/api";
import { isDateChangeReason } from "@/lib/exception-reasons";
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

const emptyFilters: Filters = {
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
  const [editing, setEditing] = useState<Parcel | null>(null);
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
  const [actualCod, setActualCod] = useState("");
  const [collectionWallet, setCollectionWallet] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const next = Object.fromEntries(
      (Object.keys(emptyFilters) as Array<keyof Filters>).map((key) => [key, searchParams.get(key) ?? ""]),
    ) as Filters;
    setFilters((current) =>
      (Object.keys(next) as Array<keyof Filters>).every((key) => current[key] === next[key]) ? current : next,
    );
  }, [searchParams]);

  const query = Object.entries(filters)
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
    await queryClient.invalidateQueries({ queryKey: ["parcels"] });
  };

  const assign = useMutation({
    mutationFn: (input: { parcelIds: string[]; riderId: string }) =>
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
    mutationFn: (input: { parcelId: string; status: string; reasonCode?: string; note?: string }) =>
      api(`/parcels/${input.parcelId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: input.status,
          ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
          ...(input.note ? { note: input.note } : { note: OPS_CORRECTION_NOTE }),
        }),
      }),
    onSuccess: async () => {
      setReasonPrompt(null);
      setReasonCode("");
      setReasonNote("");
      setMessage(t("statusUpdated"));
      await invalidateParcels();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : t("loadError")),
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
      link.download = `dispatch-manifest-${manifestRiderIds.length === 1 ? manifestRiderIds[0] : `${manifestRiderIds.length || "hub"}-riders`}.pdf`;
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
  const linkValidation =
    selectedParcels.length < 2
      ? t("selectAtLeastTwoForLink")
      : selectedParcels.some((parcel) => parcel.linkGroup || parcel.status === "DELIVERED")
        ? t("selectedParcelsNotLinkable")
        : new Set(selectedParcels.map((parcel) => parcel.address?.trim().toLocaleLowerCase().replace(/\s+/g, " "))).size !== 1
          ? t("sameAddressRequired")
          : new Set(selectedParcels.map((parcel) => parcel.deliveryFee)).size !== 1
            ? t("sameDeliveryFeeRequired")
            : new Set(selectedParcels.map((parcel) => parcel.rider?.id ?? null)).size !== 1
              ? t("sameRiderRequired")
              : null;

  const link = useMutation({
    mutationFn: () =>
      api("/operations/parcels/link", {
        method: "POST",
        body: JSON.stringify({ parcelIds: selected }),
      }),
    onSuccess: async () => {
      setSelected([]);
      setMessage(t("parcelsLinked"));
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
      let updated = 0;
      for (const parcel of selectedParcels) {
        if (parcel.status === bulkStatus) continue;
        try {
          await api(`/parcels/${parcel.id}/status`, {
            method: "POST",
            body: JSON.stringify({
              status: bulkStatus,
              note,
              ...((bulkStatus === "FAILED" || bulkStatus === "REJECTED") && bulkReasonCode
                ? { reasonCode: bulkReasonCode }
                : {}),
            }),
          });
          updated += 1;
        } catch (error) {
          const detail = error instanceof Error ? error.message : t("loadError");
          throw new Error(t("bulkStatusPartialFailure", { updated, detail }));
        }
      }
      return updated;
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
    if (nextStatus === "FAILED" || nextStatus === "REJECTED") {
      setReasonPrompt({ parcel, status: nextStatus });
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
                  {status.replaceAll("_", " ")}
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
            onClick={() => assign.mutate({ parcelIds: selected, riderId })}
            className="rounded-md bg-[#1598ef] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            <UserPlus size={14} className="mr-1 inline" />
            {assign.isPending ? t("loading") : `${t("assignParcels")} (${selected.length})`}
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
            disabled={Boolean(linkValidation) || link.isPending}
            onClick={() => link.mutate()}
            className="rounded-md border border-[#1598ef] px-3 py-1.5 text-xs font-bold text-[#0787df] disabled:opacity-50"
          >
            <Link2 size={14} className="mr-1 inline" />
            {link.isPending ? t("loading") : `${t("linkParcels")} (${selected.length})`}
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
                  {status.replaceAll("_", " ")}
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
                              {status.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex justify-end gap-1">
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
        <div role="dialog" aria-modal="true" aria-labelledby="manifest-title" className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]">
            <h2 id="manifest-title" className="font-display text-xl font-bold">
              {t("downloadManifest")}
            </h2>
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
        <div role="dialog" aria-modal="true" aria-labelledby="edit-parcel-title" className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
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
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <h2 id="edit-parcel-title" className="font-display text-xl font-bold">
              {t("editParcel")}
            </h2>
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

      {correctingRider && (
        <div role="dialog" aria-modal="true" aria-labelledby="correct-rider-title" className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!correctRiderId || correctReason.trim().length < 3 || correctRiderId === correctingRider.rider?.id) return;
              correctRider.mutate();
            }}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <h2 id="correct-rider-title" className="font-display text-xl font-bold">
              {t("correctRider")}
            </h2>
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
        <div role="dialog" aria-modal="true" aria-labelledby="partial-title" className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
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
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <h2 id="partial-title" className="font-display text-xl font-bold">
              {t("partialReturn")}
            </h2>
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

      {reasonPrompt && (
        <div role="dialog" aria-modal="true" aria-labelledby="reason-prompt-title" className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
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
              });
            }}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <h2 id="reason-prompt-title" className="font-display text-xl font-bold">
              {t("reasonCode")} · {reasonPrompt.status.replaceAll("_", " ")}
            </h2>
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
    </div>
  );
}
