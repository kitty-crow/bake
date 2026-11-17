import ts from "typescript";
import { diagnosticAt } from "./diagnostics";
import type { BakeDiagnostic } from "./types";

/**
 * Shared freestanding frontend for the Clang and Rust targets. Keep this independent of the
 * Baguette/Bake policy core so the existing Wasm decisions stay unchanged.
 */
export interface ClangLowerResult {
  readonly sourceFile: ts.SourceFile;
  readonly diagnostics: readonly BakeDiagnostic[];
  readonly changed: boolean;
}

const HOST_GLOBALS = new Set([
  "ArrayBuffer", "ArrayBufferLike", "SharedArrayBuffer", "DataView", "Atomics",
  "WebAssembly", "Promise", "WeakMap", "WeakSet",
  "console", "setTimeout", "setInterval", "queueMicrotask",
  "Math", "Number", "String", "Object", "Array", "JSON", "Date", "BigInt",
  "RegExp", "Map", "Set", "Symbol", "globalThis",
  "process", "require", "Bun", "fetch", "window", "document"
]);

function topLevelFunctionBinding(node: ts.ArrowFunction | ts.FunctionExpression, ancestors: readonly ts.Node[]): boolean {
  const declaration = ancestors[ancestors.length - 1];
  const list = ancestors[ancestors.length - 2];
  const statement = ancestors[ancestors.length - 3];
  const owner = ancestors[ancestors.length - 4];
  return Boolean(
    declaration && ts.isVariableDeclaration(declaration) &&
    declaration.initializer === node &&
    ts.isIdentifier(declaration.name) &&
    list && ts.isVariableDeclarationList(list) &&
    (list.flags & ts.NodeFlags.Const) !== 0 &&
    list.declarations.length === 1 &&
    statement && ts.isVariableStatement(statement) &&
    owner && ts.isSourceFile(owner)
  );
}

function externalIdentifier(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  return !symbol || !symbol.declarations?.some(declaration => !declaration.getSourceFile().isDeclarationFile);
}

/** Reject constructs that cannot be represented without a JavaScript runtime. */
export function analyseClangSourceFile(
  root: string,
  source: ts.SourceFile,
  checker: ts.TypeChecker
): BakeDiagnostic[] {
  const diagnostics: BakeDiagnostic[] = [];
  const seen = new Set<string>();
  const report = (node: ts.Node, code: string, message: string, hint: string): void => {
    const entry = diagnosticAt(root, node, code, "error", message, hint);
    const key = `${entry.file}:${entry.line}:${entry.column}:${entry.code}`;
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(entry);
    }
  };

  const walk = (node: ts.Node, ancestors: readonly ts.Node[] = []): void => {
    const parent = ancestors[ancestors.length - 1];
    if (ts.isTryStatement(node) || ts.isThrowStatement(node)) {
      report(node, "BK4001", "Exception handling has no freestanding native lowering.",
        "Use explicit typed status/results; Bake must not invent C exception semantics.");
    }
    if (ts.isAwaitExpression(node) ||
        (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword))) {
      report(node, "BK4002", "Async execution requires a coroutine or scheduler lowering not yet available for native compilation.",
        "Use a synchronous entry point or an explicitly modelled state machine.");
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      report(node, "BK4003", "Class allocation, inheritance and method semantics are not yet lowered for native compilation.",
        "Use interfaces, explicit records and top-level functions until a verified class lowering exists.");
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !topLevelFunctionBinding(node, ancestors)) {
      report(node, "BK4004", "This closure cannot be translated into a static native function safely.",
        "Use a named top-level function; only const-bound top-level functions are currently hoisted.");
    }
    if (ts.isParameter(node) && !ts.isIdentifier(node.name)) {
      report(node, "BK4010", "Destructured function parameters are not lowered for native compilation.",
        "Accept an explicit typed parameter and destructure it in the function body.");
    }
    if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name) &&
        (!parent || !ts.isVariableDeclarationList(parent) ||
         !ancestors[ancestors.length - 2] || !ts.isVariableStatement(ancestors[ancestors.length - 2]!))) {
      report(node, "BK4011", "Destructuring outside a local variable statement is not lowered for native compilation.",
        "Use a simple identifier binding and explicit field/index access.");
    }
    if (ts.isNewExpression(node)) {
      report(node, "BK4005", "Dynamic 'new' allocation has no freestanding native memory contract.",
        "Use an explicit typed allocator and an initialisation function.");
    }
    if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node) ||
        ts.isRestTypeNode(node)) {
      report(node, "BK4006", "Runtime spread/rest construction is not lowered for native compilation.",
        "Replace it with explicit copying, fixed-size fields or a statically typed buffer.");
    }
    if (ts.isPropertyAccessExpression(node) && node.questionDotToken ||
        ts.isElementAccessExpression(node) && node.questionDotToken ||
        ts.isCallExpression(node) && node.questionDotToken) {
      report(node, "BK4007", "Optional chaining has no semantics-preserving native lowering yet.",
        "Use a single-evaluation explicit null check before accessing the value.");
    }
    if (ts.isForInStatement(node) || ts.isDeleteExpression(node) ||
        ts.isTypeOfExpression(node) || ts.isTaggedTemplateExpression(node) ||
        ts.isTemplateExpression(node) || ts.isRegularExpressionLiteral(node)) {
      report(node, "BK4008", "Dynamic JavaScript operation cannot be represented directly in freestanding native code.",
        "Replace the operation with explicit typed native logic.");
    }
    if (ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword ||
         node.operatorToken.kind === ts.SyntaxKind.InKeyword)) {
      report(node, "BK4008", "JavaScript object reflection cannot be represented directly in freestanding native code.",
        "Use a statically typed discriminant or explicit field test.");
    }
    if (ts.isIdentifier(node) &&
        ((HOST_GLOBALS.has(node.text) && externalIdentifier(node, checker)) ||
         (node.text === "undefined" && externalIdentifier(node, checker)))) {
      // Property names are not references to global bindings.
      if (!(parent && ts.isPropertyAccessExpression(parent) && parent.name === node)) {
        report(node, "BK4009", `JavaScript host value ${node.text} is unavailable on bare metal.`,
          "Use an explicit freestanding platform capability or a typed native representation.");
      }
    }
    ts.forEachChild(node, child => walk(child, [...ancestors, node]));
  };

  walk(source);
  return diagnostics;
}

function typeFor(
  checker: ts.TypeChecker,
  original: ts.Node,
  fallback?: ts.Expression
): ts.TypeNode | undefined {
  const reference = original.pos >= 0 ? original : fallback && ts.getOriginalNode(fallback);
  if (!reference || reference.pos < 0) {
    // Synthetic index locals introduced by Bake have a known numeric type.
    if (fallback && ts.isNumericLiteral(fallback))
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
    return undefined;
  }
  const inferred = checker.getTypeAtLocation(reference);
  if ((inferred.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return undefined;
  // Preserve native numeric aliases such as I32/U64 before widening literals.
  if (inferred.aliasSymbol)
    return checker.typeToTypeNode(inferred, reference, ts.NodeBuilderFlags.NoTruncation);
  if ((inferred.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) !== 0)
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
  if ((inferred.flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) !== 0)
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.BigIntKeyword);
  if ((inferred.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0)
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
  if ((inferred.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) !== 0)
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
  return checker.typeToTypeNode(inferred, reference, ts.NodeBuilderFlags.NoTruncation);
}

/**
 * Materialise static types and lift top-level function constants into named
 * declarations. This is TypeScript output for native backends, not C or Rust code.
 */
export function lowerClangSourceFile(
  source: ts.SourceFile,
  checker: ts.TypeChecker
): ClangLowerResult {
  let changed = false;
  const factory = ts.factory;
  const transform: ts.TransformerFactory<ts.SourceFile> = context => {
    const visit: ts.Visitor = node => {
      if (ts.isNonNullExpression(node)) {
        changed = true;
        return ts.visitNode(node.expression, visit);
      }
      if (ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) && !node.type && node.initializer &&
          !ts.isArrowFunction(node.initializer) && !ts.isFunctionExpression(node.initializer)) {
        const original = ts.getOriginalNode(node);
        const reference = ts.isVariableDeclaration(original) ? original.name :
          node.name.pos >= 0 ? node.name : original;
        const annotation = typeFor(checker, reference, node.initializer);
        if (annotation) {
          changed = true;
          return factory.updateVariableDeclaration(
            node, node.name, node.exclamationToken, annotation,
            ts.visitNode(node.initializer, visit) as ts.Expression
          );
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return file => ts.visitNode(file, visit) as ts.SourceFile;
  };

  const result = ts.transform(source, [transform]);
  const normalised = result.transformed[0] as ts.SourceFile;
  const statements = normalised.statements.map(statement => {
    if (!ts.isVariableStatement(statement) ||
        statement.declarationList.declarations.length !== 1 ||
        (statement.declarationList.flags & ts.NodeFlags.Const) === 0) return statement;
    const declaration = statement.declarationList.declarations[0]!;
    const initializer = declaration.initializer;
    if (!ts.isIdentifier(declaration.name) || !initializer ||
        !(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) return statement;
    if (initializer.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ||
        (ts.isFunctionExpression(initializer) && initializer.asteriskToken)) return statement;
    const original = ts.getOriginalNode(initializer);
    const originalFunction = ts.isArrowFunction(original) || ts.isFunctionExpression(original)
      ? original : initializer;
    let inferredReturn = initializer.type;
    if (!inferredReturn) {
      // Compiler-synthesised functions have no symbols in the original checker.
      // Only query the checker when the original function has bound parameters.
      try {
        const signature = checker.getSignatureFromDeclaration(originalFunction);
        inferredReturn = signature
          ? checker.typeToTypeNode(signature.getReturnType(), originalFunction, ts.NodeBuilderFlags.NoTruncation)
          : undefined;
      } catch {
        // A later backend can diagnose a genuinely untyped synthetic function.
      }
    }
    const body = ts.isBlock(initializer.body)
      ? initializer.body
      : factory.createBlock([factory.createReturnStatement(initializer.body)], true);
    changed = true;
    return factory.createFunctionDeclaration(
      statement.modifiers, undefined, declaration.name, initializer.typeParameters,
      initializer.parameters, initializer.type ?? inferredReturn, body
    );
  });
  const updated = factory.updateSourceFile(normalised, statements);
  result.dispose();
  return { sourceFile: updated, diagnostics: [], changed };
}
