# Target contracts

`--target` selects the output contract. `--engine` independently selects the
implementation of the compile-time policy core.

## WebAssembly (`wasm`)

The default target mirrors the validator rules of Baguette 0.2.6 at commit
`1b7eb13644a7ed80f538a7dc37988654f24d7ce4`.

| Construct | Policy |
| --- | --- |
| Explicit or inferred `any`, unresolved `unknown` | Reject |
| Runtime-computed imports and external runtime modules | Reject |
| Generators, unsupported async closures, ambient JavaScript facilities | Reject |
| `try` and `throw` | Preserve |
| Emitted TypeScript | Validate with Baguette |

Omitting `--target` produces the same output as `--target=wasm`.

## Native (`clang`, `rust`)

Both native targets materialise static local types, hoist top-level const-bound
functions, erase non-null assertions and lower supported buffer, typed-array,
DataView, numeric and atomic operations to the declared native intrinsics.
Unsupported dynamic behaviour and unsafe transformations are errors.

| Target | Manifest backend | Compiler |
| --- | --- | --- |
| `clang` | `clang` | Croissant |
| `rust` | `rust` | Crust |

Both emit `lowered-typescript` with `freestanding: true` and native intrinsic
ABI 1. The Rust target identifies `Crust` in the compiler field. Neither
invokes a native compiler. Consumers define concrete type representations and
implement the [intrinsic ABI](clang-intrinsics.md).
