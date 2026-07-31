import type ts from "typescript";
import type { BakeDiagnostic } from "../types";
import { exceptPass } from "./except";
import { guardPass } from "./guard";
import { implicitPass } from "./implicit";
import { jsonPass } from "./json";
import { nullishPass } from "./nullish";
import { optPass } from "./opt";
import { privatePass } from "./private";
import { trapPass } from "./trap";
import { typeKeyPass } from "./type-key";
import type { WideResult } from "./types";

const passes = [jsonPass, implicitPass, typeKeyPass, guardPass, privatePass, optPass, nullishPass, exceptPass, trapPass] as const;

export function lowerWide(root: string, source: ts.SourceFile, checker: ts.TypeChecker): WideResult {
  let sourceFile = source;
  let changed = false;
  const diagnostics: BakeDiagnostic[] = [];
  for (const pass of passes) {
    const result = pass.run(root, sourceFile, checker);
    sourceFile = result.sourceFile;
    changed ||= result.changed;
    diagnostics.push(...result.diagnostics);
  }
  return { sourceFile, changed, diagnostics };
}
