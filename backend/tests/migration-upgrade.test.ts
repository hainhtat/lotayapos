import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

describe("hub-scoped finance migration", () => {
  test("backfills a parcel journal and preserves its closed cashbook lock", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lotaya-finance-upgrade-"));
    const database = join(directory, "upgrade.db");
    const migrationsRoot = resolve("prisma/migrations");
    try {
      const migrations = readdirSync(migrationsRoot).filter((name) => /^\d/.test(name) && name < "20260811070000").sort();
      for (const migration of migrations) execFileSync("sqlite3", [database, `.read ${join(migrationsRoot, migration, "migration.sql")}`]);
      execFileSync("sqlite3", [database, `
        INSERT INTO Hub(id,name) VALUES('hub-a','Hub A');
        INSERT INTO OnlineShop(id,name) VALUES('shop-a','Shop A');
        INSERT INTO Batch(id,shopId,pickupDate,hubId,label) VALUES('batch-a','shop-a',strftime('%s','2026-08-11')*1000,'hub-a','Batch A');
        INSERT INTO Parcel(id,batchId,trackingNumber,customerName,address,codAmount,deliveryFee,advanceAmount,updatedAt) VALUES('parcel-a','batch-a','PKG-A','Customer','Address',1000,100,500,CURRENT_TIMESTAMP);
        INSERT INTO JournalEntry(id,sourceType,sourceId,businessDate,description,hubId) VALUES('journal-a','PICKUP_ADVANCE','parcel-a',strftime('%s','2026-08-11')*1000,'Advance',NULL);
        INSERT INTO CashbookDay(id,businessDate,hubId,closedAt,closedBy) VALUES('cashbook-a',strftime('%s','2026-08-11')*1000,NULL,strftime('%s','2026-08-11 12:00:00')*1000,'admin-a');
        INSERT INTO CashbookDay(id,businessDate,hubId) VALUES('cashbook-existing',strftime('%s','2026-08-11')*1000,'hub-a');
        INSERT INTO CashbookAudit(id,cashbookDayId,action,actorId,reason) VALUES('audit-a','cashbook-a','CLOSE','admin-a','Legacy close');
      `]);
      execFileSync("sqlite3", [database, `.read ${join(migrationsRoot, "20260811070000_finance_hub_backfill_and_settlement_evidence", "migration.sql")}`]);
      execFileSync("sqlite3", [database, `.read ${join(migrationsRoot, "20260811080000_batch_locations_username_expenses", "migration.sql")}`]);
      execFileSync("sqlite3", [database, `.read ${join(migrationsRoot, "20260811090000_release_remediation", "migration.sql")}`]);
      execFileSync("sqlite3", [database, `.read ${join(migrationsRoot, "20260813180000_user_administration", "migration.sql")}`]);

      const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${database}` }) });
      const migratedDay = await client.cashbookDay.findFirstOrThrow({ where: { hubId: "hub-a" } });
      expect(migratedDay.id).toBe("cashbook-existing");
      expect(migratedDay.closedAt).not.toBeNull();
      expect(migratedDay.closedBy).toBe("admin-a");
      expect(await client.cashbookAudit.findFirstOrThrow({ where: { action: "CLOSE" }, select: { cashbookDayId: true } })).toEqual({ cashbookDayId: "cashbook-existing" });
      expect(await client.journalEntry.findUniqueOrThrow({ where: { id: "journal-a" }, select: { hubId: true } })).toEqual({ hubId: "hub-a" });
      const migratedBatch = await client.batch.findUniqueOrThrow({ where: { id: "batch-a" }, select: { pickupDate: true } });
      const batchIndexes = execFileSync("sqlite3", [database, "PRAGMA index_list('Batch');"], { encoding: "utf8" });
      expect(batchIndexes).toContain("Batch_shopId_pickupDate_key");
      expect(await client.expenseCategory.count()).toBe(4);
      const expenseForeignKeys = execFileSync("sqlite3", [database, "PRAGMA foreign_key_list('ExpenseEntry');"], { encoding: "utf8" });
      expect(expenseForeignKeys).toContain("JournalEntry");
      expect(expenseForeignKeys).toContain("User");
      expect(expenseForeignKeys).toContain("Hub");
      expect(await client.locationImportAudit.count()).toBe(0);
      await client.user.create({ data: { id: "finance-a", email: "finance@example.com", username: "finance-a", name: "Finance", passwordHash: "test-only", role: "FINANCE", hubId: "hub-a" } });
      const journal = await client.journalEntry.create({ data: { sourceType: "CASHBOOK_EXPENSE", sourceId: "expense-a", hubId: "hub-a", businessDate: migratedBatch.pickupDate, description: "Rent" } });
      await client.expenseEntry.create({ data: { id: "expense-a", hubId: "hub-a", categoryId: "expense_rent", wallet: "CASH", businessDate: migratedBatch.pickupDate, description: "Rent", amount: 1000, actorId: "finance-a", journalEntryId: journal.id, idempotencyKey: "expense-command-a" } });
      const secondJournal = await client.journalEntry.create({ data: { sourceType: "CASHBOOK_EXPENSE", sourceId: "expense-b", hubId: "hub-a", businessDate: migratedBatch.pickupDate, description: "Rent retry" } });
      await expect(client.expenseEntry.create({ data: { id: "expense-b", hubId: "hub-a", categoryId: "expense_rent", wallet: "CASH", businessDate: migratedBatch.pickupDate, description: "Rent retry", amount: 1000, actorId: "finance-a", journalEntryId: secondJournal.id, idempotencyKey: "expense-command-a" } })).rejects.toMatchObject({ code: "P2002" });
      await client.$disconnect();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
