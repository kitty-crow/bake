import fs from "node:fs";
import path from "node:path";
import { bake, printBakeResult } from "../src/index";

const thistle = path.resolve(process.argv[2] ?? "../thistle");
const project = path.join(thistle, "tsconfig.bake-native.json");
const outDir = "build/bake-clang";
const entries = [
  "src/native/abi.ts", "src/native/kernel.ts", "src/native/memory.ts",
  "src/native/start.ts", "src/native/thx.ts", "src/native/types.ts",
  "src/native/vfs.ts", "src/native/word.ts"
];
if (!fs.existsSync(path.join(thistle, entries[1]!))) {
  throw new Error(`Thistle checkout missing: ${thistle}`);
}
const config = {
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
    lib: ["ES2022", "DOM"], strict: true, skipLibCheck: true,
    noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    types: [], noEmit: true
  },
  files: entries
};
fs.writeFileSync(project, JSON.stringify(config, null, 2) + "\n");
try {
  const result = bake({
    project, outDir, validateOnly: false, failOnWarnings: true,
    target: "clang", engine: "host"
  });
  printBakeResult(result);
  if (!result.success) {
    throw new Error(`Thistle native Clang lowering failed with ${result.diagnostics.filter(d => d.severity === "error").length} errors`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(thistle, outDir, "bake-manifest.json"), "utf8")) as {
    target: { backend: string; freestanding: boolean };
    sourceFiles: string[];
  };
  if (manifest.target.backend !== "clang" || !manifest.target.freestanding) {
    throw new Error("Incorrect clang manifest");
  }
  if (!manifest.sourceFiles.some(x => x.endsWith("native/kernel.ts"))) {
    throw new Error("Thistle native kernel not emitted");
  }
  process.stdout.write(`Thistle native Clang frontend validated: ${manifest.sourceFiles.length} modules\n`);
} finally {
  fs.rmSync(project, { force: true });
  fs.rmSync(path.join(thistle, outDir), { recursive: true, force: true });
}
