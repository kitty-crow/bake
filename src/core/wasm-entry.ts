import { loadU32, storeU32 } from "./intrinsics";
import {
  BAKE_CORE_ABI_VERSION,
  BAKE_CORE_RECORD_WORDS,
  decideBakeFact
} from "./protocol";
import type { BakeWord } from "./protocol";

const WORD_BYTES: BakeWord = 4;
const RECORD_BYTES: BakeWord = BAKE_CORE_RECORD_WORDS * WORD_BYTES;

export function bakeCoreVersion(): BakeWord {
  return BAKE_CORE_ABI_VERSION;
}

export function bakeDecideFact(
  kind: BakeWord,
  flags: BakeWord,
  auxiliary0: BakeWord,
  auxiliary1: BakeWord
): BakeWord {
  return decideBakeFact(kind, flags, auxiliary0, auxiliary1);
}

export function bakeProcessFacts(
  inputPointer: BakeWord,
  factCount: BakeWord,
  outputPointer: BakeWord
): BakeWord {
  for (let index: BakeWord = 0; index < factCount; index++) {
    const input: BakeWord = inputPointer + index * RECORD_BYTES;
    const output: BakeWord = outputPointer + index * WORD_BYTES;
    const kind: BakeWord = loadU32(0, input);
    const flags: BakeWord = loadU32(0, input + WORD_BYTES);
    const auxiliary0: BakeWord = loadU32(0, input + WORD_BYTES * 2);
    const auxiliary1: BakeWord = loadU32(0, input + WORD_BYTES * 3);
    storeU32(0, output, decideBakeFact(kind, flags, auxiliary0, auxiliary1));
  }

  return factCount;
}
