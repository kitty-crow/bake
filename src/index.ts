import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { analyseSourceFile } from "./analyse";
import { analyseClangSourceFile, lowerClangSourceFile } from "./clang";
import { lowerNativeClang } from "./clang-native";
import { createBakeCoreEngine } from "./core-engine";
import { formatDiagnostic } from "./diagnostics";
import { lowerSourceFile } from "./lower";
import { BAGUETTE_TARGET_COMMIT, BAGUETTE_TARGET_VERSION, DEFAULT_BAKE_TARGET, isNativeTarget, parseBakeTarget } from "./target";
import type { BakeConfig, BakeDiagnostic, BakeResult } from "./types";

export * from "./types";
export * from "./target";
export * from "./core-engine";
export * from "./core/protocol";
export { formatDiagnostic } from "./diagnostics";

function parseProject(projectPath: string): { program: ts.Program; root: string; parsed: ts.ParsedCommandLine } {
  const absoluteProject = path.resolve(projectPath);
  const config = ts.readJsonConfigFile(absoluteProject, ts.sys.readFile);
  const root = path.dirname(absoluteProject);
  const parsed = ts.parseJsonSourceFileConfigFileContent(config, ts.sys, root, {
    noEmit: true,
    incremental: false,
    composite: false
  }, absoluteProject);
  if (parsed.errors.length) {
    throw new Error(parsed.errors.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
  }
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
  return { program, root, parsed };
}

function normaliseTypeScriptDiagnostic(root: string, diagnostic: ts.Diagnostic): BakeDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const file = diagnostic.file ?? null;
  const start = diagnostic.start ?? null;
  if (!file || start === null) {
    return { code: `TS${diagnostic.code}`, severity: "error", file: "<project>", line: 1, column: 1, message, hint: null, suggestion: null };
  }
  const place = file.getLineAndCharacterOfPosition(start);
  return {
    code: `TS${diagnostic.code}`,
    severity: diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "error",
    file: path.relative(root, file.fileName).split(path.sep).join("/"),
    line: place.line + 1,
    column: place.character + 1,
    message,
    hint: null,
    suggestion: null
  };
}

function sourceFiles(program: ts.Program): ts.SourceFile[] {
  return program.getSourceFiles().filter(source =>
    !source.isDeclarationFile &&
    !source.fileName.includes(`${path.sep}node_modules${path.sep}`)
  );
}

function outputPathFor(source: ts.SourceFile, root: string, outDir: string, commonRoot: string): string {
  const relative = path.relative(commonRoot, source.fileName);
  return path.resolve(root, outDir, relative);
}

function commonDirectory(files: readonly string[]): string {
  const first = files[0] ?? null;
  if (first == null) return process.cwd();
  const parts = files.map(file => path.resolve(file).split(path.sep));
  const shared: string[] = [];
  const firstParts = parts[0] ?? [];
  for (let index = 0; ; index++) {
    const value = firstParts[index] ?? null;
    if (value == null || !parts.every(item => (item[index] ?? null) === value)) break;
    shared.push(value);
  }
  return shared.join(path.sep) || path.parse(first).root;
}

export function bake(config: BakeConfig): BakeResult {
  const target = parseBakeTarget(config.target ?? DEFAULT_BAKE_TARGET);
  const core = createBakeCoreEngine(config.engine ?? "auto", config.wasmFile);
  const { program, root } = parseProject(config.project);
  const checker = program.getTypeChecker();
  const diagnostics: BakeDiagnostic[] = ts.getPreEmitDiagnostics(program).map(diagnostic => normaliseTypeScriptDiagnostic(root, diagnostic));
  const emittedFiles: string[] = [];
  const files = sourceFiles(program);
  const commonRoot = commonDirectory(files.map(file => path.dirname(file.fileName)));
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false });

  const outputs: Array<{ path: string; text: string }> = [];
  const nativeIntrinsics: Array<{ file: string; required: readonly string[] }> = [];
  for (const source of files) {
    diagnostics.push(...analyseSourceFile(root, source, program, checker, core, target));
    const lowered = lowerSourceFile(root, source, checker, core, target);
    diagnostics.push(...lowered.diagnostics);
    // Materialise original TypeScript types before rewriting host types and
    // calls into native intrinsics. Both native targets share the existing ABI.
    // The Wasm output path remains untouched.
    const normalised = isNativeTarget(target) ? lowerClangSourceFile(lowered.sourceFile, checker) : null;
    if (normalised) diagnostics.push(...normalised.diagnostics);
    const native = normalised ? lowerNativeClang(normalised.sourceFile, checker, root) : null;
    if (native && native.intrinsics.length) nativeIntrinsics.push({
      file: path.relative(root, source.fileName).split(path.sep).join("/"),
      required: native.intrinsics
    });
    if (native) {
      diagnostics.push(...native.diagnostics);
      diagnostics.push(...analyseClangSourceFile(root, native.sourceFile, checker));
    }
    if (!config.validateOnly) {
      outputs.push({
        path: outputPathFor(source, root, config.outDir, commonRoot),
        text: printer.printFile(native ? native.sourceFile : lowered.sourceFile)
      });
    }
  }

  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code));
  const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === "error");
  const hasWarnings = diagnostics.some(diagnostic => diagnostic.severity === "warning");
  const success = !hasErrors && !(config.failOnWarnings && hasWarnings);

  if (!config.validateOnly && success) {
    const outputRoot = path.resolve(root, config.outDir);
    for (const output of outputs) {
      fs.mkdirSync(path.dirname(output.path), { recursive: true });
      fs.writeFileSync(output.path, output.text, "utf8");
      emittedFiles.push(output.path);
    }

    const generatedProject = path.join(outputRoot, "tsconfig.json");
    const extendsPath = path.relative(outputRoot, path.resolve(config.project)).split(path.sep).join("/");
    fs.writeFileSync(generatedProject, JSON.stringify({
      extends: extendsPath.startsWith(".") ? extendsPath : `./${extendsPath}`,
      compilerOptions: {
        noEmit: true,
        rootDir: ".",
        incremental: false,
        composite: false,
        declaration: false,
        declarationMap: false,
        sourceMap: false
      },
      include: ["**/*.ts"],
      exclude: []
    }, null, 2) + "\n", "utf8");
    emittedFiles.push(generatedProject);

    const manifestPath = path.join(outputRoot, "bake-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      schema: 1,
      tool: "Bake",
      version: "1.0.0",
      engine: core.implementation,
      coreAbi: core.version,
      target: target === "wasm"
        ? { compiler: "Baguette", version: BAGUETTE_TARGET_VERSION, commit: BAGUETTE_TARGET_COMMIT }
        : { compiler: target === "clang" ? "C" : "Crust", backend: target,
            format: "lowered-typescript", freestanding: true,
            intrinsicAbi: 1, intrinsics: nativeIntrinsics },
      sourceProject: path.relative(root, path.resolve(config.project)).split(path.sep).join("/"),
      generatedProject: path.relative(root, generatedProject).split(path.sep).join("/"),
      sourceFiles: outputs.map(output => path.relative(outputRoot, output.path).split(path.sep).join("/"))
    }, null, 2) + "\n", "utf8");
    emittedFiles.push(manifestPath);
  }

  if (config.reportFile) {
    const reportPath = path.resolve(root, config.reportFile);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      tool: "Bake",
      version: "1.0.0",
      engine: core.implementation,
      coreAbi: core.version,
      target: target === "wasm"
        ? `Baguette ${BAGUETTE_TARGET_VERSION} (${BAGUETTE_TARGET_COMMIT})`
        : target === "clang" ? "clang (freestanding C frontend)" : "rust (freestanding Rust frontend for Crust)",
      success,
      emittedFiles: emittedFiles.map(file => path.relative(root, file).split(path.sep).join("/")),
      diagnostics
    }, null, 2) + "\n", "utf8");
  }

  return { success, target, engine: core.implementation, emittedFiles, diagnostics };
}

export function printBakeResult(result: BakeResult): void {
  for (const diagnostic of result.diagnostics) {
    const stream = diagnostic.severity === "error" ? process.stderr : process.stdout;
    stream.write(`${formatDiagnostic(diagnostic)}\n`);
  }
  const errors = result.diagnostics.filter(item => item.severity === "error").length;
  const warnings = result.diagnostics.filter(item => item.severity === "warning").length;
  process.stdout.write(`Bake (${result.engine} core): ${result.success ? result.target === "wasm" ? "ready for Baguette validation" : result.target === "clang" ? "ready for freestanding C backend validation" : "ready for Crust validation" : "source needs attention"}; ${errors} error(s), ${warnings} warning(s), ${result.emittedFiles.length} file(s) emitted.\n`);
}
