import type { RequestHandler } from "express";
import * as service from "../services/parcel.service.js";

export const list: RequestHandler = async (req, res) => {
  const result = await service.listParcels({ id: req.auth!.sub, role: req.auth!.role }, req.query.assignedToMe === "true", {
  batchId: typeof req.query.batchId === "string" ? req.query.batchId : undefined,
  riderId: typeof req.query.riderId === "string" ? req.query.riderId : undefined,
  assignmentStatus: typeof req.query.assignmentStatus === "string" ? req.query.assignmentStatus as "ASSIGNED" | "UNASSIGNED" : undefined,
  zone: typeof req.query.zone === "string" ? req.query.zone : undefined,
  township: typeof req.query.township === "string" ? req.query.township : undefined,
  townshipId: typeof req.query.townshipId === "string" ? req.query.townshipId : undefined,
  districtId: typeof req.query.districtId === "string" ? req.query.districtId : undefined,
  regionStateId: typeof req.query.regionStateId === "string" ? req.query.regionStateId : undefined,
  dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
  dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
  trackingNumber: typeof req.query.trackingNumber === "string" ? req.query.trackingNumber : undefined,
  orderId: typeof req.query.orderId === "string" ? req.query.orderId : undefined,
  customerName: typeof req.query.customerName === "string" ? req.query.customerName : undefined,
  shopId: typeof req.query.shopId === "string" ? req.query.shopId : undefined,
  status: typeof req.query.status === "string" ? req.query.status : undefined,
  reasonCode: typeof req.query.reasonCode === "string" ? req.query.reasonCode : undefined,
  page: req.query.page === undefined ? undefined : Number(req.query.page),
  pageSize: req.query.pageSize === undefined ? undefined : Number(req.query.pageSize),
  });
  res.json({ success: true, data: result.items, pagination: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: Math.ceil(result.total / result.pageSize) } });
};
export const updateStatus: RequestHandler = async (req, res) => res.json({ success: true, data: await service.updateStatus(String(req.params.id), req.body.status, { id: req.auth!.sub, role: req.auth!.role }, req.body.reasonCode, req.body.note, req.body.actualCodCollected, req.body.collectionWallet) });
export const updateParcel: RequestHandler = async (req, res) => res.json({ success: true, data: await service.updateParcel(String(req.params.id), req.body, { id: req.auth!.sub, role: req.auth!.role }) });
export const history: RequestHandler = async (req, res) => res.json({ success: true, data: await service.getParcelHistory(String(req.params.id), { id: req.auth!.sub, role: req.auth!.role }) });
export const detail: RequestHandler = async (req, res) => res.json({ success: true, data: await service.getParcelDetail(String(req.params.id), { id: req.auth!.sub, role: req.auth!.role }) });
