import { body } from "express-validator";
import { amount, idempotencyKey, optionalHub, wallet } from "./shared.js";

export const closeCashbookValidators = [body("businessDate").isISO8601(), optionalHub];
export const approveCashbookVarianceValidators = [...closeCashbookValidators, body("reason").isString().trim().isLength({ min: 3, max: 500 })];
export const reopenCashbookValidators = approveCashbookVarianceValidators;
export const openingBalanceValidators = [...closeCashbookValidators, wallet, amount("amount"), body("reason").isString().trim().isLength({ min: 3, max: 500 }), idempotencyKey];
export const walletTransferValidators = [...closeCashbookValidators, body("fromWallet").isIn(["CASH", "KBZ_PAY", "WAVE_PAY"]), body("toWallet").isIn(["CASH", "KBZ_PAY", "WAVE_PAY"]), amount("amount"), body("reason").isString().trim().isLength({ min: 3, max: 500 }), idempotencyKey];
export const cashbookAdjustmentValidators = [...closeCashbookValidators, wallet, amount("amount"), body("direction").isIn(["INCREASE", "DECREASE"]), body("reason").isString().trim().isLength({ min: 3, max: 500 }), idempotencyKey];
