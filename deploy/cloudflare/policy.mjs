/** @param {Request} request @param {string} origin */
export function isCanonicalRequest(request, origin) {
  const expected = new URL(origin);
  return (
    expected.protocol === "https:" && expected.origin === origin && new URL(request.url).origin === origin
  );
}

/** @param {Request} request @param {string} origin */
export function forwardRequest(request, origin) {
  const url = new URL(request.url);
  url.protocol = "http:";
  url.host = "container";
  const forwarded = new Request(url, request);
  const host = new URL(origin).host;
  forwarded.headers.set("host", host);
  forwarded.headers.set("x-forwarded-host", host);
  forwarded.headers.set("x-forwarded-proto", "https");
  forwarded.headers.delete("forwarded");
  forwarded.headers.delete("x-forwarded-for");
  return forwarded;
}

/** @param {Record<string, unknown>} bindings @returns {Record<string, string>} */
export function containerEnvironment(bindings) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const key of [
    "DATABASE_URL",
    "DATABASE_DIRECT_URL",
    "NEXTAUTH_SECRET",
    "CALENDSO_ENCRYPTION_KEY",
    "RESEND_API_KEY",
    "GOOGLE_API_CREDENTIALS",
    "EMAIL_FROM",
    "PUBLIC_APP_URL",
  ]) {
    const value = bindings[key];
    if (typeof value !== "string" || !value) throw new Error(`Missing CAL setting: ${key}`);
    env[key] = value;
  }
  return {
    ...env,
    NEXT_PUBLIC_WEBAPP_URL: env.PUBLIC_APP_URL,
    NEXT_PUBLIC_WEBSITE_URL: env.PUBLIC_APP_URL,
    NEXTAUTH_URL: env.PUBLIC_APP_URL,
    CAL_MCP_BASE_URL: env.PUBLIC_APP_URL,
    CAL_PRIVATE_INSTANCE: "true",
    NEXT_PUBLIC_DISABLE_SIGNUP: "true",
    ORGANIZATIONS_ENABLED: "false",
    GOOGLE_LOGIN_ENABLED: "false",
    CALCOM_TELEMETRY_DISABLED: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    ENABLE_ASYNC_TASKER: "false",
    NODE_ENV: "production",
    HOSTNAME: "0.0.0.0",
    PORT: "3000",
  };
}
