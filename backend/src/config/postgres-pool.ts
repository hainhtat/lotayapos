const STRIPPED_QUERY_KEYS = new Set(["sslmode", "uselibpqcompat"]);

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

  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false as const },
  };
}
