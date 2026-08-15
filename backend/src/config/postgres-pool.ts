const STRIPPED_QUERY_KEYS = new Set(["sslmode", "uselibpqcompat"]);

/**
 * Pool options for PrismaPg / node-pg.
 * Supabase poolers often need rejectUnauthorized=false (default).
 * Set DATABASE_SSL_REJECT_UNAUTHORIZED=true when a verifying CA bundle is configured.
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

  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";

  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized },
  };
}
