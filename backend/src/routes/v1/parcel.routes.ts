import { Router } from "express";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { validation } from "../../middleware/error.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { detail, history, list, updateParcel, updateStatus } from "../../controllers/parcel.controller.js";
import { parcelListValidation, parcelStatusValidation, parcelUpdateValidation } from "../../validators/parcels.js";

export const parcelRouter = Router();
parcelRouter.get("/", requireAuth, parcelListValidation, validation, asyncHandler(list));
parcelRouter.get("/:id/history", requireAuth, asyncHandler(history));
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
