import ts from "typescript";
import type { WidePass, WideResult } from "./types";

function predicateCallback(node: ts.ParameterDeclaration): boolean {
  const fn = node.parent;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false;
  const call = fn.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== fn) return false;
  const target = call.expression;
  return ts.isPropertyAccessExpression(target) &&
    (target.name.text === "every" || target.name.text === "some" || target.name.text === "filter");
}

export const implicitPass: WidePass = {
  name: "implicit predicate parameters",
  run(_root, source, checker): WideResult {
    let changed = false;
    const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
      const factory = context.factory;
      const visit: ts.Visitor = node => {
        if (ts.isParameter(node) && !node.type && ts.isIdentifier(node.name) && predicateCallback(node)) {
          const type = checker.getTypeAtLocation(node.name);
          if (type.flags & ts.TypeFlags.Any) {
            changed = true;
            return factory.updateParameterDeclaration(
              node,
              node.modifiers,
              node.dotDotDotToken,
              node.name,
              node.questionToken,
              factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
              node.initializer
            );
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return file => ts.visitNode(file, visit) as ts.SourceFile;
    };
    const result = ts.transform(source, [transformer]);
    const sourceFile = result.transformed[0] as ts.SourceFile;
    result.dispose();
    return { sourceFile, changed, diagnostics: [] };
  }
};
