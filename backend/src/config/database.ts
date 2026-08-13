import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { env } from "./env.js";
import { postgresPoolOptions } from "./postgres-pool.js";

const adapter = env.databaseProvider === "postgresql"
  ? new PrismaPg(new Pool(postgresPoolOptions(env.databaseUrl)))
  : new PrismaBetterSqlite3({ url: env.databaseUrl });

export const prisma = new PrismaClient({ adapter });
