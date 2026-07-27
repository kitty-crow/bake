import ts from "typescript";
import type { BakeCoreEngine } from "./core-engine";
import {
  BAKE_ACTION_LOWER,
  BAKE_ACTION_WARNING,
  BAKE_FACT_DESTRUCTURE,
  BAKE_FACT_FOR_OF,
  BAKE_FACT_NULLISH,
  BAKE_FLAG_AWAIT,
  BAKE_FLAG_IMPURE,
  BAKE_FLAG_NOT_ARRAY_LIKE,
  BAKE_FLAG_UNDEFINED_SENSITIVE,
  BAKE_FLAG_UNSUPPORTED_BINDING,
  BAKE_FLAG_UNSUPPORTED_INITIALIZER,
  bakeDecisionAction,
  bakeDecisionDiagnostic,
  bakeDecisionPayload
} from "./core/protocol";
import { diagnosticAt } from "./diagnostics";
import { bakeDiagnosticCode } from "./target";
import type { BakeDiagnostic } from "./types";

interface LowerResult {
  readonly sourceFile: ts.SourceFile;
  readonly changed: boolean;
  readonly diagnostics: readonly BakeDiagnostic[];
}

function isPureExpression(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return isPureExpression(expression.expression);
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return isPureExpression(expression.left) && isPureExpression(expression.right);
  }
  return ts.isIdentifier(expression) ||
    ts.isLiteralExpression(expression) ||
    expression.kind === ts.SyntaxKind.ThisKeyword ||
    ts.isPropertyAccessExpression(expression) && isPureExpression(expression.expression) ||
    ts.isElementAccessExpression(expression) && isPureExpression(expression.expression) && Boolean(expression.argumentExpression && isPureExpression(expression.argumentExpression));
}

function isArrayLikeExpression(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const type = checker.getTypeAtLocation(expression);
  return checker.isArrayType(type) || checker.isTupleType(type);
}

export function lowerSourceFile(
  root: string,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  core: BakeCoreEngine
): LowerResult {
  const diagnostics: BakeDiagnostic[] = [];
  let changed = false;
  let serial = 0;

  const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
    const factory = context.factory;

    const collectNullishOperands = (expression: ts.Expression, operands: ts.Expression[]): void => {
      const unwrapped = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
      if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        collectNullishOperands(unwrapped.left, operands);
        collectNullishOperands(unwrapped.right, operands);
        return;
      }
      operands.push(expression);
    };

    const lowerNullish = (node: ts.BinaryExpression): ts.Expression | undefined => {
      if (node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) return undefined;

      const operands: ts.Expression[] = [];
      collectNullishOperands(node, operands);
      if (operands.length < 2) return undefined;

      let flags = 0;
      let firstNonNullable = -1;
      for (let index = 0; index < operands.length - 1; index++) {
        const operand = operands[index]!;
        if (!isPureExpression(operand)) flags |= BAKE_FLAG_IMPURE;

        const operandType = checker.getTypeAtLocation(operand);
        const parts = operandType.isUnion() ? operandType.types : [operandType];
        const hasNull = parts.some(part => Boolean(part.flags & ts.TypeFlags.Null));
        const hasUndefined = parts.some(part => Boolean(part.flags & ts.TypeFlags.Undefined));
        if (hasUndefined) flags |= BAKE_FLAG_UNDEFINED_SENSITIVE;
        if (!hasNull) {
          firstNonNullable = index;
          break;
        }
      }

      const decision = core.decide(BAKE_FACT_NULLISH, flags, operands.length, firstNonNullable);
      const action = bakeDecisionAction(decision);
      if (action === BAKE_ACTION_WARNING) {
        const impure = (flags & BAKE_FLAG_IMPURE) !== 0;
        diagnostics.push(diagnosticAt(
          root,
          node,
          bakeDiagnosticCode(bakeDecisionDiagnostic(decision)),
          "warning",
          impure
            ? "Bake left this nullish-coalescing expression unchanged because an operand may have side effects."
            : "Bake did not lower this undefined-sensitive nullish expression.",
          impure
            ? "Assign each side-effecting operand to a typed local first. Bake can then lower the chain without evaluating it twice."
            : "Replace undefined with an explicit nullable or tagged native representation before Baguette compilation."
        ));
        return node;
      }
      if (action !== BAKE_ACTION_LOWER) return undefined;

      const effectiveLength = bakeDecisionPayload(decision);
      const effectiveOperands = operands.slice(0, effectiveLength);
      const visitedOperands = effectiveOperands.map(operand => ts.visitNode(operand, visitor) as ts.Expression);
      let lowered: ts.Expression = visitedOperands[visitedOperands.length - 1]!;
      for (let index = visitedOperands.length - 2; index >= 0; index--) {
        const operand = visitedOperands[index]!;
        lowered = factory.createConditionalExpression(
          factory.createBinaryExpression(operand, factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken), factory.createNull()),
          factory.createToken(ts.SyntaxKind.QuestionToken),
          operand,
          factory.createToken(ts.SyntaxKind.ColonToken),
          lowered
        );
      }

      changed = true;
      return lowered;
    };

    const lowerForOf = (node: ts.ForOfStatement): ts.Statement | undefined => {
      let flags = 0;
      if (node.awaitModifier) flags |= BAKE_FLAG_AWAIT;
      if (!isArrayLikeExpression(node.expression, checker)) flags |= BAKE_FLAG_NOT_ARRAY_LIKE;
      if (!ts.isVariableDeclarationList(node.initializer) || node.initializer.declarations.length !== 1) {
        flags |= BAKE_FLAG_UNSUPPORTED_INITIALIZER;
      } else {
        const declaration = node.initializer.declarations[0]!;
        if (!ts.isIdentifier(declaration.name)) flags |= BAKE_FLAG_UNSUPPORTED_INITIALIZER;
      }

      const decision = core.decide(BAKE_FACT_FOR_OF, flags, 0, 0);
      if (bakeDecisionAction(decision) !== BAKE_ACTION_LOWER) return undefined;

      const declarationList = node.initializer as ts.VariableDeclarationList;
      const declaration = declarationList.declarations[0]!;
      const declarationName = declaration.name as ts.Identifier;
      changed = true;
      const id = serial++;
      const arrayName = factory.createUniqueName(`__bake_array_${id}`);
      const indexName = factory.createUniqueName(`__bake_index_${id}`);
      const arrayDeclaration = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(arrayName, undefined, undefined, ts.visitNode(node.expression, visitor) as ts.Expression)
        ], ts.NodeFlags.Const)
      );
      const initializer = factory.createVariableDeclarationList([
        factory.createVariableDeclaration(indexName, undefined, undefined, factory.createNumericLiteral(0))
      ], ts.NodeFlags.Let);
      const condition = factory.createBinaryExpression(indexName, factory.createToken(ts.SyntaxKind.LessThanToken), factory.createPropertyAccessExpression(arrayName, "length"));
      const incrementor = factory.createPostfixUnaryExpression(indexName, ts.SyntaxKind.PlusPlusToken);
      const itemDeclaration = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            declarationName,
            declaration.exclamationToken,
            declaration.type,
            factory.createElementAccessExpression(arrayName, indexName)
          )
        ], declarationList.flags)
      );
      const originalBody = ts.visitNode(node.statement, visitor) as ts.Statement;
      const statements = ts.isBlock(originalBody) ? [itemDeclaration, ...originalBody.statements] : [itemDeclaration, originalBody];
      return factory.createBlock([
        arrayDeclaration,
        factory.createForStatement(initializer, condition, incrementor, factory.createBlock(statements, true))
      ], true);
    };

    const bindingNeedsManualLowering = (name: ts.BindingName): boolean => {
      if (ts.isIdentifier(name)) return false;
      for (const element of name.elements) {
        if (!ts.isBindingElement(element)) continue;
        if (element.dotDotDotToken || element.initializer || bindingNeedsManualLowering(element.name)) return true;
      }
      return false;
    };

    const lowerVariableStatement = (node: ts.VariableStatement): ts.Statement[] | undefined => {
      const declarations = node.declarationList.declarations;
      if (!declarations.some(declaration => !ts.isIdentifier(declaration.name))) return undefined;

      const unsupported = declarations.find(declaration => !ts.isIdentifier(declaration.name) && bindingNeedsManualLowering(declaration.name));
      const flags = unsupported ? BAKE_FLAG_UNSUPPORTED_BINDING : 0;
      const decision = core.decide(BAKE_FACT_DESTRUCTURE, flags, 0, 0);
      const action = bakeDecisionAction(decision);
      if (action === BAKE_ACTION_WARNING && unsupported) {
        diagnostics.push(diagnosticAt(
          root,
          unsupported,
          bakeDiagnosticCode(bakeDecisionDiagnostic(decision)),
          "warning",
          "Bake left destructuring with defaults, rest elements or nested unsupported bindings unchanged.",
          "Rewrite it as explicit indexed or property assignments so each native value has a deterministic source."
        ));
        return undefined;
      }
      if (action !== BAKE_ACTION_LOWER) return undefined;

      const output: ts.Statement[] = [];
      for (const declaration of declarations) {
        if (ts.isIdentifier(declaration.name) || !declaration.initializer) {
          output.push(factory.createVariableStatement(node.modifiers, factory.createVariableDeclarationList([
            ts.visitEachChild(declaration, visitor, context) as ts.VariableDeclaration
          ], node.declarationList.flags)));
          continue;
        }

        const tempName = factory.createUniqueName(`__bake_destructure_${serial++}`);
        output.push(factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
          factory.createVariableDeclaration(tempName, undefined, undefined, ts.visitNode(declaration.initializer, visitor) as ts.Expression)
        ], ts.NodeFlags.Const)));

        const emitBinding = (name: ts.BindingName, access: ts.Expression): void => {
          if (ts.isIdentifier(name)) {
            output.push(factory.createVariableStatement(node.modifiers, factory.createVariableDeclarationList([
              factory.createVariableDeclaration(name, undefined, undefined, access)
            ], node.declarationList.flags)));
            return;
          }
          if (ts.isObjectBindingPattern(name)) {
            for (const element of name.elements) {
              const propertyName = element.propertyName ?? element.name;
              const next = ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName) || ts.isNumericLiteral(propertyName)
                ? factory.createElementAccessExpression(access, ts.isIdentifier(propertyName) ? factory.createStringLiteral(propertyName.text) : propertyName)
                : access;
              emitBinding(element.name, next);
            }
          } else {
            name.elements.forEach((element, index) => {
              if (!ts.isBindingElement(element)) return;
              emitBinding(element.name, factory.createElementAccessExpression(access, factory.createNumericLiteral(index)));
            });
          }
        };

        emitBinding(declaration.name, tempName);
        changed = true;
      }
      return output;
    };

    const visitor: ts.Visitor = node => {
      if (ts.isForOfStatement(node)) {
        const lowered = lowerForOf(node);
        if (lowered) return lowered;
      }
      if (ts.isVariableStatement(node)) {
        const lowered = lowerVariableStatement(node);
        if (lowered) return lowered;
      }
      if (ts.isBinaryExpression(node)) {
        const lowered = lowerNullish(node);
        if (lowered) return lowered;
      }
      return ts.visitEachChild(node, visitor, context);
    };

    return node => ts.visitNode(node, visitor) as ts.SourceFile;
  };

  const result = ts.transform(source, [transformer]);
  const transformed = result.transformed[0] as ts.SourceFile;
  result.dispose();
  return { sourceFile: transformed, changed, diagnostics };
}
