import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

const commands = [
  "turbo run build --filter=@calcom/web^...",
  "workspace @calcom/web copy-app-store-static",
  "workspace @calcom/web exec next typegen",
  "type-check --force --concurrency=1",
  "workspace @calcom/web exec next build --webpack --experimental-build-mode compile",
  "workspace @calcom/web exec next build --webpack --experimental-build-mode generate",
];

test("production page routes never contain test suites", () => {
  const files = readdirSync(new URL("../apps/web/pages/", import.meta.url), { recursive: true });
  const tests = files.filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file));
  assert.deepEqual(tests, [], "Next.js treats test files inside pages as public routes; keep them in test/.");
});

function run(t, failOn = "", signalOn = "") {
  const dir = mkdtempSync(join(tmpdir(), "cal-build-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "bin"));
  copyFileSync(new URL("build-cal.sh", import.meta.url), join(dir, "scripts/build-cal.sh"));
  copyFileSync(
    new URL("prepare-next-generate.mjs", import.meta.url),
    join(dir, "scripts/prepare-next-generate.mjs")
  );
  const log = join(dir, "calls");
  writeFileSync(log, "");
  writeFileSync(
    join(dir, "bin/yarn"),
    [
      "#!/bin/sh",
      '[ "$SKIP_DB_MIGRATIONS" = "1" ] || exit 99',
      'printf "%s\\n" "$*" >> "$CAL_TEST_LOG"',
      'if [ "$*" = "$CAL_TEST_FAIL" ]; then exit 42; fi',
      'if [ "$*" = "$CAL_TEST_SIGNAL" ]; then kill -TERM "$$"; fi',
      `if [ "$*" = "${commands[4]}" ]; then`,
      "  mkdir -p apps/web/.next/server",
      "  printf '%s' 'module.exports = {};' > apps/web/.next/server/middleware.js",
      `  printf '%s' '{"version":1,"files":["middleware.js"]}' > apps/web/.next/server/middleware.js.nft.json`,
      "fi",
      `if [ "$*" = "${commands[5]}" ]; then`,
      "  mv apps/web/.next/server/proxy.js apps/web/.next/server/middleware.js || exit 43",
      "  mv apps/web/.next/server/proxy.js.nft.json apps/web/.next/server/middleware.js.nft.json || exit 43",
      "fi",
    ].join("\n"),
    { mode: 0o700 }
  );
  const result = spawnSync("sh", [join(dir, "scripts/build-cal.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      CAL_TEST_LOG: log,
      CAL_TEST_FAIL: failOn,
      CAL_TEST_SIGNAL: signalOn,
      SKIP_DB_MIGRATIONS: "0",
    },
  });
  return { ...result, calls: readFileSync(log, "utf8").trim().split("\n") };
}

test("checks types before compiling and finalizes in a separate process", (t) => {
  const result = run(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, commands);
});

test("an interrupted type checker cannot continue to compilation", (t) => {
  const result = run(t, "", commands[3]);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, commands.slice(0, 4));
});

for (const [index, command] of commands.entries()) {
  test(`stops after a failed ${command}`, (t) => {
    const result = run(t, command);
    assert.equal(result.status, 42, result.stderr);
    assert.deepEqual(result.calls, commands.slice(0, index + 1));
  });
}
