import ts from "typescript";
import type { BakeDiagnostic } from "../types";
import type { WidePass, WideResult } from "./types";
import { warn } from "./util";

function hash(value: string): number {
  let out = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    out ^= value.charCodeAt(index);
    out = Math.imul(out, 0x01000193);
  }
  return (out >>> 0) || 1;
}

function code(expression: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(expression)) return (Number(expression.text) | 0) || 1;
  if (ts.isStringLiteralLike(expression)) return hash(expression.text);
  if (ts.isNewExpression(expression) && expression.arguments?.[0] && ts.isStringLiteralLike(expression.arguments[0])) {
    return hash(expression.arguments[0].text);
  }
  return undefined;
}

function needsSink(node: ts.TryStatement): boolean {
  const block = node.parent;
  if (!ts.isBlock(block) || block.statements[block.statements.length - 1] !== node) return false;
  const owner = block.parent;
  return ts.isFunctionLike(owner) && Boolean(owner.type && owner.type.kind !== ts.SyntaxKind.VoidKeyword);
}

function nestedBreak(node: ts.Node, root: ts.TryStatement): boolean {
  let current = node.parent;
  while (current && current !== root.tryBlock) {
    if (ts.isIterationStatement(current, false) || ts.isSwitchStatement(current)) return true;
    current = current.parent;
  }
  return false;
}

export const exceptPass: WidePass = {
  name: "exceptions",
  run(root, source): WideResult {
    let changed = false;
    let serial = 0;
    const diagnostics: BakeDiagnostic[] = [];
    const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
      const factory = context.factory;
      const visit: ts.Visitor = node => {
        if (!ts.isTryStatement(node)) return ts.visitEachChild(node, visit, context);
        if (!node.catchClause || node.finallyBlock) {
          diagnostics.push(warn(root, node, "BK3201", "Wide lowering only handles try/catch without finally.", "Move cleanup into explicit statements and keep the thrown value deterministic."));
          return ts.visitEachChild(node, visit, context);
        }
        const id = serial++;
        const err = factory.createUniqueName(`__bake_err_${id}`);
        let nested = false;
        let unsafeBreak = false;
        const throwVisit: ts.Visitor = current => {
          if (ts.isFunctionLike(current)) return current;
          if (ts.isTryStatement(current) && current !== node) {
            nested = true;
            return current;
          }
          if (ts.isThrowStatement(current)) {
            if (nestedBreak(current, node)) {
              unsafeBreak = true;
              return current;
            }
            const value = code(current.expression);
            if (value === undefined) {
              diagnostics.push(warn(root, current, "BK3202", "A non-literal thrown value was collapsed to error code 1.", "Throw a numeric code or an Error with a literal message for stable lowering."));
            }
            return factory.createBlock([
              factory.createExpressionStatement(factory.createBinaryExpression(err, factory.createToken(ts.SyntaxKind.EqualsToken), factory.createNumericLiteral(value ?? 1))),
              factory.createBreakStatement()
            ], true);
          }
          return ts.visitEachChild(current, throwVisit, context);
        };
        const body = ts.visitNode(node.tryBlock, throwVisit) as ts.Block;
        if (nested) {
          diagnostics.push(warn(root, node, "BK3203", "Nested try blocks were left unchanged.", "Split nested exception regions into named result-returning functions."));
          return ts.visitEachChild(node, visit, context);
        }
        if (unsafeBreak) {
          diagnostics.push(warn(root, node, "BK3204", "Throws inside loops or switches were left unchanged.", "Move that region into a named result-returning function before wide lowering."));
          return ts.visitEachChild(node, visit, context);
        }
        const catchStatements: ts.Statement[] = [];
        const variable = node.catchClause.variableDeclaration;
        if (variable && ts.isIdentifier(variable.name)) {
          catchStatements.push(factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
            factory.createVariableDeclaration(variable.name, undefined, factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword), err)
          ], ts.NodeFlags.Const)));
        }
        catchStatements.push(...node.catchClause.block.statements.map(statement => ts.visitNode(statement, visit) as ts.Statement));
        const output: ts.Statement[] = [
          factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
            factory.createVariableDeclaration(err, undefined, factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword), factory.createNumericLiteral(0))
          ], ts.NodeFlags.Let)),
          factory.createDoStatement(body, factory.createFalse()),
          factory.createIfStatement(
            factory.createBinaryExpression(err, factory.createToken(ts.SyntaxKind.ExclamationEqualsToken), factory.createNumericLiteral(0)),
            factory.createBlock(catchStatements, true)
          )
        ];
        if (needsSink(node)) {
          output.push(factory.createWhileStatement(factory.createTrue(), factory.createBlock([], true)));
        }
        changed = true;
        return output;
      };
      return file => ts.visitNode(file, visit) as ts.SourceFile;
    };
    const result = ts.transform(source, [transformer]);
    const sourceFile = result.transformed[0] as ts.SourceFile;
    result.dispose();
    return { sourceFile, changed, diagnostics };
  }
};
