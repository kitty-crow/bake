import ts from "typescript";
import { required } from "./checked";

type AstReplacement = ts.Node | readonly ts.Node[];

function templateStatement(text: string): ts.Statement {
  const source = ts.createSourceFile("bake-template.ts", text, ts.ScriptTarget.ES2022, false);
  return required(source.statements[0] ?? null);
}

function substitute<T extends ts.Node>(template: T, replacements: ReadonlyMap<ts.Node, AstReplacement>): T {
  // The TypeScript visitor preserves grammar-level absence of tokens and nodes.
  // Insert original children without printing/reparsing them or losing their symbol identity.
  const transform: ts.TransformerFactory<T> = context => root =>
    ts.visitEachChild(root, child => replacements.get(child) ?? child, context);
  const result = ts.transform(template, [transform]);
  try {
    return ts.setTextRange(required(result.transformed[0] ?? null), { pos: -1, end: -1 });
  } finally {
    result.dispose();
  }
}

/** Construct an initialised declaration, with a type annotation only when one exists. */
export function initialisedVariable(name: ts.BindingName, value: ts.Expression, annotation: ts.TypeNode | null = null): ts.VariableDeclaration {
  const statement = templateStatement(annotation ? "let slot: SlotType = slotValue;" : "let slot = slotValue;");
  if (!ts.isVariableStatement(statement)) throw new Error("Invalid variable template");
  const template = required(statement.declarationList.declarations[0] ?? null);
  const replacements = new Map<ts.Node, AstReplacement>([
    [template.name, name],
    [required(template.initializer ?? null), value]
  ]);
  if (annotation) replacements.set(required(template.type ?? null), annotation);
  return substitute(template, replacements);
}

export interface NamedFunctionParts {
  readonly name: ts.Identifier;
  readonly modifiers: readonly ts.ModifierLike[];
  readonly typeParameters: readonly ts.TypeParameterDeclaration[];
  readonly parameters: readonly ts.ParameterDeclaration[];
  readonly returns: ts.TypeNode | null;
  readonly body: ts.Block;
}

/** Construct a non-generator function while retaining the supplied AST children. */
export function namedFunction(parts: NamedFunctionParts): ts.FunctionDeclaration {
  const statement = templateStatement(
    (parts.modifiers.length ? "export " : "") + "function slot" +
    (parts.typeParameters.length ? "<SlotType>" : "") + "(slotArg: SlotType)" +
    (parts.returns ? ": SlotType" : "") + " {}"
  );
  if (!ts.isFunctionDeclaration(statement)) throw new Error("Invalid function template");
  const replacements = new Map<ts.Node, AstReplacement>([
    [required(statement.name ?? null), parts.name],
    [required(statement.parameters[0] ?? null), parts.parameters],
    [required(statement.body ?? null), parts.body]
  ]);
  if (parts.modifiers.length) replacements.set(required((statement.modifiers ?? [])[0] ?? null), parts.modifiers);
  if (parts.typeParameters.length) replacements.set(required((statement.typeParameters ?? [])[0] ?? null), parts.typeParameters);
  if (parts.returns) replacements.set(required(statement.type ?? null), parts.returns);
  return substitute(statement, replacements);
}
