# Testing Reference

Use the repository’s Expo-compatible Jest preset and React Native Testing Library. Provide a `renderApp` helper with a fresh QueryClient, deterministic local i18n, theme, and auth providers. Reset mocks, storage, and network handlers after each test. Test observable behavior with roles, labels, text, and user interactions; avoid snapshots, sleeps, real APIs, and mocking Router/Query internals.

Cover tab labels and navigation, translated Home, auth bootstrap and protected deep links, form validation and server errors, token verification/refresh races, logout cleanup, theme and locale persistence/fallback, not-found, and accessibility names for icon-only controls. Keep tests independent of network connectivity and device locale.
