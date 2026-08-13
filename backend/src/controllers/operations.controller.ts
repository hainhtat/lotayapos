import type { RequestHandler } from "express";
import * as service from "../services/operations.service.js";
import { generateDispatchManifestPdf } from "../utils/manifest-pdf.js";
import { previewManifestPdf } from "../services/manifest-import.service.js";

const actor = (req: Parameters<RequestHandler>[0]) => ({ id: req.auth!.sub, role: req.auth!.role });

export const batches: RequestHandler = async (req, res) => res.json({ success: true, data: await service.listBatches(actor(req)) });
export const batchDetail: RequestHandler = async (req,res)=>res.json({success:true,data:await service.getBatchDetail(String(req.params.id),actor(req))});
export const bulkCreateParcels: RequestHandler = async(req,res)=>res.status(201).json({success:true,data:await service.bulkCreateParcels(String(req.params.id),req.body,actor(req))});
export const previewManifestImport: RequestHandler = async(req,res)=>res.json({success:true,data:await previewManifestPdf(String(req.params.id),Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0),actor(req))});
export const createBatch: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.createBatch(req.body, actor(req)) });
export const postPickupAdvances: RequestHandler = async (req, res) => res.json({ success: true, data: await service.postPickupAdvances(String(req.params.id), req.body, actor(req)) });
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

export const downloadManifest: RequestHandler = async (req, res) => {
  const result = await service.buildManifestForRiders(req.body, actor(req));
  const pdf = generateDispatchManifestPdf({ sections: result.sections });
  res.status(200).type("application/pdf").set({
    "Content-Disposition": `attachment; filename="dispatch-manifest-${result.filenameSuffix}.pdf"`,
    "X-Rider-Count": String(result.riderCount),
    "X-Parcel-Count": String(result.parcelCount),
  }).send(pdf);
};

export const linkParcels: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: await service.linkParcels(req.body, actor(req)) });
export const reassignParcel: RequestHandler = async (req, res) => res.json({ success: true, data: await service.reassignParcel(String(req.params.id), req.body, actor(req)) });
export const extendPendingReturn: RequestHandler = async (req, res) => res.json({ success: true, data: await service.extendPendingReturn(String(req.params.id), req.body, actor(req)) });
