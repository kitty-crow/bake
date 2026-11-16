import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import assert from "node:assert/strict";
import { bake } from "../src/index";
import { createBakeCoreEngine } from "../src/core-engine";
import {
  BAKE_ACTION_LOWER,
  BAKE_ACTION_NONE,
  BAKE_ACTION_WARNING,
  BAKE_FACT_EXCEPTION,
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

test("passes Baguette-supported try and throw syntax through unchanged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bake-exception-"));
  try {
    fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext", types: [] },
      files: ["input.ts"]
    }, null, 2));
    fs.writeFileSync(
      path.join(root, "input.ts"),
      "export function positive(value: number): number {\n  try {\n    if (value < 0) throw new RangeError(\"negative\");\n    return value;\n  } finally {\n  }\n}\n"
    );

    const result = bake({
      project: path.join(root, "tsconfig.json"),
      outDir: "out",
      validateOnly: false,
      failOnWarnings: false
    });
    assert.equal(result.success, true);
    assert.ok(!result.diagnostics.some(item => item.code === "BK2201"));
    const output = fs.readFileSync(path.join(root, "out", "input.ts"), "utf8");
    assert.match(output, /try/);
    assert.match(output, /throw new RangeError/);
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
  assert.ok(!result.diagnostics.some(item => item.code === "BK2201"));
});

test("hosted core exposes the policy that is compiled to Wasm", () => {
  const core = createBakeCoreEngine("host");
  const lower = core.decide(BAKE_FACT_NULLISH, 0, 4, 1);
  assert.equal(bakeDecisionAction(lower), BAKE_ACTION_LOWER);
  assert.equal(bakeDecisionPayload(lower), 2);

  const unsafe = core.decide(BAKE_FACT_NULLISH, BAKE_FLAG_IMPURE, 4, -1);
  assert.equal(bakeDecisionAction(unsafe), BAKE_ACTION_WARNING);

  const exception = core.decide(BAKE_FACT_EXCEPTION, 0, 0, 0);
  assert.equal(bakeDecisionAction(exception), BAKE_ACTION_NONE);
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

test("omitted target and explicit wasm target emit identical source", () => {
  const root = path.join(fixtureRoot, "lowering");
  const implicit = "out-implicit-wasm";
  const explicit = "out-explicit-wasm";
  try {
    const defaults = bake({
      project: path.join(root, "tsconfig.json"), outDir: implicit,
      validateOnly: false, failOnWarnings: false, engine: "host"
    });
    const wasm = bake({
      project: path.join(root, "tsconfig.json"), outDir: explicit,
      validateOnly: false, failOnWarnings: false, engine: "host", target: "wasm"
    });
    assert.equal(defaults.success, true);
    assert.equal(wasm.success, true);
    assert.equal(defaults.target, "wasm");
    assert.equal(wasm.target, "wasm");
    assert.equal(
      fs.readFileSync(path.join(root, implicit, "input.ts"), "utf8"),
      fs.readFileSync(path.join(root, explicit, "input.ts"), "utf8")
    );
    const defaultManifest = JSON.parse(fs.readFileSync(path.join(root, implicit, "bake-manifest.json"), "utf8"));
    assert.equal(defaultManifest.target.compiler, "Baguette");
  } finally {
    fs.rmSync(path.join(root, implicit), { recursive: true, force: true });
    fs.rmSync(path.join(root, explicit), { recursive: true, force: true });
  }
});

test("clang target lowers loops, bindings, nullish and hoists statically bound functions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bake-clang-"));
  try {
    fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext", types: [] },
      files: ["input.ts"]
    }));
    fs.writeFileSync(path.join(root, "input.ts"), [
      "export const add = (a: number, b: number) => a + b;",
      "export function calculate(values: number[], value: number | null): number {",
      "  const [first, second] = values;",
      "  let total = value ?? first ?? 0;",
      "  for (const part of values) { total += part; }",
      "  const extra = 3;",
      "  return add(total, second + extra);",
      "}"
    ].join("\n") + "\n");
    const result = bake({
      project: path.join(root, "tsconfig.json"), outDir: "out", target: "clang",
      validateOnly: false, failOnWarnings: true, engine: "host"
    });
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.equal(result.target, "clang");
    const emitted = fs.readFileSync(path.join(root, "out/input.ts"), "utf8");
    assert.match(emitted, /export function add\(/);
    assert.match(emitted, /const extra: number = 3/);
    assert.match(emitted, /for \(let __bake_index_/);
    assert.match(emitted, /__bake_destructure_/);
    assert.ok(!emitted.includes("??"));
    assert.ok(!emitted.includes("=>"));
    assert.ok(!emitted.includes("for (const part of"));
    const generated = ts.createProgram([path.join(root, "out/input.ts")], {
      strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, types: []
    });
    const generatedErrors = ts.getPreEmitDiagnostics(generated);
    assert.equal(generatedErrors.length, 0,
      generatedErrors.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\\n")).join("\\n"));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "out/bake-manifest.json"), "utf8"));
    assert.equal(manifest.target.backend, "clang");
    assert.equal(manifest.target.freestanding, true);
    assert.equal(manifest.target.format, "lowered-typescript");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clang mode rejects exception and runtime-dependent constructs without emitting output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bake-clang-errors-"));
  try {
    fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext", types: [] },
      files: ["input.ts"]
    }));
    fs.writeFileSync(path.join(root, "input.ts"), [
      'export function run(): number {',
      '  try { throw new Error("unavailable"); } catch { return 0; }',
      '}'
    ].join("\n") + "\n");
    const clang = bake({
      project: path.join(root, "tsconfig.json"), outDir: "out", target: "clang",
      validateOnly: false, failOnWarnings: false, engine: "host"
    });
    assert.equal(clang.success, false);
    assert.ok(clang.diagnostics.some(d => d.code === "BK4001"));
    assert.equal(fs.existsSync(path.join(root, "out")), false);
    const wasm = bake({
      project: path.join(root, "tsconfig.json"), outDir: "out-wasm", target: "wasm",
      validateOnly: true, failOnWarnings: false, engine: "host"
    });
    assert.ok(!wasm.diagnostics.some(d => d.code === "BK4001"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clang refuses to duplicate a side-effecting nullish operand", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bake-clang-nullish-"));
  try {
    fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "ESNext", types: [] },
      files: ["input.ts"]
    }));
    fs.writeFileSync(path.join(root, "input.ts"),
      "declare function load(): number | null;\nexport function get(): number { return load() ?? 3; }\n");
    const result = bake({
      project: path.join(root, "tsconfig.json"), outDir: "out", target: "clang",
      validateOnly: false, failOnWarnings: false, engine: "host"
    });
    assert.equal(result.success, false);
    assert.ok(result.diagnostics.some(d => d.code === "BK3001"));
    assert.equal(fs.existsSync(path.join(root, "out")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source and tooling directories contain no JavaScript source files", () => {
  const inspect = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "out") inspect(location);
      } else {
        assert.doesNotMatch(entry.name, /\.(?:js|jsx|mjs|cjs)$/i, location);
      }
    }
  };
  for (const name of ["src", "scripts", "test"]) inspect(path.join(repositoryRoot, name));
});

test("CLI accepts both target forms, defaults to wasm and rejects invalid target values", () => {
  const cli = path.join(repositoryRoot, "dist/cli.js");
  const project = path.join(fixtureRoot, "lowering/tsconfig.json");
  const base = ["--project", project, "--validate-only", "--engine=host"];
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...base, ...args], { encoding: "utf8" });
  const implicit = run();
  const explicit = run("--target=wasm");
  const clang = run("--target", "clang");
  const invalid = run("--target=invalid");
  const missing = run("--target");
  assert.equal(implicit.status, 0, implicit.stderr);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.equal(clang.status, 0, clang.stderr);
  assert.equal(implicit.stdout, explicit.stdout);
  assert.match(clang.stdout, /ready for freestanding C backend validation/);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid Bake target/);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing value for --target/);
});
