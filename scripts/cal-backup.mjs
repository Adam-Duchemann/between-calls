import { execFileSync, spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  closeSync,
  constants,
  createWriteStream,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";

const algorithm = "aes-256-gcm";
const archiveHeaderLimit = 1024;
const archiveName = /^cal-public-[\dTZ.-]+-[0-9a-f-]{36}\.calbak$/;
const commitPattern = /^[0-9a-f]{40}$/;
const emptyTargetCheck = [
  "SELECT current_database(), inet_server_addr() IS NULL,",
  "(EXISTS (SELECT FROM pg_namespace WHERE nspname = 'public')",
  "AND NOT EXISTS (SELECT FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND left(nspname,3) <> 'pg_')",
  "AND NOT EXISTS (SELECT FROM pg_largeobject_metadata)",
  "AND NOT EXISTS (SELECT FROM pg_depend WHERE refclassid = 'pg_namespace'::regclass AND refobjid = 'public'::regnamespace));",
].join(" ");
const usage = [
  "capture --directory PATH --key-file PATH --service NAME --source-commit SHA",
  "cycle --directory PATH --key-file PATH --service NAME --source-commit SHA --keep COUNT",
  "inspect --archive PATH --key-file PATH",
  "restore --archive PATH --key-file PATH --socket PATH --port PORT --database NAME",
  "retain --directory PATH --key-file PATH --keep COUNT [--apply]",
]
  .map((line) => "node scripts/cal-backup.mjs " + line)
  .join("\n");

function privateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
    throw new Error("Use an owner-only directory for CAL backups.");
  }
}

function readPrivateFile(path, key = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid() ||
      (key && stat.size !== 32)
    ) {
      throw new Error(
        key ? "Use a 32-byte private key file owned by the current user." : "Use a private CAL archive file."
      );
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function authenticate(path, key) {
  const source = readPrivateFile(path);
  try {
    const headerLength = source.subarray(0, archiveHeaderLimit).indexOf(10) + 1;
    if (headerLength < 2 || source.length <= headerLength + 16) throw new Error("Invalid archive header.");
    const serialized = source.subarray(0, headerLength);
    const header = JSON.parse(serialized.toString("utf8"));
    if (
      header.format !== 1 ||
      !commitPattern.test(header.sourceCommit) ||
      new Date(header.createdAt).toISOString() !== header.createdAt ||
      !/^[0-9a-f]{24}$/.test(header.nonce)
    ) {
      throw new Error("Invalid archive header.");
    }
    const decipher = createDecipheriv(algorithm, key, Buffer.from(header.nonce, "hex"), {
      authTagLength: 16,
    });
    decipher.setAAD(serialized);
    decipher.setAuthTag(source.subarray(-16));
    const partial = decipher.update(source.subarray(headerLength, -16));
    try {
      return { header, plaintext: Buffer.concat([partial, decipher.final()]) };
    } finally {
      partial.fill(0);
    }
  } catch {
    throw new Error("The CAL archive could not be authenticated.");
  }
}

function pg(command, args, input, env = process.env) {
  try {
    // PostgreSQL errors may include SQL or values from the archived data.
    return execFileSync(command, args, { env, input, stdio: ["pipe", "pipe", "ignore"] }).toString("utf8");
  } catch {
    throw new Error(command + " failed. Verify the PostgreSQL tools and connection settings.");
  }
}

function inspect(archive, key) {
  const { header, plaintext } = authenticate(archive, key);
  try {
    pg("pg_restore", ["--list"], plaintext);
    return { archive, sourceCommit: header.sourceCommit, createdAt: header.createdAt, authenticated: true };
  } finally {
    plaintext.fill(0);
  }
}

async function capture(directory, key, service, sourceCommit) {
  privateDirectory(directory);
  const createdAt = new Date().toISOString();
  const nonce = randomBytes(12);
  const header = Buffer.from(
    JSON.stringify({ format: 1, sourceCommit, createdAt, nonce: nonce.toString("hex") }) + "\n"
  );
  const ID = randomUUID();
  const pending = join(directory, ".pending-" + ID);
  const archive = join(directory, "cal-public-" + createdAt.replaceAll(":", "-") + "-" + ID + ".calbak");
  const cipher = createCipheriv(algorithm, key, nonce, { authTagLength: 16 });
  cipher.setAAD(header);
  writeFileSync(pending, header, { mode: 0o600, flag: "wx" });
  try {
    const child = spawn(
      "pg_dump",
      [
        "--dbname=service=" +
          service +
          " sslmode=verify-full connect_timeout=10 options='-c default_transaction_read_only=on'",
        "--no-password",
        "--lock-wait-timeout=30000",
        "--schema=public",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--no-subscriptions",
        "--no-publications",
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    let status;
    try {
      [status] = await Promise.all([
        once(child, "close"),
        pipeline(child.stdout, cipher, createWriteStream(pending, { flags: "a" })),
      ]);
    } catch {
      child.kill();
      throw new Error("The pg_dump stream failed.");
    }
    if (status[0] !== 0) throw new Error("pg_dump failed. Verify the source service and PostgreSQL tools.");
    appendFileSync(pending, cipher.getAuthTag());
    const fd = openSync(pending, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const verification = inspect(pending, key);
    linkSync(pending, archive);
    return { ...verification, archive };
  } finally {
    unlinkSync(pending);
  }
}

function restore(archive, key, socket, port, database) {
  const { header, plaintext } = authenticate(archive, key);
  const env = { ...process.env, LC_ALL: "C", PGCONNECT_TIMEOUT: "10" };
  for (const name of ["PGSERVICE", "PGSERVICEFILE", "PGHOSTADDR", "PGOPTIONS"]) delete env[name];
  const target = ["--host=" + socket, "--port=" + port, "--dbname=" + database, "--no-password"];
  try {
    const list = pg("pg_restore", ["--list"], plaintext);
    const state = pg(
      "psql",
      [
        ...target,
        "--no-psqlrc",
        "--no-align",
        "--tuples-only",
        "--set=ON_ERROR_STOP=1",
        "--command=" + emptyTargetCheck,
      ],
      undefined,
      env
    );
    if (state.trim() !== database + "|t|t") {
      throw new Error("The restore target must be an empty database on a local Unix socket.");
    }
    const directory = mkdtempSync(join(tmpdir(), "cal-restore-"));
    try {
      // PostgreSQL creates an empty public schema when it initializes a database.
      const entries = list.replace(/^\d+; \d+ \d+ SCHEMA - public .*$/gm, "; existing public schema");
      const listPath = join(directory, "restore.list");
      writeFileSync(listPath, entries, { mode: 0o600 });
      pg(
        "pg_restore",
        [...target, "--use-list=" + listPath, "--single-transaction", "--no-privileges", "--no-owner"],
        plaintext,
        env
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  } finally {
    plaintext.fill(0);
  }
  return { database, sourceCommit: header.sourceCommit, restored: true };
}

function retain(directory, key, keep, apply) {
  privateDirectory(directory);
  const archives = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && archiveName.test(entry.name))
    .map(({ name }) => {
      const { header, plaintext } = authenticate(join(directory, name), key);
      plaintext.fill(0);
      return { name, createdAt: header.createdAt };
    });
  archives.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  const retiring = archives.slice(keep).map(({ name }) => name);
  const retained = archives.slice(0, keep).map(({ name }) => name);
  if (apply && retiring.length) {
    const retired = join(directory, "retired");
    mkdirSync(retired, { mode: 0o700, recursive: true });
    privateDirectory(retired);
    for (const name of retiring) {
      const path = join(directory, name);
      const destination = join(retired, basename(path));
      // Create the new link before removing the old one. Existing archives cannot be overwritten.
      try {
        linkSync(path, destination);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        // An interrupted move may have already linked the same recovery point.
        const activeFile = lstatSync(path, { bigint: true });
        const retiredFile = lstatSync(destination, { bigint: true });
        if (
          !retiredFile.isFile() ||
          retiredFile.dev !== activeFile.dev ||
          retiredFile.ino !== activeFile.ino
        ) {
          throw new Error("A different retired archive already uses this name.");
        }
      }
      unlinkSync(path);
    }
  }
  return { retained, retire: retiring, moved: apply ? retiring.length : 0 };
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help") {
    console.log(usage);
    return;
  }
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      directory: { type: "string" },
      "key-file": { type: "string" },
      service: { type: "string" },
      "source-commit": { type: "string" },
      archive: { type: "string" },
      socket: { type: "string" },
      port: { type: "string" },
      database: { type: "string" },
      keep: { type: "string" },
      apply: { type: "boolean" },
    },
  });
  if (!values["key-file"]) throw new Error("Specify --key-file.");
  const key = readPrivateFile(values["key-file"], true);
  try {
    const directory = values.directory && resolve(values.directory);
    const archive = values.archive && resolve(values.archive);
    const keep = Number(values.keep);
    const validKeep = Number.isSafeInteger(keep) && keep > 0;
    if (
      (command === "capture" || (command === "cycle" && validKeep)) &&
      directory &&
      /^[a-zA-Z0-9_-]+$/.test(values.service ?? "") &&
      commitPattern.test(values["source-commit"] ?? "")
    ) {
      const backup = await capture(directory, key, values.service, values["source-commit"]);
      if (command === "capture") return backup;
      try {
        return { backup, retention: retain(directory, key, keep, true) };
      } catch {
        throw new Error(
          "The new backup was saved, but retention could not finish. Verify the active and retired archives."
        );
      }
    }
    if (command === "inspect" && archive) return inspect(archive, key);
    const port = Number(values.port);
    if (
      command === "restore" &&
      archive &&
      values.socket &&
      isAbsolute(values.socket) &&
      !values.socket.includes(",") &&
      /^\d{1,5}$/.test(values.port ?? "") &&
      port > 0 &&
      port < 65536 &&
      /^[a-z][a-z0-9_]*$/.test(values.database ?? "")
    ) {
      return restore(archive, key, values.socket, port, values.database);
    }
    if (command === "retain" && directory && validKeep) {
      return retain(directory, key, keep, values.apply);
    }
    throw new Error("Invalid CAL backup arguments. Run with --help.");
  } finally {
    key.fill(0);
  }
}

try {
  const result = await main();
  if (result) console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
