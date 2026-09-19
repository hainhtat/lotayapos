import { ApiError } from "../../utils/api-error.js";

export type CashbookWallet = "CASH" | "KBZ_PAY" | "WAVE_PAY";

const walletAccounts: Record<CashbookWallet, string> = {
  CASH: "WALLET_CASH",
  KBZ_PAY: "WALLET_KBZ_PAY",
  WAVE_PAY: "WALLET_WAVE_PAY",
};

export function walletAccount(wallet: CashbookWallet) {
  const account = walletAccounts[wallet];
  if (!account) throw new ApiError(400, "INVALID_WALLET", "Wallet must be Cash, KBZ Pay, or Wave Pay");
  return account;
}

export function positiveAmount(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, "INVALID_AMOUNT", `${field} must be a positive integer`);
  }
}
