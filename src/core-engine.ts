import {
  BAKE_CORE_ABI_VERSION,
  decideBakeFact
} from "./core/protocol";

export type BakeEngineMode = "auto" | "host" | "wasm";
export type BakeEngineImplementation = "host";

export interface BakeCoreEngine {
  readonly implementation: BakeEngineImplementation;
  readonly version: number;
  decide(kind: number, flags: number, auxiliary0: number, auxiliary1: number): number;
}

class HostedBakeCore implements BakeCoreEngine {
  readonly implementation = "host" as const;
  readonly version = BAKE_CORE_ABI_VERSION;

  decide(kind: number, flags: number, auxiliary0: number, auxiliary1: number): number {
    return decideBakeFact(kind >>> 0, flags >>> 0, auxiliary0 >>> 0, auxiliary1 >>> 0) >>> 0;
  }
}

export function createBakeCoreEngine(mode: BakeEngineMode = "auto", wasmFile: string | null = null): BakeCoreEngine {
  if (mode === "wasm" || wasmFile !== null) throw new Error("The self-hosted Wasm engine has been retired");
  return new HostedBakeCore();
}
