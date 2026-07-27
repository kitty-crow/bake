import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { bake } from "../src/index";
import { createBakeCoreEngine } from "../src/core-engine";
import {
  BAKE_ACTION_LOWER,
  BAKE_ACTION_WARNING,
  BAKE_FACT_NULLISH,
  BAKE_FLAG_IMPURE,
  bakeDecisionAction,
  bakeDecisionPayload
} from "../src/core/protocol";

const repositoryRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repositoryRoot, "test/fixtures");

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
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext", types: [] },
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

test("hosted core exposes the policy that is compiled to Wasm", () => {
  const core = createBakeCoreEngine("host");
  const lower = core.decide(BAKE_FACT_NULLISH, 0, 4, 1);
  assert.equal(bakeDecisionAction(lower), BAKE_ACTION_LOWER);
  assert.equal(bakeDecisionPayload(lower), 2);

  const unsafe = core.decide(BAKE_FACT_NULLISH, BAKE_FLAG_IMPURE, 4, -1);
  assert.equal(bakeDecisionAction(unsafe), BAKE_ACTION_WARNING);
});

test("Bake can bake its dependency-free core", () => {
  const output = path.join(repositoryRoot, "build/test-self-host");
  fs.rmSync(output, { recursive: true, force: true });
  try {
    const result = bake({
      project: path.join(repositoryRoot, "tsconfig.core.json"),
      outDir: "build/test-self-host",
      validateOnly: false,
      failOnWarnings: true,
      engine: "host"
    });
    assert.equal(result.success, true);
    assert.equal(result.engine, "host");

    const protocol = fs.readFileSync(path.join(output, "protocol.ts"), "utf8");
    const entry = fs.readFileSync(path.join(output, "wasm-entry.ts"), "utf8");
    assert.ok(!protocol.includes("typescript"));
    assert.ok(!protocol.includes("node:"));
    assert.ok(!entry.includes("node:"));
    assert.ok(!protocol.includes("??"));
    assert.ok(!entry.includes("??"));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
