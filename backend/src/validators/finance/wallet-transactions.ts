import { query } from "express-validator";

export const walletTransactionValidators = [
  query("from").matches(/^\d{4}-\d{2}-\d{2}$/),
  query("to").matches(/^\d{4}-\d{2}-\d{2}$/),
  query("hubId").isString().trim().notEmpty(),
  query("wallet").optional().isIn(["CASH", "KBZ_PAY", "WAVE_PAY"]),
  query("type").optional().isString().trim().matches(/^[A-Z][A-Z_]{1,79}$/),
  query("riderId").optional().isString().trim().notEmpty(),
  query("shopId").optional().isString().trim().notEmpty(),
  query("format").optional().equals("csv"),
  query("page").optional().isInt({ min: 1, max: 100000 }).toInt(),
  query("pageSize").optional().isInt({ min: 1, max: 100 }).toInt(),
];
