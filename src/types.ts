import ts from "typescript";
import type { BakeEngineImplementation, BakeEngineMode } from "./core-engine";

export type BakeSeverity = "error" | "warning" | "suggestion";

export interface BakeSuggestion {
  readonly title: string;
  readonly replacement?: string;
  readonly confidence?: "high" | "medium" | "low";
  readonly evidence?: readonly string[];
}

export interface BakeDiagnostic {
  readonly code: string;
  readonly severity: BakeSeverity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly hint?: string;
  readonly suggestion?: BakeSuggestion;
}

export interface BakeConfig {
  readonly project: string;
  readonly outDir: string;
  readonly validateOnly: boolean;
  readonly reportFile?: string;
  readonly failOnWarnings: boolean;
  readonly engine?: BakeEngineMode;
  readonly wasmFile?: string;
}

export interface BakeFileResult {
  readonly sourceFile: ts.SourceFile;
  readonly outputText?: string;
  readonly changed: boolean;
  readonly diagnostics: readonly BakeDiagnostic[];
}

export interface BakeResult {
  readonly success: boolean;
  readonly engine: BakeEngineImplementation;
  readonly emittedFiles: readonly string[];
  readonly diagnostics: readonly BakeDiagnostic[];
}
