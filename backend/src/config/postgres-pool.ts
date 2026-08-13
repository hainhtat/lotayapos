const STRIPPED_QUERY_KEYS = new Set(["sslmode", "uselibpqcompat"]);

export function postgresPoolOptions(databaseUrl: string) {
  const url = new URL(databaseUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (STRIPPED_QUERY_KEYS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false as const },
  };
}
