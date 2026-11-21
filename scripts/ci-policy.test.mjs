import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";

test("private CAL only exposes its manual validation workflow", () => {
  const workflows = readdirSync(new URL("../.github/workflows/", import.meta.url))
    .filter((file) => /\.ya?ml$/.test(file))
    .sort();
  assert.deepEqual(workflows, ["cal-private-build.yml"]);
});
