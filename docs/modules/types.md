# Public data types

| Export | Contents |
| --- | --- |
| `BakeSeverity` | error, warning or suggestion |
| `BakeSuggestion` | Proposed replacement, confidence and evidence |
| `BakeDiagnostic` | Code, severity, file location, message and nullable hint/suggestion |
| `BakeConfig` | Input project, output directory, validation/report options, policy engine and target |
| `BakeFileResult` | Source AST, changed flag and diagnostics |
| `DEFAULT_BAKE_SETTINGS` | Default host selection, Wasm target and null report/Wasm file paths |
| `BakeResult` | Success, target, implementation, emitted files and diagnostics |

File locations are relative to the project root unless no source location is available.
