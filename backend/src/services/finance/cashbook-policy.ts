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
  if (env.databaseProvider === "postgresql") {
    const lockKey = `cashbook:${hubId}:${date.toISOString().slice(0, 10)}`;
    await tx.$queryRaw<Array<{ locked: number }>>`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }
}

export async function assertCashbookOpen(
  tx: Prisma.TransactionClient,
  date: Date,
  hubId: string,
) {
  await lockCashbookDay(tx, date, hubId);
  // A no-op update makes the PostgreSQL day row part of the transaction's
  // write set. If this transaction waited behind a concurrent close,
  // PostgreSQL must abort the stale Serializable snapshot instead of allowing
  // a posting based on the old open state. SQLite serializes writes globally
  // and does not need persistent rows for open days.
  const day = env.databaseProvider === "postgresql"
    ? await tx.cashbookDay.upsert({
        where: { hubId_businessDate: { hubId, businessDate: date } },
        create: { hubId, businessDate: date },
        update: { varianceAmount: { increment: 0 } },
        select: { closedAt: true },
      })
    : await tx.cashbookDay.findFirst({
        where: { hubId, businessDate: date },
        select: { closedAt: true },
      });
  if (day?.closedAt) {
    throw new ApiError(409, "DAY_CLOSED", "Cashbook day is already closed");
  }
}
