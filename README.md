# Bake

**Bake pre-compiles TypeScript into the deterministic subset accepted by Baguette. It bakes the Baguette.**

Bake is a source-to-source compatibility frontend. It does not execute the programme and never introduces a JavaScript runtime, interpreter, virtual machine or bytecode layer into generated programmes.

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

## Self-hosted core

Bake has a dependency-free policy core designed to bake itself and then compile through Baguette:

```text
hosted Stage 0 Bake
    ↓ bakes tsconfig.core.json
Baguette-compatible Stage 1 Bake core
    ↓ Baguette
bake-core.wasm
    ↓
default Bake decision engine
```

The hosted frontend still loads and type-checks TypeScript projects. Compatibility policy and lowering eligibility run through one stable core ABI. Before bootstrap that policy runs as TypeScript; afterwards `--engine auto` loads the Baguette-compiled WebAssembly core by default.

This is compile-time tooling. `bake-core.wasm` is not embedded into applications produced by Bake or Baguette.

## Status

Bake 0.2 development targets Baguette 0.2.6.

It currently:

- rejects explicit and inferred `any`;
- rejects unresolved `unknown` and proposes a reviewable interface or union from static guards and property use;
- mirrors Baguette's diagnostics for dynamic imports, external runtime imports, generators, unsupported async closures and JavaScript-host globals;
- passes Baguette-supported syntax through unchanged when no Bake lowering is required, including `try` and `throw`;
- lowers simple object and array destructuring;
- lowers array and tuple `for...of` loops to indexed loops;
- lowers side-effect-free nullish coalescing with linear output growth;
- writes a machine-readable JSON report;
- refuses transformations whose semantics cannot yet be preserved;
- can bake its dependency-free core into a Baguette input tree;
- can use the resulting Baguette-compiled Wasm core through the normal `bake` command.

Bake does not silently accept an inferred shape. A proposed type is advice for the developer to review and add to the source.

## Install and build

```bash
npm install
npm run build
```

The Git repository contains TypeScript source only. `dist/`, `dist-test/`, `build/` and `dist-wasm/` are generated locally and ignored by Git.

## Bootstrap the Wasm core

Clone Baguette beside Bake:

```text
nodeapps/
├── baguette/
└── bake/
```

Install both projects, then run:

```bash
cd ../baguette
npm install

cd ../bake
npm install
npm run bootstrap
```

A different Baguette checkout can be selected with:

```bash
BAGUETTE_COMPILER=/path/to/baguette/src/compiler.ts npm run bootstrap
```

The bootstrap command:

1. uses the hosted core to bake `tsconfig.core.json`;
2. writes the Stage 1 source tree under `build/self-host/`;
3. invokes Baguette with `baguette.config.json`;
4. writes `dist-wasm/bake-core.wasm`;
5. compares representative hosted and Wasm core decisions.

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

Engine selection:

```bash
bake --engine auto --project tsconfig.json --validate-only
bake --engine wasm --project tsconfig.json --validate-only
bake --engine host --project tsconfig.json --validate-only
```

`auto` prefers `dist-wasm/bake-core.wasm` and falls back to the hosted core if the Wasm artefact has not been built. `wasm` fails rather than falling back, which is useful for conformance testing.

Treat warnings as failures:

```bash
bake --project tsconfig.json --fail-on-warnings
```

When Bake succeeds, point Baguette at the emitted source tree. Baguette remains the final authority on whether the programme belongs to its supported subset.

## Test

```bash
npm test
```

Run the complete bootstrap and then require the Wasm core for the test suite:

```bash
npm run test:self-host
```

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

1. Compile-time complexity is acceptable. An execution layer in generated programmes is not.
2. Every automatic rewrite must preserve observable semantics.
3. Bake may suggest a type, but never silently invent one.
4. `any` is always an error.
5. Baguette owns the native language contract and remains the final validator.
6. Baguette-supported constructs are passed through when Bake has no safe or necessary lowering.
7. Hosted and Wasm core decisions must remain bit-for-bit equivalent.

See [Architecture](docs/architecture.md) and [Target contract](docs/target-contract.md).
