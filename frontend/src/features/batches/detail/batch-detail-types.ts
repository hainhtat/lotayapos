export type Location = { id: string; code?: string; nameEn: string; nameMy?: string };
export type Township = Location & {
  deliveryFee: number;
  district?: {
    id: string;
    nameEn: string;
    nameMy?: string;
    regionStateId?: string;
    regionState?: { id?: string; nameEn: string; nameMy?: string };
  };
};
export type Zone = { id: string; code?: string; name: string };
export type SavedParcel = {
  id: string;
  trackingNumber: string;
  orderId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  address: string;
  status: string;
  codAmount: number;
  deliveryFee?: number | null;
  townshipId?: string | null;
  zoneId?: string | null;
  linkGroupId?: string | null;
  linkGroup?: { id: string } | null;
  townshipRelation?: { id: string; nameEn: string; deliveryFee: number; district?: { id: string; regionStateId: string } } | null;
  zoneRelation?: { id: string; name: string } | null;
};
export type Batch = {
  id: string;
  hubId: string;
  label: string;
  advancePaid: number;
  advancePostedAmount?: number;
  paymentPaid?: number;
  historicalSettledAmount?: number;
  openingAdjustment?: number;
  totalCod: number;
  remainingToOs: number;
  balanceError?: string | null;
  deliveryFeeCredit: number;
  returnedCod: number;
  nextTrackingSequence: number;
  shop: { name: string };
  parcels: SavedParcel[];
  finalizedAt?: string | null;
  automaticAccounting?: boolean;
  availableOsCredit?: number;
  expectedOsCreditApplied?: number;
  expectedOutstanding?: number;
  expectedCarryForwardCredit?: number;
};

export type ParcelRow = {
  orderId: string;
  customerName: string;
  address: string;
  regionStateId: string;
  districtId: string;
  townshipId: string;
  zoneId: string;
  customerPhone: string;
  codAmount: string;
};
export type ManifestPreviewRow = ParcelRow & { sourcePage: number; confidence: number; warnings: string[] };
export type ManifestPreview = { rows: ManifestPreviewRow[]; pageCount: number; truncated: boolean; extraction: "LOCAL_TEXT"; saved: false };
