#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

type Engine = "host" | "wasm";

interface BenchmarkSample {
  readonly engine: Engine;
  readonly iteration: number;
  readonly bakeMilliseconds: number;
  readonly stageOneSha256: string;
  readonly emittedFiles: number;
}

interface BenchmarkReport {
  readonly schema: number;
  readonly benchmark: string;
  readonly runs: number;
  readonly warmups: number;
  readonly samples: readonly BenchmarkSample[];
  readonly stageOneSha256: string;
  readonly emittedFiles: number;
}

interface Summary {
  readonly mean: number;
  readonly median: number;
  readonly standardDeviation: number;
  readonly percentile95: number;
  readonly minimum: number;
  readonly maximum: number;
}

interface PairedSummary {
  readonly meanDifference: number;
  readonly medianDifference: number;
  readonly standardDeviation: number;
  readonly confidence95Low: number;
  readonly confidence95High: number;
  readonly wasmWins: number;
  readonly hostWins: number;
  readonly ties: number;
  readonly percentOfHostMean: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) fail("Cannot average an empty set");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) fail("Cannot find the median of an empty set");
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function standardDeviation(values: readonly number[], average: number): number {
  if (values.length < 2) return 0;
  const squaredDifferences = values.map(value => (value - average) ** 2);
  return Math.sqrt(squaredDifferences.reduce((sum, value) => sum + value, 0) / (values.length - 1));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) fail("Cannot find a percentile of an empty set");
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index]!;
}

function summarise(values: readonly number[]): Summary {
  if (values.length === 0) fail("Cannot summarise an empty timing set");
  const sorted = [...values].sort((left, right) => left - right);
  const average = mean(values);
  return {
    mean: average,
    median: median(sorted),
    standardDeviation: standardDeviation(values, average),
    percentile95: percentile(sorted, 0.95),
    minimum: sorted[0]!,
    maximum: sorted[sorted.length - 1]!
  };
}

function pairedDifferences(
  host: readonly BenchmarkSample[],
  wasm: readonly BenchmarkSample[]
): number[] {
  const wasmByIteration = new Map(wasm.map(sample => [sample.iteration, sample]));
  return host.map(hostSample => {
    const wasmSample = wasmByIteration.get(hostSample.iteration);
    if (wasmSample === undefined) fail(`Missing Wasm sample for iteration ${hostSample.iteration}`);
    return hostSample.bakeMilliseconds - wasmSample.bakeMilliseconds;
  });
}

function summarisePairs(differences: readonly number[], hostMean: number): PairedSummary {
  if (differences.length === 0) fail("Cannot summarise an empty paired timing set");
  const sorted = [...differences].sort((left, right) => left - right);
  const average = mean(differences);
  const deviation = standardDeviation(differences, average);
  const standardError = deviation / Math.sqrt(differences.length);
  const margin = 1.96 * standardError;
  const epsilon = 0.000001;
  const wasmWins = differences.filter(value => value > epsilon).length;
  const hostWins = differences.filter(value => value < -epsilon).length;
  return {
    meanDifference: average,
    medianDifference: median(sorted),
    standardDeviation: deviation,
    confidence95Low: average - margin,
    confidence95High: average + margin,
    wasmWins,
    hostWins,
    ties: differences.length - wasmWins - hostWins,
    percentOfHostMean: hostMean === 0 ? 0 : (average / hostMean) * 100
  };
}

function milliseconds(value: number): string {
  return `${value.toFixed(3)} ms`;
}

function printSummary(label: string, summary: Summary): void {
  process.stdout.write(
    `${label}: mean ${milliseconds(summary.mean)}, median ${milliseconds(summary.median)}, ` +
    `sd ${milliseconds(summary.standardDeviation)}, p95 ${milliseconds(summary.percentile95)}, ` +
    `min ${milliseconds(summary.minimum)}, max ${milliseconds(summary.maximum)}\n`
  );
}

function printPaired(summary: PairedSummary): void {
  const verdict = summary.confidence95Low > 0
    ? "Wasm faster"
    : summary.confidence95High < 0
      ? "TypeScript faster"
      : "inconclusive";
  process.stdout.write(
    `Paired Bake result: mean ts-wasm ${milliseconds(summary.meanDifference)} ` +
    `(${summary.percentOfHostMean.toFixed(3)}% of the TypeScript mean), ` +
    `median ${milliseconds(summary.medianDifference)}, ` +
    `sd ${milliseconds(summary.standardDeviation)}, ` +
    `95% CI [${milliseconds(summary.confidence95Low)}, ${milliseconds(summary.confidence95High)}], ` +
    `wins wasm/ts/tie ${summary.wasmWins}/${summary.hostWins}/${summary.ties}: ${verdict}\n`
  );
}

function main(): void {
  const root = path.resolve(__dirname, "..");
  const reportFile = path.resolve(
    process.env.BAKE_BENCH_REPORT ?? path.join(root, "build/self-host-benchmark/report.json")
  );
  if (!fs.existsSync(reportFile)) fail(`Benchmark report does not exist: ${reportFile}`);

  const report = JSON.parse(fs.readFileSync(reportFile, "utf8")) as BenchmarkReport;
  if (report.schema !== 2 || report.benchmark !== "bake-engine") {
    fail("This is not a Bake-only engine benchmark report. Discard the old Baguette pipeline report and rerun the benchmark.");
  }

  const host = report.samples.filter(sample => sample.engine === "host");
  const wasm = report.samples.filter(sample => sample.engine === "wasm");
  if (host.length !== wasm.length || host.length === 0) {
    fail("Benchmark report does not contain complete paired samples");
  }

  const hostSummary = summarise(host.map(sample => sample.bakeMilliseconds));
  const wasmSummary = summarise(wasm.map(sample => sample.bakeMilliseconds));
  const differences = pairedDifferences(host, wasm);
  const pairedSummary = summarisePairs(differences, hostSummary.mean);

  process.stdout.write(
    `Analysing ${host.length} sequential Bake-only host/Wasm pairs after ` +
    `${report.warmups} warmup pair(s). Baguette was not run.\n`
  );
  printSummary("ts-core Bake", hostSummary);
  printSummary("wasm-core Bake", wasmSummary);
  process.stdout.write("\nPositive ts-wasm means Wasm was faster.\n");
  printPaired(pairedSummary);
  process.stdout.write(`Identical Stage 1 TypeScript SHA-256: ${report.stageOneSha256}\n`);
  process.stdout.write(`Emitted files per Bake run: ${report.emittedFiles}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Bake benchmark analysis failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
