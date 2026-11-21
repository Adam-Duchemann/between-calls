import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(process.argv[2] || ".");
for (const path of [
  "apps/web/server.js",
  "apps/web/.next/static",
  "apps/web/public/fonts/Inter-roman.var.woff2",
  "packages/i18n/locales/en/common.json",
  "i18n.json",
]) {
  assert.ok(existsSync(join(root, path)), `Missing packaged file: ${path}`);
}
assert.notEqual(process.getuid?.(), 0, "Runtime must be non-root");

const require = createRequire(join(root, "apps/web/server.js"));
const sharp = require("sharp");
const { info } = await sharp(Buffer.from([255, 0, 0, 255]), {
  raw: { width: 1, height: 1, channels: 4 },
})
  .resize(2, 2)
  .png()
  .toBuffer({ resolveWithObject: true });
assert.equal(info.width, 2);
assert.equal(info.height, 2);
assert.equal(info.format, "png");
console.log("Standalone assets, non-root user and native image processing passed.");
