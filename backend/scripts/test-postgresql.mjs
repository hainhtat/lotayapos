import { spawnSync } from "node:child_process";

// Deliberately never use DATABASE_URL or the project's .env as a test target.
const target = process.env.TEST_POSTGRES_URL;
if (!target) throw new Error("Set TEST_POSTGRES_URL to an isolated local PostgreSQL database ending in _test");
const url = new URL(target);
if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname)) {
  throw new Error("PostgreSQL tests require a localhost database name ending in _test");
}
const env = { ...process.env, NODE_ENV: "test", DATABASE_PROVIDER: "postgresql", DATABASE_URL: target, DIRECT_DATABASE_URL: target };
function run(args, environment = env) {
  const result = spawnSync("npx", args, { stdio: "inherit", env: environment });
  if (result.error || result.status !== 0) throw new Error(`Test command failed: ${args[0]}`);
}
try {
  run(["prisma", "migrate", "deploy"]);
  run(["prisma", "generate"]);
  run(["jest", "--runInBand", "tests/ledger-summary.test.ts", "tests/os-account.test.ts", "tests/os-history.test.ts", "tests/tracking-allocation.test.ts", "tests/automatic-advances.test.ts", "tests/simple-workflow.test.ts", "--setupFilesAfterEnv", "./tests/postgres-teardown.ts"]);
} finally {
  run(["prisma", "generate", "--schema", "prisma/schema.prisma"], { ...env, DATABASE_PROVIDER: "sqlite", DATABASE_URL: "file:./dev.db", DIRECT_DATABASE_URL: "" });
}
