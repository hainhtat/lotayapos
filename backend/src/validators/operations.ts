import { body, param } from "express-validator";

export const parcelIdValidation = [param("id").isString().trim().notEmpty()];
export const alertIdValidation = [param("id").isString().trim().notEmpty()];
export const batchIdValidation = [param("id").isString().trim().notEmpty()];

export const createBatchValidation = [
  body("shopId").isString().trim().notEmpty(),
  body("pickupDate").isISO8601(),
  body("batchName").isString().trim().isLength({min:2,max:150}),
  body("advancePaid").isInt({min:0}).toInt(),
  // Accepted temporarily for backwards compatibility, but operational creation never posts money.
  body("fundingWallet").optional().isIn(["CASH", "KBZ_PAY", "WAVE_PAY"]),
  body("hubId").optional().isString().trim().notEmpty(),
  body("parcels").not().exists().withMessage("Create the batch first, then use the bulk parcel endpoint"),
];

export const bulkParcelCreateValidation = [
  param("id").isString().trim().notEmpty(),
  body("parcels").isArray({min:1,max:500}),
  body("parcels.*.trackingNumber").isString().trim().notEmpty(),
  body("parcels.*.orderId").optional({nullable:true}).isString().trim().isLength({max:255}),
  body("parcels.*.customerName").isString().trim().notEmpty(),
  body("parcels.*.customerPhone").optional().isString().trim().isLength({max:50}),
  body("parcels.*.address").isString().trim().notEmpty(),
  body("parcels.*.codAmount").isInt({min:0}).toInt(),
  body("parcels.*.townshipId").isString().trim().notEmpty(),
  body("parcels.*.zoneId").optional().isString().trim().notEmpty(),
];

export const pickupAdvanceValidation = [
  body("fundingWallet").isIn(["CASH", "KBZ_PAY", "WAVE_PAY"]),
];

export const bulkAssignmentValidation = [
  body("parcelIds").isArray({ min: 1, max: 500 }),
  body("parcelIds.*").isString().trim().notEmpty(),
  body("riderId").isString().trim().notEmpty(),
];

export const manifestDownloadValidation = [
  body("riderIds").isArray({ min: 1, max: 50 }),
  body("riderIds.*").isString().trim().notEmpty(),
];

export const linkParcelsValidation = [
  body().isObject(),
  body("parcelIds").isArray({ min: 2, max: 20 }),
  body("parcelIds.*").isString().trim().notEmpty(),
  body("parcelIds").custom((ids: string[]) => new Set(ids).size === ids.length).withMessage("parcelIds must be unique"),
];

export const reassignParcelValidation = [
  body("riderId").isString().trim().notEmpty(),
  body("reason").isString().trim().isLength({ min: 3, max: 500 }),
];

export const pendingReturnExtensionValidation = [
  body("days").isInt({ min: 1, max: 30 }).toInt(),
  body("reason").isString().trim().isLength({ min: 3, max: 500 }),
];
