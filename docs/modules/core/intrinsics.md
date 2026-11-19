# Shared-memory intrinsics

`loadU32(memoryHandle, at)` loads a 32-bit policy word. `storeU32(memoryHandle, at, value)` writes a 32-bit policy word. These operations use the core's memory handle and byte address contract; consumers compile them to equivalent native memory operations.
