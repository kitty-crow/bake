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
