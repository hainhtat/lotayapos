---
name: frontend-starter
description: Scaffold or modernize a production-minded Vite React TypeScript SPA with Vitest, TanStack React Query, React Router, React Hook Form, shadcn/ui, Tailwind CSS, Lucide icons, light/dark mode, English/Myanmar localization, and JWT authentication. Use when asked to bootstrap a frontend starter, app shell, auth flow, or tested React SPA.
---

# Frontend Starter

This skill is an implementation specification. It does not provide or build a pre-made application. When invoked, inspect the target repository first, preserve compatible conventions, and use current stable package releases after checking `references/official-sources.md`.

## Required stack

- Vite with the React + TypeScript template.
- React, strict TypeScript, Vitest, React Testing Library, `user-event`, and DOM matchers.
- TanStack React Query with one application `QueryClient`.
- React Router Data Mode with `createBrowserRouter` and `RouterProvider`.
- React Hook Form for login and registration forms.
- shadcn/ui source-owned primitives, Tailwind CSS v4 Vite integration, and Lucide React named imports.
- `i18next` and `react-i18next` with local English and Myanmar JSON resources.

Do not pin versions from this document. Follow current official installation instructions and keep mutually compatible versions.

## Deliverable

Create a minimal, accessible empty app shell containing:

- `AppProviders` composing theme, query, auth, i18n, and router concerns without duplicate state ownership.
- Public `/login` and `/register` routes.
- Protected `/`, `/profile`, and `/settings` routes inside an `AppLayout`.
- A semantic responsive header with active navigation, account/logout action, light/dark/system theme toggle, and English/Myanmar language toggle.
- A translated not-found route and translated loading, validation, auth, theme, navigation, and error copy.
- `.env.example` with only non-secret `VITE_API_BASE_URL` configuration.

Suggested source boundaries are documented in `references/architecture.md`. Keep pages intentionally empty; do not add sample business data or speculative features.

## Authentication contract

Treat JWT authentication as a backend integration. The backend owns password hashing, token issuance, cryptographic verification, claim validation, refresh rotation, revocation, and authorization. The frontend must never sign tokens or call decoded browser claims “verified”. Read `references/authentication.md` before implementing auth.

Default, replaceable endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/verify`, and `POST /auth/logout`.

Prefer Secure, HttpOnly, SameSite cookies with `credentials: "include"`. If the backend explicitly returns an access token to JavaScript, keep it in memory and send a Bearer header; do not persist tokens unless the security tradeoff is explicitly accepted. Bootstrap with `/auth/verify`, represent loading/authenticated/anonymous states, coordinate one refresh promise for concurrent 401s, replay once, clear protected query data on invalidation/logout, and sanitize relative return paths.

## Localization and theming

Keep resources local and synchronous in tests. Include at minimum:

```text
src/i18n/locales/en/{common,auth,pages}.json
src/i18n/locales/my/{common,auth,pages}.json
```

Persist language and theme under app-specific keys. Support `light`, `dark`, and `system`; apply the resolved class to the document root and listen for system preference changes. Set document `lang` and `dir`. Every user-visible string, including form errors and icon-only labels, must use translation keys.

## Testing and verification

Read `references/testing.md`. Add behavioral tests for smoke rendering, translated Home, header navigation, protected-route bootstrap/redirect, login and registration validation/submission/errors, verify restoration, coordinated refresh/no loop, logout cleanup, theme persistence/system mode, language persistence/fallback, not-found, and accessible icon controls. Use a fresh QueryClient and deterministic local i18n per test; mock HTTP at the network boundary with MSW when no repository standard exists.

Expose and run the repository-equivalent `lint`, `typecheck`, `test --run`, and `build` commands. Report assumptions and the backend contract; do not claim backend JWT verification was implemented in the browser.
