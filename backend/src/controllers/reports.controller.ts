import type { RequestHandler } from "express";
import { getMonthlyOperationsReport, getOsStatementReport, getProfitReport, getReturnsReport, getRiderPerformanceReport } from "../services/reports.service.js";

const input = (req: Parameters<RequestHandler>[0]) => ({
  from: String(req.query.from), to: String(req.query.to),
  hubId: typeof req.query.hubId === "string" ? req.query.hubId : undefined,
  shopId: typeof req.query.shopId === "string" ? req.query.shopId : undefined,
  riderId: typeof req.query.riderId === "string" ? req.query.riderId : undefined,
});
const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.auth!.sub, role: req.auth!.role });
export const csvValue = (value: unknown) => {
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  let cell = String(value ?? "");
  if (/^[\t\r]/.test(cell) || /^\s*[=+\-@]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
};
function sendCsv(res: Parameters<RequestHandler>[1], filename: string, headers: string[], rows: unknown[][]) {
  res.type("text/csv").set("Content-Disposition", `attachment; filename="${filename}"`).send(`\uFEFF${[headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n")}`);
}

export const profit: RequestHandler = async (req, res) => {
  const data = await getProfitReport(
    {
      from: String(req.query.from),
      to: String(req.query.to),
      hubId: typeof req.query.hubId === "string" ? req.query.hubId : undefined,
    },
    { id: req.auth!.sub, role: req.auth!.role },
  );
  res.json({ success: true, data });
};

export const monthlyOperations: RequestHandler = async (req, res) => res.json({ success: true, data: await getMonthlyOperationsReport(input(req), actor(req)) });

export const returns: RequestHandler = async (req, res) => {
  const data = await getReturnsReport(input(req), actor(req));
  if (req.query.format === "csv") return sendCsv(res, `returns-${input(req).from}-${input(req).to}.csv`, ["occurredAt", "trackingNumber", "orderId", "fromStatus", "toStatus", "reasonCode", "currentStatus", "advanceAmount", "overdue"], data.events.map((row) => [row.occurredAt.toISOString(), row.parcel.trackingNumber, row.parcel.orderId, row.fromStatus, row.toStatus, row.reasonCode, row.parcel.status, row.parcel.advanceAmount, row.overdue]));
  res.json({ success: true, data });
};

export const riderPerformance: RequestHandler = async (req, res) => {
  const data = await getRiderPerformanceReport(input(req), actor(req));
  if (req.query.format === "csv") return sendCsv(res, `rider-performance-${input(req).from}-${input(req).to}.csv`, ["riderId", "riderName", "completedWays", "delivered", "partial", "failed", "rejected", "superseded", "commissionAmount"], data.riders.map((row) => [row.riderId, row.riderName, row.completedWays, row.delivered, row.partial, row.failed, row.rejected, row.superseded, row.commissionAmount]));
  res.json({ success: true, data });
};

export const osStatements: RequestHandler = async (req, res) => {
  const data = await getOsStatementReport(input(req), actor(req));
  if (req.query.format === "csv") return sendCsv(res, `os-statements-${input(req).from}-${input(req).to}.csv`, ["businessDate", "shop", "status", "grossCollectedCod", "advanceDeduction", "returnDeduction", "deliveryFeeDeduction", "adjustmentAmount", "netAmount", "wallet"], data.settlements.map((row) => [row.businessDate.toISOString().slice(0, 10), row.shop.name, row.status, row.grossCollectedCod, row.advanceDeduction, row.returnDeduction, row.deliveryFeeDeduction, row.adjustmentAmount, row.netAmount, row.wallet]));
  res.json({ success: true, data });
};
