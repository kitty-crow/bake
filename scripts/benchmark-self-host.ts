#!/usr/bin/env bun
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { bake } from "../src/index";
import type { BakeEngineImplementation } from "../src/core-engine";

interface BenchmarkSample {
  readonly engine: BakeEngineImplementation;
  readonly iteration: number;
  readonly bakeMilliseconds: number;
  readonly stageOneSha256: string;
  readonly emittedFiles: number;
}

interface TimingSummary {
  readonly mean: number;
  readonly median: number;
  readonly minimum: number;
  readonly maximum: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(`Expected a non-negative integer, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

function filesBelow(directory: string, prefix = ""): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(absolute, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

function sha256StageOne(directory: string): string {
  const hash = createHash("sha256");
  const sourceFiles = filesBelow(directory).filter(relative => relative.endsWith(".ts"));
  if (sourceFiles.length === 0) fail(`Bake emitted no TypeScript below ${directory}`);
  for (const relative of sourceFiles) {
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(directory, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function summarise(values: readonly number[]): TimingSummary {
  if (values.length === 0) fail("Cannot summarise an empty timing set");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median,
    minimum: sorted[0]!,
    maximum: sorted[sorted.length - 1]!
  };
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(2)} ms`;
}

function formatSummary(summary: TimingSummary): string {
  return `mean ${formatMilliseconds(summary.mean)}, median ${formatMilliseconds(summary.median)}, min ${formatMilliseconds(summary.minimum)}, max ${formatMilliseconds(summary.maximum)}`;
}

function runSample(
  root: string,
  benchmarkRoot: string,
  wasmCore: string,
  engine: BakeEngineImplementation,
  iteration: number,
  measured: boolean
): BenchmarkSample {
  const runRoot = path.join(benchmarkRoot, "work");
  const stageOneDirectory = path.join(runRoot, "stage-one");
  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(runRoot, { recursive: true });

  const started = performance.now();
  const result = bake({
    project: path.join(root, "tsconfig.core.json"),
    outDir: stageOneDirectory,
    validateOnly: false,
    failOnWarnings: true,
    engine,
    wasmFile: wasmCore
  });
  const bakeMilliseconds = performance.now() - started;

  if (!result.success) fail(`${engine} Bake failed during benchmark`);
  if (result.engine !== engine) fail(`Requested ${engine} Bake but ${result.engine} ran`);

  const sample = {
    engine,
    iteration,
    bakeMilliseconds,
    stageOneSha256: sha256StageOne(stageOneDirectory),
    emittedFiles: result.emittedFiles.length
  };

  if (measured) {
    process.stdout.write(
      `${engine === "host" ? "ts-core" : "wasm-core"} run ${iteration}: ` +
      `Bake ${formatMilliseconds(bakeMilliseconds)}\n`
    );
  }

  return sample;
}

function main(): void {
  const root = path.resolve(__dirname, "..");
  const runs = positiveInteger(process.env.BAKE_BENCH_RUNS, 3);
  const warmups = positiveInteger(process.env.BAKE_BENCH_WARMUPS, 1);
  if (runs < 1) fail("BAKE_BENCH_RUNS must be at least 1");

  const wasmCore = path.join(root, "dist-wasm/bake-core.wasm");
  if (!fs.existsSync(wasmCore)) {
    fail(`Wasm core was not found at ${wasmCore}. Run npm run bootstrap first.`);
  }

  const benchmarkRoot = path.join(root, "build/self-host-benchmark");
  fs.rmSync(benchmarkRoot, { recursive: true, force: true });
  fs.mkdirSync(benchmarkRoot, { recursive: true });

  process.stdout.write(
    `Bake engine benchmark: ${runs} measured sequential pair(s), ${warmups} warmup pair(s). ` +
    `Baguette is not executed or timed.\n`
  );

  for (let warmup = 1; warmup <= warmups; warmup++) {
    runSample(root, benchmarkRoot, wasmCore, "host", warmup, false);
    runSample(root, benchmarkRoot, wasmCore, "wasm", warmup, false);
  }

  const samples: BenchmarkSample[] = [];
  for (let iteration = 1; iteration <= runs; iteration++) {
    const order: readonly BakeEngineImplementation[] = iteration % 2 === 1
      ? ["host", "wasm"]
      : ["wasm", "host"];
    for (const engine of order) {
      samples.push(runSample(root, benchmarkRoot, wasmCore, engine, iteration, true));
    }
  }

  const host = samples.filter(sample => sample.engine === "host");
  const wasm = samples.filter(sample => sample.engine === "wasm");
  const stageOneHashes = new Set(samples.map(sample => sample.stageOneSha256));
  const emittedCounts = new Set(samples.map(sample => sample.emittedFiles));
  if (stageOneHashes.size !== 1) {
    fail("ts-core and wasm-core emitted different Stage 1 TypeScript modules");
  }
  if (emittedCounts.size !== 1) {
    fail("ts-core and wasm-core reported different emitted-file counts");
  }

  const hostBake = summarise(host.map(sample => sample.bakeMilliseconds));
  const wasmBake = summarise(wasm.map(sample => sample.bakeMilliseconds));
  const bakeSpeedRatio = hostBake.mean / wasmBake.mean;

  process.stdout.write("\nResults\n");
  process.stdout.write(`  ts-core Bake:   ${formatSummary(hostBake)}\n`);
  process.stdout.write(`  wasm-core Bake: ${formatSummary(wasmBake)}\n`);
  process.stdout.write(
    `  Wasm Bake speed ratio: ${bakeSpeedRatio.toFixed(3)}x, ` +
    `where above 1 means wasm-core was faster.\n`
  );
  process.stdout.write(`  Identical Stage 1 TypeScript SHA-256: ${samples[0]!.stageOneSha256}\n`);
  process.stdout.write(`  Emitted files per run: ${samples[0]!.emittedFiles}\n`);

  const report = {
    schema: 2,
    benchmark: "bake-engine",
    runs,
    warmups,
    wasmCore,
    samples,
    summaries: {
      hostBake,
      wasmBake,
      bakeSpeedRatio
    },
    stageOneSha256: samples[0]!.stageOneSha256,
    emittedFiles: samples[0]!.emittedFiles
  };
  const reportFile = path.join(benchmarkRoot, "report.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`  Report: ${reportFile}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Bake benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
