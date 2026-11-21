import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareProxyOutput } from "./prepare-next-generate.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "cal-proxy-output-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function compiled(directory) {
  writeFileSync(join(directory, "middleware.js"), "module.exports = { proxy: true };\n");
  writeFileSync(
    join(directory, "middleware.js.nft.json"),
    JSON.stringify({ version: 1, files: ["middleware.js", "chunks/runtime.js"] })
  );
}

test("generate can rename the proxy artifacts after compile already renamed them", (t) => {
  const directory = fixture(t);
  compiled(directory);
  const original = readFileSync(join(directory, "middleware.js"), "utf8");
  prepareProxyOutput(directory);
  assert.equal(readFileSync(join(directory, "middleware.js"), "utf8"), original);
  assert.equal(readFileSync(join(directory, "proxy.js"), "utf8"), original);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "proxy.js.nft.json"), "utf8")), {
    version: 1,
    files: ["proxy.js", "chunks/runtime.js"],
  });
  renameSync(join(directory, "proxy.js"), join(directory, "middleware.js"));
  renameSync(join(directory, "proxy.js.nft.json"), join(directory, "middleware.js.nft.json"));
  assert.equal(readFileSync(join(directory, "middleware.js"), "utf8"), original);
});

test("already prepared proxy outputs are preserved", (t) => {
  const directory = fixture(t);
  writeFileSync(join(directory, "proxy.js"), "new proxy output");
  writeFileSync(join(directory, "proxy.js.nft.json"), '{"version":1,"files":[]}');
  prepareProxyOutput(directory);
  assert.equal(readFileSync(join(directory, "proxy.js"), "utf8"), "new proxy output");
});

for (const invalid of ["missing", "invalid-json", "invalid-files", "partial-proxy"]) {
  test(`refuses ${invalid} output before preparing generation`, (t) => {
    const directory = fixture(t);
    if (invalid !== "missing") compiled(directory);
    if (invalid === "invalid-json") writeFileSync(join(directory, "middleware.js.nft.json"), "{");
    if (invalid === "invalid-files") {
      writeFileSync(join(directory, "middleware.js.nft.json"), '{"version":1,"files":[42]}');
    }
    if (invalid === "partial-proxy") writeFileSync(join(directory, "proxy.js"), "incomplete");
    assert.throws(() => prepareProxyOutput(directory));
    if (invalid !== "partial-proxy") assert.equal(existsSync(join(directory, "proxy.js")), false);
  });
}
