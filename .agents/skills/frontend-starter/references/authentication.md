# Authentication Reference

The server is the trust boundary. It must verify JWT signatures with an allow-listed algorithm and validate `iss`, `aud`, `exp`, `nbf`, subject, and token type. Browser payload decoding is display-only and never verification.

Use cookie credentials by default and coordinate CSRF protection with the backend. Never expose signing keys, refresh secrets, tokens in URLs, logs, analytics, translation resources, or `VITE_*` variables. Normalize non-2xx responses into typed errors. Handle 401 with one shared refresh promise and one replay; never recursively refresh verify/refresh/logout requests. Handle 403 as forbidden, not as a refresh trigger. Clear user state, sensitive forms, and protected query caches when the session ends.
