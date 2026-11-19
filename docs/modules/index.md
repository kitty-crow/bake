# Public package entry

`bake(config)` loads a TypeScript project and returns a BakeResult. A successful, non-validation-only invocation writes the source tree, project configuration and manifest. `printBakeResult(result)` writes errors to stderr and other messages to stdout; `formatDiagnostic` returns a string without I/O.

| Export group | Identifiers |
| --- | --- |
| [Data contracts](types.md) | `BakeSeverity`, `BakeSuggestion`, `BakeDiagnostic`, `BakeConfig`, `DEFAULT_BAKE_SETTINGS`, `BakeFileResult`, `BakeResult` |
| [Target selection](target.md) | `BakeTarget`, `DEFAULT_BAKE_TARGET`, `isNativeTarget`, `parseBakeTarget`, `BAGUETTE_TARGET_VERSION`, `BAGUETTE_TARGET_COMMIT`, `BAGUETTE_FORBIDDEN_AMBIENT_IDENTIFIERS`, `BAKE_DIAGNOSTIC_CODES`, `bakeDiagnosticCode` |
| [Policy engines](core-engine.md) | `createBakeCoreEngine`, `BakeEngineMode`, `BakeEngineImplementation`, `BakeCoreEngine` |
| [Record encoding](core/protocol.md) | `packBakeDecision`, `bakeDecisionAction`, `bakeDecisionDiagnostic`, `bakeDecisionPayload`, `decideBakeFact`, `BakeWord`, `BAKE_CORE_ABI_VERSION`, `BAKE_CORE_RECORD_WORDS`, `BAKE_NO_INDEX` |
| Type and runtime facts | `BAKE_FACT_ANY`, `BAKE_FACT_UNKNOWN`, `BAKE_FACT_DYNAMIC_IMPORT`, `BAKE_FACT_AMBIENT_RUNTIME`, `BAKE_FACT_EXTERNAL_RUNTIME_IMPORT`, `BAKE_FACT_ASYNC_CLOSURE`, `BAKE_FACT_GENERATOR`, `BAKE_FACT_EXCEPTION` |
| Rewrite facts | `BAKE_FACT_NULLISH`, `BAKE_FACT_FOR_OF`, `BAKE_FACT_DESTRUCTURE` |
| Actions | `BAKE_ACTION_NONE`, `BAKE_ACTION_ERROR`, `BAKE_ACTION_WARNING`, `BAKE_ACTION_LOWER` |
| Diagnostic constants | `BAKE_DIAGNOSTIC_NONE`, `BAKE_DIAGNOSTIC_ANY`, `BAKE_DIAGNOSTIC_UNKNOWN`, `BAKE_DIAGNOSTIC_DYNAMIC_IMPORT`, `BAKE_DIAGNOSTIC_AMBIENT_RUNTIME`, `BAKE_DIAG_EXTERNAL_IMPORT`, `BAKE_DIAGNOSTIC_ASYNC_CLOSURE`, `BAKE_DIAGNOSTIC_GENERATOR`, `BAKE_DIAGNOSTIC_EXCEPTION`, `BAKE_DIAGNOSTIC_UNSAFE_LOWERING` |
| Flags | `BAKE_FLAG_IMPURE`, `BAKE_FLAG_UNDEFINED_SENSITIVE`, `BAKE_FLAG_AWAIT`, `BAKE_FLAG_NOT_ARRAY_LIKE`, `BAKE_FLAG_UNSUPPORTED_INITIALIZER`, `BAKE_FLAG_UNSUPPORTED_BINDING` |
