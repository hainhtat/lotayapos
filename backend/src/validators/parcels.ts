import { body, param, query } from "express-validator";

export const parcelListValidation = [
  query("queue").optional().isIn(["to-assign", "with-riders", "rescheduled", "return-to-os", "overdue"]),
  query("assignedToMe").optional().isBoolean(),
  query("batchId").optional().isString().trim().notEmpty(),
  query("riderId").optional().isString().trim().notEmpty(),
  query("assignmentStatus").optional().isIn(["ASSIGNED", "UNASSIGNED"]),
  query("zone").optional().isString().trim().notEmpty(),
  query("township").optional().isString().trim().notEmpty(),
  query("townshipId").optional().isString().trim().notEmpty(),
  query("districtId").optional().isString().trim().notEmpty(),
  query("regionStateId").optional().isString().trim().notEmpty(),
  query("dateFrom").optional().isISO8601(),
  query("dateTo").optional().isISO8601(),
  query("trackingNumber").optional().isString().trim().isLength({ min: 1, max: 100 }),
  query("orderId").optional().isString().trim().isLength({ min: 1, max: 255 }),
  query("customerName").optional().isString().trim().isLength({ min: 1, max: 150 }),
  query("shopId").optional().isString().trim().notEmpty(),
  query("status").optional().isIn(["CREATED", "PICKED_UP", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "PARTIAL", "FAILED", "REJECTED", "PENDING_RETURN", "RETURNED"]),
  query("reasonCode").optional().isString().trim().isLength({ min: 1, max: 50 }),
  query("page").optional().isInt({ min: 1, max: 100000 }).toInt(),
  query("pageSize").optional().isInt({ min: 1, max: 100 }).toInt(),
];

export const parcelStatusValidation = [
  param("id").isString().trim().notEmpty(),
  body("status").isIn(["CREATED", "PICKED_UP", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "PARTIAL", "FAILED", "REJECTED", "PENDING_RETURN", "RETURNED"]),
  body("reasonCode").optional().isString().trim().notEmpty(),
  body("note").optional().isString().trim(),
  body("actualCodCollected").optional().isInt({ min: 0 }).toInt(),
  body("collectionWallet").if(body("status").equals("PARTIAL")).isIn(["CASH", "KBZ_PAY", "WAVE_PAY"]),
  body("collectionMode").optional().isIn(["PAID_BY_OS", "CASH_RECEIPT_EXCEPTION"]),
  body("paidToOsIncludeDeliveryFee").optional().isBoolean().toBoolean(),
];

export const parcelRescheduleValidation = [
  body("parcelIds").isArray({ min: 1, max: 50 }),
  body("parcelIds.*").isString().trim().notEmpty(),
  body("plannedDeliveryDate").matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({ strict: true }),
  body("reason").isString().trim().isLength({ min: 3, max: 500 }),
];

export const parcelBulkStatusValidation = [
  body("parcelIds").isArray({ min: 1, max: 50 }),
  body("parcelIds.*").isString().trim().notEmpty(),
  body("status").isIn(["CREATED", "PICKED_UP", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "PARTIAL", "FAILED", "REJECTED", "PENDING_RETURN", "RETURNED"]),
  body("reasonCode").optional().isString().trim().notEmpty(),
  body("note").optional().isString().trim(),
  body("actualCodCollected").optional().isInt({ min: 0 }).toInt(),
  body("collectionWallet").if(body("status").equals("PARTIAL")).isIn(["CASH", "KBZ_PAY", "WAVE_PAY"]),
  body("collectionMode").optional().isIn(["PAID_BY_OS", "CASH_RECEIPT_EXCEPTION"]),
  body("paidToOsIncludeDeliveryFee").optional().isBoolean().toBoolean(),
];

export const parcelUpdateValidation = [
  param("id").isString().trim().notEmpty(),
  body("orderId").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("customerName").optional().isString().trim().isLength({ min: 1, max: 150 }),
  body("customerPhone").optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  body("address").optional().isString().trim().isLength({ min: 1, max: 500 }),
  body("codAmount").optional().isInt({ min: 0 }).toInt(),
  body("deliveryFee").optional().isInt({ min: 0 }).toInt(),
  body("townshipId").optional().isString().trim().notEmpty(),
  body("zoneId").optional({ nullable: true }).isString().trim().notEmpty(),
  body().custom((value) => ["orderId", "customerName", "customerPhone", "address", "codAmount", "deliveryFee", "townshipId", "zoneId"].some((key) => key in value)).withMessage("At least one editable field is required"),
];
