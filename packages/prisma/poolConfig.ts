import type { PoolConfig } from "pg";

export function connectionConfig(
  connectionString: string,
  env: Record<string, string | undefined>
): PoolConfig {
  if (env.DATABASE_SSL_CA) {
    const url = new URL(connectionString);
    url.searchParams.forEach((value, key) => {
      if (
        key.startsWith("ssl") &&
        (key !== "sslmode" || !["require", "verify-ca", "verify-full"].includes(value))
      ) {
        throw new Error("Database URL TLS options conflict with DATABASE_SSL_CA");
      }
    });
    // pg replaces the entire SSL object when sslmode is present, discarding the configured CA.
    url.searchParams.delete("sslmode");
    connectionString = url.href;
  }
  return { connectionString, ...poolConfig(env) };
}

export function poolConfig(env: Record<string, string | undefined>): PoolConfig | undefined {
  const ssl: PoolConfig["ssl"] = env.DATABASE_SSL_CA
    ? { ca: env.DATABASE_SSL_CA, rejectUnauthorized: true }
    : undefined;
  // Each warm function owns a pool; the database pooler must handle cross-instance concurrency.
  if (env.VERCEL === "1") {
    return { max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, allowExitOnIdle: true, ssl };
  }
  if (env.USE_POOL === "true" || env.USE_POOL === "1") {
    return { max: 5, idleTimeoutMillis: 300000, ssl };
  }
  return ssl ? { ssl } : undefined;
}
