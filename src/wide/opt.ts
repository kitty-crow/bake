import ts from "typescript";
import type { BakeDiagnostic } from "../types";
import type { WidePass, WideResult } from "./types";
import { pure, warn } from "./util";

type Chain = ts.PropertyAccessChain | ts.ElementAccessChain | ts.CallChain;

function optional(node: ts.Node): node is Chain {
  return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) && ts.isOptionalChain(node);
}

function base(node: Chain): ts.Expression | undefined {
  if (node.questionDotToken) return node.expression;
  return optional(node.expression) ? base(node.expression) : undefined;
}

function strip(factory: ts.NodeFactory, node: Chain, visit: ts.Visitor): ts.Expression {
  if (ts.isPropertyAccessExpression(node)) {
    const expression = optional(node.expression)
      ? strip(factory, node.expression, visit)
      : ts.visitNode(node.expression, visit) as ts.Expression;
    return factory.createPropertyAccessExpression(expression, node.name);
  }
  if (ts.isElementAccessExpression(node)) {
    const expression = optional(node.expression)
      ? strip(factory, node.expression, visit)
      : ts.visitNode(node.expression, visit) as ts.Expression;
    const argument = node.argumentExpression
      ? ts.visitNode(node.argumentExpression, visit) as ts.Expression
      : factory.createNumericLiteral(0);
    return factory.createElementAccessExpression(expression, argument);
  }
  const expression = optional(node.expression)
    ? strip(factory, node.expression, visit)
    : ts.visitNode(node.expression, visit) as ts.Expression;
  return factory.createCallExpression(
    expression,
    node.typeArguments,
    node.arguments.map(argument => ts.visitNode(argument, visit) as ts.Expression)
  );
}

function nullTest(factory: ts.NodeFactory, expression: ts.Expression, equal: boolean): ts.Expression {
  return factory.createBinaryExpression(
    expression,
    factory.createToken(equal ? ts.SyntaxKind.EqualsEqualsToken : ts.SyntaxKind.ExclamationEqualsToken),
    factory.createNull()
  );
}

function root(node: Chain): boolean {
  return !optional(node.parent);
}

function nullable(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(nullable);
  return Boolean(type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void));
}

function declaredType(name: ts.MemberName, checker: ts.TypeChecker): ts.Type | undefined {
  const symbol = checker.getSymbolAtLocation(name);
  const declaration = symbol?.declarations?.[0];
  return symbol && declaration ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : undefined;
}

function nonNullResult(node: Chain, checker: ts.TypeChecker): boolean {
  const original = ts.getOriginalNode(node) as Chain;
  if (ts.isCallExpression(original)) {
    if (ts.isPropertyAccessExpression(original.expression)) {
      const method = declaredType(original.expression.name, checker);
      const signature = method?.getCallSignatures()[0];
      if (signature) return !nullable(checker.getReturnTypeOfSignature(signature));
    }
    const signature = checker.getResolvedSignature(original);
    return Boolean(signature && !nullable(checker.getReturnTypeOfSignature(signature)));
  }
  if (ts.isPropertyAccessExpression(original)) {
    const type = declaredType(original.name, checker);
    return Boolean(type && !nullable(type));
  }
  return false;
}

export const optPass: WidePass = {
  name: "optional-chain",
  run(rootDir, source, checker): WideResult {
    let changed = false;
    const diagnostics: BakeDiagnostic[] = [];
    const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
      const factory = context.factory;
      const lower = (node: Chain, fallback?: ts.Expression, condition = false): ts.Expression | undefined => {
        const receiver = base(node);
        if (!receiver || !pure(receiver)) {
          diagnostics.push(warn(rootDir, node, "BK3101", "Wide lowering left an effectful optional-chain receiver unchanged.", "Assign the receiver to a typed local first."));
          return undefined;
        }
        const testReceiver = ts.visitNode(receiver, visit) as ts.Expression;
        const full = strip(factory, node, visit);
        changed = true;
        if (condition) {
          return factory.createBinaryExpression(
            nullTest(factory, testReceiver, false),
            factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
            full
          );
        }
        if (fallback && nonNullResult(node, checker)) {
          return factory.createConditionalExpression(
            nullTest(factory, testReceiver, true),
            factory.createToken(ts.SyntaxKind.QuestionToken),
            fallback,
            factory.createToken(ts.SyntaxKind.ColonToken),
            full
          );
        }
        const optionalValue = factory.createConditionalExpression(
          nullTest(factory, testReceiver, true),
          factory.createToken(ts.SyntaxKind.QuestionToken),
          factory.createNull(),
          factory.createToken(ts.SyntaxKind.ColonToken),
          full
        );
        if (!fallback) return optionalValue;
        if (!pure(full)) {
          diagnostics.push(warn(rootDir, node, "BK3102", "Wide lowering kept a nullish fallback after an effectful optional chain.", "Assign the optional result to a typed local before applying the fallback."));
          return factory.createBinaryExpression(optionalValue, factory.createToken(ts.SyntaxKind.QuestionQuestionToken), fallback);
        }
        return factory.createConditionalExpression(
          nullTest(factory, optionalValue, true),
          factory.createToken(ts.SyntaxKind.QuestionToken),
          fallback,
          factory.createToken(ts.SyntaxKind.ColonToken),
          optionalValue
        );
      };
      const visit: ts.Visitor = node => {
        if (ts.isIfStatement(node) && optional(node.expression)) {
          const expression = lower(node.expression, undefined, true);
          if (expression) return factory.updateIfStatement(
            node,
            expression,
            ts.visitNode(node.thenStatement, visit) as ts.Statement,
            node.elseStatement ? ts.visitNode(node.elseStatement, visit) as ts.Statement : undefined
          );
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && optional(node.left)) {
          const fallback = ts.visitNode(node.right, visit) as ts.Expression;
          const expression = lower(node.left, fallback);
          if (expression) return expression;
        }
        if (optional(node) && root(node)) {
          const expression = lower(node);
          if (expression) return expression;
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
