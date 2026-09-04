import { Router } from "express";
import { monthlyOperations, osStatements, profit, returns, riderPerformance } from "../../controllers/reports.controller.js";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { validation } from "../../middleware/error.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { detailedOperationalReportValidators, monthlyOperationsReportValidators, osStatementReportValidators, profitReportValidators } from "../../validators/reports.js";

export const reportsRouter = Router();

reportsRouter.get(
  "/profit",
  requireAuth,
  requireRoles("SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER", "AUDITOR"),
  profitReportValidators,
  validation,
  asyncHandler(profit),
);

for (const [path, handler, validators] of [
  ["/monthly-operations", monthlyOperations, monthlyOperationsReportValidators],
  ["/returns", returns, detailedOperationalReportValidators],
  ["/rider-performance", riderPerformance, detailedOperationalReportValidators],
  ["/os-statements", osStatements, osStatementReportValidators],
] as const) {
  reportsRouter.get(path, requireAuth, requireRoles("SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER", "AUDITOR"), validators, validation, asyncHandler(handler));
}
