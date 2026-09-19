import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/api-error.js";

export async function lockCashbookDay(
  tx: Prisma.TransactionClient,
  date: Date,
  hubId: string,
) {
  // Serialize every writer and close operation for the same hub/day in
  // PostgreSQL. SQLite already serializes writes at the database level.
  // Use $executeRaw: pg_advisory_xact_lock returns void, and Prisma's
  // $queryRaw cannot safely deserialize that (FROM void-fn also fails on PG).
  if (env.databaseProvider === "postgresql") {
    const lockKey = `cashbook:${hubId}:${date.toISOString().slice(0, 10)}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }
}

export async function assertCashbookOpen(
  tx: Prisma.TransactionClient,
  date: Date,
  hubId: string,
) {
  await lockCashbookDay(tx, date, hubId);
  // Touch/create the day row under the advisory lock. Prefer find+create+update
  // over upsert so a missing unique index cannot 42P10 the whole posting path.
  let day = await tx.cashbookDay.findFirst({
    where: { hubId, businessDate: date },
    select: { id: true, closedAt: true },
  });
  if (!day) {
    day = await tx.cashbookDay.create({
      data: { hubId, businessDate: date },
      select: { id: true, closedAt: true },
    });
  } else if (env.databaseProvider === "postgresql") {
    // Include the day in this transaction's write set so a concurrent close
    // aborts a stale Serializable snapshot instead of posting against it.
    day = await tx.cashbookDay.update({
      where: { id: day.id },
      data: { varianceAmount: { increment: 0 } },
      select: { id: true, closedAt: true },
    });
  }
  if (day.closedAt) {
    throw new ApiError(409, "DAY_CLOSED", "Cashbook day is already closed");
  }
}
