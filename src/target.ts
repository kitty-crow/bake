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
