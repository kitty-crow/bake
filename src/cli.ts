#!/usr/bin/env node
import path from "node:path";
import type { BakeEngineMode } from "./core-engine";
import { bake, printBakeResult } from "./index";
import type { BakeLowering } from "./types";

interface ParsedArgs {
  project: string;
  outDir: string;
  validateOnly: boolean;
  reportFile?: string;
  failOnWarnings: boolean;
  engine: BakeEngineMode;
  wasmFile?: string;
  lowering: BakeLowering;
}

function valueAfter(args: string[], name: string): string | undefined {
  const direct = args.find(argument => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function engineAfter(args: string[]): BakeEngineMode {
  const value = valueAfter(args, "--engine") ?? process.env.BAKE_ENGINE ?? "auto";
  if (value === "auto" || value === "host" || value === "wasm") return value;
  throw new Error(`Invalid Bake engine ${JSON.stringify(value)}. Expected auto, host or wasm.`);
}

function loweringAfter(args: string[]): BakeLowering {
  const value = valueAfter(args, "--lowering") ?? "safe";
  if (value === "safe" || value === "wide") return value;
  throw new Error(`Invalid Bake lowering ${JSON.stringify(value)}. Expected safe or wide.`);
}

function usage(): string {
  return `Bake 0.2.0-dev\n\nUsage:\n  bake [--project tsconfig.json] [--out-dir build/bake]\n       [--validate-only] [--report bake-report.json] [--fail-on-warnings]\n       [--engine auto|wasm|host] [--wasm-file dist-wasm/bake-core.wasm]\n       [--lowering safe|wide]\n\nSafe is the backwards-compatible default. Wide additionally lowers a narrow,\ndocumented set of guard, exception, optional-chain and private-field patterns\nbefore Baguette performs authoritative validation.\n`;
}

function parseArgs(args: string[]): ParsedArgs {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage());
    process.exitCode = 0;
    throw new Error("__BAKE_HELP__");
  }
  const wasmFile = valueAfter(args, "--wasm-file");
  return {
    project: path.resolve(valueAfter(args, "--project") ?? "tsconfig.json"),
    outDir: valueAfter(args, "--out-dir") ?? "build/bake",
    validateOnly: args.includes("--validate-only"),
    reportFile: valueAfter(args, "--report"),
    failOnWarnings: args.includes("--fail-on-warnings"),
    engine: engineAfter(args),
    wasmFile: wasmFile ? path.resolve(wasmFile) : undefined,
    lowering: loweringAfter(args)
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = bake(options);
  printBakeResult(result);
  if (!result.success) process.exitCode = 1;
} catch (error) {
  if (error instanceof Error && error.message === "__BAKE_HELP__") {
    // Help was printed intentionally.
  } else {
    process.stderr.write(`Bake failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
