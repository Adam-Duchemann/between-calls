import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./cal-backup.mjs", import.meta.url));
const data = "PGDMP fixture booking and grant data";
const commit = "a".repeat(40);
const traceCommand = 'f.appendFileSync(process.env.BACKUP_TRACE, process.argv.slice(2).join(" ") + "\\n");';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cal-backup-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "backups");
  const bin = join(root, "bin");
  const key = join(root, "key");
  const trace = join(root, "trace");
  for (const path of [directory, bin]) mkdirSync(path, { mode: 0o700 });
  writeFileSync(key, Buffer.alloc(32, 7), { mode: 0o600 });
  const commands = {
    pg_dump:
      'if(process.env.BACKUP_FAIL_DUMP){console.error("private diagnostics");process.exit(5)}' +
      "process.stdout.write(" +
      JSON.stringify(data) +
      ");",
    pg_restore:
      'if (f.readFileSync(0, "utf8") !== ' +
      JSON.stringify(data) +
      ") process.exit(4);" +
      'if(process.argv[2]==="--list") console.log("42; 2615 2200 SCHEMA - public postgres\\n43; 1259 5678 TABLE public Bookings postgres");',
    psql: 'console.log(process.env.BACKUP_TARGET_STATE || "cal_recovery|t|t");',
  };
  for (const [name, content] of Object.entries(commands)) {
    writeFileSync(
      join(bin, name),
      "#!/usr/bin/env node\nconst f=require('node:fs');" + traceCommand + content,
      {
        mode: 0o700,
      }
    );
  }
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: bin + ":" + process.env.PATH, BACKUP_TRACE: trace, ...env },
    });
  const capture = (env) =>
    run(
      [
        "capture",
        "--directory",
        directory,
        "--key-file",
        key,
        "--service",
        "cal-source",
        "--source-commit",
        commit,
      ],
      env
    );
  const restore = (archive, env) =>
    run(
      [
        "restore",
        "--archive",
        archive,
        "--key-file",
        key,
        "--socket",
        root,
        "--port",
        "55438",
        "--database",
        "cal_recovery",
      ],
      env
    );
  const cycle = (env) =>
    run(
      [
        "cycle",
        "--directory",
        directory,
        "--key-file",
        key,
        "--service",
        "cal-source",
        "--source-commit",
        commit,
        "--keep",
        "1",
      ],
      env
    );
  return { root, directory, key, trace, run, capture, restore, cycle };
}

test("capture publishes an authenticated archive with a source revision and no plaintext", (t) => {
  const x = fixture(t);
  const saved = x.capture();
  assert.equal(saved.status, 0, saved.stderr);
  const result = JSON.parse(saved.stdout);
  assert.equal(result.sourceCommit, commit);
  assert.equal(readdirSync(x.directory).length, 1);
  assert.ok(!readFileSync(result.archive).includes(Buffer.from(data)));
  const inspected = x.run(["inspect", "--archive", result.archive, "--key-file", x.key]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).authenticated, true);
  assert.match(readFileSync(x.trace, "utf8"), /--dbname=service=cal-source[^\n]*--schema=public/);
});

test("failed capture does not publish a recovery point or leak child diagnostics", (t) => {
  const x = fixture(t);
  const failed = x.capture({ BACKUP_FAIL_DUMP: "1" });
  assert.notEqual(failed.status, 0);
  assert.deepEqual(readdirSync(x.directory), []);
  assert.doesNotMatch(failed.stderr, /private diagnostics/);
});

test("restore authenticates first and permits only an empty local target", (t) => {
  const x = fixture(t);
  const saved = x.capture();
  assert.equal(saved.status, 0, saved.stderr);
  const { archive } = JSON.parse(saved.stdout);
  const denied = x.restore(archive, { BACKUP_TARGET_STATE: "cal_recovery|t|f" });
  assert.notEqual(denied.status, 0);
  assert.doesNotMatch(readFileSync(x.trace, "utf8"), /--single-transaction/);
  const restored = x.restore(archive);
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(readFileSync(x.trace, "utf8"), /--single-transaction/);
  const trace = readFileSync(x.trace, "utf8");
  const bytes = readFileSync(archive);
  bytes[bytes.length - 1] ^= 1;
  writeFileSync(archive, bytes);
  assert.notEqual(x.restore(archive).status, 0);
  assert.equal(readFileSync(x.trace, "utf8"), trace);
});

test("retention plans from authentic recovery points and moves older copies only on request", (t) => {
  const x = fixture(t);
  for (let index = 0; index < 3; index++) {
    const saved = x.capture();
    assert.equal(saved.status, 0, saved.stderr);
  }
  const other = join(x.directory, "historical-archive.dump");
  writeFileSync(other, "old recovery format", { mode: 0o600 });
  const args = ["retain", "--directory", x.directory, "--key-file", x.key, "--keep", "2"];
  const plan = x.run(args);
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).retire.length, 1);
  assert.equal(readdirSync(x.directory).length, 4);
  const moved = x.run([...args, "--apply"]);
  assert.equal(moved.status, 0, moved.stderr);
  const [retired] = readdirSync(join(x.directory, "retired"));
  const inspected = x.run([
    "inspect",
    "--archive",
    join(x.directory, "retired", retired),
    "--key-file",
    x.key,
  ]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(readFileSync(other, "utf8"), "old recovery format");
});

test("a group-readable key is rejected", (t) => {
  const x = fixture(t);
  chmodSync(x.key, 0o640);
  const failed = x.capture();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /private key file/);
  assert.deepEqual(readdirSync(x.directory), []);
});

test("a scheduled cycle authenticates the new capture before retiring older backups", (t) => {
  const x = fixture(t);
  const initial = x.capture();
  assert.equal(initial.status, 0, initial.stderr);
  const old = JSON.parse(initial.stdout).archive;
  const result = x.cycle();
  assert.equal(result.status, 0, result.stderr);
  const { backup, retention } = JSON.parse(result.stdout);
  assert.equal(backup.authenticated, true);
  assert.deepEqual(retention.retained, [basename(backup.archive)]);
  assert.deepEqual(retention.retire, [basename(old)]);
  assert.equal(retention.moved, 1);
  const moved = x.run([
    "inspect",
    "--archive",
    join(x.directory, "retired", basename(old)),
    "--key-file",
    x.key,
  ]);
  assert.equal(moved.status, 0, moved.stderr);
});

test("a scheduled cycle leaves previous backup names in place when capture fails", (t) => {
  const x = fixture(t);
  assert.equal(x.capture().status, 0);
  assert.equal(x.capture().status, 0);
  const before = readdirSync(x.directory);
  const failed = x.cycle({ BACKUP_FAIL_DUMP: "1" });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /pg_dump failed/);
  assert.deepEqual(readdirSync(x.directory), before);
});

test("a scheduled capture bounds how long it waits for PostgreSQL table locks", (t) => {
  const x = fixture(t);
  assert.equal(x.cycle().status, 0);
  assert.match(readFileSync(x.trace, "utf8"), /--lock-wait-timeout=30000\b/);
});

test("a scheduled cycle preserves its new backup when an older archive fails authentication", (t) => {
  const x = fixture(t);
  const initial = x.capture();
  assert.equal(initial.status, 0);
  const old = JSON.parse(initial.stdout).archive;
  const bytes = readFileSync(old);
  bytes[bytes.length - 1] ^= 1;
  writeFileSync(old, bytes);
  const failed = x.cycle();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /new backup was saved, but retention could not finish/);
  const active = readdirSync(x.directory);
  assert.equal(active.length, 2);
  assert.ok(active.includes(basename(old)));
  const fresh = active.find((name) => name !== basename(old));
  const proof = x.run(["inspect", "--archive", join(x.directory, fresh), "--key-file", x.key]);
  assert.equal(proof.status, 0, proof.stderr);
});

test("retention resumes a move interrupted after the retired archive was linked", (t) => {
  const x = fixture(t);
  const first = x.capture();
  assert.equal(first.status, 0);
  const old = JSON.parse(first.stdout).archive;
  const retired = join(x.directory, "retired");
  mkdirSync(retired, { mode: 0o700 });
  linkSync(old, join(retired, basename(old)));

  const success = x.cycle();
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(readdirSync(retired), [basename(old)]);
  assert.ok(!readdirSync(x.directory).includes(basename(old)));
});

test("retention leaves both files in place if a different retired file already uses the name", (t) => {
  const x = fixture(t);
  const initial = x.capture();
  assert.equal(initial.status, 0);
  const old = JSON.parse(initial.stdout).archive;
  const retired = join(x.directory, "retired");
  mkdirSync(retired, { mode: 0o700 });
  const existing = join(retired, basename(old));
  writeFileSync(existing, "existing archive content", { mode: 0o600 });
  const failed = x.cycle();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /new backup was saved, but retention could not finish/);
  assert.ok(readdirSync(x.directory).includes(basename(old)));
  assert.equal(readFileSync(existing, "utf8"), "existing archive content");
});
