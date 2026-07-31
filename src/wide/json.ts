import ts from "typescript";
import type { WidePass, WideResult } from "./types";

const JSON_TYPE = "__BqJson";
const marker = (name: string): string => `__bq_json_${name}`;

function predicate(node: ts.SignatureDeclarationBase): ts.TypePredicateNode | undefined {
  return node.type && ts.isTypePredicateNode(node.type) && node.type.type ? node.type : undefined;
}

function unknownGuard(node: ts.SignatureDeclarationBase): boolean {
  const pred = predicate(node);
  if (!pred || !ts.isIdentifier(pred.parameterName)) return false;
  return node.parameters.some(parameter =>
    ts.isIdentifier(parameter.name) && parameter.name.text === pred.parameterName.getText() &&
    parameter.type?.kind === ts.SyntaxKind.UnknownKeyword
  );
}

function stringValues(type: ts.Type): string[] {
  if (type.isUnion()) return type.types.flatMap(stringValues);
  return type.isStringLiteral() ? [type.value] : [];
}

export const jsonPass: WidePass = {
  name: "hosted JSON guards",
  run(_root, source, checker): WideResult {
    const guards: ts.FunctionDeclaration[] = [];
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name && unknownGuard(statement)) guards.push(statement);
    }
    const dynamicModule = guards.some(statement => {
      const target = predicate(statement)?.type;
      if (!target) return false;
      const type = checker.getTypeFromTypeNode(target);
      const parts = type.isUnion() ? type.types : [type];
      return parts.some(part => !(part.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike)));
    });
    if (!dynamicModule) return { sourceFile: source, changed: false, diagnostics: [] };
    const dynamicFns = new Set(guards.map(statement => statement.name!.text));

    const f = ts.factory;
    const jsonType = (): ts.TypeNode => f.createTypeReferenceNode(JSON_TYPE, undefined);
    const call = (name: string, args: ts.Expression[]): ts.CallExpression =>
      f.createCallExpression(f.createIdentifier(marker(name)), undefined, args);
    const kind = (value: ts.Expression, code: number): ts.Expression =>
      f.createBinaryExpression(call("kind", [value]), ts.SyntaxKind.EqualsEqualsEqualsToken, f.createNumericLiteral(code));
    const negate = (value: ts.Expression): ts.Expression => f.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, value);
    const or = (items: readonly ts.Expression[]): ts.Expression =>
      items.slice(1).reduce((left, right) => f.createBinaryExpression(left, ts.SyntaxKind.BarBarToken, right), items[0] ?? f.createFalse());

    const setValues = new Map<string, string[]>();
    const findSets = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isNewExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "Set") {
        const first = node.initializer.arguments?.[0];
        if (first && ts.isArrayLiteralExpression(first)) {
          const values = first.elements.filter(ts.isStringLiteralLike).map(item => item.text);
          if (values.length === first.elements.length) setValues.set(node.name.text, values);
        }
      }
      ts.forEachChild(node, findSets);
    };
    findSets(source);

    const scopes: Array<Set<string>> = [new Set()];
    const isDynamicName = (name: string): boolean => {
      for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i]!.has(name)) return true;
      return false;
    };
    const isDynamic = (node: ts.Expression): boolean => {
      if (ts.isIdentifier(node)) return isDynamicName(node.text);
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) return isDynamic(node.expression);
      if (ts.isPropertyAccessExpression(node)) {
        if (node.name.text === "length" || node.name.text === "size") return false;
        return isDynamic(node.expression);
      }
      if (ts.isElementAccessExpression(node)) return isDynamic(node.expression);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        return name.startsWith(marker("")) && ["get", "at"].some(part => name.endsWith(part));
      }
      return false;
    };

    let context: ts.TransformationContext;
    let visit: ts.Visitor;

    const literalMembership = (value: ts.Expression, values: readonly string[]): ts.Expression =>
      or(values.map(item => call("eq_str", [value, f.createStringLiteral(item)])));

    const nativePredicate = (node: ts.CallExpression, value: ts.Expression): ts.Expression | undefined => {
      const signature = checker.getResolvedSignature(node);
      const declaration = signature?.declaration;
      const pred = declaration && ts.isFunctionLike(declaration) ? predicate(declaration) : undefined;
      if (!pred?.type) return undefined;
      const values = stringValues(checker.getTypeFromTypeNode(pred.type));
      return values.length ? literalMembership(value, values) : undefined;
    };

    const callbackBody = (node: ts.Expression, parameter: ts.Identifier, item: ts.Identifier): ts.Expression => {
      scopes.push(new Set([parameter.text]));
      const body = expression(node);
      scopes.pop();
      const replace: ts.TransformerFactory<ts.Expression> = transformContext => {
        const swap: ts.Visitor = part => ts.isIdentifier(part) && part.text === parameter.text ? item : ts.visitEachChild(part, swap, transformContext);
        return root => ts.visitNode(root, swap) as ts.Expression;
      };
      const result = ts.transform(body, [replace]);
      const out = result.transformed[0] as ts.Expression;
      result.dispose();
      return out;
    };

    const every = (base: ts.Expression, callback: ts.Expression): ts.Expression => {
      const arr = f.createIdentifier("__bq_json_arr");
      const index = f.createIdentifier("__bq_json_i");
      const item = f.createIdentifier("__bq_json_item");
      let test: ts.Expression;
      if (ts.isIdentifier(callback)) test = f.createCallExpression(callback, undefined, [item]);
      else if ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters[0] && ts.isIdentifier(callback.parameters[0].name) && !ts.isBlock(callback.body)) {
        test = callbackBody(callback.body, callback.parameters[0].name, item);
      } else return f.createFalse();
      const fn = f.createArrowFunction(undefined, undefined, [
        f.createParameterDeclaration(undefined, undefined, arr, undefined, jsonType(), undefined),
      ], f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword), f.createToken(ts.SyntaxKind.EqualsGreaterThanToken), f.createBlock([
        f.createForStatement(
          f.createVariableDeclarationList([f.createVariableDeclaration(index, undefined, f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword), f.createNumericLiteral(0))], ts.NodeFlags.Let),
          f.createBinaryExpression(index, ts.SyntaxKind.LessThanToken, call("len", [arr])),
          f.createPostfixIncrement(index),
          f.createBlock([
            f.createVariableStatement(undefined, f.createVariableDeclarationList([
              f.createVariableDeclaration(item, undefined, jsonType(), call("at", [arr, index])),
            ], ts.NodeFlags.Const)),
            f.createIfStatement(negate(test), f.createReturnStatement(f.createFalse())),
          ], true),
        ),
        f.createReturnStatement(f.createTrue()),
      ], true));
      return f.createCallExpression(f.createParenthesizedExpression(fn), undefined, [expression(base)]);
    };

    const uniqueSize = (node: ts.PropertyAccessExpression): ts.Expression | undefined => {
      if (node.name.text !== "size" || !ts.isNewExpression(node.expression) || !ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "Set") return undefined;
      const arg = node.expression.arguments?.[0];
      if (!arg || !ts.isCallExpression(arg) || !ts.isPropertyAccessExpression(arg.expression) || arg.expression.name.text !== "map" || !isDynamic(arg.expression.expression)) return undefined;
      const cb = arg.arguments[0];
      if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb)) || !cb.parameters[0] || !ts.isIdentifier(cb.parameters[0].name) || ts.isBlock(cb.body)) return undefined;
      const body = cb.body;
      if (!ts.isPropertyAccessExpression(body) || !ts.isIdentifier(body.expression) || body.expression.text !== cb.parameters[0].name.text) return undefined;
      return call("unique_prop", [expression(arg.expression.expression), f.createStringLiteral(body.name.text)]);
    };

    const expression = (node: ts.Expression): ts.Expression => {
      if (ts.isParenthesizedExpression(node)) return f.updateParenthesizedExpression(node, expression(node.expression));
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) return expression(node.expression);
      if (ts.isBinaryExpression(node)) {
        const leftTypeof = ts.isTypeOfExpression(node.left) && isDynamic(node.left.expression);
        const rightTypeof = ts.isTypeOfExpression(node.right) && isDynamic(node.right.expression);
        const literal = leftTypeof && ts.isStringLiteralLike(node.right) ? node.right.text : rightTypeof && ts.isStringLiteralLike(node.left) ? node.left.text : undefined;
        const value = leftTypeof ? expression(node.left.expression) : rightTypeof ? expression(node.right.expression) : undefined;
        if (literal && value) {
          const codes: Record<string, number> = { undefined: 0, boolean: 2, number: 3, string: 4, object: 6 };
          const check = literal === "object"
            ? or([kind(value, 5), kind(value, 6)])
            : kind(value, codes[literal] ?? -1);
          return node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ? negate(check) : check;
        }
        const leftDyn = isDynamic(node.left), rightDyn = isDynamic(node.right);
        const dynamic = leftDyn ? node.left : rightDyn ? node.right : undefined;
        const other = leftDyn ? node.right : rightDyn ? node.left : undefined;
        if (dynamic && other && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) {
          let check: ts.Expression | undefined;
          if (other.kind === ts.SyntaxKind.NullKeyword) check = kind(expression(dynamic), 1);
          else if (ts.isIdentifier(other) && other.text === "undefined") check = kind(expression(dynamic), 0);
          else if (ts.isStringLiteralLike(other)) check = call("eq_str", [expression(dynamic), other]);
          else if (ts.isNumericLiteral(other)) check = call("eq_num", [expression(dynamic), other]);
          if (check) return node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ? negate(check) : check;
        }
        return f.updateBinaryExpression(node, expression(node.left), node.operatorToken, expression(node.right));
      }
      if (ts.isPrefixUnaryExpression(node)) return f.updatePrefixUnaryExpression(node, expression(node.operand));
      if (ts.isPropertyAccessExpression(node)) {
        const unique = uniqueSize(node);
        if (unique) return unique;
        if (node.name.text === "length" && ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "trim" && isDynamic(node.expression.expression.expression)) {
          return call("trim_len", [expression(node.expression.expression.expression)]);
        }
        if (isDynamic(node.expression)) {
          if (node.name.text === "length") return call("len", [expression(node.expression)]);
          return call("get", [expression(node.expression), f.createStringLiteral(node.name.text)]);
        }
        return f.updatePropertyAccessExpression(node, expression(node.expression), node.name);
      }
      if (ts.isElementAccessExpression(node)) {
        if (isDynamic(node.expression)) return call("at", [expression(node.expression), expression(node.argumentExpression)]);
        return f.updateElementAccessExpression(node, expression(node.expression), expression(node.argumentExpression));
      }
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression)) {
          const receiver = node.expression.expression;
          const method = node.expression.name.text;
          if (ts.isIdentifier(receiver) && receiver.text === "Array" && method === "isArray" && node.arguments[0] && isDynamic(node.arguments[0])) return kind(expression(node.arguments[0]), 5);
          if (ts.isIdentifier(receiver) && receiver.text === "Number" && method === "isInteger" && node.arguments[0] && isDynamic(node.arguments[0])) return call("is_int", [expression(node.arguments[0])]);
          if (ts.isRegularExpressionLiteral(receiver) && method === "test" && node.arguments[0] && isDynamic(node.arguments[0])) return call("regex", [expression(node.arguments[0]), f.createNumericLiteral(1)]);
          if (method === "every" && isDynamic(receiver) && node.arguments[0]) return every(receiver, node.arguments[0]);
          if (method === "includes" && ts.isArrayLiteralExpression(receiver) && node.arguments[0]) {
            const raw = ts.isCallExpression(node.arguments[0]) && ts.isIdentifier(node.arguments[0].expression) && node.arguments[0].expression.text === "String" && node.arguments[0].arguments[0]
              ? node.arguments[0].arguments[0]
              : node.arguments[0];
            if (isDynamic(raw)) {
              const values = receiver.elements.filter(ts.isStringLiteralLike).map(item => item.text);
              if (values.length === receiver.elements.length) return literalMembership(expression(raw), values);
            }
          }
          if (method === "has" && ts.isIdentifier(receiver) && node.arguments[0] && isDynamic(node.arguments[0])) {
            const values = setValues.get(receiver.text);
            if (values) return literalMembership(expression(node.arguments[0]), values);
          }
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === "String" && node.arguments[0] && isDynamic(node.arguments[0])) return call("string_tag", [expression(node.arguments[0])]);
        if (ts.isIdentifier(node.expression) && !dynamicFns.has(node.expression.text) && node.arguments[0] && isDynamic(node.arguments[0])) {
          const lowered = nativePredicate(node, expression(node.arguments[0]));
          if (lowered) return lowered;
        }
        return f.updateCallExpression(node, expression(node.expression), node.typeArguments, node.arguments.map(expression));
      }
      if (ts.isConditionalExpression(node)) return f.updateConditionalExpression(node, expression(node.condition), node.questionToken, expression(node.whenTrue), node.colonToken, expression(node.whenFalse));
      if (ts.isArrayLiteralExpression(node)) return f.updateArrayLiteralExpression(node, node.elements.map(item => ts.isSpreadElement(item) ? f.updateSpreadElement(item, expression(item.expression)) : expression(item as ts.Expression)));
      if (ts.isObjectLiteralExpression(node)) return ts.visitEachChild(node, visit, context) as ts.ObjectLiteralExpression;
      return ts.visitEachChild(node, visit, context) as ts.Expression;
    };

    const statement = (node: ts.Statement): ts.Statement | readonly ts.Statement[] => {
      if (ts.isVariableStatement(node)) {
        const declarations = node.declarationList.declarations.map(declaration => {
          const dynamic = declaration.initializer ? isDynamic(declaration.initializer) : false;
          if (dynamic && ts.isIdentifier(declaration.name)) scopes[scopes.length - 1]!.add(declaration.name.text);
          return f.updateVariableDeclaration(declaration, declaration.name, declaration.exclamationToken, dynamic ? jsonType() : declaration.type, declaration.initializer ? expression(declaration.initializer) : undefined);
        });
        return f.updateVariableStatement(node, node.modifiers, f.updateVariableDeclarationList(node.declarationList, declarations));
      }
      if (ts.isReturnStatement(node)) return f.updateReturnStatement(node, node.expression ? expression(node.expression) : undefined);
      if (ts.isExpressionStatement(node)) return f.updateExpressionStatement(node, expression(node.expression));
      if (ts.isIfStatement(node)) return f.updateIfStatement(node, expression(node.expression), visit(node.thenStatement) as ts.Statement, node.elseStatement ? visit(node.elseStatement) as ts.Statement : undefined);
      if (ts.isBlock(node)) return f.updateBlock(node, node.statements.flatMap(item => statement(item)));
      if (ts.isSwitchStatement(node)) return f.updateSwitchStatement(node, expression(node.expression), ts.visitEachChild(node.caseBlock, visit, context));
      return ts.visitEachChild(node, visit, context) as ts.Statement;
    };

    const transformFunction = <T extends ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration>(node: T): T => {
      if (!unknownGuard(node)) return ts.visitEachChild(node, visit, context) as T;
      const pred = predicate(node)!;
      const parameterName = pred.parameterName.getText();
      scopes.push(new Set([parameterName]));
      const parameters = node.parameters.map(parameter =>
        ts.isIdentifier(parameter.name) && parameter.name.text === parameterName
          ? f.updateParameterDeclaration(parameter, parameter.modifiers, parameter.dotDotDotToken, parameter.name, parameter.questionToken, jsonType(), parameter.initializer)
          : parameter
      );
      let body = node.body ? (ts.isBlock(node.body) ? statement(node.body) as ts.Block : expression(node.body)) : node.body;
      if (body && ts.isBlock(body)) {
        const last = body.statements.at(-1);
        if (!last || !ts.isReturnStatement(last) && !ts.isThrowStatement(last)) {
          body = f.updateBlock(body, [...body.statements, f.createReturnStatement(f.createFalse())]);
        }
      }
      scopes.pop();
      const bool = f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
      if (ts.isFunctionDeclaration(node)) return f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, parameters, bool, body as ts.Block) as T;
      if (ts.isFunctionExpression(node)) return f.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, parameters, bool, body as ts.Block) as T;
      if (ts.isArrowFunction(node)) return f.updateArrowFunction(node, node.modifiers, node.typeParameters, parameters, bool, node.equalsGreaterThanToken, body as ts.ConciseBody) as T;
      return f.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.questionToken, node.typeParameters, parameters, bool, body as ts.Block) as T;
    };

    const transformer: ts.TransformerFactory<ts.SourceFile> = transformContext => {
      context = transformContext;
      visit = node => {
        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) return transformFunction(node);
        if (ts.isStatement(node)) return statement(node);
        if (ts.isExpression(node)) return expression(node);
        return ts.visitEachChild(node, visit, context);
      };
      return file => {
        const changed = ts.visitNode(file, visit) as ts.SourceFile;
        const prelude = ts.createSourceFile("bq-json.d.ts", `
type ${JSON_TYPE} = number;
declare function ${marker("kind")}(value: ${JSON_TYPE}): number;
declare function ${marker("get")}(value: ${JSON_TYPE}, key: string): ${JSON_TYPE};
declare function ${marker("len")}(value: ${JSON_TYPE}): number;
declare function ${marker("at")}(value: ${JSON_TYPE}, index: number): ${JSON_TYPE};
declare function ${marker("is_int")}(value: ${JSON_TYPE}): boolean;
declare function ${marker("eq_str")}(value: ${JSON_TYPE}, expected: string): boolean;
declare function ${marker("eq_num")}(value: ${JSON_TYPE}, expected: number): boolean;
declare function ${marker("trim_len")}(value: ${JSON_TYPE}): number;
declare function ${marker("regex")}(value: ${JSON_TYPE}, pattern: number): boolean;
declare function ${marker("unique_prop")}(value: ${JSON_TYPE}, key: string): number;
declare function ${marker("string_tag")}(value: ${JSON_TYPE}): string;
`, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
        return f.updateSourceFile(changed, [...prelude.statements, ...changed.statements]);
      };
    };
    const result = ts.transform(source, [transformer]);
    const sourceFile = result.transformed[0] as ts.SourceFile;
    result.dispose();
    return { sourceFile, changed: true, diagnostics: [] };
  }
};
