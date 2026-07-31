import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { analyseSourceFile } from "./analyse";
import { createBakeCoreEngine } from "./core-engine";
import { formatDiagnostic } from "./diagnostics";
import { lowerSourceFile } from "./lower";
import { BAGUETTE_TARGET_COMMIT, BAGUETTE_TARGET_VERSION } from "./target";
import type { BakeConfig, BakeDiagnostic, BakeLowering, BakeResult } from "./types";
import { lowerWide } from "./wide/run";

export * from "./types";
export * from "./target";
export * from "./core-engine";
export * from "./core/protocol";
export { formatDiagnostic } from "./diagnostics";

function parseProject(projectPath: string): { program: ts.Program; root: string; parsed: ts.ParsedCommandLine } {
  const absoluteProject = path.resolve(projectPath);
  const config = ts.readConfigFile(absoluteProject, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const root = path.dirname(absoluteProject);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, {
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
  if (!diagnostic.file || diagnostic.start === undefined) {
    return { code: `TS${diagnostic.code}`, severity: "error", file: "<project>", line: 1, column: 1, message };
  }
  const place = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return {
    code: `TS${diagnostic.code}`,
    severity: diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "error",
    file: path.relative(root, diagnostic.file.fileName).split(path.sep).join("/"),
    line: place.line + 1,
    column: place.character + 1,
    message
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
  if (!files.length) return process.cwd();
  const parts = files.map(file => path.resolve(file).split(path.sep));
  const shared: string[] = [];
  for (let index = 0; ; index++) {
    const value = parts[0]?.[index];
    if (value === undefined || !parts.every(item => item[index] === value)) break;
    shared.push(value);
  }
  return shared.join(path.sep) || path.parse(files[0]!).root;
}

function ownedImplicitAny(source: ts.SourceFile, checker: ts.TypeChecker): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && !node.type && ts.isIdentifier(node.name)) {
      const fn = node.parent;
      const call = (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) ? fn.parent : undefined;
      const target = call && ts.isCallExpression(call) && call.arguments[0] === fn ? call.expression : undefined;
      if (target && ts.isPropertyAccessExpression(target) && ["every", "some", "filter"].includes(target.name.text)) {
        const type = checker.getTypeAtLocation(node.name);
        if (type.flags & ts.TypeFlags.Any) {
          const place = source.getLineAndCharacterOfPosition(node.name.getStart(source));
          out.add(`${place.line + 1}:${place.character + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function analysisFor(
  lowering: BakeLowering,
  root: string,
  source: ts.SourceFile,
  program: ts.Program,
  checker: ts.TypeChecker,
  core: ReturnType<typeof createBakeCoreEngine>
): BakeDiagnostic[] {
  const diagnostics = analyseSourceFile(root, source, program, checker, core);
  if (lowering === "safe") return diagnostics;
  // Wide lowering owns these diagnostics. Anything it cannot remove is
  // rejected by Baguette's authoritative validation of the emitted source.
  const implicit = ownedImplicitAny(source, checker);
  return diagnostics.filter(item =>
    item.code !== "BK1002" && item.code !== "BK2201" && item.code !== "BK3001" &&
    !(item.code === "BK1001" && implicit.has(`${item.line}:${item.column}`))
  );
}

export function bake(config: BakeConfig): BakeResult {
  const core = createBakeCoreEngine(config.engine ?? "auto", config.wasmFile);
  const lowering = config.lowering ?? "safe";
  const { program, root } = parseProject(config.project);
  const checker = program.getTypeChecker();
  const diagnostics: BakeDiagnostic[] = ts.getPreEmitDiagnostics(program).map(diagnostic => normaliseTypeScriptDiagnostic(root, diagnostic));
  const emittedFiles: string[] = [];
  const files = sourceFiles(program);
  const commonRoot = commonDirectory(files.map(file => path.dirname(file.fileName)));
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false });

  const outputs: Array<{ path: string; text: string }> = [];
  for (const source of files) {
    diagnostics.push(...analysisFor(lowering, root, source, program, checker, core));
    const safe = lowerSourceFile(root, source, checker, core);
    diagnostics.push(...(lowering === "wide" ? safe.diagnostics.filter(item => item.code !== "BK3001") : safe.diagnostics));
    const lowered = lowering === "wide" ? lowerWide(root, safe.sourceFile, checker) : safe;
    if (lowering === "wide") diagnostics.push(...lowered.diagnostics);
    if (!config.validateOnly) {
      outputs.push({
        path: outputPathFor(source, root, config.outDir, commonRoot),
        text: printer.printFile(lowered.sourceFile)
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
      version: "0.2.0-dev",
      engine: core.implementation,
      lowering,
      coreAbi: core.version,
      target: { compiler: "Baguette", version: BAGUETTE_TARGET_VERSION, commit: BAGUETTE_TARGET_COMMIT },
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
      version: "0.2.0-dev",
      engine: core.implementation,
      lowering,
      coreAbi: core.version,
      target: `Baguette ${BAGUETTE_TARGET_VERSION} (${BAGUETTE_TARGET_COMMIT})`,
      success,
      emittedFiles: emittedFiles.map(file => path.relative(root, file).split(path.sep).join("/")),
      diagnostics
    }, null, 2) + "\n", "utf8");
  }

  return { success, engine: core.implementation, lowering, emittedFiles, diagnostics };
}

export function printBakeResult(result: BakeResult): void {
  for (const diagnostic of result.diagnostics) {
    const stream = diagnostic.severity === "error" ? process.stderr : process.stdout;
    stream.write(`${formatDiagnostic(diagnostic)}\n`);
  }
  const errors = result.diagnostics.filter(item => item.severity === "error").length;
  const warnings = result.diagnostics.filter(item => item.severity === "warning").length;
  process.stdout.write(`Bake (${result.engine} core, ${result.lowering} lowering): ${result.success ? "ready for Baguette validation" : "source needs attention"}; ${errors} error(s), ${warnings} warning(s), ${result.emittedFiles.length} file(s) emitted.\n`);
}
