---
name: mobile-starter
description: Create or modernize a production-minded React Native mobile app using Expo, Expo Router, Expo UI, TypeScript, TanStack React Query, React Hook Form, standard Expo tooling, light/dark themes, English/Myanmar localization, and JWT authentication. Use when asked to bootstrap or standardize an Expo mobile app.
---

# Mobile Starter

This skill is an implementation specification, not prebuilt app code. Inspect the target repository first, preserve compatible conventions, and use the current Expo SDK-compatible package versions from official docs. No dedicated third-party UI library is permitted: use React Native primitives, Expo UI, and small source-owned components.

## Stack and tooling

- React Native with Expo managed workflow and TypeScript strict mode.
- Expo Router with file-based routes and a default bottom tab layout.
- Expo UI (`@expo/ui`) for native controls where appropriate; React Native primitives for layout and text.
- TanStack React Query with one `QueryClient`; integrate React Native online/app-focus behavior where needed.
- React Hook Form for auth forms.
- Standard Expo commands and tooling: `npx expo start`, `expo install`, `expo lint`, `expo doctor`, platform builds through EAS only when requested.
- `expo-localization` plus a local translation solution such as `i18next`/`react-i18next` or `i18n-js`.

Do not pin versions in this skill. Use `npx expo install` for Expo packages and keep all packages aligned with the selected SDK.

## Deliverable

Create a minimal empty app with:

- Root providers for theme, query, auth, and localization.
- Public register and login screens.
- Protected Expo Router routes using `Stack.Protected` or the current documented protected-route pattern.
- A `(tabs)` group with Home, Profile, and Settings tabs, using translated labels and accessible native/Lucide-compatible icons without a UI kit.
- A light/dark/system theme provider and toggle, persisted under an app-specific storage key.
- English and Myanmar translation files, a language toggle, persisted preference, fallback language, and locale-aware device default.
- A translated loading state, not-found screen, validation errors, auth errors, and empty page copy.

Keep screens intentionally sparse. Do not add sample business data, a design system dependency, or backend implementation.

## Suggested structure

```text
app/
  _layout.tsx
  login.tsx
  register.tsx
  +not-found.tsx
  (tabs)/
    _layout.tsx
    index.tsx
    profile.tsx
    settings.tsx
src/
  providers/{app-providers,theme,auth,query}.tsx
  features/auth/{api,types,forms,queries}.ts(x)
  components/{app-header,theme-toggle,language-toggle,button,text,input}.tsx
  lib/{api-client,secure-storage,env}.ts
  i18n/{index,types}.ts
  i18n/locales/{en,my}/{common,auth,pages}.json
  test/{setup,render}.tsx
```

## Auth and token verification

The backend is the trust boundary: it hashes passwords, signs JWTs, verifies signatures and claims, rotates/revokes refresh sessions, and authorizes requests. The app must never sign tokens or treat decoded payloads as verified. Prefer short-lived access tokens in memory and refresh tokens in platform secure storage only when the backend contract requires client-readable tokens; otherwise prefer secure cookie/session mechanisms supported by the target platform.

Isolate the API client and default endpoints `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/verify`, and `POST /auth/logout` so field names are replaceable. Bootstrap auth before rendering protected screens, expose loading/authenticated/anonymous states, coordinate one refresh promise for concurrent 401s, replay once, clear protected query caches on logout, and handle deep links/return paths safely. Verify server-side claims including algorithm, issuer, audience, expiry, not-before, subject, and token type.

## Theme, localization, and accessibility

Use a theme context with semantic colors and `useColorScheme`; apply the selected light/dark palette consistently to React Native and Expo UI components. Persist user choice and provide a translated toggle with an accessible label. Use local synchronous translation resources in tests, persist `en`/`my`, set fallback to English, and use `expo-localization` for the initial device locale. Set web `lang` when web is supported; Myanmar is LTR, but keep direction handling extensible. Every visible string, tab title, validation message, and control label must be translated.

Meet mobile accessibility basics: labels and hints for inputs, sufficient touch targets, focus/keyboard behavior, screen-reader names for icon controls, safe-area handling, dynamic text where practical, and visible pending/error states.

## Testing and verification

Read `references/testing.md`. Add tests for provider/smoke rendering, tab navigation, theme persistence and system changes, language switching/fallback, protected-route loading/success/redirect, login and registration validation/submission/errors, verify restoration, coordinated refresh/no loop, logout cleanup, not-found, and accessible controls. Mock network calls at the boundary; do not mock Expo Router or React Query internals.

Run repository-equivalent typecheck, lint, Jest tests, and Expo validation/doctor commands where available. Report the selected Expo SDK, assumptions, API contract, secure-storage choice, and any native build prerequisites. When this skill is being authored or reviewed, do not build an app.
