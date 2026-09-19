export type DispatchFilters = {
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

export const emptyDispatchFilters: DispatchFilters = {
  queue: "", shopId: "", batchId: "", riderId: "", assignmentStatus: "", township: "",
  trackingNumber: "", orderId: "", customerName: "", status: "", from: "", to: "",
};

export function dispatchFiltersFromSearch(params: URLSearchParams, lockedQueue = ""): DispatchFilters {
  const filters = { ...emptyDispatchFilters };
  for (const key of Object.keys(filters) as Array<keyof DispatchFilters>) filters[key] = params.get(key) ?? "";
  if (lockedQueue) filters.queue = lockedQueue;
  return filters;
}

export function dispatchFiltersToSearch(filters: DispatchFilters) {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
}
