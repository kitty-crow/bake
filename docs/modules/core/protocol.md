# Policy record ABI

`BakeWord` is a 32-bit numeric value. Each fact record has four words (`BAKE_CORE_RECORD_WORDS`): kind, flags, auxiliary0, auxiliary1. `BAKE_CORE_ABI_VERSION` identifies the ABI; `BAKE_NO_INDEX` is the absent-index sentinel.

| Fact constant | Input |
| --- | --- |
| `BAKE_FACT_ANY`, `BAKE_FACT_UNKNOWN` | Unresolved type |
| `BAKE_FACT_DYNAMIC_IMPORT`, `BAKE_FACT_AMBIENT_RUNTIME`, `BAKE_FACT_EXTERNAL_RUNTIME_IMPORT` | Runtime dependency |
| `BAKE_FACT_ASYNC_CLOSURE`, `BAKE_FACT_GENERATOR`, `BAKE_FACT_EXCEPTION` | Control flow |
| `BAKE_FACT_NULLISH`, `BAKE_FACT_FOR_OF`, `BAKE_FACT_DESTRUCTURE` | Candidate rewrite |

Flags: `BAKE_FLAG_IMPURE`, `BAKE_FLAG_UNDEFINED_SENSITIVE`, `BAKE_FLAG_AWAIT`, `BAKE_FLAG_NOT_ARRAY_LIKE`, `BAKE_FLAG_UNSUPPORTED_INITIALIZER`, `BAKE_FLAG_UNSUPPORTED_BINDING`.

Decision actions: `BAKE_ACTION_NONE`, `BAKE_ACTION_ERROR`, `BAKE_ACTION_WARNING`, `BAKE_ACTION_LOWER`.

Diagnostic constants: `BAKE_DIAGNOSTIC_NONE`, `BAKE_DIAGNOSTIC_ANY`, `BAKE_DIAGNOSTIC_UNKNOWN`, `BAKE_DIAGNOSTIC_DYNAMIC_IMPORT`, `BAKE_DIAGNOSTIC_AMBIENT_RUNTIME`, `BAKE_DIAG_EXTERNAL_IMPORT`, `BAKE_DIAGNOSTIC_ASYNC_CLOSURE`, `BAKE_DIAGNOSTIC_GENERATOR`, `BAKE_DIAGNOSTIC_EXCEPTION`, `BAKE_DIAGNOSTIC_UNSAFE_LOWERING`.

`decideBakeFact` returns a packed unsigned decision: `packBakeDecision` combines action (bits 0–7), diagnostic (8–15) and payload (16–31); `bakeDecisionAction`, `bakeDecisionDiagnostic` and `bakeDecisionPayload` decode them. No host I/O is performed.
