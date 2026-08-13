DROP INDEX "Batch_shopId_pickupDate_idx";
CREATE UNIQUE INDEX "Batch_shopId_pickupDate_key" ON "Batch"("shopId", "pickupDate");

ALTER TABLE "ExpenseEntry" ADD COLUMN "idempotencyKey" TEXT;
UPDATE "ExpenseEntry" SET "idempotencyKey"='legacy:' || "id";
ALTER TABLE "ExpenseEntry" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "ExpenseEntry_idempotencyKey_key" ON "ExpenseEntry"("idempotencyKey");
CREATE INDEX "ExpenseEntry_actorId_createdAt_idx" ON "ExpenseEntry"("actorId","createdAt");
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LocationImportAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "importedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocationImportAudit_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LocationImportAudit_source_version_idx" ON "LocationImportAudit"("source","version");
CREATE INDEX "LocationImportAudit_importedById_createdAt_idx" ON "LocationImportAudit"("importedById","createdAt");
