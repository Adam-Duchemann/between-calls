// @vitest-environment node

import type { Pool, PoolConfig } from "pg";
import { afterEach, expect, it, vi } from "vitest";

const { pools } = vi.hoisted(() => ({ pools: [] as Pool[] }));

vi.mock("pg", async (importOriginal) => {
  const pg = await importOriginal<typeof import("pg")>();
  return {
    ...pg,
    Pool: class extends pg.Pool {
      constructor(config: PoolConfig) {
        super(config);
        pools.push(this);
      }
    },
  };
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("uses verified private-CA TLS and the serverless connection budget for booking reads", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/cal?sslmode=require");
  vi.stubEnv("DATABASE_SSL_CA", "certificate-pem");
  vi.stubEnv("VERCEL", "1");

  await import("./index");

  expect(pools).toHaveLength(1);
  const { Client } = await import("pg");
  const client = new Client(pools[0].options);
  expect(client).toHaveProperty("connectionParameters.ssl", {
    ca: "certificate-pem",
    rejectUnauthorized: true,
  });
  expect(pools[0].options.max).toBe(1);
});
