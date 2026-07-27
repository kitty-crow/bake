import path from "node:path";
import ts from "typescript";
import { diagnosticAt } from "./diagnostics";
import { inferUnknownParameter } from "./infer-unknown";
import { BAGUETTE_FORBIDDEN_AMBIENT_IDENTIFIERS, BAKE_DIAGNOSTIC_CODES } from "./target";
import type { BakeDiagnostic } from "./types";

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === kind));
}

function isTypeOnlyImport(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(statement)) return statement.isTypeOnly;
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  return Boolean(
    clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every(element => element.isTypeOnly)
  );
}

function localDeclaration(symbol: ts.Symbol | undefined): boolean {
  return Boolean(symbol?.declarations?.some(declaration => !declaration.getSourceFile().isDeclarationFile));
}

function isSupportedAsyncUnit(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) return Boolean(node.name && node.body);
  if (ts.isMethodDeclaration(node)) return Boolean(node.body && ts.isIdentifier(node.name) && ts.isClassDeclaration(node.parent) && node.parent.name);
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

export function analyseSourceFile(
  root: string,
  source: ts.SourceFile,
  program: ts.Program,
  checker: ts.TypeChecker
): BakeDiagnostic[] {
  const diagnostics: BakeDiagnostic[] = [];
  const seen = new Set<string>();
  const compilerOptions = program.getCompilerOptions();

  const walk = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      addUnique(diagnostics, seen, diagnosticAt(
        root,
        node,
        BAKE_DIAGNOSTIC_CODES.any,
        "error",
        "`any` cannot be baked into a deterministic native memory shape.",
        "Replace it with a concrete type, a tagged union, or an opaque numeric handle."
      ));
    }

    if (node.kind === ts.SyntaxKind.UnknownKeyword) {
      const parameter = ts.isTypeNode(node) && ts.isParameter(node.parent) ? node.parent : undefined;
      const suggestion = parameter ? inferUnknownParameter(parameter, checker) : undefined;
      addUnique(diagnostics, seen, diagnosticAt(
        root,
        node,
        BAKE_DIAGNOSTIC_CODES.unknown,
        "error",
        "`unknown` remains unresolved at the Bake to Baguette boundary.",
        suggestion
          ? "Review the inferred shape and replace `unknown` with an explicit native type. Bake never applies this guess silently."
          : "Narrow it completely before storage or calls, or replace it with a concrete interface, tagged union, or handle.",
        suggestion
      ));
    }

    if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && ts.isIdentifier(node.name) && !node.type) {
      const type = checker.getTypeAtLocation(node.name);
      if (type.flags & ts.TypeFlags.Any) {
        addUnique(diagnostics, seen, diagnosticAt(
          root,
          node.name,
          BAKE_DIAGNOSTIC_CODES.any,
          "error",
          `${ts.isParameter(node) ? "Parameter" : ts.isPropertyDeclaration(node) ? "Property" : "Variable"} ${node.name.text} is inferred as any.`,
          "Add a concrete type annotation. Bake will not insert a dynamic JavaScript value representation."
        ));
      } else if (type.flags & ts.TypeFlags.Unknown) {
        const suggestion = ts.isParameter(node) ? inferUnknownParameter(node, checker) : undefined;
        addUnique(diagnostics, seen, diagnosticAt(
          root,
          node.name,
          BAKE_DIAGNOSTIC_CODES.unknown,
          "error",
          `${ts.isParameter(node) ? "Parameter" : ts.isPropertyDeclaration(node) ? "Property" : "Variable"} ${node.name.text} is inferred as unknown.`,
          "Give the value a deterministic native type before Bake emits Baguette-target source.",
          suggestion
        ));
      }
    }


    if (ts.isFunctionLike(node) && "body" in node && node.body && !("type" in node && node.type)) {
      const signature = checker.getSignatureFromDeclaration(node);
      const returnType = signature?.getReturnType();
      const displayNode = "name" in node && node.name && ts.isIdentifier(node.name) ? node.name : node;
      if (returnType && (returnType.flags & ts.TypeFlags.Any)) {
        addUnique(diagnostics, seen, diagnosticAt(
          root,
          displayNode,
          BAKE_DIAGNOSTIC_CODES.any,
          "error",
          "This function's inferred return type is any.",
          "Add an explicit deterministic return type and remove the dynamic value source."
        ));
      } else if (returnType && (returnType.flags & ts.TypeFlags.Unknown)) {
        addUnique(diagnostics, seen, diagnosticAt(
          root,
          displayNode,
          BAKE_DIAGNOSTIC_CODES.unknown,
          "error",
          "This function's inferred return type is unknown.",
          "Narrow or convert the value to a concrete native type before returning it."
        ));
      }
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addUnique(diagnostics, seen, diagnosticAt(
        root,
        node,
        BAKE_DIAGNOSTIC_CODES.dynamicImport,
        "error",
        "Runtime-computed import() cannot be made statically discoverable without a finite module set.",
        "Use a static import, or rewrite a finite set of possible modules as an explicit switch."
      ));
    }

    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !isTypeOnlyImport(node)) {
      const resolved = ts.resolveModuleName(node.moduleSpecifier.text, source.fileName, compilerOptions, ts.sys).resolvedModule;
      const isExternal = !resolved || resolved.isExternalLibraryImport || resolved.resolvedFileName.includes(`${path.sep}node_modules${path.sep}`);
      if (isExternal) {
        addUnique(diagnostics, seen, diagnosticAt(
          root,
          node.moduleSpecifier,
          BAKE_DIAGNOSTIC_CODES.externalRuntimeImport,
          "error",
          `External runtime module ${JSON.stringify(node.moduleSpecifier.text)} is not part of the statically linked TypeScript graph.`,
          "Link its TypeScript source into the project or expose the required operation as an explicit WebAssembly host capability."
        ));
      }
    }

    if (ts.isYieldExpression(node) || ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && Boolean(node.asteriskToken))) {
      addUnique(diagnostics, seen, diagnosticAt(
        root,
        node,
        BAKE_DIAGNOSTIC_CODES.generator,
        "error",
        "Generators are not lowered by Bake 0.1.",
        "Rewrite this as an explicit iterator state object. A future Bake pass can automate this state-machine lowering."
      ));
    }

    if (ts.isTryStatement(node) || ts.isThrowStatement(node)) {
      addUnique(diagnostics, seen, diagnosticAt(
        root,
        node,
        BAKE_DIAGNOSTIC_CODES.exception,
        "error",
        "JavaScript exception semantics are not part of the Baguette native target.",
        "Return a typed result, tagged union, errno, or explicit trap code. Bake does not silently change exception behaviour."
      ));
    }

    if (ts.isFunctionLike(node) && hasModifier(node, ts.SyntaxKind.AsyncKeyword) && !isSupportedAsyncUnit(node)) {
      addUnique(diagnostics, seen, diagnosticAt(
        root,
        node,
        BAKE_DIAGNOSTIC_CODES.asyncClosure,
        "error",
        "This async closure cannot be lowered by Baguette's current native coroutine pass.",
        "Move it to a named top-level function or a named class method so its capture shape is explicit."
      ));
    }

    if (ts.isIdentifier(node) && BAGUETTE_FORBIDDEN_AMBIENT_IDENTIFIERS.has(node.text)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (!localDeclaration(symbol)) {
        addUnique(diagnostics, seen, diagnosticAt(
          root,
          node,
          BAKE_DIAGNOSTIC_CODES.ambientRuntime,
          "error",
          `${node.text} requires a JavaScript host runtime.`,
          "Replace it with an explicit numeric host capability or a native WebAssembly support routine."
        ));
      }
    }

    ts.forEachChild(node, walk);
  };

  walk(source);
  return diagnostics;
}
