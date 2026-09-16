import { Router } from "express";
import { body } from "express-validator";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { validation } from "../../middleware/error.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { applyOsHistory, previewOsHistory } from "../../controllers/os-history.controller.js";

export const osHistoryRouter = Router();
osHistoryRouter.use(requireAuth, requireRoles("SUPERADMIN"));
osHistoryRouter.post("/preview", asyncHandler(previewOsHistory));
osHistoryRouter.post("/apply", [
  body("fingerprint").isString().matches(/^[a-f0-9]{64}$/),
  body("batchIds").isArray({ min: 1 }), body("batchIds.*").isString().trim().notEmpty(),
  body("retainedBatchIds").isArray({ min: 3, max: 3 }), body("retainedBatchIds.*").isString().trim().notEmpty(),
  body("businessDate").isISO8601({ strict: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
  body("reason").isString().trim().isLength({ min: 3, max: 500 }),
  body("idempotencyKey").isString().trim().isLength({ min: 8, max: 100 }).matches(/^[A-Za-z0-9._:-]+$/),
], validation, asyncHandler(applyOsHistory));
