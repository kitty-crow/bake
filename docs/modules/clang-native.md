# Intrinsic lowering

`NativeClangResult` contains sourceFile, diagnostics and the required intrinsic names. `lowerNativeClang(source, checker, root)` translates supported buffer allocation, indexed loads/stores, DataView, atomics and numeric operations to declared intrinsics. Unsupported DataView and atomic operations generate diagnostics. See [intrinsic ABI](../clang-intrinsics.md) for the runtime contract.
