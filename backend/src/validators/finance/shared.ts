import { body } from "express-validator";

export const wallet = body("wallet").isIn(["CASH", "KBZ_PAY", "WAVE_PAY"]);

export const amount = (field: string) => body(field).isInt({ min: 0 });

export const optionalHub = body("hubId").optional().isString().trim().notEmpty();

export const idempotencyKey = body("idempotencyKey")
  .isString()
  .trim()
  .isLength({ min: 8, max: 100 })
  .matches(/^[A-Za-z0-9._:-]+$/);

export const walletSplit = [
  body("wallets").isObject(),
  body("wallets.cash").isInt({ min: 0 }),
  body("wallets.kbzPay").isInt({ min: 0 }),
  body("wallets.wavePay").isInt({ min: 0 }),
];
