import { pathToFileURL } from "node:url";

export function checkCalEnvironment(env) {
  const errors = [];
  const fail = (name, reason) => errors.push(`${name}: ${reason}`);
  for (const name of ["CAL_PRIVATE_INSTANCE", "NEXT_PUBLIC_DISABLE_SIGNUP"]) {
    if (env[name] !== "true") fail(name, "must be true for the private release.");
  }
  if (["true", "1"].includes(env.ORGANIZATIONS_ENABLED))
    fail("ORGANIZATIONS_ENABLED", "must stay disabled for private v1.");
  function origin(name, value) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
        throw new Error();
      return url.origin;
    } catch {
      fail(name, "must be a public HTTPS origin without a path or credentials.");
    }
  }
  const appOrigin = origin("NEXT_PUBLIC_WEBAPP_URL", env.NEXT_PUBLIC_WEBAPP_URL);
  for (const name of ["NEXTAUTH_URL", "CAL_MCP_BASE_URL"]) {
    const value = name === "CAL_MCP_BASE_URL" ? env[name] || env.NEXT_PUBLIC_WEBAPP_URL : env[name];
    const candidate = origin(name, value);
    if (candidate !== appOrigin) fail(name, "must match the booking app origin.");
  }
  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32)
    fail("NEXTAUTH_SECRET", "use a persistent random secret of at least 32 characters.");
  if (
    !/^[\x21-\x7e]{32}$/.test(env.CALENDSO_ENCRYPTION_KEY ?? "") ||
    env.CALENDSO_ENCRYPTION_KEY === env.NEXTAUTH_SECRET
  )
    fail("CALENDSO_ENCRYPTION_KEY", "use a separate persistent random 32-byte ASCII key.");
  for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL"]) {
    try {
      const url = new URL(env[name]);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.username ||
        !url.password ||
        url.pathname === "/" ||
        !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode"))
      )
        throw new Error();
    } catch {
      fail(name, "provide an authenticated PostgreSQL URL with TLS required.");
    }
  }
  if (!env.RESEND_API_KEY?.startsWith("re_")) fail("RESEND_API_KEY", "provide the Resend sending key.");
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.EMAIL_FROM ?? ""))
    fail("EMAIL_FROM", "provide a sender on the verified Resend domain.");
  try {
    const web = JSON.parse(env.GOOGLE_API_CREDENTIALS ?? "").web;
    if (!web?.client_id || !web?.client_secret || !Array.isArray(web?.redirect_uris)) throw new Error();
    if (!appOrigin || !web.redirect_uris.includes(`${appOrigin}/api/integrations/googlecalendar/callback`))
      throw new Error();
    if (
      env.GOOGLE_LOGIN_ENABLED === "true" &&
      !web.redirect_uris.includes(`${appOrigin}/api/auth/callback/google`)
    )
      fail("GOOGLE_API_CREDENTIALS", "add the exact Google login callback or disable Google login.");
  } catch {
    fail("GOOGLE_API_CREDENTIALS", "provide web-client JSON with the exact calendar callback.");
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkCalEnvironment(process.env);
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else
    console.log(
      "Configuration syntax passed. Provider connections, domain verification and live delivery still need acceptance tests."
    );
}
