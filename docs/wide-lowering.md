# Wide lowering

Bake defaults to `safe` lowering. Existing projects therefore keep the same validation and output path.

`--lowering wide` enables four additional, deliberately narrow passes before Baguette validates the emitted programme:

- type-predicate guards with an `unknown` parameter become boolean functions with the predicate target as the parameter type;
- private class fields and methods become prefixed TypeScript-private members;
- pure property and element optional chains become null tests;
- `try/catch` without `finally` becomes an explicit numeric error path when throws are literal codes or literal messages.

The passes do not provide a JavaScript runtime. Dynamic JSON, HTTP, clocks, cryptography and other host facilities remain explicit WebAssembly capabilities. `any`, generators, dynamic imports and ambient runtime access remain errors.

Wide lowering is intended for controlled application cores with parity tests. Baguette remains authoritative: any construct left after Bake is accepted or rejected by Baguette exactly as before.
