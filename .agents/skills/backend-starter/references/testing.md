# Testing Reference

Configure Jest for TypeScript through the repository's supported transformer/runtime and run with an isolated SQLite `DATABASE_URL`. Use Supertest against the exported app, not a bound port. Reset database state per suite or transaction, clean mocks, and restore environment variables after tests.

Required assertions include: successful and duplicate registration; invalid/missing fields; login success and generic failure; valid, expired, malformed, wrong-audience, and wrong-algorithm JWTs; verify and logout; protected-route 401/403; localized `en`/`my` messages and fallback; CORS allow/deny; 404; normalized unexpected errors; Prisma constraint mapping; and request IDs. Unit tests should cover services and pure utilities without mocking the behavior under test.
