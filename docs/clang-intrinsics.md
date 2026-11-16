# Clang-target intrinsic contract

`bake --target=clang` emits TypeScript with statically declared
`__bake_c_*` operations. It does not emit C and does not link a runtime.
The declarations are obligations for a future C backend and platform layer.
The source logic remains in Thistle. Bake rewrites expressions and types,
not entire kernel modules.

## Memory and views

- `__bake_c_new_buffer` and `__bake_c_new_shared_buffer` allocate
  contiguous, zero-initialised regions. The platform supplies the allocator.
- `__bake_c_new_view` and the typed-array constructors create typed,
  non-owning views of those regions. Native array indices are element indices;
  DataView offsets are byte offsets.
- `__bake_c_*_get` and `__bake_c_*_set` preserve typed-array element
  reads, writes and narrowing. Invalid indices must not produce unchecked
  machine-memory access.
- `__bake_c_u8_fill` and `__bake_c_u8_copy_within` preserve the original
  ranges and overlap semantics.
- `__bake_c_view_get_*` and `__bake_c_view_set_*` preserve DataView
  widths, default big-endian interpretation, optional little-endian order,
  IEEE-754 bit patterns and JS numeric conversion rules. Unaligned DataView
  accesses are supported.
- `__bake_c_abort_range` is non-returning. Bare-metal bounds violations
  must fault or stop execution, never continue after an invalid access.

The C backend must define a native representation for the emitted
`__bake_c_Buffer`, `__bake_c_View`, typed-array and external-memory
interfaces. An external memory view represents platform-supplied memory,
not a WASM engine.

## Atomics

Atomic intrinsics operate on 32-bit signed and 64-bit unsigned cells. They
must enforce their alignment and range requirements, provide sequentially
consistent operations, and preserve return values: `add` and
`compareExchange` return the previous value; `store` returns the stored
value. Integer additions wrap at the cell width. The original
`memory.shared` branches in Thistle remain intact.

## Numbers

- `__bake_c_as_int_n` and `__bake_c_as_uint_n` truncate and sign-extend
  exactly as `BigInt.asIntN` and `BigInt.asUintN` for supported widths.
- `__bake_c_bigint` and `__bake_c_number` preserve numeric conversion
  rules and explicit traps for invalid conversions.
- Floating-point intrinsics preserve JavaScript behaviour for NaN, infinity,
  signed zero and f32 rounding. In particular, they must not substitute
  C `fmin`/`fmax` where JavaScript `Math.min`/`Math.max` differ.
- The backend is responsible for translating typed `bigint` arithmetic
  with correct signedness and overflow behaviour. Bare C signed overflow is
  not an acceptable replacement for Thistle's semantics.

## Acceptance test

`scripts/check-thistle-native.ts` checks out canonical Thistle
`src/native/` and its transitive imports, lowers the entire compilation
boundary for `clang`, type-checks the generated TypeScript and rejects
remaining JavaScript host calls. CI also runs the original Bake test suite
and builds/uses the Baguette-compiled WASM policy core.

A successful Bake run means the source meets this frontend contract.
It does **not** imply a linked, bootable kernel or an implemented C backend.
