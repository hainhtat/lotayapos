const STRIPPED_QUERY_KEYS = new Set(["sslmode", "uselibpqcompat"]);

/**
 * Pool options for PrismaPg / node-pg.
 * Certificate verification is secure by default. DATABASE_SSL_CA may contain
 * a PEM CA bundle (literal newlines or escaped `\\n`). The explicit `false`
 * override is break-glass only for a controlled private network.
 */
export function postgresPoolOptions(databaseUrl: string) {
  const url = new URL(databaseUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (STRIPPED_QUERY_KEYS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  if (url.port === "6543" && !url.searchParams.has("pgbouncer")) {
    url.searchParams.set("pgbouncer", "true");
  }

  const configuredVerification = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  if (configuredVerification && !["true", "false"].includes(configuredVerification)) {
    throw new Error("DATABASE_SSL_REJECT_UNAUTHORIZED must be true or false");
  }
  const rejectUnauthorized = configuredVerification !== "false";
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n").trim();

  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized, ...(ca ? { ca } : {}) },
  };
}
