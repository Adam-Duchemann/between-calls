import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const launcher = fileURLToPath(new URL("./cal-backup-launchagent.mjs", import.meta.url));
const macOnly = { skip: process.platform !== "darwin" };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "CAL scheduler & test "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configFile = join(root, "backup settings.json");
  const config = {
    directory: join(root, "archives"),
    keyFile: join(root, "archive key"),
    pgServiceFile: join(root, "service config"),
    postgresBin: "/usr/bin",
    keychainService: "cal-fixture-service",
    keychainAccount: "fixture@example.invalid",
    sourceCommit: "a".repeat(40),
    hour: 4,
    minute: 30,
  };
  mkdirSync(config.directory, { mode: 0o700 });
  writeFileSync(config.keyFile, Buffer.alloc(32, 5), { mode: 0o600 });
  writeFileSync(config.pgServiceFile, "[cal-source]\nhost=/private/tmp/fixture\n", { mode: 0o600 });
  const save = () => writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
  save();
  const render = () => spawnSync(process.execPath, [launcher, "render", configFile], { encoding: "utf8" });
  return { root, configFile, config, save, render };
}

test("renders a daily LaunchAgent with escaped paths and no Keychain data in the plist", macOnly, (t) => {
  const x = fixture(t);
  const rendered = x.render();
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.doesNotMatch(rendered.stdout, /cal-fixture-service|fixture@example.invalid|PGPASSWORD/);
  const decoded = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", "-"], {
    input: rendered.stdout,
    encoding: "utf8",
  });
  assert.equal(decoded.status, 0, decoded.stderr);
  assert.deepEqual(JSON.parse(decoded.stdout), {
    Label: "local.cal.backup",
    ProgramArguments: [process.execPath, launcher, "run", x.configFile],
    StartCalendarInterval: { Hour: 4, Minute: 30 },
    StandardOutPath: join(x.root, "cal-backup.out.log"),
    StandardErrorPath: join(x.root, "cal-backup.err.log"),
    Umask: 0o077,
  });
});

test("rejects invalid local time or missing deployed commit", macOnly, (t) => {
  const x = fixture(t);
  x.config.minute = 60;
  x.save();
  const invalidTime = x.render();
  assert.equal(invalidTime.status, 1);
  assert.match(invalidTime.stderr, /hour and minute/);

  x.config.minute = 0;
  x.config.sourceCommit = "latest";
  x.save();
  const invalidRevision = x.render();
  assert.equal(invalidRevision.status, 1);
  assert.match(invalidRevision.stderr, /deployed commit/);
});

test("rejects credentials in configuration and refuses group-readable setup files", macOnly, (t) => {
  const x = fixture(t);
  chmodSync(x.configFile, 0o640);
  assert.match(x.render().stderr, /owner-only configuration file/);
  chmodSync(x.configFile, 0o600);
  x.config.password = "never-print-this-fixture";
  x.save();
  const rendered = x.render();
  assert.equal(rendered.status, 1);
  assert.match(rendered.stderr, /unknown configuration field/);
  assert.doesNotMatch(rendered.stderr, /never-print-this-fixture/);
});
