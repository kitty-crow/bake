import { loadU32, storeU32 } from "./intrinsics";
import {
  BAKE_CORE_ABI_VERSION,
  BAKE_CORE_RECORD_WORDS,
  decideBakeFact
} from "./protocol";

const WORD_BYTES = 4;
const RECORD_BYTES = BAKE_CORE_RECORD_WORDS * WORD_BYTES;

export function bakeCoreVersion(): number {
  return BAKE_CORE_ABI_VERSION;
}

export function bakeDecideFact(kind: number, flags: number, auxiliary0: number, auxiliary1: number): number {
  return decideBakeFact(kind, flags, auxiliary0, auxiliary1);
}

export function bakeProcessFacts(inputPointer: number, factCount: number, outputPointer: number): number {
  if (inputPointer < 0 || outputPointer < 0 || factCount < 0) return -1;

  for (let index = 0; index < factCount; index++) {
    const input = inputPointer + index * RECORD_BYTES;
    const output = outputPointer + index * WORD_BYTES;
    const kind = loadU32(0, input);
    const flags = loadU32(0, input + WORD_BYTES);
    const auxiliary0 = loadU32(0, input + WORD_BYTES * 2);
    const auxiliary1Unsigned = loadU32(0, input + WORD_BYTES * 3);
    const auxiliary1 = auxiliary1Unsigned === 0xffffffff ? -1 : auxiliary1Unsigned;
    storeU32(0, output, decideBakeFact(kind, flags, auxiliary0, auxiliary1));
  }

  return factCount;
}
