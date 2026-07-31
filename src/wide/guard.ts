import ts from "typescript";
import type { WidePass, WideResult } from "./types";

function lowerUnit<T extends ts.SignatureDeclarationBase>(factory: ts.NodeFactory, node: T): T {
  const predicate = node.type && ts.isTypePredicateNode(node.type) ? node.type : undefined;
  if (!predicate || !predicate.type || !ts.isIdentifier(predicate.parameterName)) return node;
  const parameterName = predicate.parameterName.text;
  const parameters = node.parameters.map(parameter => {
    if (!ts.isIdentifier(parameter.name) || parameter.name.text !== parameterName) return parameter;
    if (!parameter.type || parameter.type.kind !== ts.SyntaxKind.UnknownKeyword) return parameter;
    return factory.updateParameterDeclaration(
      parameter,
      parameter.modifiers,
      parameter.dotDotDotToken,
      parameter.name,
      parameter.questionToken,
      predicate.type,
      parameter.initializer
    );
  });
  if (parameters.every((parameter, index) => parameter === node.parameters[index])) return node;

  const booleanType = factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
  if (ts.isFunctionDeclaration(node)) {
    return factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, parameters, booleanType, node.body) as unknown as T;
  }
  if (ts.isFunctionExpression(node)) {
    return factory.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, parameters, booleanType, node.body) as unknown as T;
  }
  if (ts.isArrowFunction(node)) {
    return factory.updateArrowFunction(node, node.modifiers, node.typeParameters, parameters, booleanType, node.equalsGreaterThanToken, node.body) as unknown as T;
  }
  if (ts.isMethodDeclaration(node)) {
    return factory.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.questionToken, node.typeParameters, parameters, booleanType, node.body) as unknown as T;
  }
  return node;
}

export const guardPass: WidePass = {
  name: "guard",
  run(_root, source): WideResult {
    let changed = false;
    const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
      const visit: ts.Visitor = node => {
        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
          const next = lowerUnit(context.factory, node);
          if (next !== node) changed = true;
          return ts.visitEachChild(next, visit, context);
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
