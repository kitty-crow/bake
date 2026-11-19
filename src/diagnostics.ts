import path from "node:path";
import ts from "typescript";
import type { BakeDiagnostic, BakeSeverity, BakeSuggestion } from "./types";

export function diagnosticAt(
  root: string,
  node: ts.Node,
  code: string,
  severity: BakeSeverity,
  message: string,
  ...details: [] | [hint: string | null] | [hint: string | null, suggestion: BakeSuggestion | null]
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
    hint: details[0] ?? null,
    suggestion: details[1] ?? null
  };
}

export function formatDiagnostic(diagnostic: BakeDiagnostic): string {
  const label = diagnostic.severity.toUpperCase();
  let text = `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}: ${label} ${diagnostic.code}: ${diagnostic.message}`;
  if (diagnostic.hint) text += `\n  hint: ${diagnostic.hint}`;
  const suggestion = diagnostic.suggestion;
  if (suggestion) text += formatSuggestion(suggestion);
  return text;
}

function formatSuggestion(suggestion: BakeSuggestion): string {
  let text = `\n  suggestion: ${suggestion.title}`;
  if (suggestion.replacement) text += `\n${suggestion.replacement.split("\n").map(line => `    ${line}`).join("\n")}`;
  if (suggestion.confidence) text += `\n  confidence: ${suggestion.confidence}`;
  return text;
}
