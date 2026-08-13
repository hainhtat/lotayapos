DROP INDEX "Batch_shopId_pickupDate_idx";
CREATE UNIQUE INDEX "Batch_shopId_pickupDate_key" ON "Batch"("shopId", "pickupDate");

PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExpenseEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "hubId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "businessDate" DATETIME NOT NULL,
  "description" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseEntry_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExpenseEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExpenseEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExpenseEntry_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ExpenseEntry" ("id","hubId","categoryId","wallet","businessDate","description","amount","actorId","journalEntryId","idempotencyKey","createdAt")
SELECT "id","hubId","categoryId","wallet","businessDate","description","amount","actorId","journalEntryId",'legacy:' || "id","createdAt" FROM "ExpenseEntry";
DROP TABLE "ExpenseEntry";
ALTER TABLE "new_ExpenseEntry" RENAME TO "ExpenseEntry";
CREATE UNIQUE INDEX "ExpenseEntry_journalEntryId_key" ON "ExpenseEntry"("journalEntryId");
CREATE UNIQUE INDEX "ExpenseEntry_idempotencyKey_key" ON "ExpenseEntry"("idempotencyKey");
CREATE INDEX "ExpenseEntry_hubId_businessDate_idx" ON "ExpenseEntry"("hubId","businessDate");
CREATE INDEX "ExpenseEntry_actorId_createdAt_idx" ON "ExpenseEntry"("actorId","createdAt");
PRAGMA foreign_keys=ON;

CREATE TABLE "LocationImportAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "importedById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocationImportAudit_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LocationImportAudit_source_version_idx" ON "LocationImportAudit"("source","version");
CREATE INDEX "LocationImportAudit_importedById_createdAt_idx" ON "LocationImportAudit"("importedById","createdAt");
