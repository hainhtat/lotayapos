import { Router } from "express";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { validation } from "../../middleware/error.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { bulkUpdateStatus, detail, fieldHistory, history, list, updateParcel, updateStatus } from "../../controllers/parcel.controller.js";
import { parcelBulkStatusValidation, parcelListValidation, parcelStatusValidation, parcelUpdateValidation } from "../../validators/parcels.js";

export const parcelRouter = Router();
parcelRouter.get("/", requireAuth, parcelListValidation, validation, asyncHandler(list));
parcelRouter.post(
  "/bulk-status",
  requireAuth,
  requireRoles("SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"),
  parcelBulkStatusValidation,
  validation,
  asyncHandler(bulkUpdateStatus),
);
parcelRouter.get("/:id/history", requireAuth, asyncHandler(history));
parcelRouter.get("/:id/field-history", requireAuth, asyncHandler(fieldHistory));
parcelRouter.get("/:id", requireAuth, asyncHandler(detail));
parcelRouter.patch(
  "/:id",
  requireAuth,
  requireRoles("SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"),
  parcelUpdateValidation,
  validation,
  asyncHandler(updateParcel),
);
parcelRouter.post(
  "/:id/status",
  requireAuth,
  requireRoles("SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "RIDER"),
  parcelStatusValidation,
  validation,
  asyncHandler(updateStatus),
);
