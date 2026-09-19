import { backfillMissingPaidToOsFeeReceivables } from "../services/parcel.service.js";
import { prisma } from "../config/database.js";

/**
 * One-shot repair for paid-to-OS DELIVERED parcels that predate
 * OS_PAID_TO_OS_FEE_RECEIVABLE (fee excluded → rider owes fee − commission).
 *
 * Usage:
 *   npx tsx src/scripts/backfill-paid-to-os-fee-receivable.ts
 *   npx tsx src/scripts/backfill-paid-to-os-fee-receivable.ts --dry-run
 *   npx tsx src/scripts/backfill-paid-to-os-fee-receivable.ts LTY-1392
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const trackingNumbers = args.filter((arg) => arg !== "--dry-run");
  const result = await backfillMissingPaidToOsFeeReceivables({
    ...(trackingNumbers.length ? { trackingNumbers } : {}),
    dryRun,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Backfill failed"}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
