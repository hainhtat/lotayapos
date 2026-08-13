# Architecture Reference

Recommended structure:

```text
src/app/{providers,router,query-client}.ts(x)
src/components/{ui,app-header,mode-toggle,language-switcher}.tsx
src/features/auth/{api,auth-provider,auth-guard,queries,types,login-page,register-page}.tsx
src/layouts/app-layout.tsx
src/pages/{home,profile,settings,not-found}-page.tsx
src/lib/{api-client,env}.ts
src/i18n/index.ts
src/i18n/locales/{en,my}/{common,auth,pages}.json
src/test/{setup,render}.tsx
```

Compose `StrictMode > ThemeProvider > QueryClientProvider > AuthProvider > RouterProvider`. Initialize i18n before rendering. Use route loaders only for guards/redirect orchestration, not as a second server cache. Keep query keys centralized, API transport in one client, and feature APIs in hooks. Use shadcn components as source-owned code and configure the `@/*` alias consistently in TypeScript, Vite, Vitest, and shadcn.
