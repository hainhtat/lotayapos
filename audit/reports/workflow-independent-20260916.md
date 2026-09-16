# Independent workflow review — 2026-09-16

Read-only review of other agents' automatic advance creation, parcel COD synchronization, rescheduling, assign-and-dispatch, bulk OS return, and their frontend flows. Historical reconciliation implementation authored by this reviewer was excluded.

## Findings reported to parent

1. **P1 — Legacy reconciliation can disable operational batch access.** `operations.service.ts` calls `accountRows` without handling a reconciliation-required result from `listBatches` and `getBatchDetail`. One unresolved legacy OS account causes the complete listing to fail for finance/operations/admin. Preserve the operational response and expose a nullable balance plus explicit financial issue; retain strict mutation blocking.
2. **P2 — Wallet/ledger caches are not refreshed after advances and returns.** `create-batch-dialog.tsx` and `operations-page.tsx` invalidate `ledger-summary`, whereas FinancePage uses `ledger`. A newly recorded advance can leave displayed wallet money stale. Invalidate the shared `ledger` prefix.
3. **P2 — Storage failures can block batch creation/recovery.** CreateBatchDialog catches session-storage reads but not writes/removal in mutation callbacks. Quota/blocked storage can prevent posting and lock the form repeatedly; removal failure after posting can prevent success navigation. Handle storage failure explicitly without losing an uncertain payment request or misreporting a committed request as uncommitted.
4. **P2 — Automatic bulk COD changes lack actor attribution.** Bulk parcel saves create `OS_BATCH_COD_CHANGE` journals through `syncBatchObligation`, but no actor is passed into the journal and the bulk-created parcels have no creator audit. Batch creator is not necessarily the actor who imports parcels later. Record the acting user in the same transaction; individual parcel edits already have an actor audit.

All findings were sent immediately to the parent; this report records the observed versions, not confirmation that subsequent fixes have been verified.

## Scope notes

Reviewed serializable reschedule updates and their assignment/way closure, dispatch creation of a commission-rated delivery way, bulk return per-parcel derived idempotency keys, closed-date advance handling, batch request replay hashing, and atomic obligation deltas. PostgreSQL checks performed earlier covered ledger, OS payments, tracking/finalization races and historical reconciliation; the new automatic-advance and simple-workflow suites were not included in that PostgreSQL run. Their separate SQLite verification belongs to the test reviewer.

## Follow-up verification

All four findings were addressed and the changed code independently re-read:

- Batch listing/detail now catch the specific reconciliation-required error and expose a nullable balance plus `balanceError`; other failures still propagate.
- Advance creation and return confirmation invalidate the shared `ledger` query prefix.
- Batch creation handles storage write failure before sending, presents an explicit error, and catches cleanup failure after a successful request. Uncertain saved requests remain retryable with their original body.
- Automatic obligation synchronization receives the acting user ID from create, bulk-save and finalize call sites; delta journal descriptions include that actor.

The expanded PostgreSQL runner subsequently passed **6 suites / 25 tests** on the isolated local database: ledger summary, OS account payments, historical OS reconciliation, concurrent tracking/finalization, automatic advances and simple workflow. This closes the earlier PostgreSQL coverage limitation for those included suites. No production database was used.
