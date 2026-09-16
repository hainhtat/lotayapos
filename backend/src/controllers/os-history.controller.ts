import type { RequestHandler } from "express";
import { applyHistoricalOsSettlement, previewHistoricalOsSettlement } from "../services/os-history.service.js";

export const previewOsHistory: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await previewHistoricalOsSettlement({ id: req.auth!.sub, role: req.auth!.role }) });
};
export const applyOsHistory: RequestHandler = async (req, res) => {
  res.status(201).json({ success: true, data: await applyHistoricalOsSettlement(req.body, { id: req.auth!.sub, role: req.auth!.role }) });
};
