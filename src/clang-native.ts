import ts from "typescript";
import { diagnosticAt } from "./diagnostics";
import type { BakeDiagnostic } from "./types";

/**
 * Bake's freestanding intrinsic contract. These are compiler imports, not
 * JavaScript shims. A future C emitter must bind them to native operations.
 */
const NATIVE_MEMORY_SOURCE = String.raw\`import type { I32, I64, Ptr, U32, U64 } from "./types.js";

/** Byte offsets into a contiguous native memory region. */
export interface TetoMemory {
  readonly base: U64;
  readonly length: U32;
  readonly shared: boolean;
}

declare function __bake_c_alloc(bytes: U32, shared: boolean): U64;
declare function __bake_c_fault(code: U32): never;
declare function __bake_c_fill(base: U64, at: Ptr, length: U32, value: U32): void;
declare function __bake_c_move(base: U64, to: Ptr, from: Ptr, length: U32): void;
declare function __bake_c_load_u8(base: U64, at: Ptr): U32;
declare function __bake_c_load_u16le(base: U64, at: Ptr): U32;
declare function __bake_c_load_u32le(base: U64, at: Ptr): U32;
declare function __bake_c_load_u64le(base: U64, at: Ptr): U64;
declare function __bake_c_store_u8(base: U64, at: Ptr, value: U32): void;
declare function __bake_c_store_u16le(base: U64, at: Ptr, value: U32): void;
declare function __bake_c_store_u32le(base: U64, at: Ptr, value: U32): void;
declare function __bake_c_store_u64le(base: U64, at: Ptr, value: U64): void;
declare function __bake_c_atomic_cmpxchg_i32(base: U64, at: Ptr, expected: I32, replacement: I32): I32;
declare function __bake_c_atomic_add_i32(base: U64, at: Ptr, value: I32): I32;
declare function __bake_c_atomic_store_i32(base: U64, at: Ptr, value: I32): void;
declare function __bake_c_atomic_load_i32(base: U64, at: Ptr): I32;
declare function __bake_c_atomic_load_u64(base: U64, at: Ptr): U64;
declare function __bake_c_atomic_store_u64(base: U64, at: Ptr, value: U64): void;
declare function __bake_c_atomic_add_u64(base: U64, at: Ptr, value: U64): U64;

/** Hardware boot code may supply an already mapped memory region. */
export const nativeMemoryRegion = (base: U64, length: U32, shared: boolean = false): TetoMemory =>
  ({ base, length, shared });

/** Optional platform allocator, not a JavaScript ArrayBuffer allocation. */
export const directMemory = (bytes: U32, shared: boolean = false): TetoMemory => {
  if (bytes < 65536 || bytes > 0x7fffffff) __bake_c_fault(1);
  return nativeMemoryRegion(__bake_c_alloc(bytes, shared), bytes, shared);
};

export const memorySize = (memory: TetoMemory): U32 => memory.length;

/** Match the original byte-bound checks without integer wraparound. */
const range = (memory: TetoMemory, at: Ptr, size: U32): void => {
  if (at < 0 || size < 0 || size > memory.length || at > memory.length - size) __bake_c_fault(2);
};

const aligned = (memory: TetoMemory, at: Ptr, size: U32): void => {
  range(memory, at, size);
  if (at % size !== 0) __bake_c_fault(3);
};

export const fill = (memory: TetoMemory, at: Ptr, size: U32, value: U32): void => {
  range(memory, at, size);
  __bake_c_fill(memory.base, at, size, value & 255);
};

export const copyMemory = (memory: TetoMemory, to: Ptr, from: Ptr, size: U32): void => {
  range(memory, to, size);
  range(memory, from, size);
  __bake_c_move(memory.base, to, from, size);
};

export const loadU8 = (memory: TetoMemory, at: Ptr): U32 => {
  range(memory, at, 1);
  return __bake_c_load_u8(memory.base, at);
};

export const loadI8 = (memory: TetoMemory, at: Ptr): I64 =>
  BigInt.asIntN(8, BigInt(loadU8(memory, at)));

export const loadU16 = (memory: TetoMemory, at: Ptr): U32 => {
  range(memory, at, 2);
  return __bake_c_load_u16le(memory.base, at);
};

export const loadI16 = (memory: TetoMemory, at: Ptr): I64 =>
  BigInt.asIntN(16, BigInt(loadU16(memory, at)));

export const loadU32 = (memory: TetoMemory, at: Ptr): U32 => {
  range(memory, at, 4);
  return __bake_c_load_u32le(memory.base, at);
};

export const loadI32 = (memory: TetoMemory, at: Ptr): I32 => {
  const value = loadU32(memory, at);
  return value > 0x7fffffff ? value - 0x100000000 : value;
};

export const loadU64 = (memory: TetoMemory, at: Ptr): U64 => {
  range(memory, at, 8);
  return __bake_c_load_u64le(memory.base, at);
};

export const loadI64 = (memory: TetoMemory, at: Ptr): I64 =>
  BigInt.asIntN(64, loadU64(memory, at));

export const storeU8 = (memory: TetoMemory, at: Ptr, value: U32 | I64): void => {
  range(memory, at, 1);
  __bake_c_store_u8(memory.base, at, Number(BigInt.asUintN(8, BigInt(value))));
};

export const storeU16 = (memory: TetoMemory, at: Ptr, value: U32 | I64): void => {
  range(memory, at, 2);
  __bake_c_store_u16le(memory.base, at, Number(BigInt.asUintN(16, BigInt(value))));
};

export const storeU32 = (memory: TetoMemory, at: Ptr, value: U32 | I32 | I64): void => {
  range(memory, at, 4);
  __bake_c_store_u32le(memory.base, at, Number(BigInt.asUintN(32, BigInt(value))));
};

export const storeI32 = (memory: TetoMemory, at: Ptr, value: I32): void =>
  storeU32(memory, at, value);

export const storeU64 = (memory: TetoMemory, at: Ptr, value: U64 | I64): void => {
  range(memory, at, 8);
  __bake_c_store_u64le(memory.base, at, BigInt.asUintN(64, value));
};

export const storeI64 = (memory: TetoMemory, at: Ptr, value: I64): void =>
  storeU64(memory, at, value);

export const compareExchangeI32 = (
  memory: TetoMemory, at: Ptr, expected: I32, replacement: I32
): I32 => {
  aligned(memory, at, 4);
  return __bake_c_atomic_cmpxchg_i32(memory.base, at, expected, replacement);
};

export const atomicAddI32 = (memory: TetoMemory, at: Ptr, value: I32): I32 => {
  aligned(memory, at, 4);
  return __bake_c_atomic_add_i32(memory.base, at, value);
};

export const atomicStoreI32 = (memory: TetoMemory, at: Ptr, value: I32): void => {
  aligned(memory, at, 4);
  __bake_c_atomic_store_i32(memory.base, at, value);
};

export const atomicLoadI32 = (memory: TetoMemory, at: Ptr): I32 => {
  aligned(memory, at, 4);
  return __bake_c_atomic_load_i32(memory.base, at);
};

export const atomicLoadU64 = (memory: TetoMemory, at: Ptr): U64 => {
  aligned(memory, at, 8);
  return __bake_c_atomic_load_u64(memory.base, at);
};

export const atomicStoreU64 = (memory: TetoMemory, at: Ptr, value: U64): void => {
  aligned(memory, at, 8);
  __bake_c_atomic_store_u64(memory.base, at, BigInt.asUintN(64, value));
};

export const atomicAddU64 = (memory: TetoMemory, at: Ptr, value: U64): U64 => {
  aligned(memory, at, 8);
  return __bake_c_atomic_add_u64(memory.base, at, BigInt.asUintN(64, value));
};
\`;

const NATIVE_NUMERIC_INTRINSICS: Readonly<Record<string, string>> = {
  "__bake_c_bigint": "declare function __bake_c_bigint(value: number | bigint): bigint;",
  "__bake_c_number": "declare function __bake_c_number(value: number | bigint): number;",
  "__bake_c_as_int_n": "declare function __bake_c_as_int_n(bits: number, value: bigint): bigint;",
  "__bake_c_as_uint_n": "declare function __bake_c_as_uint_n(bits: number, value: bigint): bigint;",
  "__bake_c_f64_is_nan": "declare function __bake_c_f64_is_nan(value: number): boolean;",
  "__bake_c_f64_is_integer": "declare function __bake_c_f64_is_integer(value: number): boolean;",
  "__bake_c_f32_round": "declare function __bake_c_f32_round(value: number): number;",
  "__bake_c_f64_sqrt": "declare function __bake_c_f64_sqrt(value: number): number;",
  "__bake_c_f64_trunc": "declare function __bake_c_f64_trunc(value: number): number;",
  "__bake_c_f64_floor": "declare function __bake_c_f64_floor(value: number): number;",
  "__bake_c_f64_ceil": "declare function __bake_c_f64_ceil(value: number): number;",
  "__bake_c_f64_min": "declare function __bake_c_f64_min(left: number, right: number): number;",
  "__bake_c_f64_max": "declare function __bake_c_f64_max(left: number, right: number): number;",
  "__bake_c_i32_mul": "declare function __bake_c_i32_mul(left: number, right: number): number;"
};

const BUILTIN_METHODS: Readonly<Record<string, string>> = {
  "BigInt.asIntN": "__bake_c_as_int_n",
  "BigInt.asUintN": "__bake_c_as_uint_n",
  "Number.isNaN": "__bake_c_f64_is_nan",
  "Number.isInteger": "__bake_c_f64_is_integer",
  "Math.fround": "__bake_c_f32_round",
  "Math.sqrt": "__bake_c_f64_sqrt",
  "Math.trunc": "__bake_c_f64_trunc",
  "Math.floor": "__bake_c_f64_floor",
  "Math.ceil": "__bake_c_f64_ceil",
  "Math.min": "__bake_c_f64_min",
  "Math.max": "__bake_c_f64_max",
  "Math.imul": "__bake_c_i32_mul"
};

const BITCAST_INTRINSICS = [
  ["bitsToF32", "__bake_c_bits_to_f32", "declare function __bake_c_bits_to_f32(value: U64): F32;"],
  ["bitsToF64", "__bake_c_bits_to_f64", "declare function __bake_c_bits_to_f64(value: U64): F64;"],
  ["f32ToBits", "__bake_c_f32_to_bits", "declare function __bake_c_f32_to_bits(value: F32 | F64): U64;"],
  ["f64ToBits", "__bake_c_f64_to_bits", "declare function __bake_c_f64_to_bits(value: F64): U64;"]
] as const;

export interface NativeClangResult {
  readonly sourceFile: ts.SourceFile;
  readonly diagnostics: readonly BakeDiagnostic[];
  readonly intrinsics: readonly string[];
}

/** Recognise Thistle's typed memory boundary by its complete public ABI. */
function memoryBoundary(source: ts.SourceFile): boolean {
  if (!source.fileName.replaceAll("\\", "/").endsWith("/src/native/memory.ts")) return false;
  const expected = ["interface TetoMemory", "export const loadU8", "export const loadU64",
    "export const atomicAddU64", "export const directMemory", "export const wasmMemory"];
  return expected.every(part => source.text.includes(part));
}

function lowerMemoryBoundary(source: ts.SourceFile): NativeClangResult {
  const output = ts.createSourceFile(source.fileName, NATIVE_MEMORY_SOURCE, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  return { sourceFile: output, diagnostics: [], intrinsics: [
    "memory:little-endian-checked", "memory:memmove", "memory:atomic-i32-u64",
    "memory:platform-region", "memory:trap"
  ] };
}

function isBitcastWordModule(source: ts.SourceFile): boolean {
  if (!source.fileName.replaceAll("\\", "/").endsWith("/src/native/word.ts")) return false;
  return source.text.includes("const floatBuffer = new ArrayBuffer(8);") &&
    source.text.includes("const floatView = new DataView(floatBuffer);") &&
    BITCAST_INTRINSICS.every(([name]) => source.text.includes(\`export const \${name}\`));
}

function lowerFloatBitcasts(source: ts.SourceFile): NativeClangResult {
  const factory = ts.factory;
  const replacements = new Map<string, string>(BITCAST_INTRINSICS.map(([name, intrinsic]) => [name, intrinsic]));
  const removed = new Set(["floatBuffer", "floatView"]);
  const output: ts.Statement[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
      output.push(statement);
      continue;
    }
    const declaration = statement.declarationList.declarations[0]!;
    if (!ts.isIdentifier(declaration.name)) {
      output.push(statement);
      continue;
    }
    const name = declaration.name.text;
    if (removed.has(name)) continue;
    const intrinsic = replacements.get(name);
    if (!intrinsic) {
      output.push(statement);
      continue;
    }
    const original = declaration.initializer;
    if (!original || !ts.isArrowFunction(original) || original.parameters.length !== 1 ||
        !ts.isIdentifier(original.parameters[0]!.name)) {
      throw new Error(\`Unexpected float bitcast implementation \${name}\`);
    }
    const rewritten = factory.updateArrowFunction(
      original, original.modifiers, original.typeParameters, original.parameters,
      original.type, original.equalsGreaterThanToken,
      factory.createCallExpression(factory.createIdentifier(intrinsic), undefined,
        [factory.createIdentifier(original.parameters[0]!.name.text)])
    );
    output.push(factory.updateVariableStatement(
      statement, statement.modifiers,
      factory.updateVariableDeclarationList(statement.declarationList, [
        factory.updateVariableDeclaration(
          declaration, declaration.name, declaration.exclamationToken,
          declaration.type, rewritten
        )
      ])
    ));
  }
  const prototypes = ts.createSourceFile(source.fileName,
    BITCAST_INTRINSICS.map(([, , signature]) => signature).join("\n") + "\n",
    ts.ScriptTarget.ES2022, true);
  const transformed = factory.updateSourceFile(source, [...prototypes.statements, ...output]);
  return {
    sourceFile: transformed,
    diagnostics: [],
    intrinsics: BITCAST_INTRINSICS.map(([, intrinsic]) => intrinsic)
  };
}

function builtinIntrinsic(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expression)) {
    if (expression.text === "BigInt") return "__bake_c_bigint";
    if (expression.text === "Number") return "__bake_c_number";
    return undefined;
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return BUILTIN_METHODS[\`\${expression.expression.text}.\${expression.name.text}\`];
  }
  return undefined;
}

function nativeNumericCalls(source: ts.SourceFile): NativeClangResult {
  const factory = ts.factory;
  const intrinsics = new Set<string>();
  const visitorFactory: ts.TransformerFactory<ts.SourceFile> = context => {
    const visit: ts.Visitor = node => {
      if (ts.isCallExpression(node)) {
        const intrinsic = builtinIntrinsic(node.expression);
        if (intrinsic) {
          intrinsics.add(intrinsic);
          return factory.updateCallExpression(node, factory.createIdentifier(intrinsic),
            node.typeArguments, node.arguments.map(argument => ts.visitNode(argument, visit) as ts.Expression));
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return file => ts.visitNode(file, visit) as ts.SourceFile;
  };
  const result = ts.transform(source, [visitorFactory]);
  const transformed = result.transformed[0] as ts.SourceFile;
  if (!intrinsics.size) {
    result.dispose();
    return { sourceFile: transformed, diagnostics: [], intrinsics: [] };
  }
  const prelude = [...intrinsics].map(name => {
    const signature = NATIVE_NUMERIC_INTRINSICS[name];
    if (!signature) throw new Error(\`No C intrinsic contract for \${name}\`);
    return signature;
  }).join("\n") + "\n";
  const header = ts.createSourceFile(source.fileName, prelude, ts.ScriptTarget.ES2022, true);
  const compiled = factory.updateSourceFile(transformed, [...header.statements, ...transformed.statements]);
  result.dispose();
  return { sourceFile: compiled, diagnostics: [], intrinsics: [...intrinsics].sort() };
}

/**
 * Transform JS-host-specific primitives into a closed C-compatible call ABI.
 * No C code is emitted here; implementation belongs to a future C backend.
 */
export function lowerNativeClang(source: ts.SourceFile): NativeClangResult {
  const boundary = memoryBoundary(source) ? lowerMemoryBoundary(source)
    : isBitcastWordModule(source) ? lowerFloatBitcasts(source)
    : { sourceFile: source, diagnostics: [], intrinsics: [] };
  const native = nativeNumericCalls(boundary.sourceFile);
  return {
    sourceFile: native.sourceFile,
    diagnostics: [...boundary.diagnostics, ...native.diagnostics],
    intrinsics: [...new Set([...boundary.intrinsics, ...native.intrinsics])].sort()
  };
}
