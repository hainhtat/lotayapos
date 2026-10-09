import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/api-error.js";
import { businessDateUtcBoundary, nextCalendarDate } from "../../utils/business-date.js";

const wallets = [
  { wallet: "CASH", account: "WALLET_CASH" },
  { wallet: "KBZ_PAY", account: "WALLET_KBZ_PAY" },
  { wallet: "WAVE_PAY", account: "WALLET_WAVE_PAY" },
] as const;
const walletAccounts = wallets.map((item) => item.account);
type Wallet = typeof wallets[number]["wallet"];

function businessDateLabel(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: env.hubTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export type WalletTransactionQuery = {
  from: string; to: string; hubId: string; wallet?: Wallet; type?: string; riderId?: string; shopId?: string;
  page?: number; pageSize?: number; format?: "csv";
};

export async function listTransactionHubs(actor: { id: string; role: string }) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, hubId: true } });
  if (!user?.active || user.role !== actor.role || !["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER", "AUDITOR"].includes(user.role))
    throw new ApiError(403, "FORBIDDEN", "Finance access required");
  if (user.role !== "SUPERADMIN" && !user.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required");
  const hubs = await prisma.hub.findMany({
    where: user.role === "SUPERADMIN" ? undefined : { id: user.hubId! },
    select: { id: true, name: true }, orderBy: { name: "asc" },
  });
  return { hubs };
}

function safeAmount(value: number) {
  if (!Number.isSafeInteger(value)) throw new ApiError(422, "BALANCE_OUT_OF_RANGE", "Balance exceeds the supported amount range");
  return value;
}

/** Wallet debits increase funds; wallet credits decrease funds. */
export function walletMovement(lines: { account: string; debit: number; credit: number }[]) {
  return wallets.map(({ wallet, account }) => ({
    wallet,
    amount: safeAmount(lines.filter((line) => line.account === account).reduce((sum, line) => sum + line.debit - line.credit, 0)),
  })).filter((item) => item.amount !== 0);
}

export async function listWalletTransactions(query: WalletTransactionQuery, actor: { id: string; role: string }) {
  if (query.riderId && query.shopId) throw new ApiError(400, "INVALID_FILTER", "Choose either a rider or a shop filter");
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user?.active || user.role !== actor.role || !["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER", "AUDITOR"].includes(user.role))
    throw new ApiError(403, "FORBIDDEN", "Finance access required");
  if (user.role !== "SUPERADMIN" && (!user.hubId || user.hubId !== query.hubId))
    throw new ApiError(403, "FORBIDDEN", "Resource is outside your hub scope");
  const hub = await prisma.hub.findUnique({ where: { id: query.hubId }, select: { id: true } });
  if (!hub) throw new ApiError(404, "HUB_NOT_FOUND", "Hub not found");

  const from = businessDateUtcBoundary(query.from, env.hubTimezone);
  const to = businessDateUtcBoundary(nextCalendarDate(query.to), env.hubTimezone);
  if (from >= to) throw new ApiError(400, "INVALID_DATE_RANGE", "Start date must be before or equal to end date");
  if ((Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 + 1 > 366)
    throw new ApiError(400, "REPORT_RANGE_TOO_LARGE", "Date range cannot exceed 366 days");
  const account = query.wallet ? wallets.find((item) => item.wallet === query.wallet)?.account : undefined;
  const dateWhere: Prisma.JournalEntryWhereInput = { hubId: query.hubId, businessDate: { gte: from, lt: to } };
  const rowWhere: Prisma.JournalEntryWhereInput = {
    ...dateWhere,
    lines: { some: { account: account ?? { in: walletAccounts } } },
    ...(query.type ? { sourceType: query.type } : {}),
  };
  if (query.riderId || query.shopId) {
    const [settlements, payments, batches, osSettlementsForShop] = await Promise.all([
      query.riderId ? prisma.settlement.findMany({ where: { riderId: query.riderId, rider: { hubId: query.hubId } }, select: { id: true }, take: 1_001 }) : Promise.resolve([]),
      query.shopId ? prisma.osAccountPayment.findMany({ where: { shopId: query.shopId, hubId: query.hubId }, select: { id: true, voidIdempotencyKey: true }, take: 1_001 }) : Promise.resolve([]),
      query.shopId ? prisma.batch.findMany({ where: { shopId: query.shopId, hubId: query.hubId }, select: { id: true }, take: 1_001 }) : Promise.resolve([]),
      query.shopId ? prisma.osSettlement.findMany({ where: { shopId: query.shopId, hubId: query.hubId }, select: { id: true }, take: 1_001 }) : Promise.resolve([]),
    ]);
    if ([settlements.length, payments.length, batches.length, osSettlementsForShop.length].some((count) => count > 1_000))
      throw new ApiError(400, "FILTER_TOO_BROAD", "Too many historical source records for this party filter");
    const sources = [
      ...(settlements.length ? [{ sourceType: "RIDER_SETTLEMENT", sourceId: { in: settlements.map((item) => item.id) } }] : []),
      ...(payments.length ? [{ sourceType: "OS_ACCOUNT_PAYMENT", sourceId: { in: payments.map((item) => item.id) } }] : []),
      ...(osSettlementsForShop.length ? [{ sourceType: "OS_SETTLEMENT", sourceId: { in: osSettlementsForShop.map((item) => item.id) } }] : []),
      ...batches.flatMap((item) => [
        { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: item.id },
        { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: { startsWith: `${item.id}:` } },
      ]),
    ];
    const originals = sources.length ? await prisma.journalEntry.findMany({
      where: { hubId: query.hubId, OR: sources }, select: { id: true }, take: 10_001,
    }) : [];
    if (originals.length > 10_000) throw new ApiError(400, "FILTER_TOO_BROAD", "Too many historical journal entries for this party filter");
    const voidKeys = payments.map((payment) => payment.voidIdempotencyKey).filter((key): key is string => !!key);
    rowWhere.OR = [
      ...sources,
      ...(originals.length ? [{ sourceType: "LEDGER_REVERSAL", sourceId: { in: originals.map((entry) => entry.id) } }] : []),
      ...(voidKeys.length ? [{ sourceType: "OS_ACCOUNT_PAYMENT_VOID", sourceId: { in: voidKeys } }] : []),
    ];
    if (!rowWhere.OR.length) rowWhere.OR = [{ id: "__NO_MATCH__" }];
  }
  const [openingLines, periodLines, total, entries] = await prisma.$transaction([
    prisma.journalLine.groupBy({ by: ["account"], where: { account: { in: walletAccounts }, entry: { hubId: query.hubId, businessDate: { lt: from } } }, _sum: { debit: true, credit: true } }),
    prisma.journalLine.groupBy({ by: ["account"], where: { account: { in: walletAccounts }, entry: dateWhere }, _sum: { debit: true, credit: true } }),
    prisma.journalEntry.count({ where: rowWhere }),
    prisma.journalEntry.findMany({
      where: rowWhere,
      include: { lines: { where: { account: { in: walletAccounts } } } },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: query.format === "csv" ? 0 : ((query.page ?? 1) - 1) * (query.pageSize ?? 50),
      take: query.format === "csv" ? 10_001 : query.pageSize ?? 50,
    }),
  ]);
  if (query.format === "csv" && total > 10_000)
    throw new ApiError(400, "EXPORT_TOO_LARGE", "Transaction export exceeds 10,000 rows; narrow the date range or filters");
  const summary = wallets.map(({ wallet, account }) => {
    const openingLine = openingLines.find((line) => line.account === account);
    const periodLine = periodLines.find((line) => line.account === account);
    const opening = safeAmount((openingLine?._sum.debit ?? 0) - (openingLine?._sum.credit ?? 0));
    const moneyIn = safeAmount(periodLine?._sum.debit ?? 0);
    const moneyOut = safeAmount(periodLine?._sum.credit ?? 0);
    return { wallet, opening, in: moneyIn, out: moneyOut, closing: safeAmount(opening + moneyIn - moneyOut) };
  });
  // Calculate statement balances over every wallet movement in the period, then
  // select the visible rows. Party/type filters must not change a real balance.
  const balancesAfter = new Map<string, Array<{ wallet: Wallet; balance: number }>>();
  if (entries.length) {
    const running = await prisma.$queryRaw<Array<{ entryId: string; account: string; cumulative: bigint | number }>>(Prisma.sql`
      WITH movements AS (
        SELECT entry.id AS "entryId", line.account AS account,
          SUM(line.debit - line.credit) AS movement,
          entry."businessDate" AS "businessDate", entry."createdAt" AS "createdAt"
        FROM "JournalEntry" AS entry
        JOIN "JournalLine" AS line ON line."entryId" = entry.id
        WHERE entry."hubId" = ${query.hubId}
          AND entry."businessDate" >= ${from}
          AND entry."businessDate" < ${to}
          AND line.account IN (${Prisma.join(walletAccounts)})
        GROUP BY entry.id, line.account, entry."businessDate", entry."createdAt"
      ), running AS (
        SELECT "entryId", account,
          SUM(movement) OVER (PARTITION BY account ORDER BY "businessDate", "createdAt", "entryId" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative
        FROM movements
      )
      SELECT "entryId", account, cumulative FROM running
      WHERE "entryId" IN (${Prisma.join(entries.map((entry) => entry.id))})
    `);
    const openingByAccount = new Map<string, number>(summary.map((item) => [wallets.find((wallet) => wallet.wallet === item.wallet)!.account, item.opening]));
    for (const row of running) {
      const wallet = wallets.find((item) => item.account === row.account)?.wallet;
      if (!wallet) continue;
      const balance = safeAmount((openingByAccount.get(row.account) ?? 0) + safeAmount(Number(row.cumulative)));
      const values = balancesAfter.get(row.entryId) ?? [];
      values.push({ wallet, balance });
      balancesAfter.set(row.entryId, values);
    }
  }
  const sourceIds = (type: string) => entries.filter((entry) => entry.sourceType === type && entry.sourceId).map((entry) => entry.sourceId!);
  const [batches, settlements, payments, expenses, osSettlements, originals] = await Promise.all([
    prisma.batch.findMany({ where: { id: { in: sourceIds("BATCH_PICKUP_ADVANCE").map((id) => id.split(":")[0]) } }, select: { id: true, label: true, createdBy: true, shop: { select: { name: true } } } }),
    prisma.settlement.findMany({ where: { id: { in: sourceIds("RIDER_SETTLEMENT") } }, select: { id: true, rider: { select: { user: { select: { name: true } } } } } }),
    prisma.osAccountPayment.findMany({ where: { id: { in: sourceIds("OS_ACCOUNT_PAYMENT") } }, select: { id: true, reference: true, postedBy: true, shop: { select: { name: true } } } }),
    prisma.expenseEntry.findMany({ where: { id: { in: sourceIds("CASHBOOK_EXPENSE") } }, select: { id: true, actor: { select: { name: true } }, category: { select: { nameEn: true } } } }),
    prisma.osSettlement.findMany({ where: { id: { in: sourceIds("OS_SETTLEMENT") } }, select: { id: true, postedBy: true, shop: { select: { name: true } } } }),
    prisma.journalEntry.findMany({ where: { id: { in: sourceIds("LEDGER_REVERSAL") }, hubId: query.hubId }, select: { id: true, sourceType: true, sourceId: true, description: true } }),
  ]);
  const batchById = new Map(batches.map((item) => [item.id, item]));
  const settlementById = new Map(settlements.map((item) => [item.id, item]));
  const paymentById = new Map(payments.map((item) => [item.id, item]));
  const expenseById = new Map(expenses.map((item) => [item.id, item]));
  const osSettlementById = new Map(osSettlements.map((item) => [item.id, item]));
  const originalById = new Map(originals.map((item) => [item.id, item]));
  const actorIds = [...new Set([...batches.map((item) => item.createdBy), ...payments.map((item) => item.postedBy), ...osSettlements.map((item) => item.postedBy)].filter((id): id is string => !!id))];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const actorById = new Map(actors.map((item) => [item.id, item.name]));
  const items = entries.map((entry) => ({
    id: entry.id,
    businessDate: businessDateLabel(entry.businessDate),
    createdAt: entry.createdAt,
    type: entry.sourceType,
    description: entry.description,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    reverses: entry.sourceType === "LEDGER_REVERSAL" ? originalById.get(entry.sourceId ?? "") ?? null : null,
    reference: entry.sourceType === "OS_ACCOUNT_PAYMENT" ? paymentById.get(entry.sourceId ?? "")?.reference ?? entry.sourceId : entry.sourceType === "BATCH_PICKUP_ADVANCE" ? batchById.get((entry.sourceId ?? "").split(":")[0])?.label ?? entry.sourceId : entry.sourceId,
    counterparty: entry.sourceType === "RIDER_SETTLEMENT" ? settlementById.get(entry.sourceId ?? "")?.rider.user.name ?? null : entry.sourceType === "OS_ACCOUNT_PAYMENT" ? paymentById.get(entry.sourceId ?? "")?.shop.name ?? null : entry.sourceType === "BATCH_PICKUP_ADVANCE" ? batchById.get((entry.sourceId ?? "").split(":")[0])?.shop.name ?? null : entry.sourceType === "OS_SETTLEMENT" ? osSettlementById.get(entry.sourceId ?? "")?.shop.name ?? null : null,
    recordedBy: entry.sourceType === "OS_ACCOUNT_PAYMENT" ? actorById.get(paymentById.get(entry.sourceId ?? "")?.postedBy ?? "") ?? null : entry.sourceType === "BATCH_PICKUP_ADVANCE" ? actorById.get(batchById.get((entry.sourceId ?? "").split(":")[0])?.createdBy ?? "") ?? null : entry.sourceType === "CASHBOOK_EXPENSE" ? expenseById.get(entry.sourceId ?? "")?.actor.name ?? null : entry.sourceType === "OS_SETTLEMENT" ? actorById.get(osSettlementById.get(entry.sourceId ?? "")?.postedBy ?? "") ?? null : null,
    wallets: walletMovement(entry.lines),
    balancesAfter: balancesAfter.get(entry.id) ?? [],
  }));
  const page = query.page ?? 1, pageSize = query.pageSize ?? 50;
  return { summary: { wallets: summary }, items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}
