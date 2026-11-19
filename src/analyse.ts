import path from "node:path";
import ts from "typescript";
import type { BakeCoreEngine } from "./core-engine";
import {
  BAKE_ACTION_ERROR,
  BAKE_FACT_AMBIENT_RUNTIME,
  BAKE_FACT_ANY,
  BAKE_FACT_ASYNC_CLOSURE,
  BAKE_FACT_DYNAMIC_IMPORT,
  BAKE_FACT_EXCEPTION,
  BAKE_FACT_EXTERNAL_RUNTIME_IMPORT,
  BAKE_FACT_GENERATOR,
  BAKE_FACT_UNKNOWN,
  bakeDecisionAction,
  bakeDecisionDiagnostic
} from "./core/protocol";
import { diagnosticAt } from "./diagnostics";
import { inferUnknownParameter } from "./infer-unknown";
import { BAGUETTE_FORBIDDEN_AMBIENT_IDENTIFIERS, bakeDiagnosticCode } from "./target";
import type { BakeDiagnostic } from "./types";
import type { BakeTarget } from "./target";

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === kind));
}

function isTypeOnlyImport(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(statement)) return statement.isTypeOnly;
  const clause = statement.importClause ?? null;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings ?? null;
  return bindings !== null && ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
}

function localDeclaration(symbol: ts.Symbol | null): boolean {
  return (symbol ? symbol.declarations ?? [] : []).some(declaration => !declaration.getSourceFile().isDeclarationFile);
}

function isSupportedAsyncUnit(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) return Boolean((node.name ?? null) && (node.body ?? null));
  if (ts.isMethodDeclaration(node)) return Boolean((node.body ?? null) && ts.isIdentifier(node.name) && ts.isClassDeclaration(node.parent) && (node.parent.name ?? null));
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const variable = node.parent;
    return ts.isVariableDeclaration(variable) &&
      ts.isIdentifier(variable.name) &&
      ts.isVariableDeclarationList(variable.parent) &&
      variable.parent.declarations.length === 1 &&
      ts.isVariableStatement(variable.parent.parent) &&
      ts.isSourceFile(variable.parent.parent.parent);
  }
  return false;
}

function addUnique(target: BakeDiagnostic[], seen: Set<string>, diagnostic: BakeDiagnostic): void {
  const key = `${diagnostic.code}:${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`;
  if (!seen.has(key)) {
    seen.add(key);
    target.push(diagnostic);
  }
}

function errorCode(core: BakeCoreEngine, fact: number): string | null {
  const decision = core.decide(fact, 0, 0, 0);
  if (bakeDecisionAction(decision) !== BAKE_ACTION_ERROR) return null;
  return bakeDiagnosticCode(bakeDecisionDiagnostic(decision));
}

export function analyseSourceFile(
  root: string,
  source: ts.SourceFile,
  program: ts.Program,
  checker: ts.TypeChecker,
  core: BakeCoreEngine,
  target: BakeTarget = "wasm"
): BakeDiagnostic[] {
  const diagnostics: BakeDiagnostic[] = [];
  const seen = new Set<string>();
  const compilerOptions = program.getCompilerOptions();

  const report = (fact: number, make: (code: string) => BakeDiagnostic): void => {
    const code = errorCode(core, fact);
    if (code) addUnique(diagnostics, seen, make(code));
  };

  const checkBinding = (node: ts.ParameterDeclaration | ts.VariableDeclaration | ts.PropertyDeclaration): void => {
    if (!ts.isIdentifier(node.name)) return;
    const type = checker.getTypeAtLocation(node.name);
    const name = node.name;
    if (type.flags & ts.TypeFlags.Any) {
      report(BAKE_FACT_ANY, code => diagnosticAt(
        root,
        node.name,
        code,
        "error",
        `${ts.isParameter(node) ? "Parameter" : ts.isPropertyDeclaration(node) ? "Property" : "Variable"} ${name.text} is inferred as any.`,
        "Add a concrete type annotation. Bake will not insert a dynamic JavaScript value representation."
      ));
      return;
    }
    if (type.flags & ts.TypeFlags.Unknown) {
      report(BAKE_FACT_UNKNOWN, code => {
        const suggestion = ts.isParameter(node) ? inferUnknownParameter(node, checker) : null;
        return diagnosticAt(
          root,
          node.name,
          code,
          "error",
          `${ts.isParameter(node) ? "Parameter" : ts.isPropertyDeclaration(node) ? "Property" : "Variable"} ${name.text} is inferred as unknown.`,
          target === "wasm"
            ? "Give the value a deterministic native type before Bake emits Baguette-target source."
            : "Give the value a deterministic native type before Bake emits freestanding native source.",
          suggestion
        );
      });
    }
  };

  const checkReturn = (node: ts.SignatureDeclaration): void => {
    const signature = checker.getSignatureFromDeclaration(node) ?? null;
    const returnType = signature ? signature.getReturnType() : null;
    const name = "name" in node ? node.name ?? null : null;
    const displayNode = name && ts.isIdentifier(name) ? name : node;
    if (returnType && (returnType.flags & ts.TypeFlags.Any)) {
      report(BAKE_FACT_ANY, code => diagnosticAt(
        root,
        displayNode,
        code,
        "error",
        "This function's inferred return type is any.",
        "Add an explicit deterministic return type and remove the dynamic value source."
      ));
      return;
    }
    if (returnType && (returnType.flags & ts.TypeFlags.Unknown)) {
      report(BAKE_FACT_UNKNOWN, code => diagnosticAt(
        root,
        displayNode,
        code,
        "error",
        "This function's inferred return type is unknown.",
        "Narrow or convert the value to a concrete native type before returning it."
      ));
    }
  };

  const checkImport = (node: ts.ImportDeclaration | ts.ExportDeclaration): void => {
    const specifier = node.moduleSpecifier ?? null;
    if (!specifier || !ts.isStringLiteral(specifier)) return;
    const resolved = ts.resolveModuleName(specifier.text, source.fileName, compilerOptions, ts.sys).resolvedModule ?? null;
    const isExternal = !resolved || (resolved.isExternalLibraryImport ?? false) || resolved.resolvedFileName.includes(`${path.sep}node_modules${path.sep}`);
    if (isExternal) {
      report(BAKE_FACT_EXTERNAL_RUNTIME_IMPORT, code => diagnosticAt(
        root,
        specifier,
        code,
        "error",
        `External runtime module ${JSON.stringify(specifier.text)} is not part of the statically linked TypeScript graph.`,
        target === "wasm"
          ? "Link its TypeScript source into the project or expose the required operation as an explicit WebAssembly host capability."
          : "Link its TypeScript source into the project or expose the operation through an explicit freestanding native capability."
      ));
    }
  };

  const walk = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      report(BAKE_FACT_ANY, code => diagnosticAt(
        root,
        node,
        code,
        "error",
        "`any` cannot be baked into a deterministic native memory shape.",
        "Replace it with a concrete type, a tagged union, or an opaque numeric handle."
      ));
    }

    if (node.kind === ts.SyntaxKind.UnknownKeyword) {
      report(BAKE_FACT_UNKNOWN, code => {
        const parameter = ts.isTypeNode(node) && ts.isParameter(node.parent) ? node.parent : null;
        const suggestion = parameter ? inferUnknownParameter(parameter, checker) : null;
        return diagnosticAt(
          root,
          node,
          code,
          "error",
          "`unknown` remains unresolved at the Bake to Baguette boundary.",
          suggestion
            ? "Review the inferred shape and replace `unknown` with an explicit native type. Bake never applies this guess silently."
            : "Narrow it completely before storage or calls, or replace it with a concrete interface, tagged union, or handle.",
          suggestion
        );
      });
    }

    if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && ts.isIdentifier(node.name) && !(node.type ?? null)) checkBinding(node);

    if (ts.isFunctionLike(node) && "body" in node && (node.body ?? null) && !("type" in node && (node.type ?? null))) checkReturn(node);

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(BAKE_FACT_DYNAMIC_IMPORT, code => diagnosticAt(
        root,
        node,
        code,
        "error",
        "Runtime-computed import() cannot be made statically discoverable without a finite module set.",
        "Use a static import, or rewrite a finite set of possible modules as an explicit switch."
      ));
    }

    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && !isTypeOnlyImport(node)) checkImport(node);

    if (ts.isYieldExpression(node) || ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && Boolean(node.asteriskToken ?? null))) {
      report(BAKE_FACT_GENERATOR, code => diagnosticAt(
        root,
        node,
        code,
        "error",
        "Generators are not lowered by Bake 0.1.",
        "Rewrite this as an explicit iterator state object. A future Bake pass can automate this state-machine lowering."
      ));
    }

    if (ts.isTryStatement(node) || ts.isThrowStatement(node)) {
      report(BAKE_FACT_EXCEPTION, code => diagnosticAt(
        root,
        node,
        code,
        "error",
        "JavaScript exception semantics are not part of the Baguette native target.",
        "Return a typed result, tagged union, errno, or explicit trap code. Bake does not silently change exception behaviour."
      ));
    }

    if (ts.isFunctionLike(node) && hasModifier(node, ts.SyntaxKind.AsyncKeyword) && !isSupportedAsyncUnit(node)) {
      report(BAKE_FACT_ASYNC_CLOSURE, code => diagnosticAt(
        root,
        node,
        code,
        "error",
        "This async closure cannot be lowered by Baguette's current native coroutine pass.",
        "Move it to a named top-level function or a named class method so its capture shape is explicit."
      ));
    }

    if (ts.isIdentifier(node) && BAGUETTE_FORBIDDEN_AMBIENT_IDENTIFIERS.has(node.text) && !localDeclaration(checker.getSymbolAtLocation(node) ?? null)) {
        report(BAKE_FACT_AMBIENT_RUNTIME, code => diagnosticAt(
          root,
          node,
          code,
          "error",
          `${node.text} requires a JavaScript host runtime.`,
          "Replace it with an explicit numeric host capability or a native WebAssembly support routine."
        ));
    }

    ts.forEachChild(node, walk);
  };

  walk(source);
  return diagnostics;
}
