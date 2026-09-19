# Architecture refactoring plan

## Objective

Replace the Finance, Dispatch, and Batch Detail monoliths with cohesive domain modules while preserving every product rule in `PROJECT_SPEC.md`. Moving lines is not completion: a phase succeeds only when callers use the new interfaces, duplicated rules are removed, and the original monolith is deleted or reduced to a temporary compatibility barrel with no implementation.

## Non-negotiable invariants

- No route, response shape, role permission, hub scope, translation, or user workflow changes unless separately approved.
- Money remains integer MMK; journals remain balanced, immutable, attributable, and idempotent.
- Existing imports may use temporary compatibility re-exports during migration, but production callers must move to the owning module before a phase closes.
- No generic repository layer or interface is introduced for a single adapter.
- `PROJECT_SPEC.md` is not changed by this work.

## Baseline and targets

| Area | Baseline | Target orchestration module | Completion signal |
| --- | ---: | ---: | --- |
| `finance.service.ts` | 2,287 lines | no implementation; compatibility barrel deleted or under 100 lines temporarily | every exported command/query has one domain owner |
| `operations-page.tsx` | 1,842 lines | under 350 lines | page contains layout and coordination, not request bodies or modal implementations |
| `batch-detail-page.tsx` | 1,029 lines | under 350 lines | import, parcel editing, and manifest review are independently testable |
| `finance.routes.ts` | dense inline validation | route wiring only | validation schemas live beside their feature |

Line targets are guardrails, not the definition of quality. Cohesion, dependency direction, and behavior tests decide completion.

## Dependency direction

```text
routes/controllers -> domain command/query modules -> Prisma + ledger helpers
pages -> feature hooks -> API client
pages -> focused view modules -> shared UI primitives
```

Domain modules may depend on shared authorization, dates, ledger posting, and calculation helpers. Shared helpers must not import a domain command module. Feature view modules must not issue API calls directly.

## Phase 1 — Finance decomposition

### Target modules

```text
backend/src/services/finance/
  authorization.ts
  rider-settlements.ts
  rider-outstanding.ts
  os-settlements.ts
  os-returns.ts
  expenses.ts
  cashbook-postings.ts
  cashbook-close.ts
  ledger-summary.ts
  settlement-calculations.ts
backend/src/validators/finance/
  rider-settlements.ts
  os-settlements.ts
  cashbook.ts
  expenses.ts
```

### Migration slices

1. **Shared seams** — settlement calculations and finance authorization/hub scope. Status: complete, pending relocation into the final folder structure.
2. **OS settlement lifecycle** — move preview, drafts, posting, listing, amendment, reversal, and their private helpers as one cohesive module. Do not separate pure helpers from the command flow merely to reduce line count.
3. **OS returns** — move pending-return queries, individual/bulk receipt, replay/idempotency logic, and return journal integration.
4. **Rider accounting** — move outstanding aggregation, preview/declaration/posting, salary/commission application, receipt history, and mismatch rules.
5. **Cashbook** — split posting commands from close/approve/reopen workflow; expenses own their categories, queries, and posting command.
6. **Ledger summary** — isolate the aggregate read model.
7. **Validation and callers** — move validators; update controllers and other services to import the owning modules directly.
8. **Remove the monolith** — delete `finance.service.ts`. A short-lived re-export barrel is allowed during slices 2–7, but contains no implementation and is deleted before Phase 1 closes.

### Finance acceptance gates

- Authorization/hub rules have one owner and explicit tests for Superadmin, hub-scoped Finance, inactive users, cross-hub access, and organization-wide Auditor reads.
- Each money command has behavior tests for happy path, authorization, idempotent replay/conflict, closed day, and balanced posting where applicable.
- No finance domain module exceeds 600 lines without a documented reason based on cohesion.
- No production module imports `finance.service.ts`.
- Full backend test, typecheck, lint, and build pass.

## Phase 2 — Dispatch workspace decomposition

### Target modules

```text
frontend/src/features/dispatch/
  dispatch-types.ts
  dispatch-filters.ts
  use-dispatch-data.ts
  use-dispatch-commands.ts
  dispatch-queue-tabs.tsx
  dispatch-filter-panel.tsx
  dispatch-table.tsx
  bulk-actions.tsx
  parcel-edit-dialog.tsx
  assignment-dialog.tsx
  manifest-dialog.tsx
  return-handover-dialog.tsx
```

### Migration order

1. Define shared feature types and retain the tested URL filter interface.
2. Move read queries into `use-dispatch-data`; query keys and enablement remain visible through that interface.
3. Group mutations by user command in `use-dispatch-commands`; centralize invalidation rules there.
4. Extract the table and queue/filter controls using data and callbacks only.
5. Extract dialogs one workflow at a time with semantic component tests.
6. Reduce the page to role-aware orchestration, selection state, and layout.

### Dispatch acceptance gates

- Page contains no raw API path, request payload, or query invalidation logic.
- URL filters round-trip and browser navigation remain covered.
- Assignment, status change, paid-to-OS, reschedule, return handover, link/unlink, and bulk workflows each retain behavior tests.
- No extracted view module owns server state independently of the feature hooks.
- Full frontend test, typecheck, lint, and build pass.

## Phase 3 — Batch Detail decomposition

### Target modules

```text
frontend/src/features/batches/detail/
  batch-detail-types.ts
  parcel-draft-rules.ts
  use-batch-detail.ts
  batch-summary.tsx
  parcel-entry-form.tsx
  parcel-table.tsx
  manifest-import-dialog.tsx
  manifest-review-table.tsx
```

### Acceptance gates

- Parsing, normalization, township consistency, and draft restoration live in a pure rules module with boundary tests.
- Import upload/review/apply is isolated from manual parcel entry.
- The page contains no direct API request construction.
- Draft persistence and failed import recovery retain regression coverage.
- Full frontend quality gates pass.

## Phase 4 — Shared UI and cleanup

- Adopt shared controls during feature extraction when two or more workflows share the same interface.
- Consolidate parcel-table behavior only after Dispatch and Batch modules expose matching needs; do not force a universal table abstraction.
- Remove compatibility exports, dead code, duplicate types, obsolete tests, and stale comments.
- Record final module sizes and dependency checks against the baseline.

## Per-slice workflow

1. Identify the behavior and current callers.
2. Add or locate tests at the public interface.
3. Move the cohesive implementation and private helpers together.
4. Update callers to the owning module.
5. Delete the old implementation immediately; do not keep two sources of truth.
6. Run focused tests, typecheck, lint, and `git diff --check`.
7. At phase boundaries, run all frontend/backend tests and production builds.

## Definition of done

The refactor is complete only when all phase acceptance gates pass, the three monoliths meet their orchestration targets, `finance.service.ts` is removed, no temporary compatibility import remains, and the full repository validation is green. Test counts or line reductions alone do not qualify as architectural completion.
