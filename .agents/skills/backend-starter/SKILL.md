---
name: backend-starter
description: Create or modernize a production-minded versioned REST API using TypeScript, Express, Prisma, SQLite for local development and tests, PostgreSQL for production, express-validator, CORS, Jest, Supertest, ESLint, typescript-eslint, tsx watch mode, JWT auth, and English/Myanmar responses. Use when asked to bootstrap or standardize an Express backend.
---

# Backend Starter

This is an implementation specification, not prebuilt application code. Inspect the target repository first, preserve compatible conventions, and use current mutually compatible releases after checking `references/official-sources.md`.

## Stack and scripts

- TypeScript in strict mode; Express 5; Node 18+; `tsx watch` for development.
- Prisma ORM with SQLite for local development/tests and PostgreSQL in production.
- `express-validator` for request validation and sanitization; CORS configured from environment allowlists.
- Jest and Supertest for unit and HTTP integration tests.
- ESLint with `typescript-eslint`, plus formatting consistent with the existing repository.

Provide scripts equivalent to `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:watch`, `test:integration`, `db:migrate`, `db:deploy`, `db:generate`, and `db:seed` when seeding is needed. Do not invent version pins from this skill.

## Standard structure

Use this separation and adapt names only to repository conventions:

```text
src/
  app.ts                 # Express app, middleware, versioned routes
  server.ts              # process startup and graceful shutdown
  config/env.ts          # typed, fail-fast environment configuration
  config/database.ts     # one PrismaClient lifecycle owner
  routes/v1/index.ts
  routes/v1/auth.routes.ts
  controllers/auth.controller.ts
  services/auth.service.ts
  middleware/{auth,error,not-found,request-id,validation}.middleware.ts
  validators/auth.validators.ts
  utils/{api-error,async-handler,jwt,password,localization}.ts
  types/express.d.ts
  i18n/{en,my}.ts
prisma/{schema.prisma,migrations/,seed.ts}
tests/{unit,integration,setup.ts,helpers/}
```

Routes declare HTTP endpoints and middleware; controllers translate HTTP to service calls; services own business rules and transactions; Prisma access stays in services/repositories; middleware handles cross-cutting concerns; validators never contain business logic; utilities remain dependency-light.

## API contract

Version every route under `/api/v1`. Include a health endpoint, JSON content negotiation, consistent success envelopes, and a typed error envelope such as `{ success: false, error: { code, message, details, requestId } }`. Add 404 handling before the four-argument error handler. Never expose stack traces or raw Prisma errors in production; log structured server-side details with a request ID.

## Environment and database

Validate environment variables at startup and provide `.env.example` without secrets. Use `DATABASE_URL="file:./dev.db"` locally/test and PostgreSQL URLs in production; select configuration by environment without committing credentials. Commit Prisma migrations. Use `prisma migrate dev` for local schema evolution, `prisma migrate deploy` in production, and isolate test databases so tests are deterministic. Do not use `db push` as a production migration strategy.

## JWT authentication

Implement `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/verify`, and `POST /api/v1/auth/logout`; add refresh rotation only when the API contract requires it. Hash passwords with an established password-hashing library. Sign short-lived access tokens server-side and verify signatures plus `iss`, `aud`, `exp`, `nbf`, subject, and algorithm allowlists in auth middleware. Keep signing keys in server-only environment/config, never in client bundles or logs. Return the canonical user separately from token claims and attach it to a typed request context. Use generic credential errors to avoid account enumeration and revoke/clear sessions safely on logout.

## Validation, language, and CORS

Use `checkSchema` or explicit chains for body, params, query, and headers; sanitize before controllers; return stable machine-readable field errors. Add an `Accept-Language` parser with supported `en` and `my`, a configured fallback, and translation keys for response messages and validation errors. Do not trust arbitrary locale input. Configure CORS with explicit origins, allowed methods/headers, credentials policy, and environment-specific behavior; never use permissive credentials plus `*`.

## Testing

Read `references/testing.md`. Unit-test services, JWT/password utilities, validators, error mapping, and localization. Integration-test the real Express app with Supertest and an isolated SQLite database: health/version routes, validation failures, register/login/verify/logout, auth failures, CORS behavior, 404s, and consistent errors. Avoid listening on a real port in tests, shared mutable Prisma clients, real production databases, and brittle snapshots.

Finish by running typecheck, lint, unit tests, integration tests, and build. Report assumptions, migration commands, environment requirements, and any backend contract still needed. Do not build anything when this skill is merely being authored or reviewed.
