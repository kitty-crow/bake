# Policy engine

The hosted TypeScript engine is the sole implementation.

- `BakeEngineMode` accepts auto and host for compatibility. The legacy wasm value is rejected at runtime.
- `BakeEngineImplementation` identifies the active implementation, always host.
- `createBakeCoreEngine(mode, wasmFile)` returns a hosted policy engine. Omit both arguments for normal use. Requests for the retired Wasm engine or a non-null Wasm engine file throw an error.
- `BakeCoreEngine` exposes the implementation, protocol version and four-word decide operation, which returns a packed policy decision.
