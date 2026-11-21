import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL(".", import.meta.url));

function runScript(t, script, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cal-start-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "bin"));
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  for (const name of ["start.sh", "setup-cal.sh"]) {
    if (existsSync(join(source, name))) copyFileSync(join(source, name), join(dir, "scripts", name));
  }
  const stub = `#!/bin/sh
name="\${0##*/}"
printf '%s %s\\n' "$name" "$*" >> "$CAL_TEST_LOG"
if [ "$name $*" = "\${CAL_TEST_FAIL_ON:-}" ]; then exit 42; fi
`;
  for (const name of ["yarn", "npx"]) writeFileSync(join(dir, "bin", name), stub, { mode: 0o700 });
  for (const name of ["replace-placeholder.sh", "wait-for-it.sh"]) {
    writeFileSync(join(dir, "scripts", name), stub, { mode: 0o700 });
  }
  const result = spawnSync("/bin/sh", [join(dir, "scripts", script)], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...env,
      PATH: `${join(dir, "bin")}:${env.PATH}`,
      CAL_TEST_LOG: log,
      NEXT_PUBLIC_WEBAPP_URL: "https://cal.example.test",
      BUILT_NEXT_PUBLIC_WEBAPP_URL: "https://cal.example.test",
      DATABASE_HOST: "database:5432",
      ...overrides,
    },
  });
  return { ...result, calls: readFileSync(log, "utf8").trim().split("\n").filter(Boolean) };
}

test("normal startup never migrates or seeds the database", (t) => {
  const result = runScript(t, "start.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["yarn workspace @calcom/web start"]);
});

test("startup replaces a changed public URL before starting the app", (t) => {
  const result = runScript(t, "start.sh", { BUILT_NEXT_PUBLIC_WEBAPP_URL: "http://built.example.test" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    "replace-placeholder.sh http://built.example.test https://cal.example.test",
    "yarn workspace @calcom/web start",
  ]);
});

test("startup rejects a missing runtime URL without starting the app", (t) => {
  const result = runScript(t, "start.sh", { NEXT_PUBLIC_WEBAPP_URL: "" });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
});

test("startup propagates the application's failure", (t) => {
  assert.equal(runScript(t, "start.sh", { CAL_TEST_FAIL_ON: "yarn workspace @calcom/web start" }).status, 42);
});

test("explicit setup deploys migrations and then seeds the app catalog", (t) => {
  const result = runScript(t, "setup-cal.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    "yarn prisma migrate deploy",
    "yarn workspace @calcom/prisma seed-app-store",
  ]);
});

test("failed migrations stop setup before seeding", (t) => {
  const result = runScript(t, "setup-cal.sh", { CAL_TEST_FAIL_ON: "yarn prisma migrate deploy" });
  assert.equal(result.status, 42, result.stderr);
  assert.deepEqual(result.calls, ["yarn prisma migrate deploy"]);
});
