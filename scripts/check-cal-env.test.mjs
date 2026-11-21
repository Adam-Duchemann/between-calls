import assert from "node:assert/strict";
import test from "node:test";
import { checkCalEnvironment } from "./check-cal-env.mjs";

const valid = () => ({
  CAL_PRIVATE_INSTANCE: "true",
  NEXT_PUBLIC_DISABLE_SIGNUP: "true",
  NEXT_PUBLIC_WEBAPP_URL: "https://cal.example.com",
  NEXTAUTH_URL: "https://cal.example.com",
  NEXTAUTH_SECRET: "unique-auth-secret-longer-than-32-characters",
  CALENDSO_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  DATABASE_URL: "postgresql://owner:private-password@database.example.com:5432/cal?sslmode=require",
  DATABASE_DIRECT_URL: "postgresql://owner:private-password@database.example.com:5432/cal?sslmode=require",
  EMAIL_FROM: "bookings@example.com",
  RESEND_API_KEY: "re_private_key",
  GOOGLE_API_CREDENTIALS: JSON.stringify({
    web: {
      client_id: "private-client",
      client_secret: "private-secret",
      redirect_uris: ["https://cal.example.com/api/integrations/googlecalendar/callback"],
    },
  }),
});
test("accepts the private production configuration without printing values", () => {
  assert.deepEqual(checkCalEnvironment(valid()), []);
});
test("rejects public signup and mismatched HTTP or MCP origins", () => {
  const errors = checkCalEnvironment({
    ...valid(),
    CAL_PRIVATE_INSTANCE: "false",
    NEXT_PUBLIC_WEBAPP_URL: "http://localhost:3100",
    CAL_MCP_BASE_URL: "https://other.example.com",
  });
  assert.ok(errors.some((e) => e.startsWith("CAL_PRIVATE_INSTANCE")));
  assert.ok(errors.some((e) => e.startsWith("NEXT_PUBLIC_WEBAPP_URL")));
  assert.ok(errors.some((e) => e.startsWith("CAL_MCP_BASE_URL")));
});
test("requires separate stable keys and authenticated TLS database URLs", () => {
  const env = valid();
  env.CALENDSO_ENCRYPTION_KEY = env.NEXTAUTH_SECRET;
  env.DATABASE_URL = "postgresql://owner:private-password@database.example.com/cal";
  const errors = checkCalEnvironment(env);
  assert.ok(errors.some((e) => e.startsWith("CALENDSO_ENCRYPTION_KEY")));
  assert.ok(errors.some((e) => e.startsWith("DATABASE_URL")));
  assert.ok(!JSON.stringify(errors).includes("private-password"));
});
test("checks provider configuration and the exact calendar callback", () => {
  const env = {
    ...valid(),
    RESEND_API_KEY: "",
    GOOGLE_API_CREDENTIALS: '{"web":{"client_secret":"DO_NOT_PRINT"}}',
  };
  const errors = checkCalEnvironment(env);
  assert.ok(errors.some((e) => e.startsWith("RESEND_API_KEY")));
  assert.ok(errors.some((e) => e.startsWith("GOOGLE_API_CREDENTIALS")));
  assert.ok(!JSON.stringify(errors).includes("DO_NOT_PRINT"));
});
test("requires the login callback only when Google login is enabled", () => {
  assert.ok(
    checkCalEnvironment({ ...valid(), GOOGLE_LOGIN_ENABLED: "true" }).some((e) =>
      e.includes("login callback")
    )
  );
});
