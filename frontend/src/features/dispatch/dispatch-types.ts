export type Parcel = {
  id: string;
  trackingNumber: string;
  orderId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  address?: string | null;
  status: string;
  collectionMode?: "PAID_BY_OS" | "CASH_RECEIPT_EXCEPTION" | null;
  codAmount: number;
  deliveryFee?: number | null;
  actualCodCollected?: number | null;
  townshipId?: string | null;
  zoneId?: string | null;
  batch: { id?: string; label: string; pickupDate?: string; finalizedAt?: string | null; shop: { name: string } };
  rider?: { id?: string; user?: { name?: string } } | null;
  zone?: string | null;
  township?: string | null;
  linkGroup?: { id: string; address: string; baseDeliveryFee: number; totalDeliveryFee: number } | null;
  reasonCode?: string | null;
  plannedDeliveryDate?: string | null;
  createdAt?: string;
};
export type Township = {
  id: string;
  nameEn: string;
  nameMy?: string | null;
  deliveryFee: number;
  district?: { nameEn: string; regionState?: { nameEn: string } };
};
export type Zone = { id: string; name: string };
export type BatchSummary = {
  id: string;
  label: string;
  pickupDate: string;
  shop: { name: string };
  parcels: Array<{ status: string }>;
};
export type MasterData = {
  shops?: Array<{ id: string; name: string }>;
  riders: Array<{ id: string; hubId?: string | null; user: { name: string }; hub?: { name: string } | null }>;
};
export type ReasonCode = {
  id: string;
  code: string;
  labelEn: string;
  labelMy: string;
  outcome: "PARTIAL" | "FAILED" | "REJECTED";
  noteRequired: boolean;
  active: boolean;
};
export type OsReturnListPreview = { parcelCount: number; totalCod: number; parcels: Array<{ id?: string; trackingNumber: string; orderId?: string | null; customerName: string; address?: string | null; codAmount: number; status?: string; reasonCode?: string | null; batch?: { label?: string; shop?: { name?: string } } }> };
export type PaidToOsHandoverPreview = {
  parcelCount: number;
  totalCod: number;
  totalFees: number;
  sections: Array<{
    riderName: string;
    hubName?: string;
    parcels: Array<{
      id?: string;
      trackingNumber: string;
      customerName: string;
      shopName?: string | null;
      codAmount: number;
      deliveryFee?: number | null;
      paidToOsFeeIncluded?: boolean;
      note?: string | null;
    }>;
  }>;
};
