import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { bake } from "../src/index";

const source = `
type Reader = "sun" | "moon";

export function isReader(value: unknown): value is Reader {
  return value === "sun" || value === "moon";
}

class Counter {
  #value: number = 0;
  add(value: number): number {
    this.#value += value;
    return this.#value;
  }
}

interface Box { value: number; }

function read(box: Box | null): number | null {
  return box?.value;
}

function risky(value: number): number {
  try {
    if (value < 0) throw new Error("negative");
    return value;
  } catch (error) {
    return -1;
  }
}

export function score(values: number[], fallback: number | null): number {
  let total = 0;
  for (const value of values) total += value;
  const pair = [total, fallback ?? 0];
  const [left, right] = pair;
  const counter = new Counter();
  const box: Box | null = { value: counter.add(left + right) };
  return risky(read(box) ?? 0);
}
`;

test("wide lowering removes the supported application syntax", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bake-wide-"));
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
      failOnWarnings: false,
      lowering: "wide"
    });
    assert.equal(wide.success, true);
    assert.equal(wide.lowering, "wide");
    const output = fs.readFileSync(path.join(root, "wide", "input.ts"), "utf8");
    assert.ok(!output.includes(": unknown"));
    assert.ok(!output.includes(" is Reader"));
    assert.ok(!output.includes("#value"));
    assert.ok(!output.includes("?."));
    assert.ok(!/\btry\b/.test(output));
    assert.ok(!/\bthrow\b/.test(output));
    assert.match(output, /__bake_err_/);
    assert.match(output, /__bake_p_/);
    assert.match(output, /for \(let __bake_index_/);
    assert.match(output, /__bake_destructure_/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
