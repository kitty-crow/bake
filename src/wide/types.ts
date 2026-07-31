import type ts from "typescript";
import type { BakeDiagnostic } from "../types";

export interface WideResult {
  readonly sourceFile: ts.SourceFile;
  readonly changed: boolean;
  readonly diagnostics: readonly BakeDiagnostic[];
}

export interface WidePass {
  readonly name: string;
  run(root: string, source: ts.SourceFile): WideResult;
}
