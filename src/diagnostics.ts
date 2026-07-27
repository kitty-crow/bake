import path from "node:path";
import ts from "typescript";
import type { BakeDiagnostic, BakeSeverity, BakeSuggestion } from "./types";

export function diagnosticAt(
  root: string,
  node: ts.Node,
  code: string,
  severity: BakeSeverity,
  message: string,
  hint?: string,
  suggestion?: BakeSuggestion
): BakeDiagnostic {
  const source = node.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    code,
    severity,
    file: path.relative(root, source.fileName).split(path.sep).join("/"),
    line: position.line + 1,
    column: position.character + 1,
    message,
    hint,
    suggestion
  };
}

export function formatDiagnostic(diagnostic: BakeDiagnostic): string {
  const label = diagnostic.severity.toUpperCase();
  let text = `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}: ${label} ${diagnostic.code}: ${diagnostic.message}`;
  if (diagnostic.hint) text += `\n  hint: ${diagnostic.hint}`;
  if (diagnostic.suggestion) {
    text += `\n  suggestion: ${diagnostic.suggestion.title}`;
    if (diagnostic.suggestion.replacement) {
      text += `\n${diagnostic.suggestion.replacement.split("\n").map(line => `    ${line}`).join("\n")}`;
    }
    if (diagnostic.suggestion.confidence) text += `\n  confidence: ${diagnostic.suggestion.confidence}`;
  }
  return text;
}
