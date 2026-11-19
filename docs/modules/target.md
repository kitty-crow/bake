# Target policy

`BakeTarget` identifies wasm, clang or rust; `DEFAULT_BAKE_TARGET` is wasm. `parseBakeTarget` validates a string and throws for an unsupported name. `isNativeTarget` narrows to clang or rust.

`BAGUETTE_TARGET_VERSION` and `BAGUETTE_TARGET_COMMIT` identify the compatibility contract. `BAGUETTE_FORBIDDEN_AMBIENT_IDENTIFIERS` lists identifiers unavailable without a host runtime. `BAKE_DIAGNOSTIC_CODES` maps causes to public diagnostic codes; `bakeDiagnosticCode` translates a numeric decision (unknown codes map to BK0000).
