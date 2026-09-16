# Historical OS settlement

This is an explicit Superadmin action after deployment, never a migration side effect. Back up the database before applying and keep the returned adjustment ID.

1. Sign in as Superadmin. Request `POST /api/v1/finance/os-history/preview` with `{}` (the ERP panel does this).
2. Review the three retained batches. Selection is global, ordered by pickup date descending, then immutable batch ID descending for ties. Every older batch appears, including unrecorded legacy batches. Check the positive amount to clear and any blockers.
3. Submit `POST /api/v1/finance/os-history/apply` with the exact `fingerprint`, all preview `batchIds`, the three `retainedBatchIds`, `businessDate` (`YYYY-MM-DD`), a reason, and a unique `idempotencyKey`. Do not recompute the selection from labels or client dates.
4. If a request times out, retry its identical body/reference. A changed preview requires reviewing a new preview. The operation is atomic; conflicts do not partially settle a selection.
5. Verify wallet totals match the before values and retained batch outstanding remains. Older batches have historical-settlement metadata and account history; existing and future confirmed return credits remain available.

No wallet line is created. The positive payable adjustment debits `OS_COD_PAYABLE` and credits `OS_HISTORICAL_SETTLEMENT_CLEARING`. Missing legacy obligations and confirmed-return credits are materialized with balanced non-wallet opening/return journals. Parcel statuses, rider receivables and existing payments are preserved. A closed business date or unresolved legacy reconciliation blocks the whole action. Generic individual journal reversal is blocked for these reconciliation journals because it would leave the subledger inconsistent.

The migration only adds fields/tables; it does not select or settle production batches automatically.
