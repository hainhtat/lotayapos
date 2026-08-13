import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { env } from "./env.js";

const adapter = env.databaseProvider === "postgresql"
  ? new PrismaPg(new Pool({ connectionString: env.databaseUrl, ssl: { rejectUnauthorized: false } }))
  : new PrismaBetterSqlite3({ url: env.databaseUrl });

export const prisma = new PrismaClient({ adapter });
