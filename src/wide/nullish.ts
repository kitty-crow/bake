import ts from "typescript";
import type { BakeDiagnostic } from "../types";
import type { WidePass, WideResult } from "./types";
import { pure, warn } from "./util";

function notNull(factory: ts.NodeFactory, expression: ts.Expression): ts.Expression {
  return factory.createBinaryExpression(
    expression,
    factory.createToken(ts.SyntaxKind.ExclamationEqualsToken),
    factory.createNull()
  );
}

function bounds(factory: ts.NodeFactory, array: ts.Expression, index: ts.Expression): ts.Expression {
  const lower = factory.createBinaryExpression(index, factory.createToken(ts.SyntaxKind.GreaterThanEqualsToken), factory.createNumericLiteral(0));
  const upper = factory.createBinaryExpression(
    index,
    factory.createToken(ts.SyntaxKind.LessThanToken),
    factory.createPropertyAccessExpression(array, "length")
  );
  return factory.createBinaryExpression(lower, factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken), upper);
}

export const nullishPass: WidePass = {
  name: "nullish",
  run(root, source, checker): WideResult {
    let changed = false;
    const diagnostics: BakeDiagnostic[] = [];
    const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
      const factory = context.factory;
      const visit: ts.Visitor = node => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
          const left = ts.visitNode(node.left, visit) as ts.Expression;
          const right = ts.visitNode(node.right, visit) as ts.Expression;
          if (ts.isElementAccessExpression(left) && left.argumentExpression) {
            const index = left.argumentExpression;
            if (!pure(index)) {
              diagnostics.push(warn(root, node, "BK3401", "Wide lowering left an effectful nullish index unchanged.", "Assign the index to a typed local before applying ??."));
              return factory.updateBinaryExpression(node, left, node.operatorToken, right);
            }
            if (pure(left.expression)) {
              const condition = factory.createBinaryExpression(
                bounds(factory, left.expression, index),
                factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
                notNull(factory, left)
              );
              changed = true;
              return factory.createConditionalExpression(
                condition,
                factory.createToken(ts.SyntaxKind.QuestionToken),
                factory.createNonNullExpression(left),
                factory.createToken(ts.SyntaxKind.ColonToken),
                right
              );
            }
            const original = ts.getOriginalNode(node.left) as ts.ElementAccessExpression;
            const type = checker.getTypeAtLocation(original.expression);
            const typeNode = checker.typeToTypeNode(type, undefined, ts.NodeBuilderFlags.NoTruncation);
            if (!typeNode) {
              diagnostics.push(warn(root, node, "BK3401", "Wide lowering could not type an effectful nullish array receiver.", "Assign the array to a typed local before applying ??."));
              return factory.updateBinaryExpression(node, left, node.operatorToken, right);
            }
            const name = factory.createUniqueName("__bake_arr");
            const item = factory.createElementAccessExpression(name, index);
            const condition = factory.createBinaryExpression(
              bounds(factory, name, index),
              factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
              notNull(factory, item)
            );
            const body = factory.createConditionalExpression(
              condition,
              factory.createToken(ts.SyntaxKind.QuestionToken),
              factory.createNonNullExpression(item),
              factory.createToken(ts.SyntaxKind.ColonToken),
              right
            );
            const arrow = factory.createArrowFunction(
              undefined,
              undefined,
              [factory.createParameterDeclaration(undefined, undefined, name, undefined, typeNode)],
              undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              body
            );
            changed = true;
            return factory.createCallExpression(factory.createParenthesizedExpression(arrow), undefined, [left.expression]);
          }
          if (!pure(left)) {
            diagnostics.push(warn(root, node, "BK3401", "Wide lowering left an effectful nullish receiver unchanged.", "Assign the receiver to a typed local before applying ?? so it is evaluated once."));
            return factory.updateBinaryExpression(node, left, node.operatorToken, right);
          }
          changed = true;
          return factory.createConditionalExpression(
            notNull(factory, left),
            factory.createToken(ts.SyntaxKind.QuestionToken),
            factory.createNonNullExpression(left),
            factory.createToken(ts.SyntaxKind.ColonToken),
            right
          );
        }
        return ts.visitEachChild(node, visit, context);
      };
      return file => ts.visitNode(file, visit) as ts.SourceFile;
    };
    const result = ts.transform(source, [transformer]);
    const sourceFile = result.transformed[0] as ts.SourceFile;
    result.dispose();
    return { sourceFile, changed, diagnostics };
  }
};
