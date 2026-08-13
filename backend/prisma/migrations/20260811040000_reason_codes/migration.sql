CREATE TABLE "ReasonCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelMy" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "noteRequired" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ReasonCode_code_key" ON "ReasonCode"("code");
CREATE INDEX "ReasonCode_outcome_active_idx" ON "ReasonCode"("outcome", "active");

INSERT OR IGNORE INTO "ReasonCode" ("id", "code", "labelEn", "labelMy", "outcome", "noteRequired", "active", "updatedAt") VALUES
('reason_partial_damaged', 'ITEM_DAMAGED', 'Item damaged', 'ပစ္စည်းပျက်စီး', 'PARTIAL', true, true, CURRENT_TIMESTAMP),
('reason_failed_unavailable', 'CUSTOMER_UNAVAILABLE', 'Customer unavailable', 'ဖောက်သည်မရှိ', 'FAILED', false, true, CURRENT_TIMESTAMP),
('reason_rejected_customer', 'CUSTOMER_REJECTED', 'Customer rejected delivery', 'ဖောက်သည်ငြင်းပယ်', 'REJECTED', true, true, CURRENT_TIMESTAMP);
