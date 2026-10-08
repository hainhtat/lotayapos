const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const RESOLVED_STATUSES = new Set(["DELIVERED", "RETURNED", "VOIDED"]);

export function threeDaysInHandSnapshot(
  parcels: Array<{ id: string; status: string; createdAt: Date }>,
  now = new Date(),
) {
  const cutoff = now.getTime() - THREE_DAYS_MS;
  const parcelIds: string[] = [];
  let nextDueAt: number | null = null;

  for (const parcel of parcels) {
    if (RESOLVED_STATUSES.has(parcel.status)) continue;
    const createdAt = parcel.createdAt.getTime();
    if (createdAt <= cutoff) {
      parcelIds.push(parcel.id);
    } else {
      const dueAt = createdAt + THREE_DAYS_MS;
      nextDueAt = nextDueAt === null ? dueAt : Math.min(nextDueAt, dueAt);
    }
  }

  return {
    parcelIds,
    nextDueAt: nextDueAt === null ? null : new Date(nextDueAt).toISOString(),
    calculatedAt: now.toISOString(),
  };
}
