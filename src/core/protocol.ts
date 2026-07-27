export type BakeWord = number;

export const BAKE_CORE_ABI_VERSION: BakeWord = 1;
export const BAKE_CORE_RECORD_WORDS: BakeWord = 4;
export const BAKE_NO_INDEX: BakeWord = 0xffffffff;

export const BAKE_FACT_ANY: BakeWord = 1;
export const BAKE_FACT_UNKNOWN: BakeWord = 2;
export const BAKE_FACT_DYNAMIC_IMPORT: BakeWord = 3;
export const BAKE_FACT_AMBIENT_RUNTIME: BakeWord = 4;
export const BAKE_FACT_EXTERNAL_RUNTIME_IMPORT: BakeWord = 5;
export const BAKE_FACT_ASYNC_CLOSURE: BakeWord = 6;
export const BAKE_FACT_GENERATOR: BakeWord = 7;
export const BAKE_FACT_EXCEPTION: BakeWord = 8;
export const BAKE_FACT_NULLISH: BakeWord = 9;
export const BAKE_FACT_FOR_OF: BakeWord = 10;
export const BAKE_FACT_DESTRUCTURE: BakeWord = 11;

export const BAKE_ACTION_NONE: BakeWord = 0;
export const BAKE_ACTION_ERROR: BakeWord = 1;
export const BAKE_ACTION_WARNING: BakeWord = 2;
export const BAKE_ACTION_LOWER: BakeWord = 3;

export const BAKE_DIAGNOSTIC_NONE: BakeWord = 0;
export const BAKE_DIAGNOSTIC_ANY: BakeWord = 1;
export const BAKE_DIAGNOSTIC_UNKNOWN: BakeWord = 2;
export const BAKE_DIAGNOSTIC_DYNAMIC_IMPORT: BakeWord = 3;
export const BAKE_DIAGNOSTIC_AMBIENT_RUNTIME: BakeWord = 4;
export const BAKE_DIAGNOSTIC_EXTERNAL_RUNTIME_IMPORT: BakeWord = 5;
export const BAKE_DIAGNOSTIC_ASYNC_CLOSURE: BakeWord = 6;
export const BAKE_DIAGNOSTIC_GENERATOR: BakeWord = 7;
export const BAKE_DIAGNOSTIC_EXCEPTION: BakeWord = 8;
export const BAKE_DIAGNOSTIC_UNSAFE_LOWERING: BakeWord = 9;

export const BAKE_FLAG_IMPURE: BakeWord = 1;
export const BAKE_FLAG_UNDEFINED_SENSITIVE: BakeWord = 2;
export const BAKE_FLAG_AWAIT: BakeWord = 4;
export const BAKE_FLAG_NOT_ARRAY_LIKE: BakeWord = 8;
export const BAKE_FLAG_UNSUPPORTED_INITIALIZER: BakeWord = 16;
export const BAKE_FLAG_UNSUPPORTED_BINDING: BakeWord = 32;

const ACTION_MASK: BakeWord = 0xff;
const DIAGNOSTIC_MASK: BakeWord = 0xff;
const PAYLOAD_MASK: BakeWord = 0xffff;

export function packBakeDecision(action: BakeWord, diagnostic: BakeWord, payload: BakeWord): BakeWord {
  return ((action & ACTION_MASK) |
    ((diagnostic & DIAGNOSTIC_MASK) << 8) |
    ((payload & PAYLOAD_MASK) << 16)) >>> 0;
}

export function bakeDecisionAction(decision: BakeWord): BakeWord {
  return decision & ACTION_MASK;
}

export function bakeDecisionDiagnostic(decision: BakeWord): BakeWord {
  return (decision >>> 8) & DIAGNOSTIC_MASK;
}

export function bakeDecisionPayload(decision: BakeWord): BakeWord {
  return (decision >>> 16) & PAYLOAD_MASK;
}

function error(diagnostic: BakeWord): BakeWord {
  return packBakeDecision(BAKE_ACTION_ERROR, diagnostic, 0);
}

function warning(diagnostic: BakeWord): BakeWord {
  return packBakeDecision(BAKE_ACTION_WARNING, diagnostic, 0);
}

export function decideBakeFact(
  kind: BakeWord,
  flags: BakeWord,
  auxiliary0: BakeWord,
  auxiliary1: BakeWord
): BakeWord {
  switch (kind) {
    case BAKE_FACT_ANY:
      return error(BAKE_DIAGNOSTIC_ANY);
    case BAKE_FACT_UNKNOWN:
      return error(BAKE_DIAGNOSTIC_UNKNOWN);
    case BAKE_FACT_DYNAMIC_IMPORT:
      return error(BAKE_DIAGNOSTIC_DYNAMIC_IMPORT);
    case BAKE_FACT_AMBIENT_RUNTIME:
      return error(BAKE_DIAGNOSTIC_AMBIENT_RUNTIME);
    case BAKE_FACT_EXTERNAL_RUNTIME_IMPORT:
      return error(BAKE_DIAGNOSTIC_EXTERNAL_RUNTIME_IMPORT);
    case BAKE_FACT_ASYNC_CLOSURE:
      return error(BAKE_DIAGNOSTIC_ASYNC_CLOSURE);
    case BAKE_FACT_GENERATOR:
      return error(BAKE_DIAGNOSTIC_GENERATOR);
    case BAKE_FACT_EXCEPTION:
      return packBakeDecision(BAKE_ACTION_NONE, BAKE_DIAGNOSTIC_NONE, 0);
    case BAKE_FACT_NULLISH: {
      if ((flags & BAKE_FLAG_IMPURE) !== 0 || (flags & BAKE_FLAG_UNDEFINED_SENSITIVE) !== 0) {
        return warning(BAKE_DIAGNOSTIC_UNSAFE_LOWERING);
      }
      const operandCount: BakeWord = auxiliary0 >>> 0;
      if (operandCount === 0) return packBakeDecision(BAKE_ACTION_NONE, BAKE_DIAGNOSTIC_NONE, 0);
      const firstNonNullable: BakeWord = auxiliary1 >>> 0;
      const effectiveLength: BakeWord = firstNonNullable !== BAKE_NO_INDEX && firstNonNullable < operandCount
        ? firstNonNullable + 1
        : operandCount;
      return packBakeDecision(BAKE_ACTION_LOWER, BAKE_DIAGNOSTIC_NONE, effectiveLength);
    }
    case BAKE_FACT_FOR_OF:
      if ((flags & (BAKE_FLAG_AWAIT | BAKE_FLAG_NOT_ARRAY_LIKE | BAKE_FLAG_UNSUPPORTED_INITIALIZER)) !== 0) {
        return packBakeDecision(BAKE_ACTION_NONE, BAKE_DIAGNOSTIC_NONE, 0);
      }
      return packBakeDecision(BAKE_ACTION_LOWER, BAKE_DIAGNOSTIC_NONE, 0);
    case BAKE_FACT_DESTRUCTURE:
      if ((flags & BAKE_FLAG_UNSUPPORTED_BINDING) !== 0) {
        return warning(BAKE_DIAGNOSTIC_UNSAFE_LOWERING);
      }
      return packBakeDecision(BAKE_ACTION_LOWER, BAKE_DIAGNOSTIC_NONE, 0);
    default:
      return packBakeDecision(BAKE_ACTION_NONE, BAKE_DIAGNOSTIC_NONE, 0);
  }
}
