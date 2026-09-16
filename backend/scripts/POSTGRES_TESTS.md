# PostgreSQL finance regression checks

Run from `backend` against a disposable local PostgreSQL instance. Create an empty database whose name ends in `_test`; the runner rejects non-local hosts and ignores the application's `DATABASE_URL` as its target.

```sh
TEST_POSTGRES_URL='postgresql://postgres@127.0.0.1:55439/lotaya_finance_test' npm run test:postgresql
```

The server must support TLS, consistent with the production adapter. For a disposable local instance with a self-signed certificate, explicitly set `DATABASE_SSL_REJECT_UNAUTHORIZED=false` for this command only, or provide its trusted CA with `DATABASE_SSL_CA`.

```sh
TEST_POSTGRES_URL='postgresql://postgres@127.0.0.1:55439/lotaya_finance_test' DATABASE_SSL_REJECT_UNAUTHORIZED=false npm run test:postgresql
```

The runner applies the committed PostgreSQL migrations, generates its Prisma client, runs real database regression tests, and restores the SQLite client in `finally`. Do not run another backend test/build concurrently with client generation. The database is not dropped automatically; use only synthetic data. No production connection or application `.env` database is used.

Coverage includes >500 journal account aggregates, hub scope, compensating entries, bounded detail reads, split-wallet payments, excess payment rejection, duplicate retries, correction/replacement hash checking, concurrent payment retries, and concurrent tracking allocation followed by finalization.
