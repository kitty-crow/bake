import ts from "typescript";
import type { WidePass, WideResult } from "./types";
import { mods } from "./util";

export const privatePass: WidePass = {
  name: "private",
  run(_root, source): WideResult {
    let changed = false;
    let classId = 0;
    const names = new Map<string, string>();
    const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
      const factory = context.factory;
      const raw = (name: ts.PrivateIdentifier): string => name.text.replace(/^#/, "");
      const findName = (name: ts.PrivateIdentifier): string => {
        let current: ts.Node | undefined = name;
        while (current && !ts.isClassLike(current)) current = current.parent;
        if (current && ts.isClassLike(current)) {
          for (const member of current.members) {
            if (!member.name || !ts.isPrivateIdentifier(member.name) || raw(member.name) !== raw(name)) continue;
            const found = names.get(`${raw(member.name)}:${member.pos}`);
            if (found) return found;
          }
        }
        return `__bake_p_${raw(name)}`;
      };
      const visit: ts.Visitor = node => {
        if (ts.isClassLike(node)) {
          const id = classId++;
          for (const member of node.members) {
            if (member.name && ts.isPrivateIdentifier(member.name)) {
              names.set(`${raw(member.name)}:${member.pos}`, `__bake_p_${id}_${raw(member.name)}`);
            }
          }
        }
        if (ts.isPropertyDeclaration(node) && ts.isPrivateIdentifier(node.name)) {
          changed = true;
          return factory.updatePropertyDeclaration(
            node,
            mods(factory, node.modifiers, ts.SyntaxKind.PrivateKeyword),
            factory.createIdentifier(findName(node.name)),
            node.questionToken ?? node.exclamationToken,
            node.type,
            node.initializer && ts.visitNode(node.initializer, visit) as ts.Expression
          );
        }
        if (ts.isMethodDeclaration(node) && ts.isPrivateIdentifier(node.name)) {
          changed = true;
          return factory.updateMethodDeclaration(
            node,
            mods(factory, node.modifiers, ts.SyntaxKind.PrivateKeyword),
            node.asteriskToken,
            factory.createIdentifier(findName(node.name)),
            node.questionToken,
            node.typeParameters,
            node.parameters,
            node.type,
            node.body && ts.visitNode(node.body, visit) as ts.Block
          );
        }
        if (ts.isPropertyAccessExpression(node) && ts.isPrivateIdentifier(node.name)) {
          changed = true;
          return factory.updatePropertyAccessExpression(
            node,
            ts.visitNode(node.expression, visit) as ts.Expression,
            factory.createIdentifier(findName(node.name))
          );
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
