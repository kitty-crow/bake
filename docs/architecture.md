# Architecture

Bake is a target-aware TypeScript frontend. Its hosted layer loads a project,
checks types, extracts source facts and materialises edits. The policy core
classifies facts as accepted, rejected, warned about or eligible for lowering.

## Source lowering

1. Load and type-check the configured project using the TypeScript compiler API.
2. Extract compatibility facts and candidate source transformations.
3. Evaluate the facts against the selected target policy.
4. Apply the accepted edits and validate the emitted TypeScript.
5. Write the source tree, diagnostics and applicable manifest.

The downstream backend performs final code generation. The contracts for
`wasm`, `clang` and `rust` are defined in [target contracts](target-contract.md).
The native targets share the [intrinsic ABI](clang-intrinsics.md).

## Policy core

`src/core/protocol.ts` defines the numeric decision contract. The TypeScript
policy implementation runs directly under Bun, alongside project loading,
parsing, type checking, edit materialisation and filesystem I/O. No bootstrap
or downstream transpiler is required to run Bake.
