import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { postgresPoolOptions } from "../src/config/postgres-pool.js";
import { previewHistoricalOsSettlement, applyHistoricalOsSettlement } from "../src/services/os-history.service.js";
import { accountRows } from "../src/services/os-account.service.js";

describe("historical OS reconciliation without wallet movement", () => {
  let database: PrismaClient;
  let directory: string;
  let pool: Pool | undefined;
  const schema = `history_${randomUUID().replaceAll("-", "")}`;
  const actor = { id: "history-admin", role: "SUPERADMIN" };
  beforeAll(async () => {
    const postgres = process.env.DATABASE_PROVIDER === "postgresql";
    const migrations = resolve(postgres ? "prisma/migrations-postgresql" : "prisma/migrations");
    if (postgres) {
      const url = process.env.DATABASE_URL!;
      const parsed = new URL(url);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test")) throw new Error("Historical PG checks require an isolated local *_test database");
      pool = new Pool(postgresPoolOptions(url));
      const connection = await pool.connect();
      try {
        await connection.query(`CREATE SCHEMA "${schema}"`);
        await connection.query(`SET search_path TO "${schema}"`);
        for (const name of readdirSync(migrations).filter(name => /^\d/.test(name)).sort()) await connection.query(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
      } finally { connection.release(); }
      database = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    } else {
      directory = mkdtempSync(join(tmpdir(), "lotaya-history-test-"));
      const path = join(directory, "history.db");
      for (const name of readdirSync(migrations).filter(name => /^\d/.test(name)).sort()) execFileSync("sqlite3", [path, `.read ${join(migrations, name, "migration.sql")}`]);
      database = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) });
    }
    await database.hub.create({ data: { id: "history-hub", name: "History" } });
    await database.onlineShop.create({ data: { id: "history-shop", name: "History" } });
    await database.user.create({ data: { id: actor.id, email: "history@test.local", name: "Admin", passwordHash: "test", role: actor.role } });
    for (let i = 0; i < 6; i++) {
      await database.batch.create({ data: { id: `history-${i}`, hubId: "history-hub", shopId: "history-shop", pickupDate: new Date(`2030-01-0${i + 1}`), label: `Batch ${i}` } });
      if (i > 0) await database.osBatchObligation.create({ data: { batchId: `history-${i}`, hubId: "history-hub", shopId: "history-shop", originalCod: i === 2 ? 100 : 1000 } });
    }
    await database.parcel.createMany({ data: [
      { id: "history-live", batchId: "history-0", trackingNumber: "HIST-LIVE", customerName: "Test", address: "Test", codAmount: 800, status: "FAILED" },
      { id: "history-return", batchId: "history-0", trackingNumber: "HIST-RETURN", customerName: "Test", address: "Test", codAmount: 200, status: "RETURNED" },
    ] });
    for (const id of ["history-1", "history-2"]) await database.journalEntry.create({ data: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: id, hubId: "history-hub", businessDate: new Date("2030-01-01"), description: "Advance", lines: { create: [{ account: "OS_COD_PAYABLE", debit: 200 }, { account: "WALLET_CASH", credit: 200 }] } } });
    await database.osReturnCredit.create({ data: { parcelId: "history-paid-return", batchId: "history-2", shopId: "history-shop", hubId: "history-hub", amount: 100, businessDate: new Date("2030-01-03"), postedBy: actor.id, idempotencyKey: "history-paid-return" } });
    await database.journalEntry.create({ data: { sourceType: "TEST_RIDER_RECEIVABLE", sourceId: "history-live", hubId: "history-hub", businessDate: new Date("2030-01-01"), description: "Rider owes collection", lines: { create: [{ account: "RIDER_RECEIVABLE", debit: 75 }, { account: "OS_BATCH_COD_CLEARING", credit: 75 }] } } });
  }, 30000);
  afterAll(async () => {
    await database?.$disconnect();
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  test("previews all older batches and retains exactly the newest three", async () => {
    const result = await previewHistoricalOsSettlement(actor, database);
    expect(result.retainedBatches.map(batch => batch.id)).toEqual(["history-5", "history-4", "history-3"]);
    expect(result.batches.map(batch => batch.id)).toEqual(["history-2", "history-1", "history-0"]);
    expect(result.canApply).toBe(true);
    expect(result.totalAdjustment).toBe(1600);
    expect(result.batches.find(batch => batch.id === "history-0")?.createsOpeningObligation).toBe(true);
    expect(await database.osHistoricalSettlement.count()).toBe(0);
  });

  test("rejects unauthorized actors and stale exact-selection previews", async () => {
    await expect(previewHistoricalOsSettlement({ ...actor, role: "FINANCE" }, database)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const preview = await previewHistoricalOsSettlement(actor, database);
    const payload = { fingerprint: preview.fingerprint, batchIds: preview.batches.map(batch => batch.id), retainedBatchIds: preview.retainedBatches.map(batch => batch.id), businessDate: "2030-02-01", reason: "Settled previously on paper", idempotencyKey: "history-apply-test" };
    await expect(applyHistoricalOsSettlement({ ...payload, retainedBatchIds: ["history-0", "history-4", "history-5"] }, actor, database)).rejects.toMatchObject({ code: "HISTORICAL_PREVIEW_CHANGED" });
    await database.osBatchObligation.update({ where: { batchId: "history-1" }, data: { originalCod: 1100 } });
    await expect(applyHistoricalOsSettlement(payload, actor, database)).rejects.toMatchObject({ code: "HISTORICAL_PREVIEW_CHANGED" });
    await database.osBatchObligation.update({ where: { batchId: "history-1" }, data: { originalCod: 1000 } });
  });

  test("an advance above recorded COD does not invent spendable return credit", async () => {
    await database.osReturnCredit.update({ where: { idempotencyKey: "history-paid-return" }, data: { status: "VOIDED" } });
    expect((await accountRows(database, { hubId: "history-hub" })).find(row => row.batchId === "history-2")?.creditAvailable).toBe(0);
    await database.osReturnCredit.update({ where: { idempotencyKey: "history-paid-return" }, data: { status: "POSTED" } });
  });

  test("closed-day rejection leaves every historical record unapplied", async () => {
    const preview = await previewHistoricalOsSettlement(actor, database);
    await database.cashbookDay.create({ data: { id: "history-closed", hubId: "history-hub", businessDate: new Date("2030-02-01"), closedAt: new Date(), closedBy: actor.id } });
    await expect(applyHistoricalOsSettlement({ fingerprint: preview.fingerprint, batchIds: preview.batches.map(batch => batch.id), retainedBatchIds: preview.retainedBatches.map(batch => batch.id), businessDate: "2030-02-01", reason: "Paper settlement", idempotencyKey: "history-closed-test" }, actor, database)).rejects.toMatchObject({ code: "DAY_CLOSED" });
    expect(await database.osHistoricalSettlement.count()).toBe(0);
    await database.cashbookDay.delete({ where: { id: "history-closed" } });
  });

  test("applies one auditable non-wallet settlement and preserves credits, riders and parcel statuses", async () => {
    const beforeWallet = await database.journalLine.aggregate({ where: { account: { startsWith: "WALLET_" } }, _sum: { debit: true, credit: true } });
    const beforeRider = await database.journalLine.aggregate({ where: { account: "RIDER_RECEIVABLE" }, _sum: { debit: true, credit: true } });
    const beforeParcels = await database.parcel.findMany({ orderBy: { id: "asc" } });
    const preview = await previewHistoricalOsSettlement(actor, database);
    const payload = { fingerprint: preview.fingerprint, batchIds: preview.batches.map(batch => batch.id), retainedBatchIds: preview.retainedBatches.map(batch => batch.id), businessDate: "2030-02-01", reason: "Settled previously on paper", idempotencyKey: "history-apply-test" };
    const attempts = process.env.DATABASE_PROVIDER === "postgresql" ? 2 : 1;
    const results = await Promise.allSettled(Array.from({ length: attempts }, () => applyHistoricalOsSettlement(payload, actor, database)));
    const successful = results.find(result => result.status === "fulfilled");
    expect(successful?.status).toBe("fulfilled");
    for (const attempt of results) if (attempt.status === "rejected") expect(attempt.reason).toMatchObject({ code: "HISTORICAL_ADJUSTMENT_CONFLICT" });
    if (!successful || successful.status !== "fulfilled") throw new Error("Historical adjustment did not succeed");
    const result = successful.value;
    expect(result).toMatchObject({ walletChange: 0, totalAdjustment: 1600, replay: false });
    expect(await applyHistoricalOsSettlement(payload, actor, database)).toMatchObject({ replay: true, adjustmentId: result.adjustmentId });
    await expect(applyHistoricalOsSettlement({ ...payload, reason: "Changed reason" }, actor, database)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await database.journalLine.aggregate({ where: { account: { startsWith: "WALLET_" } }, _sum: { debit: true, credit: true } })).toEqual(beforeWallet);
    expect(await database.journalLine.aggregate({ where: { account: "RIDER_RECEIVABLE" }, _sum: { debit: true, credit: true } })).toEqual(beforeRider);
    expect(await database.parcel.findMany({ orderBy: { id: "asc" } })).toEqual(beforeParcels);
    const rows = await accountRows(database, { hubId: "history-hub" });
    expect(rows.filter(row => ["history-0", "history-1", "history-2"].includes(row.batchId)).every(row => row.outstanding === 0)).toBe(true);
    expect(rows.find(row => row.batchId === "history-2")?.creditAvailable).toBe(100);
    expect(rows.filter(row => ["history-3", "history-4", "history-5"].includes(row.batchId)).reduce((sum, row) => sum + row.outstanding, 0)).toBe(3000);
    expect(await database.osHistoricalSettlement.count()).toBe(3);
    const journals = await database.journalEntry.findMany({ include: { lines: true } });
    for (const journal of journals) expect(journal.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
  });
});
