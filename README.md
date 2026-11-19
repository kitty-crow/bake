# Bake

Bake validates TypeScript and lowers supported constructs into typed source
for ahead-of-time compilation. Its outputs are TypeScript, diagnostics and a
build manifest.

## Build

Requires Bun 1.1 or later.

```sh
bun install --frozen-lockfile
bun run build
```

## Use

```sh
bun src/cli.ts --project tsconfig.json --out-dir build/bake \
  --report build/bake-report.json
```

| Target | Output contract | Consumer |
| --- | --- | --- |
| `wasm` (default) | TypeScript compatible with the WebAssembly subset | Baguette |
| `clang` | Freestanding lowered TypeScript, native intrinsic ABI | Croissant |
| `rust` | Freestanding lowered TypeScript, native intrinsic ABI | Crust |

The selected backend validates and compiles Bake's output. Bake does not emit
machine code or add a JavaScript runtime.

```sh
bun src/cli.ts --project tsconfig.json --target=clang --out-dir build/native
bun src/cli.ts --project tsconfig.json --target=rust --out-dir build/rust
bun src/cli.ts --project tsconfig.json --validate-only --fail-on-warnings
```

Supported rewrites include simple destructuring, array and tuple iteration
and side-effect-free nullish coalescing. Explicit or inferred `any`,
unresolved dynamic types and unsupported target operations produce errors.
Suggestions for unresolved `unknown` types require review by the caller.
See [target contracts](docs/target-contract.md) for target-specific rules.

## Policy engine

Bake uses its TypeScript policy engine directly through Bun. The former
self-hosted Wasm engine is retired. Legacy engine options auto and host remain
accepted for compatibility; wasm engine requests are rejected. The wasm output
target remains supported.

## Test

`bun run guards` runs every Code Guards rule in strict mode, including tests and documentation. Any finding stops `bun run build`.

```sh
bun run test
```

## Documentation

[Module reference](docs/index.md)

- [Architecture](docs/architecture.md)
- [Target contracts](docs/target-contract.md)
- [Native intrinsic ABI](docs/clang-intrinsics.md)

## Licence

[MIT](LICENSE).

## Source distribution

The versioned release contains the pinned KITTYX source at `kittyx/` and Bun lockfile. Thistle is a release-pinned validation fixture for the native lowering checks, not a runtime dependency. No JavaScript transpilation is required.
