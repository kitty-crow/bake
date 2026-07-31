import ts from "typescript";
import type { BakeDiagnostic } from "../types";
import type { WidePass, WideResult } from "./types";
import { pure, warn } from "./util";

export const optPass: WidePass = {
  name: "optional-chain",
  run(root, source): WideResult {
    let changed = false;
    const diagnostics: BakeDiagnostic[] = [];
    const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
      const factory = context.factory;
      const visit: ts.Visitor = node => {
        if (ts.isPropertyAccessChain(node) && node.questionDotToken) {
          if (!pure(node.expression)) {
            diagnostics.push(warn(root, node, "BK3101", "Wide lowering left an effectful optional-chain receiver unchanged.", "Assign the receiver to a typed local first."));
            return ts.visitEachChild(node, visit, context);
          }
          const expression = ts.visitNode(node.expression, visit) as ts.Expression;
          changed = true;
          return factory.createConditionalExpression(
            factory.createBinaryExpression(expression, factory.createToken(ts.SyntaxKind.EqualsEqualsToken), factory.createNull()),
            factory.createToken(ts.SyntaxKind.QuestionToken),
            factory.createNull(),
            factory.createToken(ts.SyntaxKind.ColonToken),
            factory.createPropertyAccessExpression(expression, node.name)
          );
        }
        if (ts.isElementAccessChain(node) && node.questionDotToken && node.argumentExpression) {
          if (!pure(node.expression) || !pure(node.argumentExpression)) {
            diagnostics.push(warn(root, node, "BK3101", "Wide lowering left an effectful optional element access unchanged.", "Assign the receiver and index to typed locals first."));
            return ts.visitEachChild(node, visit, context);
          }
          const expression = ts.visitNode(node.expression, visit) as ts.Expression;
          const argument = ts.visitNode(node.argumentExpression, visit) as ts.Expression;
          changed = true;
          return factory.createConditionalExpression(
            factory.createBinaryExpression(expression, factory.createToken(ts.SyntaxKind.EqualsEqualsToken), factory.createNull()),
            factory.createToken(ts.SyntaxKind.QuestionToken),
            factory.createNull(),
            factory.createToken(ts.SyntaxKind.ColonToken),
            factory.createElementAccessExpression(expression, argument)
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
