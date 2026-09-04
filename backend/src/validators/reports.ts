import { query } from "express-validator";

const businessDate = (field: string) => query(field)
  .isString()
  .matches(/^\d{4}-\d{2}-\d{2}$/)
  .withMessage(`${field} must use YYYY-MM-DD`);

export const profitReportValidators = [
  businessDate("from"),
  businessDate("to"),
  query("hubId").optional().isString().trim().notEmpty(),
];

const operationalFilters = [
  businessDate("from"), businessDate("to"),
  query("hubId").optional().isString().trim().notEmpty(),
  query("shopId").optional().isString().trim().notEmpty(),
  query("riderId").optional().isString().trim().notEmpty(),
];

export const monthlyOperationsReportValidators = operationalFilters;
export const detailedOperationalReportValidators = [
  ...operationalFilters,
  query("format").optional().isIn(["json", "csv"]),
];

export const osStatementReportValidators = [
  businessDate("from"), businessDate("to"),
  query("hubId").optional().isString().trim().notEmpty(),
  query("shopId").optional().isString().trim().notEmpty(),
  query("format").optional().isIn(["json", "csv"]),
];
