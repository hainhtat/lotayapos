import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("ledger summary", () => {
  const hubId = randomUUID(), otherHub = randomUUID(), userId = randomUUID();
  const headers = () => ({ Authorization: `Bearer ${signAccessToken({ sub: userId, email: `${userId}@test.local`, role: "FINANCE", tokenVersion: 0 })}` });
  beforeAll(async () => {
    await prisma.hub.createMany({ data: [{ id: hubId, name: "Summary" }, { id: otherHub, name: "Other" }] });
    await prisma.user.create({ data: { id: userId, name: "Finance", email: `${userId}@test.local`, passwordHash: "test", role: "FINANCE", hubId } });
    const entries = Array.from({ length: 502 }, (_, i) => ({ id: randomUUID(), hubId: i === 501 ? otherHub : hubId, sourceType: i === 500 ? "LEDGER_REVERSAL" : "TEST_SUMMARY", sourceId: randomUUID(), businessDate: new Date("2034-01-01T00:00:00Z") }));
    await prisma.journalEntry.createMany({ data: entries.map(entry => ({ ...entry, description: "Summary regression" })) });
    await prisma.journalLine.createMany({ data: entries.flatMap((entry, i) => [
      { entryId: entry.id, account: "WALLET_CASH", debit: i === 500 ? 0 : 100, credit: i === 500 ? 100 : 0 },
      { entryId: entry.id, account: "OPENING_BALANCE", debit: i === 500 ? 100 : 0, credit: i === 500 ? 0 : 100 },
    ]) });
  });
  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { entry: { hubId: { in: [hubId, otherHub] } } } });
    await prisma.journalEntry.deleteMany({ where: { hubId: { in: [hubId, otherHub] } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.hub.deleteMany({ where: { id: { in: [hubId, otherHub] } } });
  });
  test("sums more than 500 entries including reversals without crossing hub scope", async () => {
    const response = await request(app).get("/api/v1/finance/ledger/summary").set(headers());
    expect(response.status).toBe(200);
    expect(response.body.data.accounts).toContainEqual({ account: "WALLET_CASH", debit: 50000, credit: 100, balance: 49900 });
    expect(response.body.data.balanced).toBe(true);
    expect(response.body.data).not.toHaveProperty("entries");
    const detail = await request(app).get("/api/v1/finance/ledger").set(headers());
    expect(detail.body.error.code).toBe("REPORT_TOO_LARGE");
  });
  test("validates date filters and filters selected accounts", async () => {
    const invalid = await request(app).get("/api/v1/finance/ledger/summary?from=bad").set(headers());
    expect(invalid.status).toBe(400);
    const filtered = await request(app).get("/api/v1/finance/ledger/summary?account=WALLET_CASH&from=2034-01-01&to=2034-01-01").set(headers());
    expect(filtered.body.data.accounts).toHaveLength(1);
    expect(filtered.body.data.accounts[0].balance).toBe(49900);
    const denied = await request(app).get("/api/v1/finance/ledger/summary");
    expect(denied.status).toBe(401);
  });
});
