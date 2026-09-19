import { body } from "express-validator";
import { idempotencyKey } from "./shared.js";

export const editableStatement = [
  body("advanceDeduction").isInt({ min: 0 }),
  body("returnDeduction").isInt({ min: 0 }),
  body("deliveryFeeDeduction").isInt({ min: 0 }),
  body("adjustmentAmount").isInt(),
  body("adjustmentReason").optional().isString().trim().isLength({ min: 3, max: 500 }),
  body("reason").isString().trim().isLength({ min: 3, max: 500 }),
  idempotencyKey,
];

export const settlementBatchIds = body("batchIds")
  .isArray({ min: 1, max: 100 })
  .custom((ids: unknown[]) =>
    ids.every((id) => typeof id === "string" && id.trim().length > 0),
  );
