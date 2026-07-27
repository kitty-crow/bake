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

function literalType(expression: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(expression)) return JSON.stringify(expression.text);
  if (ts.isNumericLiteral(expression)) return expression.text;
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (ts.isBigIntLiteral(expression)) return expression.text;
  return undefined;
}

function typeFromTypeof(text: string): string | undefined {
  switch (text) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    case "bigint": return "bigint";
    case "object": return "object";
    case "undefined": return "undefined";
    default: return undefined;
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
  const found = checker.getSymbolAtLocation(expression);
  return found === symbol;
}

function propertyRoot(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  symbol: ts.Symbol
): { name: string; node: ts.PropertyAccessExpression | ts.ElementAccessExpression } | undefined {
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
  return undefined;
}

function ensureProperty(evidence: UnknownEvidence, name: string): PropertyEvidence {
  let property = evidence.properties.get(name);
  if (!property) {
    property = { name, types: new Set(), optional: false, evidence: [] };
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
    if (refersToSymbol(operand, checker, symbol)) {
      if (inferred !== "object" && inferred !== "undefined") evidence.primitiveTypes.add(inferred);
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

function typeTextFromUse(node: ts.Node, checker: ts.TypeChecker): string | undefined {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent)) {
    const other = parent.left === node ? parent.right : parent.left;
    const type = checker.getTypeAtLocation(other);
    const text = checker.typeToString(type, other, ts.TypeFormatFlags.NoTruncation);
    if (!text.includes("any") && !text.includes("unknown")) return text;
  }
  if (ts.isCallExpression(parent)) {
    const index = parent.arguments.indexOf(node as ts.Expression);
    const signature = checker.getResolvedSignature(parent);
    const parameter = index >= 0 ? signature?.getParameters()[index] : undefined;
    if (parameter) {
      const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? parent;
      const type = checker.getTypeOfSymbolAtLocation(parameter, declaration);
      const text = checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation);
      if (!text.includes("any") && !text.includes("unknown")) return text;
    }
  }
  return undefined;
}

function safeIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function renderSuggestion(
  functionName: string,
  parameterName: string,
  evidence: UnknownEvidence
): BakeSuggestion | undefined {
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

  if (!alternatives.length) return undefined;
  const replacementType = [...new Set(alternatives)].join(" | ");
  const hasUnresolved = objectProperties.some(property => property.types.size === 0) || evidence.arrayLike;
  const confidence = hasUnresolved ? "low" : objectProperties.length ? "medium" : "high";
  const replacement = [
    declaration,
    declaration ? "" : undefined,
    `// Consider changing ${parameterName}: unknown to:`,
    `${parameterName}: ${replacementType}`
  ].filter((line): line is string => line !== undefined).join("\n");

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
): BakeSuggestion | undefined {
  if (!ts.isIdentifier(parameter.name)) return undefined;
  const symbol = checker.getSymbolAtLocation(parameter.name);
  if (!symbol) return undefined;
  const functionLike = parameter.parent;
  if (!ts.isFunctionLike(functionLike) || !("body" in functionLike) || !functionLike.body) return undefined;
  const functionBody = functionLike.body;

  const evidence: UnknownEvidence = {
    primitiveTypes: new Set(),
    literalTypes: new Set(),
    properties: new Map(),
    arrayLike: false,
    evidence: []
  };

  const walk = (node: ts.Node): void => {
    if (node !== functionLike && ts.isFunctionLike(node)) return;

    if (ts.isBinaryExpression(node)) {
      recordTypeofComparison(node, checker, symbol, evidence);
      recordLiteralComparison(node, checker, symbol, evidence);
      if (node.operatorToken.kind === ts.SyntaxKind.InKeyword && ts.isStringLiteralLike(node.left) && refersToSymbol(node.right, checker, symbol)) {
        const property = ensureProperty(evidence, node.left.text);
        property.optional = false;
        property.evidence.push(`${JSON.stringify(node.left.text)} in parameter`);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Array" &&
      node.expression.name.text === "isArray" &&
      node.arguments[0] &&
      refersToSymbol(node.arguments[0], checker, symbol)
    ) {
      evidence.arrayLike = true;
      evidence.evidence.push("Array.isArray(parameter)");
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const property = propertyRoot(node, checker, symbol);
      if (property) {
        const record = ensureProperty(evidence, property.name);
        const inferred = typeTextFromUse(node, checker);
        if (inferred) record.types.add(inferred);
        record.evidence.push(`property ${property.name} is accessed`);
      }
    }

    ts.forEachChild(node, walk);
  };
  walk(functionBody);

  const declarationName = functionLike.name && ts.isIdentifier(functionLike.name)
    ? functionLike.name.text
    : ts.isVariableDeclaration(functionLike.parent) && ts.isIdentifier(functionLike.parent.name)
      ? functionLike.parent.name.text
      : "anonymous";

  return renderSuggestion(declarationName, parameter.name.text, evidence);
}
