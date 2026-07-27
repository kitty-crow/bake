import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { bake } from "../src/index";

const fixtureRoot = path.resolve(__dirname, "../../test/fixtures");

test("suggests a concrete shape for unknown", () => {
  const result = bake({
    project: path.join(fixtureRoot, "unknown", "tsconfig.json"),
    outDir: "out",
    validateOnly: true,
    failOnWarnings: false
  });
  const diagnostic = result.diagnostics.find(item => item.code === "BK1002");
  assert.ok(diagnostic);
  assert.match(diagnostic?.suggestion?.replacement ?? "", /id: number/);
  assert.match(diagnostic?.suggestion?.replacement ?? "", /kind: "point"/);
});

test("lowers array for-of, destructuring and pure nullish coalescing", () => {
  const root = path.join(fixtureRoot, "lowering");
  fs.rmSync(path.join(root, "out"), { recursive: true, force: true });
  const result = bake({
    project: path.join(root, "tsconfig.json"),
    outDir: "out",
    validateOnly: false,
    failOnWarnings: false
  });
  assert.equal(result.success, true);
  const output = fs.readFileSync(path.join(root, "out", "input.ts"), "utf8");
  assert.match(output, /for \(let __bake_index_/);
  assert.match(output, /__bake_destructure_/);
  assert.match(output, /first !== null/);
  assert.match(output, /fallback !== null/);
  assert.ok(!output.includes("??"));
});

test("lowers long nullish chains with linear output growth", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bake-nullish-"));
  try {
    fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext" },
      files: ["input.ts"]
    }, null, 2));
    const chain = Array.from({ length: 128 }, () => "value").join(" ?? ");
    fs.writeFileSync(
      path.join(root, "input.ts"),
      `export function choose(value: number | null): number {\n  return ${chain} ?? 0;\n}\n`
    );

    const result = bake({
      project: path.join(root, "tsconfig.json"),
      outDir: "out",
      validateOnly: false,
      failOnWarnings: false
    });
    assert.equal(result.success, true);
    const output = fs.readFileSync(path.join(root, "out", "input.ts"), "utf8");
    assert.ok(!output.includes("??"));
    assert.ok(output.length < 50_000, `Expected bounded output, received ${output.length} characters`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects any and reports unsupported native features", () => {
  const result = bake({
    project: path.join(fixtureRoot, "unsupported", "tsconfig.json"),
    outDir: "out",
    validateOnly: true,
    failOnWarnings: false
  });
  assert.equal(result.success, false);
  assert.ok(result.diagnostics.some(item => item.code === "BK1001"));
  assert.ok(result.diagnostics.some(item => item.code === "BK2101"));
  assert.ok(result.diagnostics.some(item => item.code === "BK2201"));
});
