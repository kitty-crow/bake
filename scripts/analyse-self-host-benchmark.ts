#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

interface BenchmarkSample {
  readonly engine: "host" | "wasm";
  readonly iteration: number;
  readonly bakeMilliseconds: number;
  readonly baguetteMilliseconds: number;
  readonly totalMilliseconds: number;
}

interface BenchmarkReport {
  readonly runs: number;
  readonly warmups: number;
  readonly samples: readonly BenchmarkSample[];
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
  readonly confidence95Low: number;
  readonly confidence95High: number;
  readonly wasmWins: number;
  readonly hostWins: number;
  readonly ties: number;
}

type Selector = (sample: BenchmarkSample) => number;

function fail(message: string): never {
  throw new Error(message);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) fail("Cannot calculate statistics for an empty sample");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) fail("Cannot calculate statistics for an empty sample");
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function standardDeviation(values: readonly number[], average: number): number {
  if (values.length < 2) return 0;
  const squared = values.reduce((sum, value) => {
    const difference = value - average;
    return sum + difference * difference;
  }, 0);
  return Math.sqrt(squared / (values.length - 1));
}

function summarise(values: readonly number[]): Summary {
  const sorted = [...values].sort((left, right) => left - right);
  const average = mean(values);
  const p95Index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
  return {
    mean: average,
    median: median(sorted),
    standardDeviation: standardDeviation(values, average),
    percentile95: sorted[p95Index]!,
    minimum: sorted[0]!,
    maximum: sorted[sorted.length - 1]!
  };
}

function critical95(degreesOfFreedom: number): number {
  const values = [
    0,
    12.706, 4.303, 3.182, 2.776, 2.571,
    2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131,
    2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060,
    2.056, 2.052, 2.048, 2.045, 2.042
  ];
  if (degreesOfFreedom < 1) return 0;
  return degreesOfFreedom < values.length ? values[degreesOfFreedom]! : 1.96;
}

function pairDifferences(
  host: readonly BenchmarkSample[],
  wasm: readonly BenchmarkSample[],
  selector: Selector
): number[] {
  const wasmByIteration = new Map<number, BenchmarkSample>();
  for (const sample of wasm) wasmByIteration.set(sample.iteration, sample);
  return host.map(sample => {
    const counterpart = wasmByIteration.get(sample.iteration);
    if (!counterpart) fail(`Missing Wasm sample for iteration ${sample.iteration}`);
    return selector(sample) - selector(counterpart);
  });
}

function summarisePairs(differences: readonly number[]): PairedSummary {
  const sorted = [...differences].sort((left, right) => left - right);
  const average = mean(differences);
  const deviation = standardDeviation(differences, average);
  const margin = critical95(differences.length - 1) * deviation / Math.sqrt(differences.length);
  const tolerance = 0.001;
  const wasmWins = differences.filter(value => value > tolerance).length;
  const hostWins = differences.filter(value => value < -tolerance).length;
  return {
    meanDifference: average,
    medianDifference: median(sorted),
    confidence95Low: average - margin,
    confidence95High: average + margin,
    wasmWins,
    hostWins,
    ties: differences.length - wasmWins - hostWins
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

function printPaired(label: string, summary: PairedSummary): void {
  const verdict = summary.confidence95Low > 0
    ? "Wasm faster"
    : summary.confidence95High < 0
      ? "TypeScript faster"
      : "inconclusive";
  process.stdout.write(
    `${label}: mean ts-wasm ${milliseconds(summary.meanDifference)}, ` +
    `median ${milliseconds(summary.medianDifference)}, ` +
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
  const host = report.samples.filter(sample => sample.engine === "host");
  const wasm = report.samples.filter(sample => sample.engine === "wasm");
  if (host.length !== wasm.length || host.length === 0) fail("Benchmark report does not contain complete paired samples");

  const bakeSelector: Selector = sample => sample.bakeMilliseconds;
  const baguetteSelector: Selector = sample => sample.baguetteMilliseconds;
  const totalSelector: Selector = sample => sample.totalMilliseconds;

  process.stdout.write(`Analysing ${host.length} sequential host/Wasm pairs after ${report.warmups} warmup pair(s).\n`);
  printSummary("ts-core Bake", summarise(host.map(bakeSelector)));
  printSummary("wasm-core Bake", summarise(wasm.map(bakeSelector)));
  printSummary("ts-core Baguette", summarise(host.map(baguetteSelector)));
  printSummary("wasm-core Baguette", summarise(wasm.map(baguetteSelector)));
  printSummary("ts-core total", summarise(host.map(totalSelector)));
  printSummary("wasm-core total", summarise(wasm.map(totalSelector)));
  process.stdout.write("\nPaired comparisons (positive ts-wasm means Wasm was faster)\n");
  printPaired("Bake", summarisePairs(pairDifferences(host, wasm, bakeSelector)));
  printPaired("Baguette", summarisePairs(pairDifferences(host, wasm, baguetteSelector)));
  printPaired("Total", summarisePairs(pairDifferences(host, wasm, totalSelector)));
}

try {
  main();
} catch (error) {
  process.stderr.write(`Bake benchmark analysis failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
