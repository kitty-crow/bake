import {
  BAKE_DIAGNOSTIC_AMBIENT_RUNTIME,
  BAKE_DIAGNOSTIC_ANY,
  BAKE_DIAGNOSTIC_ASYNC_CLOSURE,
  BAKE_DIAGNOSTIC_DYNAMIC_IMPORT,
  BAKE_DIAGNOSTIC_EXCEPTION,
  BAKE_DIAGNOSTIC_EXTERNAL_RUNTIME_IMPORT,
  BAKE_DIAGNOSTIC_GENERATOR,
  BAKE_DIAGNOSTIC_UNKNOWN,
  BAKE_DIAGNOSTIC_UNSAFE_LOWERING
} from "./core/protocol";

/**
 * Bake's compatibility contract for Baguette 0.2.6.
 * Baguette remains authoritative. Bake mirrors only the explicit validator
 * rules required to give earlier and more actionable diagnostics.
 */
export const BAGUETTE_TARGET_VERSION = "0.2.6";
export const BAGUETTE_TARGET_COMMIT = "1b7eb13644a7ed80f538a7dc37988654f24d7ce4";

export const BAGUETTE_FORBIDDEN_AMBIENT_IDENTIFIERS = new Set([
  "Bun",
  "Function",
  "Proxy",
  "Reflect",
  "WeakMap",
  "WeakSet",
  "WebSocket",
  "document",
  "eval",
  "fetch",
  "navigator",
  "process",
  "require",
  "window"
]);

export const BAKE_DIAGNOSTIC_CODES = {
  any: "BK1001",
  unknown: "BK1002",
  dynamicImport: "BK1101",
  ambientRuntime: "BK1102",
  externalRuntimeImport: "BK1103",
  asyncClosure: "BK2003",
  generator: "BK2101",
  exception: "BK2201",
  unsafeLowering: "BK3001"
} as const;

export function bakeDiagnosticCode(diagnostic: number): string {
  switch (diagnostic) {
    case BAKE_DIAGNOSTIC_ANY: return BAKE_DIAGNOSTIC_CODES.any;
    case BAKE_DIAGNOSTIC_UNKNOWN: return BAKE_DIAGNOSTIC_CODES.unknown;
    case BAKE_DIAGNOSTIC_DYNAMIC_IMPORT: return BAKE_DIAGNOSTIC_CODES.dynamicImport;
    case BAKE_DIAGNOSTIC_AMBIENT_RUNTIME: return BAKE_DIAGNOSTIC_CODES.ambientRuntime;
    case BAKE_DIAGNOSTIC_EXTERNAL_RUNTIME_IMPORT: return BAKE_DIAGNOSTIC_CODES.externalRuntimeImport;
    case BAKE_DIAGNOSTIC_ASYNC_CLOSURE: return BAKE_DIAGNOSTIC_CODES.asyncClosure;
    case BAKE_DIAGNOSTIC_GENERATOR: return BAKE_DIAGNOSTIC_CODES.generator;
    case BAKE_DIAGNOSTIC_EXCEPTION: return BAKE_DIAGNOSTIC_CODES.exception;
    case BAKE_DIAGNOSTIC_UNSAFE_LOWERING: return BAKE_DIAGNOSTIC_CODES.unsafeLowering;
    default: return "BK0000";
  }
}
