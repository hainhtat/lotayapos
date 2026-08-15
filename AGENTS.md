# Agent and skill roster

`PROJECT_SPEC.md` is the product and domain source of truth for this repository.

## Spec maintenance (mandatory)

`PROJECT_SPEC.md` must stay the single source of truth. Parent agents and other specialists must **not** edit it themselves.

| When | Action |
| --- | --- |
| Spec must change for any reason (intentional deviation, post-ship sync, user asks to update the spec, documenting a closed gap) | **Always** call `/spec-maintainer` (Task `subagent_type="spec-maintainer"`) |
| Implementation diverges from the spec on purpose | Call out the conflict, implement only if the user directed it, then run `/spec-maintainer` to sync |
| Unclear whether the product rule changed | Ask the user; do not invent or silently rewrite the spec |

Spec Maintainer updates `PROJECT_SPEC.md` from repository evidence only — no invented requirements.

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
| `spec-maintainer` | **Only** agent allowed to edit `PROJECT_SPEC.md`; sync to intentional implementation / evidence |

## Codex agents (`.codex/agents/`)

Keep the original TOML agents for Codex. Cursor uses the markdown copies in `.cursor/agents/`. When changing agent policy, update both (or regenerate the Cursor copies from TOML).

## Parent-agent expectations

1. Read `PROJECT_SPEC.md` before domain decisions.
2. Prefer existing skills over inventing stack conventions.
3. Delegate to specialists for separable workstreams; run `test` / `verifier` (and `auditor` for money/auth risk) before claiming done.
4. Do not invent ledger, permission, or API behavior; ask or state a bounded assumption.
5. **Never edit `PROJECT_SPEC.md` directly** — always delegate to `/spec-maintainer` when the source of truth must be adjusted.
