# Architecture Reference

Keep `app/` focused on route composition and screens; keep providers, API functions, query hooks, auth state, theme, i18n, and reusable source-owned controls under `src/`. Root `_layout.tsx` owns provider composition and protected route groups. `(tabs)/_layout.tsx` owns the default tabs and translated tab options. Use Expo Router’s current protected routes rather than hand-written redirect races when the selected SDK supports them; otherwise implement a single auth gate with an explicit bootstrap loading state.

Create one QueryClient outside render, configure retries deliberately, and integrate online/focus managers with Expo app state/netinfo only if those packages are already accepted. Keep tokens out of logs, URLs, AsyncStorage, translation files, and non-secure environment variables.
