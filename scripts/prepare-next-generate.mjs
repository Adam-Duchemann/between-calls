import assert from "node:assert/strict";
import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function prepareProxyOutput(directory) {
  const proxy = join(directory, "proxy.js");
  const proxyTrace = `${proxy}.nft.json`;
  if (existsSync(proxy) || existsSync(proxyTrace)) {
    assert.ok(existsSync(proxy) && existsSync(proxyTrace), "Incomplete proxy output from compilation");
    return;
  }

  const middleware = join(directory, "middleware.js");
  const trace = JSON.parse(readFileSync(`${middleware}.nft.json`, "utf8"));
  assert.ok(
    trace.version === 1 &&
      Array.isArray(trace.files) &&
      trace.files.every((file) => typeof file === "string"),
    "Invalid middleware file trace from compilation"
  );
  // Next 16.4.3 renames proxy outputs in both split build phases: vercel/next.js#86753.
  // Keep middleware available while generate loads pages, then let Next rename the copies.
  copyFileSync(middleware, proxy, constants.COPYFILE_EXCL);
  writeFileSync(
    proxyTrace,
    JSON.stringify({
      ...trace,
      files: trace.files.map((file) => (file === "middleware.js" ? "proxy.js" : file)),
    }),
    { flag: "wx" }
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  prepareProxyOutput(resolve("apps/web/.next/server"));
}

export { prepareProxyOutput };
