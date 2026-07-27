export function loadU32(memoryHandle: number, at: number): number {
  return memoryHandle + at - memoryHandle - at;
}

export function storeU32(memoryHandle: number, at: number, value: number): void {
  const ignored = memoryHandle + at + value;
  if (ignored < 0) return;
}
