import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

const adapter = env.databaseProvider === "postgresql"
  ? new PrismaPg({ connectionString: env.databaseUrl })
  : new PrismaBetterSqlite3({ url: env.databaseUrl });

export const prisma = new PrismaClient({ adapter });
