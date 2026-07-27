# Architecture

Bake is a whole-program TypeScript compatibility frontend for Baguette. Its bootstrap design separates TypeScript project discovery from the compatibility policy that can be compiled to WebAssembly.

## Runtime pipeline

1. The hosted frontend loads and type-checks the selected TypeScript project with the TypeScript compiler API.
2. It extracts source locations, type facts and candidate lowerings.
3. The Bake core decides whether each fact is accepted, rejected, warned about or lowered.
4. The hosted materialiser applies the core's decisions to the TypeScript AST and emits a parallel source tree.
5. Baguette performs authoritative validation and ahead-of-time WebAssembly compilation.

The default `auto` engine loads `dist-wasm/bake-core.wasm` when it exists. Before bootstrap, or when explicitly selected with `--engine host`, the same policy function runs directly as TypeScript. Both implementations use the same numeric ABI and must produce identical decisions.

## Bootstrap pipeline

```text
Stage 0 Bake running under Bun or Node
        |
        | bakes tsconfig.core.json
        v
Baguette-compatible Stage 1 TypeScript core
        |
        | Baguette AOT compilation
        v
bake-core.wasm
        |
        | selected by bake --engine auto
        v
Wasm-backed Bake command
```

Bake's complete handwritten source does not need to be accepted directly by Baguette. Stage 0 must be able to transform the dependency-free core into a Stage 1 source tree that Baguette accepts. Baguette then compiles that Stage 1 core into the implementation used by later Bake runs.

`src/core/protocol.ts` is the bootstrap root. It has no dependency on `typescript`, `node:*`, filesystem access, exceptions, dynamic imports or JavaScript host globals. `src/core/wasm-entry.ts` exposes the policy through numeric WebAssembly exports and a bulk shared-memory record interface.

## Trust boundary

The hosted frontend currently remains responsible for:

- project and module loading;
- TypeScript parsing and type checking;
- extracting typed facts from the TypeScript AST;
- materialising source edits;
- filesystem access and reports.

The self-baked core is authoritative for:

- compatibility decisions;
- diagnostic categories;
- safe-lowering eligibility;
- nullish-chain truncation policy;
- the stable host-to-Wasm decision ABI.

Moving parsing and edit materialisation into the core is a later stage. It is not required for the initial bootstrap because the generated Stage 1 core contains no hosted dependencies.

## Conformance rule

Every core fact used by Bake must produce the same packed decision from the hosted and Wasm implementations. `npm run bootstrap` compiles the core and compares representative decisions before accepting the Wasm artefact. CI then runs the complete Bake test suite once with the hosted core and once with `BAKE_ENGINE=wasm`.

## No runtime rule

Bake-generated output is ordinary TypeScript source. Bake does not add a VM, interpreter, bytecode engine, JavaScript object model or dynamic type representation. The Wasm module is Bake's own compile-time implementation, not a runtime shipped with programmes compiled by Baguette.

## Planned expansion

- batch all discovered facts through the shared-memory ABI rather than individual Wasm calls;
- move diagnostic text construction into a generated table shared by both engines;
- serialise a compact typed Bake IR so rewrite construction can move into Wasm;
- generator to explicit iterator state machine;
- typed exception propagation to whole-program result unions;
- finite dynamic-import specialisation;
- closure capture materialisation;
- array helper expansion;
- optional-chain lowering with single-evaluation temporaries;
- discriminated-union reconstruction from `unknown` guards.
