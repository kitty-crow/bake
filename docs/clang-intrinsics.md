# Native intrinsic ABI

The `clang` and `rust` targets emit statically declared `__bake_c_*` operations
with intrinsic ABI version 1. The backend and its platform implementation
supply their representations and behaviour.

## Memory and views

- `__bake_c_new_buffer` and `__bake_c_new_shared_buffer` allocate contiguous,
  zero-initialised regions.
- `__bake_c_new_view` and the typed-array constructors create non-owning views.
  Typed-array indices refer to elements; DataView offsets refer to bytes.
- `__bake_c_*_get` and `__bake_c_*_set` preserve element access and narrowing.
  Out-of-range indices must not cause unchecked machine-memory access.
- `__bake_c_u8_fill` and `__bake_c_u8_copy_within` preserve ranges and overlap
  semantics.
- `__bake_c_view_get_*` and `__bake_c_view_set_*` preserve widths, default
  big-endian order, optional little-endian order, IEEE-754 bit patterns and
  numeric conversions. Unaligned DataView accesses are supported.
- `__bake_c_abort_range` is non-returning.

The platform defines `__bake_c_Buffer`, `__bake_c_View`, typed-array and
external-memory representations. External memory is supplied by the caller.

## Atomics

Operations on signed 32-bit and unsigned 64-bit cells require valid alignment
and range, and sequential consistency. `add` and `compareExchange` return the
previous value; `store` returns the stored value. Addition wraps at cell width.

## Numbers

- `__bake_c_as_int_n` and `__bake_c_as_uint_n` implement explicit-width
  truncation and sign extension for supported widths.
- `__bake_c_bigint` and `__bake_c_number` preserve conversion rules and traps.
- Floating-point operations preserve NaN, infinity, signed zero and f32
  rounding. C `fmin` and `fmax` are not interchangeable with JavaScript
  `Math.min` and `Math.max` for all operands.
- Typed `bigint` arithmetic requires the correct signedness and overflow
  behaviour. C signed overflow is not a valid substitute.

## Acceptance test

`scripts/check-thistle-native.ts` uses Thistle's native source and transitive
imports as a validation fixture for both targets. It checks the emitted
TypeScript and rejects remaining JavaScript host calls. Native linking and
execution are separate backend tests.
