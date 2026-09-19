import { body, query } from "express-validator";
import { idempotencyKey } from "./shared.js";

export const receiveOsReturnsBulkValidators = [body("parcelIds").isArray({ min: 1, max: 50 }), body("parcelIds.*").isString().trim().notEmpty(), body("businessDate").isISO8601({ strict: true }), idempotencyKey];
export const osPendingReturnsValidators = [query("shopId").optional().isString().trim().notEmpty(), query("hubId").optional().isString().trim().notEmpty()];
export const receiveOsReturnValidators = [body("parcelId").isString().trim().notEmpty(), body("businessDate").isISO8601(), idempotencyKey];
