import ts from "typescript";
import type { BakeSuggestion } from "./types";

interface PropertyEvidence {
  readonly name: string;
  readonly types: Set<string>;
  optional: boolean;
  readonly evidence: string[];
}

interface UnknownEvidence {
  readonly primitiveTypes: Set<string>;
  readonly literalTypes: Set<string>;
  readonly properties: Map<string, PropertyEvidence>;
  arrayLike: boolean;
  readonly evidence: string[];
}

function literalType(expression: ts.Expression): string | null {
  if (ts.isStringLiteralLike(expression)) return JSON.stringify(expression.text);
  if (ts.isNumericLiteral(expression)) return expression.text;
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (ts.isBigIntLiteral(expression)) return expression.text;
  return null;
}

function typeFromTypeof(text: string): string | null {
  switch (text) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    case "bigint": return "bigint";
    case "object": return "object";
    case "undefined": return "undefined";
    default: return null;
  }
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function refersToSymbol(expression: ts.Expression, checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  expression = unwrap(expression);
  if (!ts.isIdentifier(expression)) return false;
  const found = checker.getSymbolAtLocation(expression) ?? null;
  return found === symbol;
}

function propertyRoot(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  symbol: ts.Symbol
): { name: string; node: ts.PropertyAccessExpression | ts.ElementAccessExpression } | null {
  expression = unwrap(expression);
  if (ts.isPropertyAccessExpression(expression) && refersToSymbol(expression.expression, checker, symbol)) {
    return { name: expression.name.text, node: expression };
  }
  if (
    ts.isElementAccessExpression(expression) &&
    refersToSymbol(expression.expression, checker, symbol) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return { name: expression.argumentExpression.text, node: expression };
  }
  return null;
}

function ensureProperty(evidence: UnknownEvidence, name: string): PropertyEvidence {
  let property = evidence.properties.get(name) ?? null;
  if (!property) {
    property = { name, types: new Set<string>(), optional: false, evidence: [] };
    evidence.properties.set(name, property);
  }
  return property;
}

function recordTypeofComparison(
  node: ts.BinaryExpression,
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  evidence: UnknownEvidence
): void {
  const pairs: Array<[ts.Expression, ts.Expression]> = [
    [node.left, node.right],
    [node.right, node.left]
  ];
  for (const [candidate, value] of pairs) {
    if (!ts.isTypeOfExpression(candidate) || !ts.isStringLiteralLike(value)) continue;
    const inferred = typeFromTypeof(value.text);
    if (!inferred) continue;
    const operand = unwrap(candidate.expression);
    const isParam = refersToSymbol(operand, checker, symbol);
    if (isParam && inferred !== "object" && inferred !== "undefined") evidence.primitiveTypes.add(inferred);
    if (isParam) {
      evidence.evidence.push(`typeof parameter === ${JSON.stringify(value.text)}`);
      continue;
    }
    const property = propertyRoot(operand, checker, symbol);
    if (property) {
      const record = ensureProperty(evidence, property.name);
      record.types.add(inferred);
      record.evidence.push(`typeof ${property.name} === ${JSON.stringify(value.text)}`);
    }
  }
}

function recordLiteralComparison(
  node: ts.BinaryExpression,
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  evidence: UnknownEvidence
): void {
  // Inspect either operand because a literal may occur on either side of an equality comparison.
  const equalityOperators = new Set([
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken
  ]);
  if (!equalityOperators.has(node.operatorToken.kind)) return;
  const pairs: Array<[ts.Expression, ts.Expression]> = [
    [node.left, node.right],
    [node.right, node.left]
  ];
  for (const [candidate, value] of pairs) {
    const literal = literalType(unwrap(value));
    if (!literal) continue;
    const expression = unwrap(candidate);
    if (refersToSymbol(expression, checker, symbol)) {
      evidence.literalTypes.add(literal);
      evidence.evidence.push(`parameter compared with ${literal}`);
      continue;
    }
    const property = propertyRoot(expression, checker, symbol);
    if (property) {
      const record = ensureProperty(evidence, property.name);
      record.types.add(literal);
      record.evidence.push(`${property.name} compared with ${literal}`);
    }
  }
}

function concreteText(type: ts.Type, node: ts.Node, checker: ts.TypeChecker): string | null {
  const text = checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation);
  return !text.includes("any") && !text.includes("unknown") ? text : null;
}

function parameterType(node: ts.Node, parent: ts.CallExpression, checker: ts.TypeChecker): string | null {
  const index = parent.arguments.indexOf(node as ts.Expression);
  const signature = checker.getResolvedSignature(parent) ?? null;
  const parameter = index >= 0 && signature ? signature.getParameters()[index] ?? null : null;
  if (!parameter) return null;
  const declaration = (parameter.valueDeclaration ?? null) ?? ((parameter.declarations ?? [])[0] ?? null) ?? parent;
  return concreteText(checker.getTypeOfSymbolAtLocation(parameter, declaration), declaration, checker);
}

function typeTextFromUse(node: ts.Node, checker: ts.TypeChecker): string | null {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent)) {
    const other = parent.left === node ? parent.right : parent.left;
    return concreteText(checker.getTypeAtLocation(other), other, checker);
  }
  if (ts.isCallExpression(parent)) return parameterType(node, parent, checker);
  return null;
}

function safeIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function renderSuggestion(
  functionName: string,
  parameterName: string,
  evidence: UnknownEvidence
): BakeSuggestion | null {
  const typeName = `BakeInferred_${safeIdentifier(functionName)}_${safeIdentifier(parameterName)}`;
  const objectProperties = [...evidence.properties.values()];
  const alternatives: string[] = [];

  const primitive = new Set([...evidence.primitiveTypes, ...evidence.literalTypes]);
  for (const type of primitive) alternatives.push(type);

  if (evidence.arrayLike) alternatives.push("unknown[]");

  let declaration = "";
  if (objectProperties.length) {
    const fields = objectProperties
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(property => {
        const types = [...property.types];
        const type = types.length ? types.sort().join(" | ") : "unknown";
        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property.name) ? property.name : JSON.stringify(property.name);
        return `  ${key}${property.optional ? "?" : ""}: ${type};`;
      })
      .join("\n");
    declaration = `interface ${typeName} {\n${fields}\n}`;
    alternatives.push(typeName);
  }

  if (!alternatives.length) return null;
  const replacementType = [...new Set(alternatives)].join(" | ");
  const hasUnresolved = objectProperties.some(property => property.types.size === 0) || evidence.arrayLike;
  const confidence = hasUnresolved ? "low" : objectProperties.length ? "medium" : "high";
  const replacement = [
    declaration,
    declaration ? "" : null,
    `// Consider changing ${parameterName}: unknown to:`,
    `${parameterName}: ${replacementType}`
  ].filter((line): line is string => line !== null).join("\n");

  const allEvidence = [
    ...evidence.evidence,
    ...objectProperties.flatMap(property => property.evidence)
  ];

  return {
    title: `The parameter appears compatible with ${replacementType}`,
    replacement,
    confidence,
    evidence: allEvidence
  };
}

export function inferUnknownParameter(
  parameter: ts.ParameterDeclaration,
  checker: ts.TypeChecker
): BakeSuggestion | null {
  if (!ts.isIdentifier(parameter.name)) return null;
  const symbol = checker.getSymbolAtLocation(parameter.name) ?? null;
  if (!symbol) return null;
  const functionLike = parameter.parent;
  if (!ts.isFunctionLike(functionLike) || !("body" in functionLike)) return null;
  const functionBody = functionLike.body ?? null;
  if (!functionBody) return null;

  const evidence: UnknownEvidence = {
    primitiveTypes: new Set<string>(),
    literalTypes: new Set<string>(),
    properties: new Map<string, PropertyEvidence>(),
    arrayLike: false,
    evidence: []
  };

  const recordProperty = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): void => {
    const property = propertyRoot(node, checker, symbol);
    if (!property) return;
    const record = ensureProperty(evidence, property.name);
    const inferred = typeTextFromUse(node, checker);
    if (inferred) record.types.add(inferred);
    record.evidence.push(`property ${property.name} is accessed`);
  };

  const walk = (node: ts.Node): void => {
    if (node !== functionLike && ts.isFunctionLike(node)) return;

    if (ts.isBinaryExpression(node)) {
      recordTypeofComparison(node, checker, symbol, evidence);
      recordLiteralComparison(node, checker, symbol, evidence);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword && ts.isStringLiteralLike(node.left) && refersToSymbol(node.right, checker, symbol)) {
      const property = ensureProperty(evidence, node.left.text);
      property.optional = false;
      property.evidence.push(`${JSON.stringify(node.left.text)} in parameter`);
    }

    const firstArgument = ts.isCallExpression(node) ? node.arguments[0] ?? null : null;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Array" &&
      node.expression.name.text === "isArray" &&
      firstArgument &&
      refersToSymbol(firstArgument, checker, symbol)
    ) {
      evidence.arrayLike = true;
      evidence.evidence.push("Array.isArray(parameter)");
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) recordProperty(node);

    ts.forEachChild(node, walk);
  };
  walk(functionBody);

  const name = functionLike.name ?? null;
  const declarationName = name && ts.isIdentifier(name)
    ? name.text
    : ts.isVariableDeclaration(functionLike.parent) && ts.isIdentifier(functionLike.parent.name)
      ? functionLike.parent.name.text
      : "anonymous";

  return renderSuggestion(declarationName, parameter.name.text, evidence);
}
