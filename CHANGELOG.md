# Changelog

All notable changes to the Lotaya ERP and API are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

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
