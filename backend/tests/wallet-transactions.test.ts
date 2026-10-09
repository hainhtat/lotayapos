import { walletMovement } from "../src/services/finance/wallet-transactions.js";

describe("wallet transaction movement", () => {
  it("shows wallet debits as money in and credits as money out", () => {
    expect(walletMovement([
      { account: "WALLET_CASH", debit: 50_000, credit: 0 },
      { account: "WALLET_KBZ_PAY", debit: 0, credit: 20_000 },
      { account: "CASHBOOK_ADJUSTMENT", debit: 0, credit: 30_000 },
    ])).toEqual([
      { wallet: "CASH", amount: 50_000 },
      { wallet: "KBZ_PAY", amount: -20_000 },
    ]);
  });

  it("retains both sides of a wallet transfer and sums repeated lines", () => {
    expect(walletMovement([
      { account: "WALLET_CASH", debit: 5_000, credit: 0 },
      { account: "WALLET_CASH", debit: 3_000, credit: 0 },
      { account: "WALLET_WAVE_PAY", debit: 0, credit: 8_000 },
    ])).toEqual([
      { wallet: "CASH", amount: 8_000 },
      { wallet: "WAVE_PAY", amount: -8_000 },
    ]);
  });
});
