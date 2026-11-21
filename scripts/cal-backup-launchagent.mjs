import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const launcher = fileURLToPath(import.meta.url);
const label = "local.cal.backup";
const pathFields = ["directory", "keyFile", "pgServiceFile", "postgresBin"];
const keychainFields = ["keychainService", "keychainAccount"];
const fields = new Set([...pathFields, ...keychainFields, "sourceCommit", "hour", "minute"]);
const ownedOnly = (stat) => stat.uid === process.getuid() && !(stat.mode & 0o077);

function readConfig(configPath) {
  const config = lstatSync(configPath);
  if (!config.isFile() || !ownedOnly(config) || !ownedOnly(lstatSync(dirname(configPath)))) {
    throw new Error("Use an owner-only configuration file in an owner-only directory.");
  }
  let settings;
  try {
    settings = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error("The configuration must contain a valid JSON object.");
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("The configuration must contain a valid JSON object.");
  }
  if (Object.keys(settings).some((key) => !fields.has(key))) {
    throw new Error("Remove the unknown configuration field.");
  }
  if (pathFields.some((key) => typeof settings[key] !== "string" || !isAbsolute(settings[key]))) {
    throw new Error("Use absolute archive, key, service file and PostgreSQL paths.");
  }
  if (keychainFields.some((key) => typeof settings[key] !== "string" || !settings[key].trim())) {
    throw new Error("Specify the existing Keychain service and account names.");
  }
  if (typeof settings.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(settings.sourceCommit)) {
    throw new Error("Specify the deployed commit as a 40-character Git SHA.");
  }
  if (
    !Number.isInteger(settings.hour) ||
    settings.hour < 0 ||
    settings.hour > 23 ||
    !Number.isInteger(settings.minute) ||
    settings.minute < 0 ||
    settings.minute > 59
  ) {
    throw new Error("Specify an hour and minute in the backup host's local time.");
  }
  const directory = lstatSync(settings.directory);
  const key = lstatSync(settings.keyFile);
  const service = lstatSync(settings.pgServiceFile);
  if (!directory.isDirectory() || !ownedOnly(directory)) {
    throw new Error("Use an owner-only archive directory.");
  }
  if (!key.isFile() || key.size !== 32 || !ownedOnly(key) || !service.isFile() || !ownedOnly(service)) {
    throw new Error("Use an owner-only 32-byte backup key and an owner-only PostgreSQL service file.");
  }
  return settings;
}

function render(configPath, { hour, minute }) {
  const job = {
    Label: label,
    ProgramArguments: [process.execPath, launcher, "run", configPath],
    StartCalendarInterval: { Hour: hour, Minute: minute },
    StandardOutPath: join(dirname(configPath), "cal-backup.out.log"),
    StandardErrorPath: join(dirname(configPath), "cal-backup.err.log"),
    Umask: 0o077,
  };
  const plist = spawnSync("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", "--", "-"], {
    input: JSON.stringify(job),
    encoding: "utf8",
  });
  if (plist.status !== 0) throw new Error("Could not generate the macOS LaunchAgent plist.");
  process.stdout.write(plist.stdout);
}

function run(settings) {
  const credential = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", settings.keychainService, "-a", settings.keychainAccount, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 12000 }
  );
  const password = credential.stdout?.replace(/\r?\n$/, "");
  if (credential.status !== 0 || !password) throw new Error("The CAL database password was unavailable.");

  const cycle = spawnSync(
    process.execPath,
    [
      join(dirname(launcher), "cal-backup.mjs"),
      "cycle",
      "--directory",
      settings.directory,
      "--key-file",
      settings.keyFile,
      "--service",
      "cal-source",
      "--source-commit",
      settings.sourceCommit,
      "--keep",
      "14",
    ],
    {
      env: {
        PATH: settings.postgresBin + ":/usr/bin:/bin",
        PGSERVICEFILE: settings.pgServiceFile,
        PGPASSWORD: password,
      },
      stdio: "inherit",
    }
  );
  process.exitCode = cycle.status ?? 1;
}

try {
  const [command, configFile, extra] = process.argv.slice(2);
  if ((command !== "render" && command !== "run") || !configFile || extra !== undefined) {
    throw new Error("Usage: node scripts/cal-backup-launchagent.mjs render|run CONFIG.json");
  }
  if (process.platform !== "darwin") throw new Error("The LaunchAgent requires macOS.");
  const configPath = resolve(configFile);
  const settings = readConfig(configPath);
  if (command === "render") render(configPath, settings);
  else run(settings);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
