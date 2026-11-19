import ts from "typescript";
import type { BakeEngineImplementation, BakeEngineMode } from "./core-engine";
import type { BakeTarget } from "./target";

export type BakeSeverity = "error" | "warning" | "suggestion";

export interface BakeSuggestion {
  readonly title: string;
  readonly replacement: string;
  readonly confidence: "high" | "medium" | "low";
  readonly evidence: readonly string[];
}

export interface BakeDiagnostic {
  readonly code: string;
  readonly severity: BakeSeverity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly hint: string | null;
  readonly suggestion: BakeSuggestion | null;
}

export interface BakeConfig {
  readonly project: string;
  readonly outDir: string;
  readonly validateOnly: boolean;
  readonly reportFile: string | null;
  readonly failOnWarnings: boolean;
  readonly engine: BakeEngineMode;
  readonly target: BakeTarget;
  readonly wasmFile: string | null;
}

/** Default policy settings for callers that only specify the input and output project. */
export const DEFAULT_BAKE_SETTINGS: Pick<BakeConfig, "reportFile" | "engine" | "target" | "wasmFile"> = {
  reportFile: null,
  engine: "auto",
  target: "wasm",
  wasmFile: null
};

export interface BakeFileResult {
  readonly sourceFile: ts.SourceFile;
  readonly changed: boolean;
  readonly diagnostics: readonly BakeDiagnostic[];
}

export interface BakeResult {
  readonly success: boolean;
  readonly target: BakeTarget;
  readonly engine: BakeEngineImplementation;
  readonly emittedFiles: readonly string[];
  readonly diagnostics: readonly BakeDiagnostic[];
}
