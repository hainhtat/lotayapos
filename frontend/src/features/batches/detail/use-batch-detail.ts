import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import type { ParcelRow, SavedParcel } from "./batch-detail-types";
import { getBatch, getRegions, getTownships, getZones, finalizeBatch, updateBatchParcel, saveBatchParcels } from "./batch-detail-api";
import { blank } from "./parcel-draft-rules";

type EditFields = { orderId: string; customerName: string; address: string; customerPhone: string; codAmount: string; deliveryFee: string; townshipId: string; zoneId: string };
type Entry = { row: ParcelRow; index: number };

export function useBatchDetail({ id, editing, editForm, setEditing, setRows, setMessage, closeFinalize }: {
  id: string; editing: SavedParcel | null; editForm: EditFields; setEditing: (parcel: SavedParcel | null) => void;
  setRows: Dispatch<SetStateAction<ParcelRow[]>>;
  setMessage: (message: string) => void; closeFinalize: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const batch = useQuery({ queryKey: ["batch", id], queryFn: () => getBatch(id) });
  const regions = useQuery({ queryKey: ["locations", "regions"], queryFn: getRegions });
  const allTownships = useQuery({ queryKey: ["locations", "townships", "all"], queryFn: getTownships });
  const editZones = useQuery({
    queryKey: ["locations", "zones", batch.data?.hubId, editForm.townshipId],
    enabled: Boolean(batch.data?.hubId && editForm.townshipId),
    queryFn: () => getZones(batch.data!.hubId, editForm.townshipId),
  });
  const invalidateParcelViews = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["batch", id] }),
    queryClient.invalidateQueries({ queryKey: ["parcels"] }),
  ]);
  const finalize = useMutation({
    mutationFn: () => finalizeBatch(id),
    onSuccess: async () => { closeFinalize(); setMessage(t("batchFinalized")); await queryClient.invalidateQueries({ queryKey: ["batch", id] }); },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
  });
  const updateParcel = useMutation({
    mutationFn: () => updateBatchParcel(editing!, editForm, Boolean(batch.data?.finalizedAt)),
    onSuccess: async () => { setMessage(t("parcelUpdated")); setEditing(null); await invalidateParcelViews(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
  });
  const save = useMutation({
    mutationFn: (entries: Entry[]) => saveBatchParcels(id, entries),
    onSuccess: async (_data, entries) => {
      setMessage(t("parcelsSaved", { count: entries.length }));
      setRows((current) => current.map((row, index) => {
        const saved = entries.find((entry) => entry.index === index);
        return saved && saved.row === row ? blank() : row;
      }));
      await invalidateParcelViews();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
  });
  return { batch, regions, allTownships, editZones, finalize, updateParcel, save };
}
