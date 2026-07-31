import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { bake } from "../src/index";

const source = `
interface Pack { meta: { code: string }; items: string[]; }

function rec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): value is string {
  return typeof value === "string";
}

export function isPack(value: unknown): value is Pack {
  return rec(value) && rec(value.meta) && str(value.meta.code) &&
    Array.isArray(value.items) && value.items.every(item => str(item) && item.trim().length < 20);
}
`;

test("wide lowering turns unknown JSON guards into explicit host capabilities", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bake-json-"));
  try {
    fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext", types: [] },
      files: ["input.ts"]
    }, null, 2));
    fs.writeFileSync(path.join(root, "input.ts"), source);

    const safe = bake({ project: path.join(root, "tsconfig.json"), outDir: "safe", validateOnly: true, failOnWarnings: false });
    assert.equal(safe.success, false);
    assert.ok(safe.diagnostics.some(item => item.code === "BK1002"));

    const wide = bake({
      project: path.join(root, "tsconfig.json"),
      outDir: "wide",
      validateOnly: false,
      failOnWarnings: true,
      lowering: "wide"
    });
    assert.equal(wide.success, true);
    const output = fs.readFileSync(path.join(root, "wide", "input.ts"), "utf8");
    assert.ok(!output.includes(": unknown"));
    assert.ok(!output.includes(" is Pack"));
    assert.match(output, /__bq_json_kind/);
    assert.match(output, /__bq_json_get/);
    assert.match(output, /__bq_json_at/);
    assert.match(output, /__bq_json_trim_len/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
