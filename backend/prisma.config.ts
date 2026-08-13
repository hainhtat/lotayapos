import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: process.env.DATABASE_PROVIDER === "postgresql"
    ? "prisma/schema.postgresql.prisma"
    : "prisma/schema.prisma",
  migrations: {
    path: process.env.DATABASE_PROVIDER === "postgresql"
      ? "prisma/migrations-postgresql"
      : "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
