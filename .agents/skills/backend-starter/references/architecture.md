# Architecture Reference

Keep `app.ts` importable without starting a server so Supertest can exercise it. Let `server.ts` own listening, signal handling, and Prisma disconnect. Register middleware in this order: request ID, security/body parsing, language, CORS, routes, not-found, error handler. Keep controllers thin and services testable through injected dependencies where practical. Use one Prisma client in runtime and explicit test setup/teardown.

Prefer typed `Result`/domain errors or `ApiError` mapping over controller-specific ad hoc status logic. Keep response localization at the HTTP boundary while services return stable error codes. Never place secrets, passwords, or raw authorization headers in logs.
