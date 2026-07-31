import path from "node:path";
import ts from "typescript";
import type { BakeDiagnostic } from "../types";

export function warn(root: string, node: ts.Node, code: string, message: string, hint?: string): BakeDiagnostic {
  const source = node.getSourceFile();
  const place = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    code,
    severity: "warning",
    file: path.relative(root, source.fileName).split(path.sep).join("/"),
    line: place.line + 1,
    column: place.character + 1,
    message,
    hint
  };
}

export function mods(
  factory: ts.NodeFactory,
  input: readonly ts.ModifierLike[] | undefined,
  kind: ts.SyntaxKind
): readonly ts.ModifierLike[] {
  if (input?.some(item => item.kind === kind)) return input;
  return [factory.createModifier(kind as ts.ModifierSyntaxKind), ...(input ?? [])];
}

export function pure(expression: ts.Expression): boolean {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) return pure(expression.expression);
  if (ts.isIdentifier(expression) || expression.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(expression)) return pure(expression.expression);
  if (ts.isElementAccessExpression(expression)) {
    return pure(expression.expression) && Boolean(expression.argumentExpression && pure(expression.argumentExpression));
  }
  return ts.isLiteralExpression(expression);
}
