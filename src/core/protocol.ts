export const BAKE_CORE_ABI_VERSION = 1;
export const BAKE_CORE_RECORD_WORDS = 4;

export const BAKE_FACT_ANY = 1;
export const BAKE_FACT_UNKNOWN = 2;
export const BAKE_FACT_DYNAMIC_IMPORT = 3;
export const BAKE_FACT_AMBIENT_RUNTIME = 4;
export const BAKE_FACT_EXTERNAL_RUNTIME_IMPORT = 5;
export const BAKE_FACT_ASYNC_CLOSURE = 6;
export const BAKE_FACT_GENERATOR = 7;
export const BAKE_FACT_EXCEPTION = 8;
export const BAKE_FACT_NULLISH = 9;
export const BAKE_FACT_FOR_OF = 10;
export const BAKE_FACT_DESTRUCTURE = 11;

export const BAKE_ACTION_NONE = 0;
export const BAKE_ACTION_ERROR = 1;
export const BAKE_ACTION_WARNING = 2;
export const BAKE_ACTION_LOWER = 3;

export const BAKE_DIAGNOSTIC_NONE = 0;
export const BAKE_DIAGNOSTIC_ANY = 1;
export const BAKE_DIAGNOSTIC_UNKNOWN = 2;
export const BAKE_DIAGNOSTIC_DYNAMIC_IMPORT = 3;
export const BAKE_DIAGNOSTIC_AMBIENT_RUNTIME = 4;
export const BAKE_DIAGNOSTIC_EXTERNAL_RUNTIME_IMPORT = 5;
export const BAKE_DIAGNOSTIC_ASYNC_CLOSURE = 6;
export const BAKE_DIAGNOSTIC_GENERATOR = 7;
export const BAKE_DIAGNOSTIC_EXCEPTION = 8;
export const BAKE_DIAGNOSTIC_UNSAFE_LOWERING = 9;

export const BAKE_FLAG_IMPURE = 1;
export const BAKE_FLAG_UNDEFINED_SENSITIVE = 2;
export const BAKE_FLAG_AWAIT = 4;
export const BAKE_FLAG_NOT_ARRAY_LIKE = 8;
export const BAKE_FLAG_UNSUPPORTED_INITIALIZER = 16;
export const BAKE_FLAG_UNSUPPORTED_BINDING = 32;

const ACTION_MASK = 0xff;
const DIAGNOSTIC_MASK = 0xff;
const PAYLOAD_MASK = 0xffff;

export function packBakeDecision(action: number, diagnostic: number, payload: number): number {
  return (action & ACTION_MASK) |
    ((diagnostic & DIAGNOSTIC_MASK) << 8) |
    ((payload & PAYLOAD_MASK) << 16);
}

export function bakeDecisionAction(decision: number): number {
  return decision & ACTION_MASK;
}

export function bakeDecisionDiagnostic(decision: number): number {
  return (decision >>> 8) & DIAGNOSTIC_MASK;
}

export function bakeDecisionPayload(decision: number): number {
  return (decision >>> 16) & PAYLOAD_MASK;
}

function error(diagnostic: number): number {
  return packBakeDecision(BAKE_ACTION_ERROR, diagnostic, 0);
}

function warning(diagnostic: number): number {
  return packBakeDecision(BAKE_ACTION_WARNING, diagnostic, 0);
}

export function decideBakeFact(kind: number, flags: number, auxiliary0: number, auxiliary1: number): number {
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
      return error(BAKE_DIAGNOSTIC_EXCEPTION);
    case BAKE_FACT_NULLISH: {
      if ((flags & BAKE_FLAG_IMPURE) !== 0 || (flags & BAKE_FLAG_UNDEFINED_SENSITIVE) !== 0) {
        return warning(BAKE_DIAGNOSTIC_UNSAFE_LOWERING);
      }
      const operandCount = auxiliary0 > 0 ? auxiliary0 : 0;
      if (operandCount === 0) return packBakeDecision(BAKE_ACTION_NONE, BAKE_DIAGNOSTIC_NONE, 0);
      const firstNonNullable = auxiliary1;
      const effectiveLength = firstNonNullable >= 0 && firstNonNullable < operandCount
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
