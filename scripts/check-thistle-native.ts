import fs from "node:fs";
import path from "node:path";
import { bake, printBakeResult } from "../src/index";
import ts from "typescript";

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
  const outputRoot = path.join(thistle, outDir);
  const sources = manifest.sourceFiles.map(relative => path.join(outputRoot, relative));
  const program = ts.createProgram({
    rootNames: sources,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      skipLibCheck: true,
      types: [],
      noEmit: true
    }
  });
  const errors = ts.getPreEmitDiagnostics(program);
  if (errors.length) {
    const formatter = ts.formatDiagnosticsWithColorAndContext(errors.slice(0, 30), {
      getCanonicalFileName: x => x,
      getCurrentDirectory: () => thistle,
      getNewLine: () => "\n"
    });
    process.stderr.write(formatter);
    throw new Error(`Clang-lowered Thistle source has ${errors.length} TypeScript errors`);
  }

  const forbidden = new Set(["ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics",
    "WebAssembly", "BigInt", "Number", "Math", "process", "Bun"]);
  const intrinsicNames = new Set<string>();
  let declared = 0;
  for (const file of sources) {
    const ast = program.getSourceFile(file);
    if (!ast) throw new Error(`Missing generated source ${file}`);
    const inspect = (node: ts.Node): void => {
      if (ts.isNewExpression(node) || ts.isTryStatement(node) ||
          ts.isThrowStatement(node) || ts.isAwaitExpression(node)) {
        throw new Error(`Unlowered C-unsafe statement in ${file}: ${node.getText(ast)}`);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          forbidden.has(node.expression.text)) {
        throw new Error(`Unlowered host call in ${file}: ${node.getText(ast)}`);
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
          forbidden.has(node.expression.text)) {
        throw new Error(`Unlowered host property in ${file}: ${node.getText(ast)}`);
      }
      if (ts.isFunctionDeclaration(node) && node.name?.text.startsWith("__bake_c_")) {
        if (node.body) throw new Error(`Intrinsic ${node.name.text} must be external`);
        declared++;
        intrinsicNames.add(node.name.text);
      }
      ts.forEachChild(node, inspect);
    };
    ts.forEachChild(ast, inspect);
  }
  if (!intrinsicNames.has("__bake_c_atomic_add_u64") ||
      !intrinsicNames.has("__bake_c_as_uint_n") ||
      !intrinsicNames.has("__bake_c_bits_to_f64")) {
    throw new Error("Incomplete native intrinsic lowering contract");
  }
  process.stdout.write(`Thistle native Clang frontend validated: ${sources.length} modules, ${declared} intrinsic declarations\n`);
} finally {
  fs.rmSync(project, { force: true });
  fs.rmSync(path.join(thistle, outDir), { recursive: true, force: true });
}
