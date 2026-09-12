import { prisma } from "../config/database.js";
import { listOsAccounts } from "../services/os-account.service.js";
import { ApiError } from "../utils/api-error.js";

async function main() {
  const superadmin = await prisma.user.findFirst({
    where: { role: "SUPERADMIN", active: true },
    select: { id: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  const obligationCount = await prisma.osBatchObligation.count();
  if (obligationCount === 0) {
    process.stdout.write("OS cutover audit passed: no opening obligations require reconciliation.\n");
    return;
  }
  if (!superadmin) throw new Error("OS cutover audit requires an active Superadmin when opening obligations exist");

  const hubs = await prisma.osBatchObligation.findMany({
    distinct: ["hubId"],
    select: { hubId: true },
    orderBy: { hubId: "asc" },
  });
  let accounts = 0;
  let outstanding = 0;
  for (const { hubId } of hubs) {
    try {
      const result = await listOsAccounts({ hubId }, superadmin);
      accounts += result.shops.length;
      outstanding += result.shops.reduce((sum, shop) => sum + shop.outstanding, 0);
    } catch (error) {
      if (error instanceof ApiError && error.code === "OS_CUTOVER_RECONCILIATION_REQUIRED") {
        process.stderr.write(`OS cutover audit blocked for hub ${hubId}: ${JSON.stringify(error.details)}\n`);
        process.exitCode = 2;
        continue;
      }
      throw error;
    }
  }
  if (process.exitCode) return;
  process.stdout.write(`OS cutover audit passed: ${accounts} shop/hub account(s), ${outstanding} MMK outstanding.\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "OS cutover audit failed"}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
