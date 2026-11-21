import assert from "node:assert/strict";
import test from "node:test";
import { containerEnvironment, forwardRequest, isCanonicalRequest } from "./policy.mjs";

const origin = "https://booking.example.com";

test("accepts only the configured HTTPS origin, regardless of forwarded headers", () => {
  assert.equal(isCanonicalRequest(new Request(`${origin}/api/mcp`), origin), true);
  for (const url of ["https://attacker.test/api/mcp", "http://booking.example.com/api/mcp"]) {
    assert.equal(
      isCanonicalRequest(
        new Request(url, { headers: { "x-forwarded-host": "booking.example.com" } }),
        origin
      ),
      false
    );
  }
});

test("forwards the original body and auth once, with trusted proxy headers", async () => {
  const request = new Request(`${origin}/api/mcp/confirm?ref=test`, {
    method: "POST",
    body: '{"decision":"approve"}',
    headers: {
      authorization: "Bearer test-token",
      cookie: "test-session=fixture",
      origin,
      host: "attacker.test",
      "x-forwarded-host": "attacker.test",
      "x-forwarded-proto": "http",
      forwarded: "host=attacker.test",
    },
  });
  const forwarded = forwardRequest(request, origin);
  assert.equal(forwarded.url, "http://container/api/mcp/confirm?ref=test");
  assert.equal(forwarded.method, "POST");
  assert.equal(await forwarded.text(), '{"decision":"approve"}');
  assert.equal(forwarded.headers.get("authorization"), "Bearer test-token");
  assert.equal(forwarded.headers.get("cookie"), "test-session=fixture");
  assert.equal(forwarded.headers.get("origin"), origin);
  assert.equal(forwarded.headers.get("host"), "booking.example.com");
  assert.equal(forwarded.headers.get("x-forwarded-host"), "booking.example.com");
  assert.equal(forwarded.headers.get("x-forwarded-proto"), "https");
  assert.equal(forwarded.headers.get("forwarded"), null);
});

const secrets = {
  DATABASE_URL: "postgres://fixture",
  DATABASE_DIRECT_URL: "postgres://fixture",
  NEXTAUTH_SECRET: "fixture-auth-secret",
  CALENDSO_ENCRYPTION_KEY: "fixture-encryption-secret",
  RESEND_API_KEY: "fixture-email-key",
  GOOGLE_API_CREDENTIALS: "fixture-google-key",
};

test("passes only required app settings into the container and enforces private defaults", () => {
  const result = containerEnvironment({
    ...secrets,
    PUBLIC_APP_URL: origin,
    EMAIL_FROM: "booking@example.com",
    CAL_PRIVATE_INSTANCE: "false",
    UNRELATED_SECRET: "do-not-forward",
  });
  assert.equal(result.NEXTAUTH_SECRET, secrets.NEXTAUTH_SECRET);
  assert.equal(result.CAL_PRIVATE_INSTANCE, "true");
  assert.equal(result.NEXT_PUBLIC_DISABLE_SIGNUP, "true");
  assert.equal(result.CAL_MCP_BASE_URL, origin);
  assert.equal(result.NEXTAUTH_URL, origin);
  assert.equal(result.HOSTNAME, "0.0.0.0");
  assert.equal(result.PORT, "3000");
  assert.equal(result.UNRELATED_SECRET, undefined);
});

test("missing runtime configuration fails without exposing other secret values", () => {
  assert.throws(
    () => containerEnvironment({ ...secrets, PUBLIC_APP_URL: origin }),
    (error) => {
      assert.match(error.message, /EMAIL_FROM/);
      assert.doesNotMatch(error.message, /fixture-/);
      return true;
    }
  );
});
