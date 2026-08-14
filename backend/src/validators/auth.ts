import { body } from "express-validator";
export const registerValidator = [body("name").trim().isLength({min:2,max:100}), body("username").trim().matches(/^[a-zA-Z0-9._-]{3,50}$/), body("email").trim().isEmail().normalizeEmail(), body("password").isLength({min:8,max:128})];
export const loginValidator = [body("identifier").optional().trim().isLength({min:3,max:254}), body("email").optional().trim().isEmail().normalizeEmail(), body().custom((value)=>Boolean(value.identifier||value.email)).withMessage("identifier or email is required"), body("password").isLength({min:1,max:128}), body("remember").optional().isBoolean({ loose: true }).toBoolean()];
export const refreshValidator = [body("refreshToken").optional().isString().trim().isLength({min:16,max:200})];
