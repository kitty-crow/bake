# Baguette target contract

Bake 0.2 targets the explicit validator behaviour of Baguette 0.2.6 at commit `1b7eb13644a7ed80f538a7dc37988654f24d7ce4`.

Bake reports these constructs before Baguette is invoked:

- explicit or inferred `any`;
- unresolved `unknown`;
- runtime-computed `import()`;
- unresolved external runtime modules;
- generators and `yield`;
- async closures outside Baguette's supported named forms;
- ambient JavaScript host facilities including `eval`, `Function`, `Proxy`, `Reflect`, browser globals, Node globals and Bun globals.

Syntax that Baguette already accepts is passed through unchanged when Bake does not need to lower it. This includes `try` and `throw`; Baguette remains responsible for their final native interpretation and validation.

The mirrored contract is diagnostic assistance, not a fork of Baguette's language definition. Baguette remains authoritative.

## Clang target (new, separate contract)

`bake --target=clang` runs the shared TypeScript checker and existing safe
lowerings before applying a C-oriented strict frontend. It produces typed
TypeScript, **not C**, and does not invoke Clang. No compiler backend or
hardware ABI is currently implied by the mode name. Only syntax for which
Bake has a proven static lowering is rewritten. Dynamic or unsafe features
are rejected with `BK4xxx`/ `BK410x` errors, rather than accepted
with JavaScript runtime dependencies or incorrect C semantics.

Do not import the Clang-specific diagnostics or transformations into the Wasm
policy core. Omitted `--target` and `--target=wasm` must yield byte-identical
source output for the same input, and preserve Baguette's manifest contract.
The host and Wasm Bake policy engines must continue to agree on every fact.
