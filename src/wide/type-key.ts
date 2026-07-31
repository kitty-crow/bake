import ts from "typescript";
import type { BakeDiagnostic } from "../types";
import type { WidePass, WideResult } from "./types";
import { warn } from "./util";

export const typeKeyPass: WidePass = {
  name: "type-key",
  run(root, source, checker): WideResult {
    let changed = false;
    const diagnostics: BakeDiagnostic[] = [];
    const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
      const factory = context.factory;
      const visit: ts.Visitor = node => {
        if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) {
          const original = ts.getOriginalNode(node) as ts.TypeOperatorNode;
          const type = checker.getTypeFromTypeNode(original.type);
          const names = checker.getPropertiesOfType(type).map(item => item.getName()).filter(name => name !== "__proto__");
          if (names.length) {
            changed = true;
            return names.length === 1
              ? factory.createLiteralTypeNode(factory.createStringLiteral(names[0]!))
              : factory.createUnionTypeNode(names.map(name => factory.createLiteralTypeNode(factory.createStringLiteral(name))));
          }
          diagnostics.push(warn(root, node, "BK3301", "Wide lowering could not materialise this keyof type.", "Use an explicit string-literal union for the native boundary."));
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
