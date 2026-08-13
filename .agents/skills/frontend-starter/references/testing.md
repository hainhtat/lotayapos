# Testing Reference

Use Vitest with a DOM environment, React Testing Library, `@testing-library/user-event`, and DOM matchers. Provide `renderApp` with a memory router, fresh test QueryClient with retries disabled, deterministic local i18n, and auth/theme providers. Reset handlers, mocks, DOM, and storage after every test.

Assert observable behavior through roles, labels, and accessible names. Avoid snapshots, sleeps, real APIs, and mocking Query, Router, or Hook Form internals. Include auth races: concurrent 401 requests cause one refresh; failed refresh settles callers and clears the session. Cover routes, forms, providers, theme/language persistence, translation fallback, not-found, and representative query success/error paths.
