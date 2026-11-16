import ts from "typescript";
import { diagnosticAt } from "./diagnostics";
import type { BakeDiagnostic } from "./types";

/**
 * TypeScript-to-freestanding-C frontend. These symbols describe native
 * operations; Bake never ships a JavaScript runtime with generated output.
 * All original Thistle control flow remains in the lowered source.
 */
const INTRINSICS: Readonly<Record<string, string>> = {
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
  "__bake_c_i32_mul": "declare function __bake_c_i32_mul(left: number, right: number): number;",
  "__bake_c_new_buffer": "declare function __bake_c_new_buffer(size: number): __bake_c_Buffer;",
  "__bake_c_new_shared_buffer": "declare function __bake_c_new_shared_buffer(size: number): __bake_c_Buffer;",
  "__bake_c_new_view": "declare function __bake_c_new_view(buffer: __bake_c_Buffer): __bake_c_View;",
  "__bake_c_new_u8_array": "declare function __bake_c_new_u8_array(buffer: __bake_c_Buffer): __bake_c_U8Array;",
  "__bake_c_new_i32_array": "declare function __bake_c_new_i32_array(buffer: __bake_c_Buffer): __bake_c_I32Array;",
  "__bake_c_new_u64_array": "declare function __bake_c_new_u64_array(buffer: __bake_c_Buffer): __bake_c_U64Array;",
  "__bake_c_u8_get": "declare function __bake_c_u8_get(array: __bake_c_U8Array, at: number): number;",
  "__bake_c_u8_set": "declare function __bake_c_u8_set(array: __bake_c_U8Array, at: number, value: number): number;",
  "__bake_c_i32_get": "declare function __bake_c_i32_get(array: __bake_c_I32Array, at: number): number;",
  "__bake_c_i32_set": "declare function __bake_c_i32_set(array: __bake_c_I32Array, at: number, value: number): number;",
  "__bake_c_u64_get": "declare function __bake_c_u64_get(array: __bake_c_U64Array, at: number): bigint;",
  "__bake_c_u64_set": "declare function __bake_c_u64_set(array: __bake_c_U64Array, at: number, value: bigint): bigint;",
  "__bake_c_u8_fill": "declare function __bake_c_u8_fill(array: __bake_c_U8Array, value: number, start?: number, end?: number): __bake_c_U8Array;",
  "__bake_c_u8_copy_within": "declare function __bake_c_u8_copy_within(array: __bake_c_U8Array, target: number, start: number, end?: number): __bake_c_U8Array;",
  "__bake_c_abort_range": "declare function __bake_c_abort_range(): never;",
  "__bake_c_view_get_u16": "declare function __bake_c_view_get_u16(view: __bake_c_View, at: number, littleEndian?: boolean): number;",
  "__bake_c_view_get_i16": "declare function __bake_c_view_get_i16(view: __bake_c_View, at: number, littleEndian?: boolean): number;",
  "__bake_c_view_get_u32": "declare function __bake_c_view_get_u32(view: __bake_c_View, at: number, littleEndian?: boolean): number;",
  "__bake_c_view_get_i32": "declare function __bake_c_view_get_i32(view: __bake_c_View, at: number, littleEndian?: boolean): number;",
  "__bake_c_view_get_u64": "declare function __bake_c_view_get_u64(view: __bake_c_View, at: number, littleEndian?: boolean): bigint;",
  "__bake_c_view_get_i64": "declare function __bake_c_view_get_i64(view: __bake_c_View, at: number, littleEndian?: boolean): bigint;",
  "__bake_c_view_get_f32": "declare function __bake_c_view_get_f32(view: __bake_c_View, at: number, littleEndian?: boolean): number;",
  "__bake_c_view_get_f64": "declare function __bake_c_view_get_f64(view: __bake_c_View, at: number, littleEndian?: boolean): number;",
  "__bake_c_view_set_u16": "declare function __bake_c_view_set_u16(view: __bake_c_View, at: number, value: number, littleEndian?: boolean): void;",
  "__bake_c_view_set_i16": "declare function __bake_c_view_set_i16(view: __bake_c_View, at: number, value: number, littleEndian?: boolean): void;",
  "__bake_c_view_set_u32": "declare function __bake_c_view_set_u32(view: __bake_c_View, at: number, value: number, littleEndian?: boolean): void;",
  "__bake_c_view_set_i32": "declare function __bake_c_view_set_i32(view: __bake_c_View, at: number, value: number, littleEndian?: boolean): void;",
  "__bake_c_view_set_u64": "declare function __bake_c_view_set_u64(view: __bake_c_View, at: number, value: bigint, littleEndian?: boolean): void;",
  "__bake_c_view_set_i64": "declare function __bake_c_view_set_i64(view: __bake_c_View, at: number, value: bigint, littleEndian?: boolean): void;",
  "__bake_c_view_set_f32": "declare function __bake_c_view_set_f32(view: __bake_c_View, at: number, value: number, littleEndian?: boolean): void;",
  "__bake_c_view_set_f64": "declare function __bake_c_view_set_f64(view: __bake_c_View, at: number, value: number, littleEndian?: boolean): void;",
  "__bake_c_atomic_cmpxchg_i32": "declare function __bake_c_atomic_cmpxchg_i32(array: __bake_c_I32Array, at: number, expected: number, replacement: number): number;",
  "__bake_c_atomic_add_i32": "declare function __bake_c_atomic_add_i32(array: __bake_c_I32Array, at: number, value: number): number;",
  "__bake_c_atomic_load_i32": "declare function __bake_c_atomic_load_i32(array: __bake_c_I32Array, at: number): number;",
  "__bake_c_atomic_store_i32": "declare function __bake_c_atomic_store_i32(array: __bake_c_I32Array, at: number, value: number): number;",
  "__bake_c_atomic_add_u64": "declare function __bake_c_atomic_add_u64(array: __bake_c_U64Array, at: number, value: bigint): bigint;",
  "__bake_c_atomic_load_u64": "declare function __bake_c_atomic_load_u64(array: __bake_c_U64Array, at: number): bigint;",
  "__bake_c_atomic_store_u64": "declare function __bake_c_atomic_store_u64(array: __bake_c_U64Array, at: number, value: bigint): bigint;"
};

const TYPE_DECLARATIONS = String.raw`
interface __bake_c_Buffer { readonly byteLength: number; }
interface __bake_c_View { readonly buffer: __bake_c_Buffer; }
interface __bake_c_ExternalMemory { readonly buffer: __bake_c_Buffer; }
interface __bake_c_U8Array {
  readonly buffer: __bake_c_Buffer;
  readonly length: number;
  [index: number]: number;
}
interface __bake_c_I32Array {
  readonly buffer: __bake_c_Buffer;
  readonly length: number;
  [index: number]: number;
}
interface __bake_c_U64Array {
  readonly buffer: __bake_c_Buffer;
  readonly length: number;
  [index: number]: bigint;
}
`;

const TYPES: Readonly<Record<string, string>> = {
  "ArrayBuffer": "__bake_c_Buffer",
  "ArrayBufferLike": "__bake_c_Buffer",
  "SharedArrayBuffer": "__bake_c_Buffer",
  "DataView": "__bake_c_View",
  "Uint8Array": "__bake_c_U8Array",
  "Int32Array": "__bake_c_I32Array",
  "BigUint64Array": "__bake_c_U64Array"
};

const CONSTRUCTORS: Readonly<Record<string, string>> = {
  "ArrayBuffer": "__bake_c_new_buffer",
  "SharedArrayBuffer": "__bake_c_new_shared_buffer",
  "DataView": "__bake_c_new_view",
  "Uint8Array": "__bake_c_new_u8_array",
  "Int32Array": "__bake_c_new_i32_array",
  "BigUint64Array": "__bake_c_new_u64_array"
};

const METHODS: Readonly<Record<string, string>> = {
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

const VIEW_METHODS: Readonly<Record<string, string>> = {
  getUint16: "__bake_c_view_get_u16",
  getInt16: "__bake_c_view_get_i16",
  getUint32: "__bake_c_view_get_u32",
  getInt32: "__bake_c_view_get_i32",
  getBigUint64: "__bake_c_view_get_u64",
  getBigInt64: "__bake_c_view_get_i64",
  getFloat32: "__bake_c_view_get_f32",
  getFloat64: "__bake_c_view_get_f64",
  setUint16: "__bake_c_view_set_u16",
  setInt16: "__bake_c_view_set_i16",
  setUint32: "__bake_c_view_set_u32",
  setInt32: "__bake_c_view_set_i32",
  setBigUint64: "__bake_c_view_set_u64",
  setBigInt64: "__bake_c_view_set_i64",
  setFloat32: "__bake_c_view_set_f32",
  setFloat64: "__bake_c_view_set_f64"
};

const ATOMICS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  i32: {
    compareExchange: "__bake_c_atomic_cmpxchg_i32",
    add: "__bake_c_atomic_add_i32",
    load: "__bake_c_atomic_load_i32",
    store: "__bake_c_atomic_store_i32"
  },
  u64: {
    add: "__bake_c_atomic_add_u64",
    load: "__bake_c_atomic_load_u64",
    store: "__bake_c_atomic_store_u64"
  }
};

export interface NativeClangResult {
  readonly sourceFile: ts.SourceFile;
  readonly diagnostics: readonly BakeDiagnostic[];
  readonly intrinsics: readonly string[];
}

function checkedType(expression: ts.Expression, checker: ts.TypeChecker): string {
  const original = ts.getOriginalNode(expression) as ts.Expression;
  const type = checker.getTypeAtLocation(original);
  return checker.typeToString(type, original, ts.TypeFormatFlags.NoTruncation);
}

function typeMatches(expression: ts.Expression, checker: ts.TypeChecker, type: string): boolean {
  const checked = checkedType(expression, checker);
  return checked === type || checked.startsWith(type + "<");
}

function inlineSource(source: ts.SourceFile, declarations: string): ts.Statement[] {
  return [...ts.createSourceFile(source.fileName, declarations, ts.ScriptTarget.ES2022, true).statements];
}

/**
 * Lower native constructs in place instead of cloning/reimplementing kernel
 * modules. The original control flow, bounds checks, and atomic branches
 * remain canonical in Thistle.
 */
export function lowerNativeClang(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  root: string
): NativeClangResult {
  const factory = ts.factory;
  const diagnostics: BakeDiagnostic[] = [];
  const used = new Set<string>();
  let needsNativeTypes = false;

  const diagnostic = (node: ts.Node, message: string): void => {
    diagnostics.push(diagnosticAt(root, node, "BK4201", "error", "Cannot safely lower native operation: " + message,
      "Use a statically typed operation covered by the Clang intrinsic contract."));
  };
  const call = (name: string, args: readonly ts.Expression[]): ts.Expression => {
    used.add(name);
    return factory.createCallExpression(factory.createIdentifier(name), undefined, args);
  };

  const arrayKind = (expression: ts.Expression): string | undefined => {
    if (typeMatches(expression, checker, "Uint8Array")) return "u8";
    if (typeMatches(expression, checker, "Int32Array")) return "i32";
    if (typeMatches(expression, checker, "BigUint64Array")) return "u64";
    return undefined;
  };

  const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
    const visit: ts.Visitor = node => {
      if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isElementAccessExpression(node.left) && node.left.argumentExpression) {
        const kind = arrayKind(node.left.expression);
        if (kind) {
          needsNativeTypes = true;
          return call("__bake_c_" + kind + "_set", [
            ts.visitNode(node.left.expression, visit) as ts.Expression,
            ts.visitNode(node.left.argumentExpression, visit) as ts.Expression,
            ts.visitNode(node.right, visit) as ts.Expression
          ]);
        }
      }
      if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        const kind = arrayKind(node.expression);
        if (kind) {
          needsNativeTypes = true;
          return call("__bake_c_" + kind + "_get", [
            ts.visitNode(node.expression, visit) as ts.Expression,
            ts.visitNode(node.argumentExpression, visit) as ts.Expression
          ]);
        }
      }
      if (ts.isThrowStatement(node) && node.expression &&
          ts.isNewExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "RangeError") {
        return factory.createExpressionStatement(call("__bake_c_abort_range", []));
      }
      if (ts.isTypeReferenceNode(node)) {
        const name = ts.isIdentifier(node.typeName) ? node.typeName.text : undefined;
        if (name && TYPES[name]) {
          needsNativeTypes = true;
          return factory.updateTypeReferenceNode(node, factory.createIdentifier(TYPES[name]!), undefined);
        }
        if (ts.isQualifiedName(node.typeName) &&
            ts.isIdentifier(node.typeName.left) &&
            node.typeName.left.text === "WebAssembly" &&
            node.typeName.right.text === "Memory") {
          needsNativeTypes = true;
          return factory.createTypeReferenceNode("__bake_c_ExternalMemory");
        }
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
        const native = CONSTRUCTORS[node.expression.text];
        if (native) {
          needsNativeTypes = true;
          return call(native, (node.arguments ?? []).map(x => ts.visitNode(x, visit) as ts.Expression));
        }
      }
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          const name = node.expression.text === "BigInt" ? "__bake_c_bigint"
            : node.expression.text === "Number" ? "__bake_c_number" : undefined;
          if (name) return call(name, node.arguments.map(x => ts.visitNode(x, visit) as ts.Expression));
        }
        if (ts.isPropertyAccessExpression(node.expression)) {
          const property = node.expression;
          const operand = property.expression;
          const method = property.name.text;
          if (ts.isIdentifier(operand)) {
            const methodName = METHODS[operand.text + "." + method];
            if (methodName) return call(methodName, node.arguments.map(x => ts.visitNode(x, visit) as ts.Expression));
            if (operand.text === "Atomics") {
              const argument = node.arguments[0];
              if (argument) {
                const isU64 = typeMatches(argument, checker, "BigUint64Array") ||
                  ts.isNewExpression(argument) && ts.isIdentifier(argument.expression) &&
                  argument.expression.text === "BigUint64Array";
                const isI32 = typeMatches(argument, checker, "Int32Array") ||
                  ts.isNewExpression(argument) && ts.isIdentifier(argument.expression) &&
                  argument.expression.text === "Int32Array";
                const target = ATOMICS[isU64 ? "u64" : isI32 ? "i32" : ""]?.[method];
                if (target) {
                  needsNativeTypes = true;
                  return call(target, node.arguments.map(x => ts.visitNode(x, visit) as ts.Expression));
                }
              }
              diagnostic(node, "unsupported atomic array or operation");
              return node;
            }
          }
          if (typeMatches(operand, checker, "DataView")) {
            const native = VIEW_METHODS[method];
            if (native) {
              needsNativeTypes = true;
              return call(native, [ts.visitNode(operand, visit) as ts.Expression,
                ...node.arguments.map(x => ts.visitNode(x, visit) as ts.Expression)]);
            }
            diagnostic(node, "unsupported DataView method " + method);
            return node;
          }
          if (typeMatches(operand, checker, "Uint8Array")) {
            const native = method === "fill" ? "__bake_c_u8_fill"
              : method === "copyWithin" ? "__bake_c_u8_copy_within" : undefined;
            if (native) {
              needsNativeTypes = true;
              return call(native, [ts.visitNode(operand, visit) as ts.Expression,
                ...node.arguments.map(x => ts.visitNode(x, visit) as ts.Expression)]);
            }
          }
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return file => ts.visitNode(file, visit) as ts.SourceFile;
  };

  const result = ts.transform(source, [transformer]);
  const lowered = result.transformed[0] as ts.SourceFile;
  const types = needsNativeTypes ? inlineSource(source, TYPE_DECLARATIONS) : [];
  const prelude = [...used].sort().map(name => {
    const declaration = INTRINSICS[name];
    if (!declaration) throw new Error("Missing C intrinsic declaration: " + name);
    return declaration;
  }).join("\n");
  const signatures = prelude ? inlineSource(source, prelude) : [];
  const rewritten = factory.updateSourceFile(lowered, [...types, ...signatures, ...lowered.statements]);
  result.dispose();
  return { sourceFile: rewritten, diagnostics, intrinsics: [...used].sort() };
}
