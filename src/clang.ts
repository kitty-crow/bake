import ts from "typescript";
import { initialisedVariable, namedFunction } from "./ast";
import { required } from "./checked";
import { diagnosticAt } from "./diagnostics";
import type { BakeDiagnostic, BakeFileResult } from "./types";

/**
 * Shared freestanding frontend for the Clang and Rust targets. Keep this independent of the
 * Baguette/Bake policy core so the existing Wasm decisions stay unchanged.
 */

const HOST_GLOBALS = new Set([
  "ArrayBuffer", "ArrayBufferLike", "SharedArrayBuffer", "DataView", "Atomics",
  "WebAssembly", "Promise", "WeakMap", "WeakSet",
  "console", "setTimeout", "setInterval", "queueMicrotask",
  "Math", "Number", "String", "Object", "Array", "JSON", "Date", "BigInt",
  "RegExp", "Map", "Set", "Symbol", "globalThis",
  "process", "require", "Bun", "fetch", "window", "document"
]);

function topLevelFunctionBinding(node: ts.ArrowFunction | ts.FunctionExpression, ancestors: readonly ts.Node[]): boolean {
  const declaration = ancestors[ancestors.length - 1] ?? null;
  const list = ancestors[ancestors.length - 2] ?? null;
  const statement = ancestors[ancestors.length - 3] ?? null;
  const owner = ancestors[ancestors.length - 4] ?? null;
  return Boolean(
    declaration && ts.isVariableDeclaration(declaration) &&
    (declaration.initializer ?? null) === node &&
    ts.isIdentifier(declaration.name) &&
    list && ts.isVariableDeclarationList(list) &&
    (list.flags & ts.NodeFlags.Const) !== 0 &&
    list.declarations.length === 1 &&
    statement && ts.isVariableStatement(statement) &&
    owner && ts.isSourceFile(owner)
  );
}

function externalIdentifier(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(node) ?? null;
  return !symbol || !(symbol.declarations ?? []).some(declaration => !declaration.getSourceFile().isDeclarationFile);
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
    const parent = ancestors[ancestors.length - 1] ?? null;
    const grandparent = ancestors[ancestors.length - 2] ?? null;
    if (ts.isTryStatement(node) || ts.isThrowStatement(node)) {
      report(node, "BK4001", "Exception handling has no freestanding native lowering.",
        "Use explicit typed status/results; Bake must not invent C exception semantics.");
    }
    if (ts.isAwaitExpression(node) ||
        (ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.AsyncKeyword))) {
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
         !grandparent || !ts.isVariableStatement(grandparent))) {
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
    if (ts.isPropertyAccessExpression(node) && (node.questionDotToken ?? null) ||
        ts.isElementAccessExpression(node) && (node.questionDotToken ?? null) ||
        ts.isCallExpression(node) && (node.questionDotToken ?? null)) {
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
         (node.text === "undefined" && externalIdentifier(node, checker))) &&
        !(parent && ts.isPropertyAccessExpression(parent) && parent.name === node)) {
      // Property names are not references to global bindings.
        report(node, "BK4009", `JavaScript host value ${node.text} is unavailable on bare metal.`,
          "Use an explicit freestanding platform capability or a typed native representation.");
    }
    ts.forEachChild(node, child => walk(child, [...ancestors, node]));
  };

  walk(source);
  return diagnostics;
}

function typeFor(
  checker: ts.TypeChecker,
  original: ts.Node,
  fallback: ts.Expression | null = null
): ts.TypeNode | null {
  const reference = original.pos >= 0 && (original.parent ?? null) ? original : fallback && ts.getOriginalNode(fallback);
  // Synthetic index locals introduced by Bake have a known numeric type.
  if (!reference || reference.pos < 0 || !(reference.parent ?? null)) return fallback && ts.isNumericLiteral(fallback)
    ? ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword) : null;
  const inferred = checker.getTypeAtLocation(reference);
  if ((inferred.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return null;
  // Preserve native numeric aliases such as I32/U64 before widening literals.
  if (inferred.aliasSymbol ?? null)
    return checker.typeToTypeNode(inferred, reference, ts.NodeBuilderFlags.NoTruncation) ?? null;
  if ((inferred.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) !== 0)
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
  if ((inferred.flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) !== 0)
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.BigIntKeyword);
  if ((inferred.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0)
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
  if ((inferred.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) !== 0)
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
  return checker.typeToTypeNode(inferred, reference, ts.NodeBuilderFlags.NoTruncation) ?? null;
}

/**
 * Materialise static types and lift top-level function constants into named
 * declarations. This is TypeScript output for native backends, not C or Rust code.
 */
function returnType(checker: ts.TypeChecker, fn: ts.ArrowFunction | ts.FunctionExpression): ts.TypeNode | null {
  // A synthetic function may lack a bound signature in the original program.
  const infer = (): ts.TypeNode | null => {
    const signature = checker.getSignatureFromDeclaration(fn) ?? null;
    return signature ? checker.typeToTypeNode(signature.getReturnType(), fn, ts.NodeBuilderFlags.NoTruncation) ?? null : null;
  };
  if (fn.pos >= 0) return infer();
  try { return infer(); } catch { return null; }
}

export function lowerClangSourceFile(
  source: ts.SourceFile,
  checker: ts.TypeChecker
): BakeFileResult {
  let changed = false;
  const factory = ts.factory;
  const annotate = (node: ts.VariableDeclaration): ts.TypeNode | null => {
    const init = node.initializer ?? null;
    if (!ts.isIdentifier(node.name) || (node.type ?? null) || !init || ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return null;
    // A grammar template's declaration is unbound; the inserted name retains the original binding.
    const reference = ts.getOriginalNode(node.name);
    return typeFor(checker, reference, init);
  };
  const transform: ts.TransformerFactory<ts.SourceFile> = context => {
    const visit: ts.Visitor<ts.Node, ts.Node> = node => {
      if (ts.isNonNullExpression(node)) {
        changed = true;
        return ts.visitNode(node.expression, visit, ts.isExpression);
      }
      const annotation = ts.isVariableDeclaration(node) ? annotate(node) : null;
      const initial = ts.isVariableDeclaration(node) ? node.initializer ?? null : null;
      if (annotation && ts.isVariableDeclaration(node) && initial) {
        changed = true;
        const updated = initialisedVariable(node.name, ts.visitNode(initial, visit, ts.isExpression), annotation);
        return ts.setOriginalNode(ts.setTextRange(updated, node), node);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return file => ts.visitNode(file, visit, ts.isSourceFile);
  };

  const result = ts.transform(source, [transform]);
  const normalised = required(result.transformed[0] ?? null);
  const statements = normalised.statements.map(statement => {
    if (!ts.isVariableStatement(statement) ||
        statement.declarationList.declarations.length !== 1 ||
        (statement.declarationList.flags & ts.NodeFlags.Const) === 0) return statement;
    const declaration = statement.declarationList.declarations[0] ?? null;
    if (!declaration) return statement;
    const initializer = declaration.initializer ?? null;
    if (!ts.isIdentifier(declaration.name) || !initializer ||
        !(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) return statement;
    if ((initializer.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ||
        (ts.isFunctionExpression(initializer) && (initializer.asteriskToken ?? null))) return statement;
    const original = ts.getOriginalNode(initializer);
    const originalFunction = ts.isArrowFunction(original) || ts.isFunctionExpression(original)
      ? original : initializer;
    const inferredReturn = (initializer.type ?? null) ?? returnType(checker, originalFunction);
    const body = ts.isBlock(initializer.body)
      ? initializer.body
      : factory.createBlock([factory.createReturnStatement(initializer.body)], true);
    changed = true;
    return namedFunction({
      modifiers: statement.modifiers ?? [], name: declaration.name,
      typeParameters: initializer.typeParameters ?? [], parameters: initializer.parameters,
      returns: inferredReturn, body
    });
  });
  const updated = factory.updateSourceFile(normalised, statements);
  result.dispose();
  return { sourceFile: updated, diagnostics: [], changed };
}
