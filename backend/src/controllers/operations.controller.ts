import type { RequestHandler } from "express";
import * as service from "../services/operations.service.js";
import * as parcelService from "../services/parcel.service.js";
import { generateDispatchManifestPdf } from "../utils/manifest-pdf.js";
import { previewManifestPdf } from "../services/manifest-import.service.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.auth!.sub, role: req.auth!.role });

export const batches: RequestHandler = async (req, res) => {
  const result = await service.listBatches(actor(req), {
    page: req.query.page === undefined ? undefined : Number(req.query.page),
    pageSize: req.query.pageSize === undefined ? undefined : Number(req.query.pageSize),
    shopId: typeof req.query.shopId === "string" ? req.query.shopId : undefined,
    hubId: typeof req.query.hubId === "string" ? req.query.hubId : undefined,
    dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
    search: typeof req.query.search === "string" ? req.query.search : undefined,
  });
  res.json({
    success: true,
    data: result.items,
    pagination: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: Math.ceil(result.total / result.pageSize) },
  });
};
export const overdueUnsent: RequestHandler = async (req, res) => {
  const result = await service.listOverdueUnsentParcels(actor(req), {
    page: req.query.page === undefined ? undefined : Number(req.query.page),
    pageSize: req.query.pageSize === undefined ? undefined : Number(req.query.pageSize),
    days: req.query.days === undefined ? undefined : Number(req.query.days),
    hubId: typeof req.query.hubId === "string" ? req.query.hubId : undefined,
  });
  res.json({
    success: true,
    data: result.items,
    meta: { days: result.days, cutoffDate: result.cutoffDate },
    pagination: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: Math.ceil(result.total / result.pageSize) },
  });
};
export const batchDetail: RequestHandler = async (req,res)=>res.json({success:true,data:await service.getBatchDetail(String(req.params.id),actor(req))});
export const bulkCreateParcels: RequestHandler = async(req,res)=>res.status(201).json({success:true,data:await service.bulkCreateParcels(String(req.params.id),req.body,actor(req))});
export const previewManifestImport: RequestHandler = async(req,res)=>res.json({success:true,data:await previewManifestPdf(String(req.params.id),Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0),actor(req))});
export const createBatch: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.createBatch(req.body, actor(req)) });
export const postPickupAdvances: RequestHandler = async (req, res) => res.json({ success: true, data: await service.postPickupAdvances(String(req.params.id), req.body, actor(req)) });
export const finalizeBatch: RequestHandler = async (req, res) => res.json({ success: true, data: await service.finalizeBatch(String(req.params.id), actor(req)) });
export const alerts: RequestHandler = async (req, res) => res.json({ success: true, data: await service.listAlerts(actor(req)) });
export const acknowledgeAlert: RequestHandler = async (req, res) => res.json({ success: true, data: await service.acknowledgeAlert(String(req.params.id), actor(req)) });

export const bulkAssign: RequestHandler = async (req, res) => {
  const result = await service.bulkAssignParcels(req.body, actor(req));
  res.status(200).json({
    success: true,
    data: {
      assignedCount: result.assignedCount,
      rider: result.rider,
      parcels: result.parcels.map((parcel) => ({
        id: parcel.id,
        trackingNumber: parcel.trackingNumber,
        codAmount: parcel.codAmount,
        deliveryFee: parcel.deliveryFee,
      })),
    },
  });
};

export const previewManifest: RequestHandler = async (req, res) => {
  const result = await service.buildManifestForRiders(req.body, actor(req));
  res.status(200).json({
    success: true,
    data: {
      sections: result.sections,
      summary: result.summary,
      riderCount: result.riderCount,
      parcelCount: result.parcelCount,
    },
  });
};

export const downloadManifest: RequestHandler = async (req, res) => {
  const result = await service.buildManifestForRiders(req.body, actor(req));
  const pdf = await generateDispatchManifestPdf({ sections: result.sections, statusesLabel: result.statusesLabel });
  const filename = `${result.filenameSuffix}.pdf`;
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, "_");
  res.status(200).type("application/pdf").set({
    "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "X-Rider-Count": String(result.riderCount),
    "X-Parcel-Count": String(result.parcelCount),
  }).send(pdf);
};

export const linkParcels: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.linkParcels(req.body, actor(req)) });
export const unlinkParcels: RequestHandler = async (req, res) => res.json({ success: true, data: await service.unlinkParcelGroup({ groupId: String(req.params.id), ...req.body }, actor(req)) });
export const correctDeliveredRider: RequestHandler = async (req, res) =>
  res.json({ success: true, data: await parcelService.correctDeliveredRider(String(req.params.id), req.body, actor(req)) });
export const reassignParcel: RequestHandler = async (req, res) => res.json({ success: true, data: await service.reassignParcel(String(req.params.id), req.body, actor(req)) });
export const extendPendingReturn: RequestHandler = async (req, res) => res.json({ success: true, data: await service.extendPendingReturn(String(req.params.id), req.body, actor(req)) });
