// Baguette prelude for the self-hosted Bake core.
// It is consumed by Baguette and is intentionally excluded from the host tsconfig.
@inline function loadU32(memoryHandle: usize, at: u32): u32 {
  return load<u32>(at);
}

@inline function storeU32(memoryHandle: usize, at: u32, value: u32): void {
  store<u32>(at, value);
}
