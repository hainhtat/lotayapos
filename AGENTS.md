# Agent and skill roster

`PROJECT_SPEC.md` is the product and domain source of truth for this repository.

## Skills (Cursor + Codex)

Already available under `.agents/skills/` — Cursor discovers these without copying:

| Skill | When to use |
| --- | --- |
| `backend-starter` | Bootstrap or standardize Express/Prisma API patterns |
| `frontend-starter` | Bootstrap or standardize Vite React ERP patterns |
| `mobile-starter` | Bootstrap or standardize Expo rider app patterns |
| `test` | Write and run a small high-value test set for a change |

## Cursor subagents (`.cursor/agents/`)

Ported from `.codex/agents/*.toml` so Cursor can delegate with `/name` or Task:

| Agent | Role |
| --- | --- |
| `orchestrator` | Plan, delegate, verify multi-step work |
| `backend-developer` | API, Prisma, ledger, auth |
| `frontend-developer` | ERP web UI |
| `mobile-developer` | Rider Expo app (Cursor addition; pairs with `mobile-starter`) |
| `test` | Focused tests for changed behavior |
| `test-reviewer` | Coverage vs spec; may edit tests only |
| `verifier` | Readonly correctness check vs `PROJECT_SPEC.md` |
| `auditor` | Readonly security/performance/reliability report under `audit/reports/` |
| `spec-maintainer` | Sync `PROJECT_SPEC.md` to intentional implementation |

## Codex agents (`.codex/agents/`)

Keep the original TOML agents for Codex. Cursor uses the markdown copies in `.cursor/agents/`. When changing agent policy, update both (or regenerate the Cursor copies from TOML).

## Parent-agent expectations

1. Read `PROJECT_SPEC.md` before domain decisions.
2. Prefer existing skills over inventing stack conventions.
3. Delegate to specialists for separable workstreams; run `test` / `verifier` (and `auditor` for money/auth risk) before claiming done.
4. Do not invent ledger, permission, or API behavior; ask or state a bounded assumption.
