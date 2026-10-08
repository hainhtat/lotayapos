import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/database.js";
import { listNegativeWalletAlerts, negativeWalletAlerts } from "../src/services/operations.service.js";

describe("negative wallet alerts", () => {
  it("shows only wallets below zero and clears each alert once its own balance recovers", () => {
    const snapshot = negativeWalletAlerts([
      { id: "hub-1", name: "Yangon", lines: [
        { account: "WALLET_CASH", _sum: { debit: 1000, credit: 2500 } },
        { account: "WALLET_KBZ_PAY", _sum: { debit: 5000, credit: 7000 } },
        { account: "WALLET_WAVE_PAY", _sum: { debit: 500, credit: 0 } },
      ] },
      { id: "hub-2", name: "Mandalay", lines: [
        { account: "WALLET_CASH", _sum: { debit: 300, credit: 300 } },
      ] },
    ]);

    expect(snapshot).toEqual([
      { id: "hub-1:KBZ_PAY", hubId: "hub-1", hubName: "Yangon", wallet: "KBZ_PAY", balance: -2000, shortfall: 2000 },
      { id: "hub-1:CASH", hubId: "hub-1", hubName: "Yangon", wallet: "CASH", balance: -1500, shortfall: 1500 },
    ]);
    expect(negativeWalletAlerts([{ id: "hub-1", name: "Yangon", lines: [
      { account: "WALLET_CASH", _sum: { debit: 2500, credit: 2500 } },
      { account: "WALLET_KBZ_PAY", _sum: { debit: 7001, credit: 7000 } },
    ] }])).toEqual([]);
  });
});

describe("hub-scoped wallet alert reads", () => {
  const suffix = randomUUID();
  const hubIds = [`wallet-alert-${suffix}-a`, `wallet-alert-${suffix}-b`];
  const financeId = `wallet-alert-finance-${suffix}`;
  const adminId = `wallet-alert-admin-${suffix}`;
  const entryIds = [`wallet-alert-entry-${suffix}-a`, `wallet-alert-entry-${suffix}-b`, `wallet-alert-entry-${suffix}-repaid`];

  beforeAll(async () => {
    await prisma.hub.createMany({ data: [{ id: hubIds[0]!, name: "Yangon" }, { id: hubIds[1]!, name: "Mandalay" }] });
    await prisma.user.createMany({ data: [
      { id: financeId, email: `${financeId}@test.invalid`, name: "Finance", passwordHash: "test-only", role: "FINANCE", hubId: hubIds[0] },
      { id: adminId, email: `${adminId}@test.invalid`, name: "Admin", passwordHash: "test-only", role: "SUPERADMIN" },
    ] });
    await prisma.journalEntry.create({ data: { id: entryIds[0], hubId: hubIds[0]!, sourceType: "TEST_WALLET_ALERT", sourceId: entryIds[0], businessDate: new Date(), description: "Advance", lines: { create: [
      { account: "WALLET_CASH", debit: 0, credit: 2000 },
      { account: "WALLET_KBZ_PAY", debit: 0, credit: 1000 },
      { account: "OS_COD_PAYABLE", debit: 3000, credit: 0 },
    ] } } });
    await prisma.journalEntry.create({ data: { id: entryIds[1], hubId: hubIds[1]!, sourceType: "TEST_WALLET_ALERT", sourceId: entryIds[1], businessDate: new Date(), description: "Advance", lines: { create: [
      { account: "WALLET_WAVE_PAY", debit: 0, credit: 700 },
      { account: "OS_COD_PAYABLE", debit: 700, credit: 0 },
    ] } } });
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [financeId, adminId] } } });
    await prisma.hub.deleteMany({ where: { id: { in: hubIds } } });
    await prisma.$disconnect();
  });

  it("limits Finance to its hub, leaves unselected wallets untouched, and clears recovered balances", async () => {
    const finance = await listNegativeWalletAlerts({ id: financeId, role: "FINANCE" });
    expect(finance).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `${hubIds[0]}:CASH`, shortfall: 2000 }),
      expect.objectContaining({ id: `${hubIds[0]}:KBZ_PAY`, shortfall: 1000 }),
    ]));
    expect(finance).toHaveLength(2);
    const admin = await listNegativeWalletAlerts({ id: adminId, role: "SUPERADMIN" });
    expect(admin).toEqual(expect.arrayContaining([expect.objectContaining({ id: `${hubIds[1]}:WAVE_PAY`, shortfall: 700 })]));

    await prisma.journalEntry.create({ data: { id: entryIds[2], hubId: hubIds[0]!, sourceType: "TEST_WALLET_ALERT", sourceId: entryIds[2], businessDate: new Date(), description: "Funding", lines: { create: [
      { account: "WALLET_CASH", debit: 2000, credit: 0 },
      { account: "WALLET_KBZ_PAY", debit: 1000, credit: 0 },
      { account: "OS_COD_PAYABLE", debit: 0, credit: 3000 },
    ] } } });
    expect(await listNegativeWalletAlerts({ id: financeId, role: "FINANCE" })).toEqual([]);
  });
});
