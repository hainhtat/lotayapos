ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "UserAdminAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "beforeJson" TEXT,
  "afterJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserAdminAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserAdminAudit_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "UserAdminAudit_targetUserId_createdAt_idx" ON "UserAdminAudit"("targetUserId", "createdAt");
CREATE INDEX "UserAdminAudit_actorId_createdAt_idx" ON "UserAdminAudit"("actorId", "createdAt");
