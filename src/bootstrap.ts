#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createBakeCoreEngine } from "./core-engine";
import {
  BAKE_FACT_ANY,
  BAKE_FACT_DESTRUCTURE,
  BAKE_FACT_FOR_OF,
  BAKE_FACT_NULLISH,
  BAKE_FLAG_IMPURE,
  BAKE_FLAG_UNSUPPORTED_BINDING
} from "./core/protocol";
import { bake, printBakeResult } from "./index";

function fail(message: string): never {
  throw new Error(message);
}

function verifyCore(wasmFile: string): void {
  const host = createBakeCoreEngine("host");
  const wasm = createBakeCoreEngine("wasm", wasmFile);
  const facts: ReadonlyArray<readonly [number, number, number, number]> = [
    [BAKE_FACT_ANY, 0, 0, 0],
    [BAKE_FACT_NULLISH, 0, 4, -1],
    [BAKE_FACT_NULLISH, 0, 4, 1],
    [BAKE_FACT_NULLISH, BAKE_FLAG_IMPURE, 4, -1],
    [BAKE_FACT_FOR_OF, 0, 0, 0],
    [BAKE_FACT_DESTRUCTURE, BAKE_FLAG_UNSUPPORTED_BINDING, 0, 0]
  ];

  for (const fact of facts) {
    const expected = host.decide(fact[0], fact[1], fact[2], fact[3]);
    const actual = wasm.decide(fact[0], fact[1], fact[2], fact[3]);
    if (actual !== expected) {
      fail(`Wasm core decision ${actual} does not match hosted decision ${expected} for fact ${fact[0]}`);
    }
  }
}

function main(): void {
  const root = path.resolve(__dirname, "..");
  const selfHostDir = path.join(root, "build/self-host");
  const wasmFile = path.join(root, "dist-wasm/bake-core.wasm");
  fs.rmSync(selfHostDir, { recursive: true, force: true });
  fs.rmSync(path.join(root, "build/baguette-generated"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "dist-wasm"), { recursive: true, force: true });

  const result = bake({
    project: path.join(root, "tsconfig.core.json"),
    outDir: "build/self-host",
    validateOnly: false,
    failOnWarnings: true,
    engine: "host"
  });
  printBakeResult(result);
  if (!result.success) fail("Stage 0 Bake could not produce a Baguette-compatible Stage 1 core");

  const configuredCompiler = process.env.BAGUETTE_COMPILER;
  const compiler = configuredCompiler
    ? path.resolve(configuredCompiler)
    : path.resolve(root, "../baguette/src/compiler.ts");
  if (!fs.existsSync(compiler)) {
    fail(`Baguette compiler was not found at ${compiler}. Set BAGUETTE_COMPILER or clone Baguette beside Bake.`);
  }

  const command = spawnSync(
    "bun",
    [compiler, "--config", path.join(root, "baguette.config.json")],
    { cwd: root, env: process.env, stdio: "inherit" }
  );
  if (command.error) fail(`Could not start Baguette: ${command.error.message}`);
  if (command.status !== 0) fail(`Baguette exited with status ${command.status ?? -1}`);
  if (!fs.existsSync(wasmFile)) fail(`Baguette completed without producing ${wasmFile}`);

  verifyCore(wasmFile);
  process.stdout.write(`Bake bootstrap complete: ${wasmFile}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Bake bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
