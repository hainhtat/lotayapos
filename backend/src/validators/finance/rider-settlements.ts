import { body, query } from "express-validator";
import { idempotencyKey } from "./shared.js";

const walletAmounts = [
  body("cash").isInt({ min: 0 }),
  body("kbzPay").isInt({ min: 0 }),
  body("wavePay").isInt({ min: 0 }),
];

export const createRiderSettlementValidators = [
  body("riderId").isString(),
  body("businessDate").isISO8601(),
  ...walletAmounts,
  body("varianceReason").optional().isString().trim().isLength({ min: 3, max: 500 }),
  body("manualEntryReason").optional().isString().trim().isLength({ min: 3, max: 500 }),
  idempotencyKey,
];

export const riderSettlementPreviewValidators = [
  query("businessDate").isISO8601(),
  query("riderId").optional().isString().trim().notEmpty(),
];

export const riderOutstandingValidators = [query("businessDate").isISO8601()];

export const declareRiderSettlementValidators = [
  body("businessDate").isISO8601(),
  ...walletAmounts,
  body("note").optional().isString().trim().isLength({ max: 500 }),
];
