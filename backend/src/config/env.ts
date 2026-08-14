import "dotenv/config";
import { randomBytes } from "node:crypto";

const nodeEnv = process.env.NODE_ENV ?? "development";
const databaseProvider = process.env.DATABASE_PROVIDER ?? (nodeEnv === "production" ? undefined : "sqlite");
if (!databaseProvider) throw new Error("Missing environment variable: DATABASE_PROVIDER");
if (!["sqlite", "postgresql"].includes(databaseProvider)) throw new Error("DATABASE_PROVIDER must be sqlite or postgresql");
const required = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
};

const jwtSecret = process.env.JWT_SECRET ?? (nodeEnv === "production" ? undefined : randomBytes(32).toString("hex"));
if (!jwtSecret) throw new Error("Missing environment variable: JWT_SECRET");
if (jwtSecret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");

const databaseUrl = required("DATABASE_URL", nodeEnv === "production" ? undefined : "file:./dev.db");
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL;
if (databaseProvider === "sqlite" && !databaseUrl.startsWith("file:")) throw new Error("SQLite DATABASE_URL must use file:");
if (databaseProvider === "postgresql" && !/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error("PostgreSQL DATABASE_URL must use postgresql://");
if (directDatabaseUrl && !/^postgres(ql)?:\/\//.test(directDatabaseUrl)) throw new Error("DIRECT_DATABASE_URL must use postgresql://");

const hubTimezone = process.env.HUB_TIMEZONE ?? "Asia/Yangon";
try { new Intl.DateTimeFormat("en-US", { timeZone: hubTimezone }).format(); } catch { throw new Error("HUB_TIMEZONE must be a valid IANA timezone"); }

function parseWebOrigins() {
  const configured = (process.env.WEB_ORIGIN ?? (nodeEnv === "production" ? "http://localhost:5173" : "http://localhost:5173"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (nodeEnv !== "production") {
    for (const devOrigin of ["http://localhost:8081", "http://127.0.0.1:8081"]) {
      if (!configured.includes(devOrigin)) configured.push(devOrigin);
    }
  }
  return configured;
}

export const env = { nodeEnv, port: Number(process.env.PORT ?? 4000), listenHost: process.env.LISTEN_HOST ?? (nodeEnv === "production" ? "127.0.0.1" : "0.0.0.0"), databaseProvider, databaseUrl, directDatabaseUrl, jwtSecret, jwtIssuer: required("JWT_ISSUER", "lotaya-api"), jwtAudience: required("JWT_AUDIENCE", "lotaya-clients"), webOrigins: parseWebOrigins(), defaultLocale: process.env.DEFAULT_LOCALE ?? "en", riderCommissionRateBps: Number(process.env.RIDER_COMMISSION_RATE_BPS ?? 1000), hubTimezone };
