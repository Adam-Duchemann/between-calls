import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");
const root = fileURLToPath(new URL("../", import.meta.url));

for (const file of [
  "packages/lib/constants.ts",
  "apps/web/modules/auth/login-view.tsx",
  "apps/web/modules/signup-view.tsx",
  "apps/web/modules/settings/my-account/profile-view.tsx",
  "apps/web/components/apps/alby/Setup.tsx",
  "apps/web/modules/bookings/components/Booker.tsx",
  "apps/web/lib/app-providers.tsx",
  "packages/app-store/googlecalendar/_metadata.ts",
  "packages/app-store/googlevideo/_metadata.ts",
  "packages/app-store/dailyvideo/_metadata.ts",
  "packages/app-store/stripepayment/_metadata.ts",
]) {
  test(`${file} has no runtime Node imports in browser code`, () => {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(root, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const nodeImports = source.statements
      .filter((statement) => ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly)
      .map((statement) => statement.moduleSpecifier.text)
      .filter((specifier) => specifier.startsWith("node:"));
    assert.deepEqual(nodeImports, [], "Node builtins cannot be bundled for these browser modules");
  });
}

test("shared locale options bundle for browsers without Node builtins", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "cal-browser-build-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = readFileSync(join(root, "packages/lib/i18n.ts"), "utf8");
  const entry = join(directory, "entry.js");
  writeFileSync(
    entry,
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    }).outputText
  );
  const compiler = webpack({
    mode: "none",
    target: "web",
    context: root,
    entry,
    devtool: false,
    resolve: { modules: [join(root, "node_modules"), "node_modules"] },
    output: { path: directory, filename: "bundle.js", library: { type: "commonjs2" } },
    optimization: { minimize: false },
  });
  const stats = await new Promise((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close((closeError) => {
        if (error || closeError) reject(error || closeError);
        else resolve(result);
      });
    });
  });
  assert.ok(!stats.hasErrors(), stats.toString({ all: false, errors: true }));
  const module = { exports: {} };
  runInNewContext(readFileSync(join(directory, "bundle.js"), "utf8"), { module, Intl });
  const expected = require("@calcom/i18n/next-i18next.config").i18n;
  assert.deepEqual(Array.from(module.exports.locales), expected.locales);
  assert.equal(module.exports.defaultLocaleOption.value, expected.defaultLocale);
  assert.ok(module.exports.localeOptions.some((option) => option.value === "fr"));
});
