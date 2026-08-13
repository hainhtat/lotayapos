import { Router } from "express";
import { body, param, query } from "express-validator";
import { requireAuth } from "../../middleware/auth.js";
import { validation } from "../../middleware/error.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { createHub,createReasonCode,createRider,createShop,createZone,dashboard,getShop,importLocations,list,listDistricts,listReasonCodes,listRegions,listShops,listTownships,listZones,updateReasonCode,updateRider,updateTownshipDeliveryFees } from "../../controllers/master-data.controller.js";
export const masterDataRouter=Router();
masterDataRouter.use(requireAuth);
masterDataRouter.get("/",asyncHandler(list));
masterDataRouter.get("/dashboard",asyncHandler(dashboard));
masterDataRouter.get("/locations/regions",asyncHandler(listRegions));
masterDataRouter.get("/locations/districts",[query("regionStateId").isString().trim().notEmpty()],validation,asyncHandler(listDistricts));
masterDataRouter.get("/locations/townships",[query("districtId").optional().isString().trim().notEmpty()],validation,asyncHandler(listTownships));
masterDataRouter.get("/locations/zones",[query("townshipId").isString().trim().notEmpty(),query("hubId").optional().isString().trim().notEmpty()],validation,asyncHandler(listZones));
masterDataRouter.patch("/locations/townships/delivery-fees",[
  body("townshipIds").isArray({min:1,max:500}),
  body("townshipIds.*").isString().trim().notEmpty(),
  body("deliveryFee").isInt({min:0}).toInt(),
],validation,asyncHandler(updateTownshipDeliveryFees));
masterDataRouter.post("/locations/import",[
  body("source").isString().trim().isLength({min:2,max:150}), body("version").isString().trim().isLength({min:1,max:50}), body("rows").isArray({min:1,max:500}),
  body("rows.*.regionCode").isString().trim().notEmpty(), body("rows.*.regionNameEn").isString().trim().notEmpty(), body("rows.*.regionNameMy").isString().trim().notEmpty(),
  body("rows.*.districtCode").isString().trim().notEmpty(), body("rows.*.districtNameEn").isString().trim().notEmpty(), body("rows.*.districtNameMy").isString().trim().notEmpty(),
  body("rows.*.townshipCode").isString().trim().notEmpty(), body("rows.*.townshipNameEn").isString().trim().notEmpty(), body("rows.*.townshipNameMy").optional().isString().trim(), body("rows.*.deliveryFee").optional({nullable:true}).isInt({min:0}).toInt(),
],validation,asyncHandler(importLocations));
masterDataRouter.get("/reason-codes", [query("outcome").optional().isIn(["PARTIAL", "FAILED", "REJECTED"])], validation, asyncHandler(listReasonCodes));
masterDataRouter.post("/reason-codes", [
  body("code").isString().trim().matches(/^[A-Za-z0-9_]{2,50}$/),
  body("labelEn").isString().trim().isLength({min:2,max:150}),
  body("labelMy").isString().trim().isLength({min:1,max:150}),
  body("outcome").isIn(["PARTIAL", "FAILED", "REJECTED"]),
  body("noteRequired").optional().isBoolean().toBoolean(),
], validation, asyncHandler(createReasonCode));
masterDataRouter.patch("/reason-codes/:id", [
  param("id").isString().trim().notEmpty(),
  body("labelEn").optional().isString().trim().isLength({min:2,max:150}),
  body("labelMy").optional().isString().trim().isLength({min:1,max:150}),
  body("noteRequired").optional().isBoolean().toBoolean(),
  body("active").optional().isBoolean().toBoolean(),
  body().custom((value) => ["labelEn", "labelMy", "noteRequired", "active"].some((key) => key in value)).withMessage("At least one editable field is required"),
], validation, asyncHandler(updateReasonCode));
masterDataRouter.post("/hubs",[body("name").isString().trim().isLength({min:2,max:100})],validation,asyncHandler(createHub));
masterDataRouter.post("/shops",[body("name").isString().trim().isLength({min:2,max:150})],validation,asyncHandler(createShop));
masterDataRouter.get("/shops",asyncHandler(listShops));
masterDataRouter.get("/shops/:id",[param("id").isString().trim().notEmpty()],validation,asyncHandler(getShop));
masterDataRouter.post("/zones",[body("name").isString().trim().isLength({min:2,max:100}),body("hubId").isString().trim().notEmpty(),body("townshipId").isString().trim().notEmpty()],validation,asyncHandler(createZone));
masterDataRouter.post("/riders",[
  body("name").isString().trim().isLength({min:2,max:100}),
  body("username").isString().trim().matches(/^[A-Za-z0-9._-]{3,50}$/),
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({min:8,max:128}),
  body("hubId").isString().trim().notEmpty(),
  body("payModel").isIn(["PERCENTAGE","SALARY","SALARY_PLUS_PERCENTAGE"]),
  body("commissionRateBps").isInt({min:0}).toInt(),
  body("monthlySalary").isInt({min:0}).toInt(),
],validation,asyncHandler(createRider));
masterDataRouter.patch("/riders/:id",[
  param("id").isString().trim().notEmpty(),
  body("name").optional().isString().trim().isLength({min:2,max:100}),
  body("hubId").optional().isString().trim().notEmpty(),
  body("payModel").optional().isIn(["PERCENTAGE","SALARY","SALARY_PLUS_PERCENTAGE"]),
  body("commissionRateBps").optional().isInt({min:0}).toInt(),
  body("monthlySalary").optional().isInt({min:0}).toInt(),
  body().custom((value)=>["name","hubId","payModel","commissionRateBps","monthlySalary"].some((key)=>key in value)).withMessage("At least one editable field is required"),
],validation,asyncHandler(updateRider));
