# Bake

**Bake pre-compiles TypeScript into the deterministic subset accepted by Baguette. It bakes the Baguette.**

Bake is a source-to-source compatibility frontend. It does not execute the programme and never introduces a JavaScript runtime, interpreter, virtual machine or bytecode layer.

```text
TypeScript
    ↓
Bake semantic analysis and safe lowering
    ↓
Baguette-compatible TypeScript
    ↓
Baguette AOT compilation
    ↓
WebAssembly
```

## Status

Bake 0.1 is an intentionally strict MVP targeting Baguette 0.2.6.

It currently:

- rejects explicit and inferred `any`;
- rejects unresolved `unknown` and proposes a reviewable interface or union from static guards and property use;
- mirrors Baguette's diagnostics for dynamic imports, external runtime imports, generators, exceptions, unsupported async closures and JavaScript-host globals;
- lowers simple object and array destructuring;
- lowers array and tuple `for...of` loops to indexed loops;
- lowers side-effect-free nullish coalescing to explicit native control flow;
- writes a machine-readable JSON report;
- refuses transformations whose semantics cannot yet be preserved.

Bake does not silently accept an inferred shape. A proposed type is advice for the developer to review and add to the source.

## Install and build

```bash
npm install
npm run build
```

## Use

```bash
bake \
  --project tsconfig.json \
  --out-dir build/bake \
  --report build/bake-report.json
```

Validation without output:

```bash
bake --project tsconfig.json --validate-only
```

Treat warnings as failures:

```bash
bake --project tsconfig.json --fail-on-warnings
```

When Bake succeeds, point Baguette at the emitted source tree. Baguette remains the final authority on whether the programme belongs to its supported subset.

## Example diagnostic

```text
src/parser.ts:4:30: ERROR BK1002: `unknown` remains unresolved at the Bake to Baguette boundary.
  hint: Review the inferred shape and replace `unknown` with an explicit native type.
  suggestion: The parameter appears compatible with BakeInferred_parse_value
    interface BakeInferred_parse_value {
      id: number;
      kind: "point";
    }

    // Consider changing value: unknown to:
    value: BakeInferred_parse_value
  confidence: medium
```

## Design rules

1. Compile-time complexity is acceptable. An execution layer is not.
2. Every automatic rewrite must preserve observable semantics.
3. Bake may suggest a type, but never silently invent one.
4. `any` is always an error.
5. Baguette owns the native language contract and remains the final validator.
6. Features without a safe lowering are reported with a concrete migration path.

See [Architecture](docs/architecture.md) and [Target contract](docs/target-contract.md).
