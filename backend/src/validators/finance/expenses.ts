import { body, query } from "express-validator";
import { idempotencyKey, optionalHub, wallet } from "./shared.js";

export const createExpenseCategoryValidators = [
  body("code").isString().trim().matches(/^[A-Za-z0-9_]{2,50}$/),
  body("nameEn").isString().trim().isLength({ min: 2, max: 100 }),
  body("nameMy").isString().trim().isLength({ min: 1, max: 100 }),
];
export const listExpensesValidators = [query("businessDate").optional().isISO8601(), query("hubId").optional().isString().trim().notEmpty(), query("limit").optional().isInt({ min: 1, max: 200 }).toInt()];
export const createExpenseValidators = [idempotencyKey, body("businessDate").isISO8601(), optionalHub, body("categoryId").isString().trim().notEmpty(), wallet, body("amount").isInt({ min: 1 }), body("description").isString().trim().isLength({ min: 2, max: 500 })];
