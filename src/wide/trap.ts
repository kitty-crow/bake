import ts from "typescript";
import type { WidePass, WideResult } from "./types";

export const trapPass: WidePass = {
  name: "trap",
  run(_root, source): WideResult {
    let changed = false;
    const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
      const factory = context.factory;
      const visit: ts.Visitor = node => {
        if (ts.isThrowStatement(node)) {
          changed = true;
          return factory.createExpressionStatement(factory.createCallExpression(factory.createIdentifier("unreachable"), undefined, []));
        }
        return ts.visitEachChild(node, visit, context);
      };
      return file => {
        const next = ts.visitNode(file, visit) as ts.SourceFile;
        if (!changed) return next;
        const declaration = factory.createFunctionDeclaration(
          [factory.createModifier(ts.SyntaxKind.DeclareKeyword)],
          undefined,
          "unreachable",
          undefined,
          [],
          factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword),
          undefined
        );
        return factory.updateSourceFile(next, [declaration, ...next.statements]);
      };
    };
    const result = ts.transform(source, [transformer]);
    const sourceFile = result.transformed[0] as ts.SourceFile;
    result.dispose();
    return { sourceFile, changed, diagnostics: [] };
  }
};
