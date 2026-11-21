// @vitest-environment node

import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { connectionConfig, poolConfig } from "./poolConfig";

describe("database connection budgets", () => {
  it("bounds a serverless instance even without the legacy pool flag", () => {
    const config = poolConfig({ VERCEL: "1" });
    expect(config?.max).toBe(1);
    expect(config?.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(config?.connectionTimeoutMillis).toBeLessThanOrEqual(10000);
    expect(config?.idleTimeoutMillis).toBeLessThanOrEqual(10000);
  });

  it("keeps the existing opt-in pool for a persistent server", () => {
    for (const USE_POOL of ["true", "1"]) {
      expect(poolConfig({ USE_POOL })).toMatchObject({ max: 5, idleTimeoutMillis: 300000 });
    }
    expect(poolConfig({})).toBeUndefined();
    expect(poolConfig({ VERCEL: "0", USE_POOL: "false" })).toBeUndefined();
  });

  it("uses the serverless budget when both deployment flags are set", () => {
    expect(poolConfig({ VERCEL: "1", USE_POOL: "true" })?.max).toBe(1);
  });

  it("verifies the database certificate with the configured private CA in every runtime", () => {
    for (const flags of [{}, { VERCEL: "1" }, { USE_POOL: "true" }]) {
      expect(poolConfig({ ...flags, DATABASE_SSL_CA: "certificate-pem" })?.ssl).toEqual({
        ca: "certificate-pem",
        rejectUnauthorized: true,
      });
    }
  });

  it("preserves the private CA when pg parses the URL's TLS requirement", () => {
    const client = new Client(
      connectionConfig("postgresql://localhost/cal?sslmode=require", {
        DATABASE_SSL_CA: "certificate-pem",
      })
    );
    expect(client).toHaveProperty("connectionParameters.ssl", {
      ca: "certificate-pem",
      rejectUnauthorized: true,
    });
  });

  it("rejects conflicting URL TLS settings when a private CA is configured", () => {
    for (const query of ["sslmode=disable", "sslmode=no-verify", "sslcert=other.pem"]) {
      expect(() =>
        connectionConfig(`postgresql://localhost/cal?${query}`, {
          DATABASE_SSL_CA: "certificate-pem",
        })
      ).toThrow("Database URL TLS options conflict with DATABASE_SSL_CA");
    }
  });
});
