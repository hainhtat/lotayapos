import { postgresPoolOptions } from "../src/config/postgres-pool.js";

describe("postgresPoolOptions", () => {
  test("strips sslmode=require so pg cannot re-apply verify-full", () => {
    const options = postgresPoolOptions(
      "postgresql://user:pass@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require&schema=public",
    );

    expect(options.connectionString).not.toContain("sslmode=require");
    expect(options.connectionString).not.toContain("sslmode");
    expect(options.connectionString).toContain("aws-0-ap-south-1.pooler.supabase.com");
    expect(options.connectionString).toContain("user");
    expect(options.connectionString).toMatch(/\/postgres(?:\?|$)/);
    expect(options.connectionString).toContain("schema=public");
    expect(options.ssl.rejectUnauthorized).toBe(false);
  });

  test("strips uselibpqcompat while keeping TLS enabled", () => {
    const options = postgresPoolOptions(
      "postgresql://user:pass@db.example.com:5432/postgres?sslmode=require&uselibpqcompat=true",
    );

    expect(options.connectionString).not.toContain("sslmode");
    expect(options.connectionString).not.toContain("uselibpqcompat");
    expect(options.connectionString).toContain("db.example.com");
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
  });
});
