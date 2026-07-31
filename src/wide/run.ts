import type ts from "typescript";
import type { BakeDiagnostic } from "../types";
import { exceptPass } from "./except";
import { guardPass } from "./guard";
import { optPass } from "./opt";
import { privatePass } from "./private";
import type { WideResult } from "./types";

const passes = [guardPass, privatePass, optPass, exceptPass] as const;

export function lowerWide(root: string, source: ts.SourceFile): WideResult {
  let sourceFile = source;
  let changed = false;
  const diagnostics: BakeDiagnostic[] = [];
  for (const pass of passes) {
    const result = pass.run(root, sourceFile);
    sourceFile = result.sourceFile;
    changed ||= result.changed;
    diagnostics.push(...result.diagnostics);
  }
  return { sourceFile, changed, diagnostics };
}
