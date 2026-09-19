import { body, query } from "express-validator";
import { amount, wallet } from "./shared.js";

export const ledgerListValidators = [query("from").optional().isISO8601(), query("to").optional().isISO8601(), query("account").optional().isString().trim().notEmpty()];
export const deliveryCollectionValidators = [body("parcelId").isString().trim().notEmpty(), body("businessDate").isISO8601(), wallet, amount("collectedCod"), amount("collectedDeliveryFee")];
export const returnDeductionValidators = [body("parcelId").isString().trim().notEmpty(), body("businessDate").isISO8601(), body("amount").optional().isInt({ min: 1 })];
export const reversalValidators = [body("sourceType").isString().trim().notEmpty(), body("sourceId").isString().trim().notEmpty(), body("businessDate").isISO8601(), body("reason").isString().trim().isLength({ min: 3, max: 500 })];
