# Architecture

Bake is a whole-program TypeScript compatibility frontend for Baguette.

## Pipeline

1. Load and type-check the selected TypeScript project.
2. Analyse source against the Baguette target contract.
3. Infer reviewable candidate shapes for unresolved `unknown` entry values.
4. Apply only semantics-preserving source transformations.
5. Emit a parallel TypeScript source tree and diagnostic report.
6. Hand the emitted tree to Baguette for authoritative validation and AOT WebAssembly compilation.

## No runtime rule

Bake-generated output is ordinary TypeScript source. Bake does not add a VM, interpreter, bytecode engine, JavaScript object model or dynamic type representation. Generated helper functions and state structures are allowed only when they compile as normal native programme code.

## Planned lowering passes

- generator to explicit iterator state machine;
- typed exception propagation to whole-program result unions;
- finite dynamic-import specialisation;
- closure capture materialisation;
- array helper expansion;
- optional-chain lowering with single-evaluation temporaries;
- discriminated-union reconstruction from `unknown` guards;
- direct invocation of Baguette `--validate-only` after emission.
