import { body, param, query } from "express-validator";
import { editableStatement, settlementBatchIds } from "./os-settlements.js";
import { idempotencyKey, optionalHub, wallet } from "./shared.js";

export const osSettlementDraftListValidators = [query("shopId").optional().isString().trim().notEmpty()];
export const savedOsSettlementDraftListValidators = [query("shopId").optional().isString().trim().notEmpty(), query("hubId").optional().isString().trim().notEmpty()];
export const saveOsSettlementDraftValidators = [body("shopId").isString().trim().notEmpty(), optionalHub, body("batchIds").isArray({ min: 1, max: 100 }), body("businessDate").isISO8601(), wallet, ...editableStatement];
export const editOsSettlementDraftValidators = [param("id").isString().trim().notEmpty(), body("expectedVersion").isInt({ min: 1 }), ...editableStatement];
export const osSettlementPreviewValidators = [body("shopId").isString().trim().notEmpty(), optionalHub, settlementBatchIds];
export const osSettlementListValidators = [query("shopId").optional().isString().trim().notEmpty(), query("hubId").optional().isString().trim().notEmpty()];
export const osSettlementDetailValidators = [param("id").isString().trim().notEmpty()];
export const createOsSettlementValidators = [body("shopId").isString().trim().notEmpty(), optionalHub, settlementBatchIds, body("businessDate").isISO8601(), wallet, body("advanceDeduction").optional().isInt({ min: 0 }), body("returnDeduction").optional().isInt({ min: 0 }), body("deliveryFeeDeduction").optional().isInt({ min: 0 }), body("adjustmentAmount").optional().isInt().custom((value, { req }) => Number(value) === 0 || (typeof req.body.adjustmentReason === "string" && req.body.adjustmentReason.trim().length >= 3)), body("adjustmentReason").optional().isString().trim().isLength({ min: 3, max: 500 }), idempotencyKey];
export const reverseOsSettlementValidators = [param("id").isString().trim().notEmpty(), body("businessDate").isISO8601(), body("reason").isString().trim().isLength({ min: 3, max: 500 })];
export const amendOsSettlementValidators = [param("id").isString().trim().notEmpty(), body("expectedVersion").isInt({ min: 1 }), body("businessDate").isISO8601(), wallet, ...editableStatement];
