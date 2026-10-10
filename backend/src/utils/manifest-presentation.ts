export type LinkedManifestParcel = {
  linkGroup?: { id: string; totalDeliveryFee: number } | null;
  deliveryFee?: number | null;
};

/** Keep visible group members together without changing which parcels were selected. */
export function groupManifestParcels<T extends LinkedManifestParcel>(parcels: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const parcel of parcels) {
    const id = parcel.linkGroup?.id;
    if (id) groups.set(id, [...(groups.get(id) ?? []), parcel]);
  }
  const emitted = new Set<string>();
  return parcels.flatMap((parcel) => {
    const id = parcel.linkGroup?.id;
    if (!id) return [parcel];
    if (emitted.has(id)) return [];
    emitted.add(id);
    return groups.get(id) ?? [parcel];
  });
}

/** A linked delivery has one shared fee, even when only some members pass the manifest filters. */
export function manifestFeeTotal(parcels: LinkedManifestParcel[]): number {
  const counted = new Set<string>();
  return parcels.reduce((sum, parcel) => {
    const group = parcel.linkGroup;
    if (!group) return sum + (parcel.deliveryFee ?? 0);
    if (counted.has(group.id)) return sum;
    counted.add(group.id);
    return sum + group.totalDeliveryFee;
  }, 0);
}
