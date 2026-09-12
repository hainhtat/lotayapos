# SME Delivery ERP System & Rider Mobile App

**Status:** Proposed implementation specification  
**Date:** 2026-08-10  
**Primary languages:** English and Myanmar (`en`, `my`)  
**Platforms:** Web Admin/ERP, Rider Mobile App, Backend API

## 1. Project Overview

This system manages a high-trust cash-on-delivery delivery operation. The company advances COD value to Online Shops (OS) when parcels are picked up, collects COD and delivery fees from customers, compensates riders according to each rider’s configured pay model (percentage commission, fixed salary, or salary plus percentage), and settles every monetary movement through a strict double-entry ledger.

The ERP is the operational and financial source of truth. Superadmin, Operations Manager, and Dispatcher may set all parcel statuses from the ERP Dispatch Queue to correct rider errors; the rider app still exposes only the rider's assigned work and permitted delivery-outcome actions. All money, status changes, settlements, adjustments, and overrides must be attributable to a user, timestamped, auditable, and reversible through compensating entries or append-only audit rather than destructive edits.

## 2. Goals

- Maintain an accurate parcel lifecycle from pickup through delivery, rejection, pending return, and return to OS.
- Track OS advances, customer collections, delivery fees, deductions, and OS settlements without relying on spreadsheet arithmetic.
- Treat `DELIVERED` as the point where rider receivable/outstanding is recognized, not as proof that cash has been remitted; evening rider settlement is a separate manual finance/operations step.
- Reconcile rider collections across Cash, KBZ Pay, and Wave Pay at daily close.
- Calculate rider compensation under the rider’s pay model, with percentage commission only for successful deliveries when commission applies, and make the calculation explainable per parcel, per way, and per settlement period.
- Give operations real-time visibility into failed/partial deliveries and overdue return queues, including ERP status actions for the dispatch/ops and return queues.
- Provide daily/monthly operational, cashbook, profitability, OS, batch, and rider reports, and surface gross profit with visible components on Finance/Reports and/or Dashboard.
- Support English/Myanmar UI and API messages without duplicating business logic.

## 3. Scope

### In scope (Phase 1)

- Organization, hub, users, roles, OS accounts, rider profiles, zones, batches, parcels, package assignment, status history, and reason codes.
- COD/advance/fee/rider-compensation/settlement accounting with Cash, KBZ Pay, and Wave Pay wallets.
- OS pickup advances and next-settlement deductions for prepayment shortfalls and returned parcels.
- Rider assignment manifests, mobile delivery updates, daily rider settlement, and cashbook day-close.
- Alerts for Partial and Failed statuses, return queue timers, manual extensions, audit trail, localization, JWT authentication, PDF assignment manifests, and reports.

### Out of scope (Phase 1)

- Customer-facing tracking, online payment gateway, route optimization, live GPS tracking, payroll, tax filing, procurement, warehouse barcode hardware integration, and automated bank reconciliation.
- Custom parcel sticker printing. Phase 2 adds sticker output and the final barcode/QR identity format, but the branded identifier strategy remains to be decided later.

## 4. Assumptions and Decisions

- A **parcel** is one delivery obligation and has one COD amount, one delivery fee due/collected amount, and one assigned rider at a time.
- A **way** is one rider delivery attempt. When the rider’s pay model includes percentage commission, daily commission is the configured % of delivery fees for that day’s successful (`DELIVERED`) ways, using the rider's commission percentage effective on the way/settlement date.
- “Partial” means the delivery was not fully completed and requires an operations decision; it does not automatically count as successful or commissionable.
- Only `DELIVERED` parcels create rider commission (when the pay model includes percentage commission) and customer collection obligations. `REJECTED`, `FAILED`, and `RETURNED` earn zero commission unless a future policy explicitly creates another payable status. Fixed salary components are independent of individual way outcomes.
- Rider pay models: `PERCENTAGE` earns daily commission as a configured % of delivery fees for that day’s successful (`DELIVERED`) deliveries; `SALARY` is a monthly fixed salary in integer MMK minor units; `SALARY_PLUS_PERCENTAGE` is monthly fixed salary plus the same daily percentage commission. At daily rider settlement, salary-bearing models deduct a pro-rata daily share `floor(monthlySalary / daysInMonth)` for the settlement business date’s calendar month from the amount collected from the rider; that deduction must appear as auditable settlement/cashbook day movement with the day’s cash inflows/outflows (not a silent net). Percentage commission continues to use existing Rider Commission Expense/Payable vocabulary; fixed salary is posted through rider settlement / cashbook day movement with auditable `RIDER_RECEIVABLE` lines without inventing a new account code unless a later finance policy requires one.
- The advance amount is configurable per parcel and may be less than, equal to, or (with explicit authorization) greater than COD. Negative balances are allowed as receivables, never silently netted away.
- A Pending Return timer starts when a parcel enters `PENDING_RETURN`, defaults to four calendar days in the hub timezone, and may be extended only with a reason and audit record.
- Posted journals remain non-destructive: corrections use void/reversal or append-only audit / compensating adjustment rather than silent overwrite. Draft OS settlement lines are editable before post; posted OS settlement lines remain editable only with a full attributable audit trail (see §6.6).
- A batch is identified by exact pickup date and OS, with a human-readable label such as `snmd 15.06.2026`; the database key is not the label.
- Monetary values are stored as integer minor units (MMK kyats unless configured otherwise); percentages are stored with explicit precision. No floating-point arithmetic is used for money.

## 5. Users and Roles

| Role | Purpose | Scope |
|---|---|---|
| Superadmin | Full administration, configuration, reversals, user/role management, all reports | All hubs and organizations |
| Operations Manager | Manage OS, batches, parcels, zones, assignments, exceptions, return extensions, operational reports | Assigned hub(s) |
| Finance/Cashier | Post advances, settlements, wallet movements, day-close, financial reports | Assigned hub(s) |
| Dispatcher | Create/import parcels, group batches, assign riders, print manifests | Assigned hub |
| Rider | View own assignments, update allowed delivery outcomes, submit collection/settlement evidence | Own rider account |
| Auditor/Read-only | View ledger, reports, status history, and audit logs | Explicitly granted scope |

Use deny-by-default authorization. Role permissions are checked server-side on every API, with hub/OS/rider ownership constraints applied after role checks.

## 6. Functional Requirements

### 6.1 Identity and access

- Register users only through authorized admin flow or invite flow; never expose open public registration in production unless explicitly enabled.
- Login with email/phone and password; return an access token and server-side session/refresh mechanism according to deployment policy.
- Verify the current token/session on app bootstrap and expose canonical user information.
- Support logout, token expiry, refresh rotation where enabled, password reset hooks, account disablement, and audit events.
- Enforce password policy, rate-limit login, avoid account enumeration, and never log credentials or tokens.

### 6.2 OS and commercial configuration

- Create and maintain OS legal/display name, contact details, settlement terms, default advance policy, active status, and preferred language.
- Configure per-OS or global delivery fee rules, default rider commission percentage per way (overridable by rider pay model), and effective dates.
- Show OS receivable/payable balance with a transaction-level explanation.

### 6.3 Zones, riders, and assignments

- Create zones and assign riders to one or more active zones with effective dates.
- Maintain rider status, contact, payment identifiers, compensation/pay-model policy, and hub.
- Rider compensation is configurable **per rider** as one of:
  - `PERCENTAGE` — daily commission = configured % of delivery fees for successful (`DELIVERED`) deliveries that day (examples: 40%, 50%).
  - `SALARY` — monthly fixed salary amount in integer MMK minor units.
  - `SALARY_PLUS_PERCENTAGE` — monthly fixed salary plus the same daily percentage commission on delivery fees.
- Settings rider create/edit must capture pay model and the applicable commission % and/or monthly salary fields. Salary ledger treatment follows §4 / §6.7 / §7 (daily pro-rata deduction from rider remittance at settlement with visible `RIDER_RECEIVABLE` lines; percentage commission uses Rider Commission Expense/Payable vocabulary).
- **Implementation note:** Rider `payModel`, `commissionRateBps`, and `monthlySalary` are persisted on `Rider`; Settings create/edit captures them. Delivery and settlement commission use `resolveCommissionRateBps`: `SALARY` → 0 bps (no percentage commission); percentage-bearing models use the rider’s stored rate when positive, otherwise the env default. Rider settlement applies `calculateDailySalaryDeduction` (`floor(monthlySalary / daysInMonth)` for `SALARY` / `SALARY_PLUS_PERCENTAGE` on the settlement business date), expected remittance `cod + fees - commission - salaryDeduction`, preview field `salaryDeduction`, and visible `RIDER_RECEIVABLE` settlement journal lines when `salaryDeduction > 0` (no new account codes)—see §6.7 / §7.
- `DELIVERED` records the rider-side collection obligation and recognizes a rider receivable/outstanding balance, but it does **not** mean the hub has already received money. Actual remittance is recorded later through a manual rider settlement that may split the declared amount across Cash, KBZ Pay, and Wave Pay, and the remaining outstanding balance stays visible until that settlement is posted. Unfulfilled parcel outcomes such as `FAILED`, `RETURNED`, `REJECTED`, `PARTIAL`, and `PENDING_RETURN` remain separate operational statuses and do not by themselves imply payment receipt or payment settlement.
- Generate a daily assignment manifest by batch, zone, rider, and date; view on-screen or export/print as PDF. `POST /operations/parcels/manifest/preview` returns JSON sections + status/COD totals; `POST /operations/parcels/manifest` returns the same selection as PDF. Both accept optional `riderIds` (empty = all riders in hub scope; Superadmin without `hubId` is organization-wide, max 50), `statuses`, `dateFrom`/`dateTo` (status **activity** date: parcels that have a `statusHistory` row with `toStatus` in the selected statuses and `createdAt` in the inclusive range—not batch `pickupDate`), and optional Superadmin `hubId`. Default statuses when omitted remain dispatch-ready `ASSIGNED` / `OUT_FOR_DELIVERY` / `PICKED_UP`. Caps: 500 parcels / 50 riders → `400 BATCH_TOO_LARGE`. Bulk assign shares the 500-parcel cap. Finance and Auditor may preview/download for settlement review. Dispatch manifest PDF embeds `NotoSansMyanmar-Regular` from `backend/assets/fonts/` so Myanmar customer/township text renders; production deploy must rsync `assets/` with the backend package.
- Provide a dispatcher bulk-dispatch workspace (ERP **Dispatch Queue**, `/operations/dispatch`) with a multi-select parcel table and filters for batch (dropdown of batches, not free-text batch id), rider, assignment status, zone/township, customer name, order ID, tracking number, and inclusive date range. Parcel-list text filters for township, customer name, order ID, and tracking number are case-insensitive (PostgreSQL `mode: insensitive`; SQLite uses case variants). **Dispatch Queue / `GET /parcels` `dateFrom`/`dateTo` still filter by batch `pickupDate`**—distinct from manifest/Reports daily delivery status, which use status activity date. The parcel list is paginated (`pageSize` 100 in the Dispatch Queue UI; API max 100) with previous/next controls. Bulk assignment accepts eligible parcel IDs and a target rider, validates the complete selection atomically, preserves assignment history, and generates a PDF manifest for the action (including multi-rider manifest download). Edit actions (inline rider/status, multi-edit, edit modal, assign) are role-gated to Superadmin, Operations Manager, and Dispatcher.
- Prevent assignment of inactive riders, duplicate active assignment, cross-hub mismatch, or parcels already terminally settled without an override.
- Allow authorized dispatcher/operations users to reassign with a reason and preserved assignment history.

### 6.4 Batches and parcels

- Create/import a batch using OS and exact pickup date. The system must allow duplicate OS `Order ID` values within the same batch, including multi-day pickups and multi-box orders, and must not reject duplicate imports on that basis.
- Capture the parcel identifiers currently supported by the implementation, including `trackingNumber` as the unique parcel identifier, OS `Order ID` as a non-unique searchable reference, and optional OS order date when provided by the source system. Preserve customer name/phone/address, COD amount, delivery fee, advance amount, zone, notes, and optional external reference.
- `trackingNumber` remains the package identity and lookup key in the current implementation; the backend accepts it as the unique parcel identifier, while `Order ID` is preserved as the original OS reference and may repeat within the same OS, batch, or day-reset OS order stream.
- Provide batch totals: parcel counts by status, COD, advances, delivery fees, commissions, collected amounts, returns, deductions, and outstanding balances.
- Search/filter by OS, batch, tracking number, order ID, customer name, OS order date, rider, zone, township, status, date (batch pickup date on parcel list), and exception reason. Township, customer name, order ID, and tracking number contains-filters are case-insensitive as implemented.
- Import must validate rows, show an error report, and commit atomically or explicitly mark partial import; no silent row loss.
- Import validation must not treat duplicate `Order ID` values as a uniqueness violation, and no unique or composite-unique constraint may involve `Order ID`.

### 6.5 Parcel lifecycle

Statuses:

`CREATED → PICKED_UP → ASSIGNED → OUT_FOR_DELIVERY → DELIVERED`

Exception branches:

`OUT_FOR_DELIVERY → PARTIAL`, `OUT_FOR_DELIVERY → FAILED`, `OUT_FOR_DELIVERY → REJECTED`, `PARTIAL/FAILED/REJECTED → PENDING_RETURN → RETURNED`

- Status transitions are server-validated against the allowed status enum and recorded with actor, source (`admin`/`rider`), timestamp, location/device metadata when available, reason code, note/reason when required, and previous/new values. Money side-effects remain those already specified for the destination status (collections, commission eligibility, return timer, OS offsets).
- Superadmin, Operations Manager, and Dispatcher may edit/set **all** parcel statuses from the ERP **Dispatch Queue** (`/operations/dispatch`) to correct rider errors (broader than rider-allowed transitions). Server validation, status history attribution (actor, from/to, note/reason when required), and ledger side-effects still apply. Deny-by-default remains for other roles.
- Rider may update only assigned parcels and only permitted delivery-outcome transitions while the way is open.
- Status override that leaves a money-bearing status (`DELIVERED` or `PARTIAL`) while **unreversed** money journals exist is rejected with `409 MONEY_POSTED`; there is no automatic reversal—Finance must reverse posted entries before the status correction. The gate considers: (1) parcel-scoped sources `RIDER_COMMISSION`, `RIDER_RECEIVABLE_RECOGNITION`, `PARTIAL_RETURN_COLLECTION`, `OS_PARTIAL_RETURN_ADJUSTMENT`, `DELIVERY_COLLECTION`, and `LINKED_RIDER_RECEIVABLE_COD`, matching `sourceId` equal to the parcel id or starting with `parcelId:`; (2) when the parcel is linked, group-scoped `LINKED_DELIVERY_COLLECTION` / `LINKED_RIDER_COMMISSION` / `LINKED_RIDER_RECEIVABLE_RECOGNITION` / `LINKED_RIDER_RECEIVABLE_FEE` / `LINKED_OS_SHORTFALL`, matching `sourceId` equal to the link group id or starting with `groupId:`. Journals that already have a matching `LEDGER_REVERSAL` (reversal `sourceId` = original entry id) do not block the override. After reversal, re-post of money events uses free versioned journal `sourceId`s via `nextVersionedJournalSourceId` (`baseId` or `baseId:uuid`) for `RIDER_COMMISSION`, `RIDER_RECEIVABLE_RECOGNITION`, `PARTIAL_RETURN_COLLECTION`, `OS_PARTIAL_RETURN_ADJUSTMENT`, `DELIVERY_COLLECTION` / `LINKED_DELIVERY_COLLECTION`, `OS_SHORTFALL` / `LINKED_OS_SHORTFALL`, `BATCH_PICKUP_ADVANCE` (batch id), and the linked receivable/commission/`LINKED_*` sources above so the unique source key can be reused.
- Parcel township (and therefore delivery fee derived from township) and COD cannot be edited after an **unreversed** batch `BATCH_PICKUP_ADVANCE` journal exists (including versioned `batchId:uuid` sourceIds); the API returns `409 ADVANCE_POSTED`. After Finance reverses the advance, `listBatches` reports `advancePosted: false` and a new advance may be posted under a versioned `sourceId`.
- On `OUT_FOR_DELIVERY` and on delivery outcomes (`DELIVERED` / `PARTIAL` / `FAILED` / `REJECTED`) for an assigned rider, the server keeps exactly one primary open (or completed) `DeliveryWay`: prefer the current rider’s open way, else the oldest open way. Any other still-open ways for that parcel are closed with outcome `SUPERSEDED`. When recording a delivery outcome, the primary way is completed with the real outcome; if none exists (legacy data, ERP override that skipped `OUT_FOR_DELIVERY`, etc.), the server creates a completed way so ERP transitions such as `OUT_FOR_DELIVERY → DELIVERED` succeed without a prior rider-started way.
- **Implementation note:** Dispatch Queue provides inline rider assign/reassign and inline/all-status editing across the status enum (with reason prompts where required), plus parcel edit modal and selected-row multi-edit, in addition to Partial Return and link-parcels. Edit affordances are role-gated to Superadmin / Operations Manager / Dispatcher. OS Order ID is the primary display identifier in the Dispatch Queue parcel table (tracking number shown as secondary mono text); this is UI prominence only—API identity remains `trackingNumber`.
- Partial and Failed require a reason code and optional/required note according to reason configuration. They immediately create ERP alerts for Superadmin and Operations Manager. When the reason code is a date-change/reschedule code (`DATE_CHANGE`, `DELIVERY_DATE_CHANGE`, or `RESCHEDULE`), the alert `type` is `DATE_CHANGE` (message notes the customer requested another delivery day); otherwise the alert `type` matches the destination status (`PARTIAL` / `FAILED`). Dispatch Queue also surfaces an inline date-change badge when the parcel’s current `reasonCode` matches those codes.
- A Partial Return outcome requires Actual COD Collected. The API validates that the value is non-negative and does not exceed Original COD, calculates the shortfall, and records the bounded OS settlement offset for the uncollected advanced COD in a balanced journal transaction. `PARTIAL_RETURN_COLLECTION` and `OS_PARTIAL_RETURN_ADJUSTMENT` use `nextVersionedJournalSourceId` on the parcel id so, after Finance reverses those journals, a later Partial outcome can re-post under `parcelId:uuid` without colliding with the unique source key.
- Rejected requires a reason code and earns zero commission.
- The current implementation requires a unique `trackingNumber` field for parcel identity, but the Phase 1 parcel lifecycle does not require any specific branded numbering policy, counter concurrency rule, or import-time numbering guarantee beyond uniqueness of the stored tracking number field.
- Delivery confirmation may require customer name/OTP/signature/photo in a later policy; keep the model extensible but do not require unavailable evidence in Phase 1.
- A parcel cannot be marked Delivered after Return without an authorized reopen/reversal workflow.

### 6.6 Advance and OS settlement ledger

At pickup, the configured advance is posted against the OS payable account and the selected company wallet. When a batch is finalized, the system creates one immutable OS batch COD obligation. The operational OS account is a per-OS, per-hub list of these batch obligations, not a new editable settlement statement.

For each obligated batch, the displayed balance is calculated as:

`outstanding = max(0, original COD + approved opening adjustment − posted advance − posted return credits − posted OS-payment allocations)`.

If that expression is negative, the excess is available OS credit rather than a negative payable. A return-to-OS creates a posted return credit for its batch; posted OS payments may consume that credit. Credit consumption and cash payments allocate oldest-first across the selected outstanding batches, are hub-scoped, and are recorded atomically with idempotency protection. Payments may be split across Cash, KBZ Pay, and Wave Pay. A wallet payment cannot exceed the selected payable after available credit.

Superadmin and Finance may void a payment with a reason and idempotency key, which posts an opposite journal and marks the original payment `VOIDED`; they may correct a payment by atomically voiding it and posting a replacement. History retains payments, return credits, and legacy settlement records.

**Return to OS:** Superadmin, Finance, and Operations Manager may use `POST /finance/os-returns/receive` to confirm physical return. It accepts `FAILED`, `REJECTED`, `PENDING_RETURN`, or `PARTIAL`, atomically changes the parcel to `RETURNED`, and creates the batch return credit. It does not post a wallet credit. The operation is idempotent and is intentionally permitted as Finance recovery rather than a normal Ops status correction. Auditor access is read-only.

The earlier OS settlement draft/preview/post workflow remains in the data/API history for pre-cutover records only. Once a selected batch has an OS batch obligation, its legacy settlement writes are rejected with `OS_ACCOUNT_CUTOVER`; the ERP presents legacy settlement history read-only. Cutover reconciliation uses attributable legacy batch payments and permits only a Superadmin-approved, evidence-backed opening adjustment where required.

### 6.7 Rider compensation and daily settlement

Rider pay model is configured on the rider profile (§6.3) as `PERCENTAGE`, `SALARY`, or `SALARY_PLUS_PERCENTAGE`.

- **`PERCENTAGE`:** Daily commission = configured % of delivery fees for successful (`DELIVERED`) deliveries that day (examples: 40%, 50%). Use existing Rider Commission Expense/Payable vocabulary.
- **`SALARY`:** Monthly fixed salary in integer MMK minor units. At settlement, deduct the daily pro-rata share `floor(monthlySalary / daysInMonth)` for the settlement business date from the total amount collected from the rider; record the deduction in the settlement journal / cashbook together with daily cash inflows/outflows (not a silent net), posted through rider settlement with auditable `RIDER_RECEIVABLE` lines (no new account code).
- **`SALARY_PLUS_PERCENTAGE`:** Monthly fixed salary plus the same daily percentage-commission rules as `PERCENTAGE`; daily salary deduction uses the same pro-rata rule as `SALARY`.
- Rejected/Failed/Returned parcels produce zero rider commission. Partial is non-commissionable until an authorized final outcome is recorded. Salary (when applicable) is not earned per failed/returned way.
- At evening settlement, calculate expected remittance from collections minus applicable rider compensation for the rider/day/settlement scope: `Amount Owed to Hub = Total COD Collected + Delivery Fees Collected - Rider Commission - salaryDeduction` (where `salaryDeduction` is 0 for `PERCENTAGE`). Surface `salaryDeduction` on settlement preview and in auditable settlement journal lines (same non-silent treatment as above).
- Linked-group settlement totals: when a delivered parcel belongs to a linked group, fees and commission are taken once from the group’s adjusted `totalDeliveryFee` only if **every** member of the group is `DELIVERED`. Incomplete linked groups do not fall through to individual member fees/commission in settlement totals (COD for delivered members still counts).
- Record actual remittance separately by wallet: Cash, KBZ Pay, and Wave Pay. Admins, Operations Managers, and Finance users record the rider’s evening settlement manually, splitting the declared amount across the supported wallets (for example Cash 100,000, KBZ Pay 100,000, Wave Pay 200,000). Permit under/over settlement only with reason, approval, and a receivable/payable balance.
- Require cashier confirmation and attach reference/note where applicable. Reconciliation compares expected, declared, verified, and variance values.
- **Implementation note:** Per-rider `payModel` / `commissionRateBps` / `monthlySalary` are persisted and editable in Settings. `resolveCommissionRateBps` forces commission to 0 for `SALARY` riders at delivery and settlement preview; percentage models use the rider rate when positive, else env default. `calculateDailySalaryDeduction` / `calculateRiderSettlementAmounts` implement the formula above; preview returns `salaryDeduction`. When `salaryDeduction > 0`, the `RIDER_SETTLEMENT` journal posts a visible `RIDER_RECEIVABLE` credit for remittance before salary (`cod + fees - commission`) and a `RIDER_RECEIVABLE` debit for the salary deduction, with the description including the salary amount; otherwise a single `RIDER_RECEIVABLE` credit for `expectedAmount` is used. No dedicated salary account code is introduced.
- The rider app should surface the rider's outstanding balance / settlement status so riders can see what remains to be remitted. The outstanding amount is reduced only when the manual settlement is posted; it is not inferred from `DELIVERED`.

### 6.8 Cashbook and day-close

- Maintain independent wallet ledgers for Cash, KBZ Pay, and Wave Pay, plus opening balance, posted movements, transfers, adjustments, and closing balance.
- Prevent cross-wallet movement from being represented as a single-sided entry; record both sides.
- Day-close is a controlled procedure: stop or queue new postings for the business date, compute expected balances, reconcile verified settlements, require variance explanations/approval, post close record, and lock the date.
- Reopening a closed day requires Superadmin authorization and creates an audit event; subsequent corrections are reversals, not edits to historical entries.
- The ERP must **show profits**: daily (and period) gross profit as a derived report metric on Finance/Reports and/or Dashboard, with visible components including delivery fee revenue, commission/salary cost, returns, and adjustments (and other components already listed for gross profit). Do not hide the composition behind a single opaque total.

### 6.9 Alerts and reporting

- Real-time or near-real-time alerts for Partial, Failed (including `DATE_CHANGE` when the Partial/Failed reason is a reschedule/date-change code), overdue Pending Return, settlement variance, failed day-close, and suspicious duplicate actions.
- Alert recipients: Superadmin and Operations Manager by default; configurable escalation and acknowledgement state.
- Outstanding-rider reporting must include the number of unsettled riders and each rider’s outstanding amount, plus the manual split-wallet payment history used to reach that balance. Dashboard/Overview should also show unsettled OS batches, COD collected today, delivery fees, wallet balances, returns due, overdue returns, failed/partial delivery alerts, expense total, and net profit breakdown, with each card deep-linking to the filtered operational or Finance view that explains the total. The overview should also make room for a quick status of rider receivables and settlement completion so finance users can see what still needs manual entry.
- The dashboard and Dispatch Queue expose a three-day overdue-unsent queue: parcels in `CREATED`, `PICKED_UP`, or `ASSIGNED` whose batch pickup date is on or before the hub-timezone calendar-date cutoff (today minus three calendar days). This queue is distinct from the Pending Return timer.
- Reports: daily operations, monthly operations, OS statement, batch inventory, rider performance/commission (and salary where configured), wallet/cashbook, day-close, outstanding receivables, returns, gross profit with component breakdown, and audit activity.
- Reports support timezone-aware date ranges, hub/OS/rider/zone filters, CSV export where useful, and PDF output for manifests and settlement statements.
- **Implementation note:** Finance/Reports now surfaces gross profit with component breakdown for authorized financial roles through the detailed reports UI and report endpoint set, rather than only an opaque aggregate dashboard figure.
- Dispatchers may link two to 20 unlinked parcels in the responsible rider’s hub, including parcels from different batches and with different addresses or fees. `DELIVERED` and `RETURNED` parcels are excluded; other statuses remain linkable. Linking assigns the responsible rider, preserves assignment history, and uses the highest member fee as the base plus 1,000 MMK for each additional parcel. The linked group is visible to riders, and commission is calculated from the group’s adjusted total delivery fees rather than separate full-fee ways. Rider settlement applies group fees/commission only when all members are `DELIVERED`; incomplete groups do not fall through to individual fees.

## 7. Double-Entry Accounting Model

Every posted monetary event creates balanced debit and credit lines in one journal entry. Journal entries include immutable ID, business date, posting date, source type/id, description, currency, actor, and reversal linkage. The ledger must reject unbalanced entries and duplicate source event keys.

Minimum account categories:

| Account | Typical meaning |
|---|---|
| Wallet: Cash | Physical cash controlled by hub |
| Wallet: KBZ Pay | Digital wallet balance |
| Wallet: Wave Pay | Digital wallet balance |
| OS COD Payable | OS batch COD obligation, reduced by posted advances and OS payments |
| OS Batch COD Clearing | Counter-account used when an OS batch obligation is created |
| OS Return Credit | Return-to-OS credit available against OS account payables |
| Customer COD Receivable | COD expected from customer |
| Delivery Fee Revenue | Delivery fee earned under policy |
| Rider Commission Expense | Commission owed to rider (percentage component) |
| Rider Settlement Receivable | Amount rider owes hub after collection/commission |
| Variance/Adjustment | Authorized operational or financial variance |

Percentage commission continues to use `Rider Commission Expense` (and related Rider Commission Payable vocabulary where applicable). Fixed rider salary is not given a newly invented account code in this chart: deduct the daily pro-rata share from the rider remittance at settlement and post it through rider settlement / cashbook day movement with auditable `RIDER_RECEIVABLE` lines alongside daily cash inflows/outflows (credit remittance-before-salary, debit salary deduction when `salaryDeduction > 0`). Introduce a dedicated salary expense/payable account only if a later explicit finance policy requires one.

Illustrative postings must be confirmed against the finance policy before implementation:

- Pickup advance: debit `OS_COD_PAYABLE`; credit the funding wallet.
- Finalized batch obligation: debit `OS_BATCH_COD_CLEARING`; credit `OS_COD_PAYABLE` for the batch original COD.
- Successful customer collection: debit selected rider-clearing/settlement account; credit `Customer COD Receivable`; separately recognize fee revenue and commission expense according to policy.
- Rider remittance: debit wallet(s); credit `Rider Settlement Receivable` (`RIDER_RECEIVABLE`). When a daily salary deduction applies, post a visible `RIDER_RECEIVABLE` credit for remittance before salary and a `RIDER_RECEIVABLE` debit for `salaryDeduction` in the same settlement journal (description includes the salary amount); no new account code.
- OS account payment: debit `OS_COD_PAYABLE`; credit the selected Cash, KBZ Pay, and/or Wave Pay wallets. Credit-only applications use a balanced memo entry and retain per-credit allocations.
- Return to OS: confirmation creates a return credit for the parcel's batch and does not create a wallet line. The credit is consumed only when applied to an OS payment.
- Partial Return (`OS_PARTIAL_RETURN_ADJUSTMENT` / `PARTIAL_RETURN_COLLECTION`): record the bounded collection/shortfall accounting for `min(Original COD − Actual COD Collected, advance)` with versioned source IDs after reversal. This remains separate from the OS account's batch return credit and does not reinstate the retired settlement-draft workflow.
- Linked delivery: recognize `Delivery Fee Revenue` and `Customer COD Receivable` from the group-adjusted fee (base fee for the first parcel plus 1,000 MMK per additional parcel), then calculate `Rider Commission Expense` from that adjusted group fee. The journal source must identify the linked group and remain idempotent. Rider settlement must not substitute incomplete linked groups with individual member fees. **Implementation note:** when the final linked member reaches `DELIVERED`, delivery-time posting allocates one canonical `DELIVERED` way per member (latest completion), posts `LINKED_RIDER_COMMISSION` / `LINKED_RIDER_RECEIVABLE_FEE` with `nextVersionedJournalSourceId` on the group id, and posts per-member `LINKED_RIDER_RECEIVABLE_COD` on the parcel id. Finance `postDeliveryCollection` uses versioned `DELIVERY_COLLECTION` / `LINKED_DELIVERY_COLLECTION` (and shortfall) sourceIds after reversal; for linked groups it does **not** create a second live `LINKED_RIDER_COMMISSION` when delivery-time posting already left an unreversed commission (`nextVersionedJournalSourceId` returns null → skip).

The system must expose the exact journal lines behind every business total.

## 8. Data Model

Core entities:

- `Organization`, `Hub`, `User`, `Role`, `Permission`, `UserRole`, `Session`.
- `OnlineShop`, `Zone`, `Rider`, `RiderZone`.
- `Rider` compensation fields (persisted): pay model (`PERCENTAGE` | `SALARY` | `SALARY_PLUS_PERCENTAGE`), `commissionRateBps` when the model includes percentage, and `monthlySalary` in integer MMK minor units when the model includes salary.
- `Batch` with OS, pickup date, label, hub, state, and import metadata.
- `Parcel` with batch, tracking number, original OS order ID, customer data, COD, fee, advance, zone, current status, and financial state.
- `Parcel` also stores Partial Return Actual COD Collected and calculated shortfall fields, assignment metadata, and optional linked-group membership.
- `LinkedParcelGroup` stores hub, group membership, base fee, per-additional-parcel fee, adjusted total fee, and lifecycle/audit metadata. Linked members retain their individual parcel and batch identity; matching address is stored/displayed data, not a linking prerequisite.
- `DeliveryWay` with parcel, rider, assigned time, outcome, commission rate/base/amount, and completion time. Duplicate open ways for the same parcel are closed with outcome `SUPERSEDED` while one primary way remains open (on `OUT_FOR_DELIVERY`) or is completed with the real delivery outcome; outcome recording may create a completed way when none is open so ERP can finish delivery without a prior rider-started way.
- `StatusHistory`, `ReasonCode`, `Alert`, `AlertRecipient`.
- `Account`, `Wallet`, `JournalEntry`, `JournalLine`, `OsBatchObligation`, `OsAccountPayment`, `OsPaymentAllocation`, `OsReturnCredit`, `OsCreditAllocation`, legacy `Settlement`/`SettlementLine`, `CashbookDay`, `WalletTransfer`.
- `AuditLog`, `ImportJob`, `Manifest`, `ReportRun`.

Use UUIDs or another non-guessable public ID, internal relational keys as appropriate, created/updated timestamps, optimistic concurrency/version fields for mutable operational records, and soft deletion only for master data where legally appropriate. Add unique constraints for tracking number, OS+pickup-date batch identity, journal source event, settlement scope, and wallet/day-close identity. Do not add unique or composite-unique constraints on `Order ID`; it remains a searchable, non-unique OS reference. Preserve optional `osOrderDate` as a searchable attribute when present. Index status/date/hub/OS/order ID/osOrderDate/rider/search fields.

## 9. API Overview

Base path: `/api/v1`. JSON responses use a consistent envelope and include request/correlation ID.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/verify`, `POST /auth/logout` |
| Master data | `GET/POST/PATCH /online-shops`, `/riders`, `/zones`, `/reason-codes` |
| Batches/parcels | `GET/POST /batches`, `POST /batches/import`, `GET/PATCH /parcels`, `GET /parcels/:id/history` |
| Assignments | `GET/POST/PATCH /assignments`, `GET /manifests/:id.pdf` |
| Bulk dispatch | `GET /parcels` with batch/rider/assignment/zone/township/customer/order/tracking/date filters (parcel-list dates = batch `pickupDate`; township/customer/order/tracking contains filters are case-insensitive), `GET /operations/parcels/overdue-unsent?days=3` for `CREATED`/`PICKED_UP`/`ASSIGNED` parcels from batches at least three hub-timezone calendar days old, pagination (`page`, `pageSize` max 100), `POST /operations/parcels/bulk-assign`, `POST /operations/parcels/link`, and manifest preview/PDF endpoints |
| Parcel guards | Status override leaving `DELIVERED`/`PARTIAL` with **unreversed** money journals → `409 MONEY_POSTED` (no auto-reversal): parcel-scoped types (incl. `LINKED_RIDER_RECEIVABLE_COD`) match `parcelId` / `parcelId:…`; group-scoped `LINKED_*` (excl. COD) match `groupId` / `groupId:…`; ignores `LEDGER_REVERSAL`. After reversal, re-post uses versioned `sourceId` (`baseId` or `baseId:uuid`) for commission/receivable/partial-return/collection/shortfall/`BATCH_PICKUP_ADVANCE`/linked sources; COD/township edit after unreversed `BATCH_PICKUP_ADVANCE` → `409 ADVANCE_POSTED` |
| Rider actions | `GET /me/assignments`, `POST /parcels/:id/ways`, `POST /parcels/:id/status` |
| Settlements | `GET/POST /rider-settlements`; OS accounts: `GET /finance/os-accounts`, `GET /finance/os-accounts/:shopId/history`, `POST /finance/os-payments`, `POST /finance/os-payments/:id/void`, `POST /finance/os-payments/:id/replace`, `POST /finance/os-accounts/cutover-adjustment`; legacy OS settlement endpoints/history remain read-only after OS-account cutover; `GET /finance/os-pending-returns`, `POST /finance/os-returns/receive`, and cashbook endpoints |
| Ledger | `GET /ledger/journal-entries`, `GET /ledger/accounts/:id/balance`, `GET /ledger/reconciliation` |
| Alerts | `GET /operations/alerts`, `POST /operations/alerts/:id/acknowledge` |
| Reports | `GET /reports/daily`, `/monthly`, `/profit`, `/returns`, `/rider-performance`, `/os-statements` |

All write endpoints validate input, authorize role and scope, support idempotency for money/status commands where retries are possible, and return stable error codes. Parcel creation/import currently generates a unique server-side tracking number, but Phase 1 does not lock the branded format or sequence policy; those decisions are deferred to a later phase. `Order ID` remains a non-unique searchable field and must not be used as the package identity or uniqueness key. If the source system provides an OS order date, the API should preserve it as an optional search/filter field distinct from the batch pickup date. Use pagination, filter validation, bounded page sizes, and explicit timezone/date semantics. Provide OpenAPI documentation when implementation begins.

Batch detail supports spreadsheet-like bulk entry and a one-parcel modal wizard (Next keeps the modal open; users can switch modes without losing the draft). It also supports an OS delivery-manifest PDF preview for local text PDFs. Uploads are validated by PDF MIME/magic, bounded to 10 MB, 50 pages, and 500 recognized rows, processed only in a private temporary directory, and deleted after extraction. Parsing never transmits customer data to an external AI/OCR service and never creates parcels automatically. It returns an editable preview with source page, row confidence, and warnings; customer name, address, optional phone, COD, and optional non-unique manifest row reference are mapped into the existing bulk parcel grid only after explicit user confirmation. Township matching is conservative against master data, unmatched/ambiguous townships require review, and delivery fees remain server-derived. Image-only/scanned documents return `OCR_REQUIRED` through an adapter boundary until an approved local OCR implementation exists.

## 10. UI Overview

### Web ERP

- Auth screens: login, registration/invite completion, session-expired state.
- App shell: sidebar/header, hub/date context, language and theme controls, notifications, user menu. Primary navigation has no single “Operations” item; operations are two menus—**All Batches** and **Dispatch Queue**—plus Finance, Reports, Settings, and Profile as elsewhere.
- Dashboard: today’s parcels, COD/fee totals, rider outstanding settlements, unsettled OS batches, wallet balances, returns due, overdue returns, alerts, expenses, and gross profit with visible profit components (or clear links into the profit report). Active-batches “view all” navigates to **All Batches** (`/operations/batches`); clicking a dashboard batch card opens **Dispatch Queue** filtered by that batch (`/operations/dispatch?batchId=…`). Each overview card should deep-link to the filtered Finance or Operations page that explains the total. Finance-facing overview cards should make the split between delivered-but-unsettled rider receivables and fully settled balances explicit.
- Operations (split UI):
  - **All Batches** (`/operations/batches`): batches overview with remaining / delivered / pending-return counts per batch; open batch detail or jump to Dispatch Queue filtered by batch. **Alerts** live on this page (acknowledge flow); header notifications bell deep-links to `/operations/batches#alerts` and is role-gated to Superadmin and Operations Manager.
  - **Dispatch Queue** (`/operations/dispatch`): dense parcel dispatch workspace similar to classic delivery POS—multi-select; columns including OS Order ID as the primary parcel label (tracking number secondary), date, merchant, customer, township, fee, COD, total, rider (inline assign), status (inline edit for Superadmin / Operations Manager / Dispatcher across the status enum), and payment summary where available; link-parcels; selected-row multi-edit; parcel edit modal; bulk assign; bulk status apply (client loop over `POST /parcels/:id/status`, stop-on-first-error, optional override note, selection cap 50); manifest preview/download modal with rider, status, and date filters (today / this week / this month / custom range—**status activity date** on the server, not pickup date) and on-screen parcel details before optional PDF; batch filter is a **dropdown of batches** (not free-text batch id); parcel-list date filters remain batch **pickupDate**; pagination at `pageSize` 100 with previous/next when there are multiple pages. Prefer only needed filters (customer/order/status/township/rider/batch/date as appropriate)—not an oversized filter grid. Also covers assignments, return/status actions, reason-code prompts (including inline `DATE_CHANGE` badge for reschedule reasons), and sticker/manifest preview data that preserves both tracking number and original OS order ID. Phase 2 sticker identity format remains undecided and should not be treated as fixed in Phase 1.
  - Route `/operations` redirects to `/operations/dispatch`, preserving the query string (for example `batchId`).
  - **Implementation note:** Dispatch Queue implements multi-select, batch dropdown filter, pagination (`pageSize` 100 + prev/next), atomic bulk status (`POST /parcels/bulk-status`), bulk assign/reassign, role-gated inline rider/status editing, edit modal, multi-edit, Partial Return, link-parcels, OS Order ID–first row display, case-insensitive text filters, and multi-rider manifest preview/PDF with status and **status-activity** date filters (server caps 500 parcels / 50 riders; PDF embeds Myanmar font). Parcel-list date filters continue to use batch pickupDate. Finance OS pending-return recovery lives on Finance OS & riders (see §6.6 / §11); a dedicated **Ops** return-queue surface is available. `GET /operations/batches` (`listBatches`) is server-paginated/filtered and still exposes `advancePosted` (true when an unreversed `BATCH_PICKUP_ADVANCE` exists for the batch id or a versioned `batchId:…` sourceId).
- Settings: OS/rider/zone (and related) master-data forms; rider create/edit captures pay model and applicable commission % / monthly salary fields (§6.3). Salary settlement deduction and visible `RIDER_RECEIVABLE` salary lines are implemented per §6.7.
- Finance: two tabs—**Finance overview** (default) and **OS & riders** (`?tab=settlements`). Deep links open the settlements tab. Overview includes post-pickup advances, wallet/ledger balances, and related finance surfaces. OS & riders hosts OS account balances by shop and batch, split-wallet payment/credit application, payment history and correction, the pending-return Received action (Auditor read-only), read-only legacy settlement history, and rider outstanding balances, plus cashbook, reconciliation, day-close, ledger drill-down, and profit visibility.
- Reports: filterable tables/charts with export and detail links, including gross profit component breakdown. **Daily delivery status** uses `POST /operations/parcels/manifest/preview` (status + today/this week/this month/custom range on **status activity date**, optional rider) so hub settlement can review outcomes that occurred in the selected window; PDF download remains optional via `POST /operations/parcels/manifest`.

### Rider app

- Auth flow with bootstrap loading.
- Protected tabs: Home assignment summary, Profile, Settings.
- Home: assigned batch/parcel list, status actions, parcel detail, rider outstanding / settlement status, reason selection for Partial/Failed/Rejected, confirmation and offline/error states. Parcel list and detail present OS Order ID as the primary title when present (tracking number secondary); API identity is unchanged.
- Parcel list supports township filtering and township-based sorting so riders can work a route quickly and consistently, with search/sort that favors fast end-of-day completion over dense admin-style filters.
- Tap-to-call on customer phone numbers should open the device's native dialer / phone app, with an accessible fallback action when the platform cannot hand off directly to the dialer. Parcel rows should make the call action obvious and low-friction.
- Settings: theme and English/Myanmar toggle, logout, app/version information.

## 11. Key Workflows

### Pickup and advance

1. Dispatcher creates/imports a batch for one OS and exact pickup date.
2. Operations validates parcel data and confirms pickup.
3. Finance posts one idempotent `BATCH_PICKUP_ADVANCE` journal for the batch advance total (after reversal, versioned `sourceId` allows re-post). `listBatches` exposes `advancePosted` so the Finance overview post-pickup advances panel can hide already-posted batches.
4. Batch inventory and OS receivable update immediately.

### Assignment and delivery

1. Dispatcher filters eligible parcels by zone and assigns a rider.
2. System generates a versioned PDF manifest and assignment snapshot.
3. Rider opens assigned work and starts a way.
4. Rider records Delivered, Partial Return, Failed, or Rejected (or Superadmin / Operations Manager / Dispatcher sets any allowed status from the ERP **Dispatch Queue**, including corrections broader than rider-allowed transitions); exception outcomes require reason codes, and Partial Return additionally requires Actual COD Collected. ERP `OUT_FOR_DELIVERY` / outcome recording keeps one primary `DeliveryWay` (prefer current rider, else oldest open), closes other open ways with outcome `SUPERSEDED`, and creates a completed way when none is open. Reschedule reason codes raise `DATE_CHANGE` alerts.
5. ERP receives alert and updates inventory, collections, commission eligibility, and return queue.

### Pending return and OS recovery

1. Partial/Failed/Rejected enters `PENDING_RETURN` with due date = entry date + four hub-timezone calendar days (Partial may remain `PARTIAL` until finance/ops resolution; finance recovery queue also includes `PARTIAL` / `FAILED` / `REJECTED` before or without that intermediate status).
2. Operations monitors and resolves overdue returns via **Dispatch Queue** parcel status (`/operations/dispatch`) and/or a dedicated Ops return-queue surface when present; overdue Pending Return alerts surface on **All Batches**. Authorized Ops users may still move `PENDING_RETURN → RETURNED` when the parcel is physically returned to the hub; timer extensions remain audited as already specified.
3. At due time, system alerts operations (All Batches alerts) and presents return action if still pending.
4. **Finance OS recovery:** authorized Finance users (and Superadmin / Operations Manager) confirm physical return via **Received** (`POST /finance/os-returns/receive`, with idempotency key). The action atomically sets `RETURNED` and records a return credit for that batch; it does not credit a wallet. Auditor may view the queue but cannot receive returns.
5. Finance OS & riders presents OS account balances, record-payment and account-history actions, and the read-only legacy settlement history. Cash/KBZ Pay/Wave Pay payments and available return credits reduce selected batch payables through the simplified OS account (§6.6).
6. `DELIVERED` marks the rider's collection obligation, but the outstanding balance is only cleared when the evening settlement is manually recorded and verified; the delivered status itself must not be treated as remittance received.

### Bulk dispatch and linked delivery
1. Dispatcher opens **Dispatch Queue**, filters unassigned parcels by batch (batch dropdown), rider, assignment status, zone/township, customer/order/tracking (case-insensitive), and date range (**batch pickupDate** on the parcel list).
2. Dispatcher selects eligible parcels, chooses a rider, and submits one atomic bulk assignment.
3. System validates hub scope, rider eligibility, parcel state, and duplicate/concurrent assignment conditions, then generates a PDF manifest (multi-rider selection supported in the download modal; manifest/Reports date filters use status activity date; PDF embeds Myanmar font).
4. Dispatcher links two to 20 eligible unlinked parcels to one responsible rider; address and fee matching are not required, but `DELIVERED` and `RETURNED` parcels are excluded.
5. System stores linked-group metadata and applies the highest member fee plus 1,000 MMK for each additional parcel to delivery-fee revenue and customer COD receivable calculations.
6. Rider sees linked parcels grouped together; commission is calculated from the adjusted linked-group delivery fees.
7. Rider settlement includes linked-group fees/commission only when every group member is `DELIVERED`; incomplete groups do not fall through to individual member fees in settlement totals.
8. Riders can filter parcels by township and sort them by township in the mobile app; list/detail UI favors OS Order ID when present.
9. Tap-to-call from the rider app opens the native phone dialer or provides an accessible fallback when direct dialing is unsupported.

### Rider evening settlement

1. System calculates compensation under the rider’s pay model (daily successful-delivery commission and/or daily pro-rata salary deduction `floor(monthlySalary / daysInMonth)` per §6.7), returns `salaryDeduction` on preview, and computes expected amount owed as `cod + fees - commission - salaryDeduction`.
2. Rider declares remittances by Cash, KBZ Pay, or Wave Pay; manual settlement can split a single rider handover across multiple wallets (for example Cash 100,000, KBZ Pay 100,000, Wave Pay 200,000). Salary (when applicable) is deducted from the collected total and shown as auditable `RIDER_RECEIVABLE` settlement journal lines (credit remittance-before-salary, debit salary deduction).
3. Cashier verifies references/counts and records actual amounts.
4. Variances require reason and authorization; settlement is locked after posting.
5. The rider-facing outstanding balance remains visible until this manual settlement is posted and verified.

### Cashbook day-close

1. Cashier reviews each wallet’s opening, movements, transfers, expected closing, and physical/digital verified balance.
2. System flags missing settlements, unposted events, and variances.
3. Cashier submits close; authorized manager approves exceptions.
4. System locks the business date and emits a close summary. Reopen requires Superadmin and creates a compensating audit trail.

## 12. Permissions Matrix

| Capability | Superadmin | Ops Manager | Finance | Dispatcher | Rider | Auditor |
|---|---:|---:|---:|---:|---:|---:|
| Manage users/roles/config | Full | View | View | No | No | View |
| Manage OS/zones/riders | Full | Full | View | Limited | Own profile | View |
| Create/import batches/parcels | Full | Full | View | Full | No | View |
| Assign/reassign riders | Full | Full | View | Full | No | View |
| Update parcel outcomes (ERP Operations + rider app) | Full (all statuses from ERP) | Full (all statuses from ERP) | View | Full (all statuses from ERP) | Own assigned (permitted outcomes only) | View |
| Edit OS settlement lines / return deductions (draft + posted with audit) | Full | Approve | Full | No | No | View |
| Finance OS pending-return receive (`POST /finance/os-returns/receive`) | Full | Full | Full | No | No | View (list only) |
| Post advances/OS settlements | Full | Approve | Full | No | No | View |
| Post rider settlements | Full | Approve | Full | No | Declare own | View |
| Cashbook close/reopen | Full | Approve | Close | No | No | View |
| Reverse financial entries | Full | Request/approve | Request | No | No | View |
| View/export reports | Full | Hub | Hub | Operations | Own | Granted scope |
| Acknowledge alerts | Full | Full | Finance alerts | Operations alerts | Own notices | No |

Enforce least privilege, separation of duties for close/reversal where possible, and immutable audit logs for every permission-sensitive action.

## 13. Non-Functional Requirements

- **Correctness:** balanced double-entry journals, idempotent money commands, transactional status/ledger updates, no floating-point money math.
- **Security:** JWT claim validation, hashed passwords, secure secret handling, CORS allowlist, rate limiting, input validation, authorization at API boundary, auditability, and safe error responses.
- **Reliability:** graceful shutdown, database transaction boundaries, retry-safe commands, health/readiness endpoints, structured logging, and alert delivery retry/dead-letter handling.
- **Performance:** indexed operational queries, pagination, bounded exports, background jobs for large imports/PDFs/reports, and no unbounded dashboard queries.
- **Availability:** define target uptime and backup/RPO/RTO before production; PostgreSQL backups must be encrypted and restore-tested.
- **Accessibility/localization:** keyboard-accessible web UI, mobile screen-reader labels, English/Myanmar coverage, locale-aware dates/numbers, and consistent hub timezone.
- **Observability:** request IDs, audit IDs, structured logs, metrics for failed transitions/settlements/day-close, and error monitoring with sensitive data redaction.
- **Privacy:** minimize customer data, restrict access by role/hub, encrypt transport and managed storage, define retention/deletion policy, and avoid customer data in logs.

## 14. Architecture

Use three independent applications with separate dependency manifests and configuration; do not use a monorepo:

```text
frontend/    # React + Vite + TypeScript
backend/     # Express + TypeScript + Prisma
mobile/      # React Native + Expo + Expo Router
```

The API is the authoritative boundary for business rules and ledger posting. Web and rider clients use typed API contracts, React Query for server state, React Hook Form for forms, and one auth abstraction each. Domain modules should separate parcel operations, accounting, settlements, reporting, alerts, identity, and master data. Use an outbox/event mechanism or transactional alert creation so Partial/Failed events cannot commit without their alert record. Use WebSocket/SSE or short polling for ERP alerts based on deployment constraints; the database event remains authoritative.

## 15. Implementation Milestones

1. **Foundation:** repository layout, shared conventions, environment validation, CI, lint/typecheck/test harnesses, API versioning, app shells, providers, localization, theme, and auth skeleton.
2. **Identity and master data:** users/roles/permissions, hubs, OS, riders (including pay model `PERCENTAGE` / `SALARY` / `SALARY_PLUS_PERCENTAGE`), zones, reason codes, JWT sessions, audit logging.
3. **Parcel operations:** batch import, parcel model, lifecycle/state machine, ERP All Batches + Dispatch Queue split (alerts on All Batches; dense Dispatch Queue with inline assign/status, multi-edit, multi-rider manifest), all-status actions for Superadmin/Operations Manager/Dispatcher, assignment, rider app tabs, manifests, alerts, and return timer/queue resolution.
4. **Ledger core:** accounts/wallets, journal posting, pickup advances, delivery collections, commission and salary-from-remittance calculation (cashbook-visible), OS receivables/deductions, and immutable reversals / compensating adjustments.
5. **Settlements:** rider settlement by wallet, simplified OS accounts with payment/credit history and non-destructive payment correction, read-only legacy settlement history after cutover, reconciliation, cashbook, day-close/reopen controls, variance approvals, and finance reports.
6. **Reporting and hardening:** daily/monthly/profit (with component breakdown)/OS/rider/return reports, exports, performance indexes, security review, backup/restore drill, observability, localization QA, accessibility QA, and end-to-end acceptance tests.
7. **Phase 2:** configurable parcel sticker templates with barcode/QR identity, human-readable tracking data, original OS `Order ID`, customer name, COD amount, print layout, and audit/versioning. The final barcode/QR identity format and generation strategy remain to be decided later.

## 16. Acceptance Criteria

- Every monetary business event is represented by balanced, queryable journal lines and cannot be posted twice.
- A rejected/failed/returned parcel earns zero rider commission and is visible in the correct return/settlement calculations. Salary-bearing pay models still follow the configured salary rules without inventing commission on those outcomes.
- Operations can resolve Pending Returns via Operations return queue / parcel status (`PENDING_RETURN → RETURNED`). Finance can confirm physical return-to-OS via **Received** on the OS & riders pending-return panel (`FAILED` / `REJECTED` / `PENDING_RETURN` / `PARTIAL` → `RETURNED`), creating a batch return credit without a wallet credit. The OS account applies that credit and split-wallet OS payments to batch COD payables; payment corrections are non-destructive and legacy settlement history is read-only after cutover.
- `DELIVERED` parcels create outstanding rider receivables until a manual evening settlement is recorded and verified; this is visible in the rider app and on the finance overview rather than inferred from the parcel status alone.
- Superadmin, Operations Manager, and Dispatcher can set any allowed parcel status from the ERP Dispatch Queue with attributable status history; riders remain limited to permitted delivery outcomes.
- ERP shows gross profit with visible components on Finance/Reports and/or Dashboard (Phase 1 requirement; the component report and breakdown UI are implemented).
- Partial Return requires a validated Actual COD Collected amount, posts at most one unreversed OS shortfall offset / collection pair (`OS_PARTIAL_RETURN_ADJUSTMENT` / `PARTIAL_RETURN_COLLECTION`, versioned `sourceId` after reversal), and preserves the original and adjusted values.
- Status override leaving `DELIVERED`/`PARTIAL` while unreversed money journals remain is rejected with `409 MONEY_POSTED` (parcel-scoped including versioned `parcelId:…` and `LINKED_RIDER_RECEIVABLE_COD`; group-scoped `LINKED_*` including versioned `groupId:…`). After reversal, delivery collection and related money events re-post with versioned sourceIds; duplicate open `DeliveryWay` rows are closed with outcome `SUPERSEDED` while one primary way carries the real outcome.
- Partial and Failed actions require reason codes and produce ERP alerts for Superadmins and Operations Managers; reschedule/date-change reason codes (`DATE_CHANGE`, `DELIVERY_DATE_CHANGE`, `RESCHEDULE`) produce alert type `DATE_CHANGE`.
- Bulk dispatch validates the complete selection atomically, records assignment history, and produces a manifest PDF (Myanmar font embedded; Reports/manifest date range = status activity date; Dispatch Queue parcel-list dates = batch pickupDate).
- Linked parcels use the base-plus-1,000-MMK fee rule and calculate rider commission from the adjusted linked-group fee.
- Parcel import/create flows preserve a unique `trackingNumber` identifier and permit duplicate OS `Order ID` values within the same batch without uniqueness errors. Dispatch Queue and rider app UIs present OS Order ID prominently when present; the spec does not require a branded `LTY-[YYMMDD]-[Sequence]` policy in Phase 1.
- Phase 2 sticker and manifest layouts preserve both tracking data and original OS `Order ID` with COD amount, but the final barcode/QR identity format is not fixed yet.
- Pending Return defaults to four days, supports audited extensions, and cannot silently expire or disappear.
- Rider settlement formula (including daily pro-rata salary deduction and incomplete linked-group fee exclusion) and wallet remittances reconcile to a locked daily cashbook close.
- Rider app supports township filtering/sorting and native-dialer tap-to-call for customer phone numbers with an accessible fallback path, with a quick route-friendly list layout.
- Web and mobile protected routes wait for verification, handle expiry safely, and never trust client-side JWT decoding.
- English/Myanmar translations cover all visible starter UI and persisted toggles work across restarts.
- Unit and integration tests cover ledger invariants, auth, validation, workflows, permissions, errors, and critical UI behavior.

## 17. Current Implementation Status

- `backend/`: Express + Prisma API with JWT auth, English/Myanmar errors, validation, and targeted Jest/Supertest coverage. Implemented behavior includes server-paginated batches, atomic dispatch actions, a three-day overdue-unsent queue, OS batch obligations and simplified OS account payments/credits with non-destructive correction, return-to-OS credits, read-only legacy settlement history after cutover, detailed reports, ledger, reconciliation, cashbook, reopen, and salary paths. Remaining work is external/manual: production PostgreSQL deploy/restore verification, real-time alert transport, observability, backups, and broader integration coverage.

- `frontend/`: Vite/React/TypeScript ERP shell with protected routes, verified-token auth bootstrap, persisted JWT auth, English/Myanmar translations, theme persistence, finance and report surfaces, atomic dispatch, parcel field audit UI, All Batches and Dispatch Queue navigation, and the public `/app` rider download page with a direct APK link. The app also exposes the authenticated `/rider-app` route and the current finance/settlement workflows described in the implemented backend slice. Remaining work is manual QA and release verification: device/accessibility checks, real APK signing/install validation, and production observability/backup readiness.

- `mobile/`: Expo/React Native/TypeScript rider app with protected routes, verified-token auth bootstrap, phone/email/username login, persisted theme and language settings, parcel workflow screens, and APK update/download manifest handling. The mobile app now reflects the current auth and parcel flow behavior instead of the earlier login and route gaps. Remaining work is signed APK build/install verification, real-device QA, and broader end-to-end regression coverage.

- `Current blockers kept open`: production PostgreSQL deploy/restore verification, real-time alert transport, signed APK build/install/device QA, observability and backup/restore drills, and broader end-to-end coverage on production-like environments.
