import { env } from "../config/env.js";

export type RiderPayContext = {
  payModel?: string | null;
  commissionRateBps?: number | null;
};

/** Resolve percentage commission bps from rider pay context; SALARY earns no percentage. */
export function resolveCommissionRateBps(rider?: RiderPayContext | null) {
  if (rider?.payModel === "SALARY") return 0;
  if (rider?.commissionRateBps != null && rider.commissionRateBps > 0) return rider.commissionRateBps;
  return env.riderCommissionRateBps;
}
