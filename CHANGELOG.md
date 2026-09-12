# Changelog

All notable changes to the Lotaya ERP and API are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-09-10

### Added

- Added the simplified OS payable account with batch COD obligations, consumable return credits, partial and split-wallet payments, oldest-first allocations, account history, and attributable corrections.
- Added explicit batch finalization so parcel entry remains editable until its OS obligation is intentionally created.
- Added safe parcel unlinking with financial correction, individual reposting, concurrency protection, and audit history.
- Added visibility for parcels left unsent for three or more days and made older open assignments visible by default in the Rider app.

### Changed

- Relaxed parcel linking to allow assigned and active parcels with different addresses, fees, or riders; only delivered and returned parcels are excluded. Linking assigns all selected parcels to one responsible rider and uses the highest fee plus 1,000 MMK for each additional parcel.
- Simplified Finance around per-shop, per-batch OS outstanding balances while retaining legacy settlements as read-only history after cutover.
- Hardened OS payment credit consumption, organization and hub scoping, idempotency, atomic corrections, migration reconciliation, and reporting against duplicate or reopened payables.
- Improved daily workflows with role-aware navigation, Myanmar business-date defaults, safer Dispatch selections, debounced filters, persistent per-batch parcel drafts, and row-level save validation.
- Improved rider settlement handling for incremental partial receipts and later declaration corrections.

### Fixed

- Prevented linked-parcel unlinking from duplicating rider receivables or leaving stale linked financial records.
- Prevented historical paid OS batches from reappearing as outstanding during the simplified-account cutover.
- Prevented the legacy and simplified settlement workflows from paying the same batch twice.
- Fixed spreadsheet draft saves for formatted MMK values, quoted CSV addresses, incomplete neighboring rows, retry behavior, and retained unfinished drafts.

### Release status

- ERP/API `0.3.0` is the recorded source release.
- Rider remains independently versioned at `0.1.1`; this ERP release does not claim a newly built Rider APK.

## [0.2.0] - 2026-09-04

### Added

- Added role-scoped monthly operations, returns, rider performance, OS statement, and profit reports, including bilingual ERP views and journal-level profit drill-down.
- Added persistent editable OS settlement drafts and auditable amendments to posted settlements, with optimistic version checks, idempotency, and non-destructive correction journals.
- Added attributable parcel field-change history and an ERP history viewer.
- Added atomic bulk parcel status updates and an operations return queue.
- Added normalized Myanmar phone numbers to user administration and login identifiers.

### Changed

- Expanded batch filtering and operational workflows across the ERP and API.
- Hardened Rider authentication so only Rider accounts can enter the mobile app, session caches are cleared on logout, and remembered sessions are handled consistently.
- Prepared Rider source release `0.1.1` (`versionCode` 2), pinned its Expo dependency set, and added explicit typecheck, health-check, APK, and AAB build commands.
- Added a bilingual Rider download page and made deployment publish APK metadata only when a version-matched artifact is present.

### Release status

- ERP/API `0.2.0` is the recorded source release.
- Rider `0.1.1` source is prepared, but its APK has not been built or published; production must retain the previously published APK metadata until the matching artifact and version marker exist.

## [0.1.1] - 2026-09-04

### Fixed

- Made manifest PDF import tolerate additional PDF text layouts and reject incomplete parses instead of silently omitting parcel rows.
- Made parcel draft saves allocate tracking numbers safely on the server and keep unsaved rows available when a save fails.
- Improved Myanmar Unicode text handling in exported PDFs and manifest PDF imports.

## [0.1.0] - 2026-08-13

### Added

- Established the initial Lotaya ERP, API, and Rider application baseline.
