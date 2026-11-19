import ts from "typescript";
import { initialisedVariable } from "./ast";
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
import { bakeDiagnosticCode, isNativeTarget } from "./target";
import type { BakeDiagnostic, BakeFileResult } from "./types";
import { required } from "./checked";
import type { BakeTarget } from "./target";

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

function nativeRepeatable(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) ||
      ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression))
    return nativeRepeatable(expression.expression);
  // Only duplicate expressions without observable reads or side effects.
  return ts.isIdentifier(expression) || ts.isLiteralExpression(expression) ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword;
}

function isArrayLikeExpression(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const type = checker.getTypeAtLocation(expression);
  return checker.isArrayType(type) || checker.isTupleType(type);
}

export function lowerSourceFile(
  root: string,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  core: BakeCoreEngine,
  target: BakeTarget = "wasm"
): BakeFileResult {
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

    const lowerNullish = (node: ts.BinaryExpression): ts.Expression | null => {
      if (node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) return null;

      const operands: ts.Expression[] = [];
      collectNullishOperands(node, operands);
      if (operands.length < 2) return null;

      let flags = 0;
      let firstNonNullable = -1;
      for (let index = 0; index < operands.length - 1; index++) {
        const operand = required(operands[index] ?? null);
        if (!isPureExpression(operand) || (isNativeTarget(target) && !nativeRepeatable(operand))) flags |= BAKE_FLAG_IMPURE;

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
          isNativeTarget(target) ? "error" : "warning",
          impure
            ? "Bake left this nullish-coalescing expression unchanged because an operand may have side effects."
            : "Bake did not lower this undefined-sensitive nullish expression.",
          impure
            ? "Assign each side-effecting operand to a typed local first. Bake can then lower the chain without evaluating it twice."
            : "Replace undefined with an explicit nullable or tagged native representation before Baguette compilation."
        ));
        return node;
      }
      if (action !== BAKE_ACTION_LOWER) return null;

      const effectiveLength = bakeDecisionPayload(decision);
      const effectiveOperands = operands.slice(0, effectiveLength);
      const visitedOperands = effectiveOperands.map(operand => ts.visitNode(operand, visitor, ts.isExpression));
      let lowered: ts.Expression = required(visitedOperands[visitedOperands.length - 1] ?? null);
      for (let index = visitedOperands.length - 2; index >= 0; index--) {
        const operand = required(visitedOperands[index] ?? null);
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

    const lowerForOf = (node: ts.ForOfStatement): ts.Statement | null => {
      let flags = 0;
      if (node.awaitModifier ?? null) flags |= BAKE_FLAG_AWAIT;
      if (!isArrayLikeExpression(node.expression, checker)) flags |= BAKE_FLAG_NOT_ARRAY_LIKE;
      if (!ts.isVariableDeclarationList(node.initializer) || node.initializer.declarations.length !== 1 ||
          !ts.isIdentifier(required(node.initializer.declarations[0] ?? null).name)) flags |= BAKE_FLAG_UNSUPPORTED_INITIALIZER;

      const decision = core.decide(BAKE_FACT_FOR_OF, flags, 0, 0);
      const canLower = bakeDecisionAction(decision) === BAKE_ACTION_LOWER;
      if (!canLower && isNativeTarget(target)) diagnostics.push(diagnosticAt(root, node, "BK4101", "error", "This for-of loop cannot be lowered to a static indexed loop.", "Use a synchronous for-of over a typed array or tuple with a single identifier binding."));
      if (!canLower) return null;

      const declarationList = node.initializer as ts.VariableDeclarationList;
      const declaration = required(declarationList.declarations[0] ?? null);
      const declarationName = declaration.name as ts.Identifier;
      changed = true;
      const id = serial++;
      const arrayName = factory.createUniqueName(`__bake_array_${id}`);
      const indexName = factory.createUniqueName(`__bake_index_${id}`);
      const arrayDeclaration = factory.createVariableStatement(
        [],
        factory.createVariableDeclarationList([
          initialisedVariable(arrayName, ts.visitNode(node.expression, visitor, ts.isExpression))
        ], ts.NodeFlags.Const)
      );
      const initializer = factory.createVariableDeclarationList([
        initialisedVariable(indexName, factory.createNumericLiteral(0))
      ], ts.NodeFlags.Let);
      const condition = factory.createBinaryExpression(indexName, factory.createToken(ts.SyntaxKind.LessThanToken), factory.createPropertyAccessExpression(arrayName, "length"));
      const incrementor = factory.createPostfixUnaryExpression(indexName, ts.SyntaxKind.PlusPlusToken);
      const itemDeclaration = factory.createVariableStatement(
        [],
        factory.createVariableDeclarationList([
          initialisedVariable(declarationName, factory.createElementAccessExpression(arrayName, indexName), declaration.type ?? null)
        ], declarationList.flags)
      );
      const originalBody = ts.visitNode(node.statement, visitor, ts.isStatement);
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
        if ((element.dotDotDotToken ?? null) || (element.initializer ?? null) || bindingNeedsManualLowering(element.name)) return true;
      }
      return false;
    };

    const lowerVariableStatement = (node: ts.VariableStatement): ts.Statement[] | null => {
      const declarations = node.declarationList.declarations;
      if (!declarations.some(declaration => !ts.isIdentifier(declaration.name))) return null;

      const unsupported = declarations.find(declaration => !ts.isIdentifier(declaration.name) && bindingNeedsManualLowering(declaration.name)) ?? null;
      const missingInitialiser = declarations.find(declaration => !ts.isIdentifier(declaration.name) && !(declaration.initializer ?? null)) ?? null;
      if (missingInitialiser && isNativeTarget(target)) diagnostics.push(diagnosticAt(root, missingInitialiser, "BK4102", "error", "Destructuring without an initialiser has no freestanding native lowering.", "Give the binding a statically typed initialiser."));
      const flags = unsupported ? BAKE_FLAG_UNSUPPORTED_BINDING : 0;
      const decision = core.decide(BAKE_FACT_DESTRUCTURE, flags, 0, 0);
      const action = bakeDecisionAction(decision);
      if (action === BAKE_ACTION_WARNING && unsupported) {
        diagnostics.push(diagnosticAt(
          root,
          unsupported,
          bakeDiagnosticCode(bakeDecisionDiagnostic(decision)),
          isNativeTarget(target) ? "error" : "warning",
          "Bake left destructuring with defaults, rest elements or nested unsupported bindings unchanged.",
          "Rewrite it as explicit indexed or property assignments so each native value has a deterministic source."
        ));
        return null;
      }
      if (action !== BAKE_ACTION_LOWER) return null;

      const output: ts.Statement[] = [];
      for (const declaration of declarations) {
        const initial = declaration.initializer ?? null;
        if (ts.isIdentifier(declaration.name) || !initial) {
          output.push(factory.createVariableStatement(node.modifiers ?? [], factory.createVariableDeclarationList([
            ts.visitEachChild(declaration, visitor, context) as ts.VariableDeclaration
          ], node.declarationList.flags)));
          continue;
        }

        const tempName = factory.createUniqueName(`__bake_destructure_${serial++}`);
        output.push(factory.createVariableStatement([], factory.createVariableDeclarationList([
          initialisedVariable(tempName, ts.visitNode(initial, visitor, ts.isExpression))
        ], ts.NodeFlags.Const)));

        const emitBinding = (name: ts.BindingName, access: ts.Expression): void => {
          if (ts.isIdentifier(name)) {
            output.push(factory.createVariableStatement(node.modifiers ?? [], factory.createVariableDeclarationList([
              initialisedVariable(name, access)
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

    const visitor: ts.Visitor<ts.Node, ts.Node> = node => {
      const lowered = ts.isForOfStatement(node) ? lowerForOf(node)
        : ts.isVariableStatement(node) ? lowerVariableStatement(node)
        : ts.isBinaryExpression(node) ? lowerNullish(node) : null;
      return lowered ?? ts.visitEachChild(node, visitor, context);
    };

    return node => ts.visitNode(node, visitor, ts.isSourceFile);
  };

  const result = ts.transform(source, [transformer]);
  const transformed = required(result.transformed[0] ?? null);
  result.dispose();
  return { sourceFile: transformed, changed, diagnostics };
}
