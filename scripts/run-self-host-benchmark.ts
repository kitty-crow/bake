#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";

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

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function writeProgress(message: string): void {
  try {
    fs.appendFileSync("/dev/tty", message, "utf8");
  } catch {
    process.stderr.write(message);
  }
}

function main(): void {
  const root = path.resolve(__dirname, "..");
  const runs = positiveInteger(process.env.BAKE_BENCH_RUNS, 3);
  const progressEnabled = process.env.BAKE_BENCH_PROGRESS !== "0";
  const progressEvery = Math.max(
    1,
    positiveInteger(
      process.env.BAKE_BENCH_PROGRESS_EVERY,
      Math.max(1, Math.floor(runs / 100))
    )
  );
  const script = path.join(root, "scripts/benchmark-self-host.ts");
  const started = performance.now();
  let completedSamples = 0;
  let completedPairs = 0;
  let stdoutBuffer = "";

  const child = spawn("bun", [script], {
    cwd: root,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  function inspectLine(line: string): void {
    if (!/^(?:ts-core|wasm-core) run \d+:/.test(line)) return;
    completedSamples++;
    const pairs = Math.floor(completedSamples / 2);
    if (pairs <= completedPairs) return;
    completedPairs = pairs;
    if (!progressEnabled || (pairs % progressEvery !== 0 && pairs !== runs)) return;

    const elapsed = performance.now() - started;
    const rate = pairs / Math.max(elapsed, 1);
    const remaining = rate > 0 ? (runs - pairs) / rate : 0;
    const percentage = runs > 0 ? (pairs / runs) * 100 : 100;
    writeProgress(
      `[Bake benchmark] ${pairs}/${runs} sequential pairs ` +
      `(${percentage.toFixed(1)}%), elapsed ${formatDuration(elapsed)}, ` +
      `ETA ${formatDuration(remaining)}\n`
    );
  }

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    process.stdout.write(text);
    stdoutBuffer += text;
    while (true) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      inspectLine(line);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  child.on("error", error => {
    process.stderr.write(`Bake benchmark launcher failed: ${error.message}\n`);
    process.exitCode = 1;
  });

  child.on("close", code => {
    if (stdoutBuffer.length > 0) inspectLine(stdoutBuffer);
    if (progressEnabled) {
      writeProgress(
        `[Bake benchmark] finished with status ${code ?? 1} after ` +
        `${formatDuration(performance.now() - started)}\n`
      );
    }
    process.exitCode = code ?? 1;
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(`Bake benchmark launcher failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
