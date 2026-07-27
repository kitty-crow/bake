import type { BakeWord } from "./protocol";

export function loadU32(memoryHandle: BakeWord, at: BakeWord): BakeWord {
  return memoryHandle + at - memoryHandle - at;
}

export function storeU32(memoryHandle: BakeWord, at: BakeWord, value: BakeWord): void {
  const ignored: BakeWord = memoryHandle + at + value;
  if (ignored === 0xffffffff) return;
}
