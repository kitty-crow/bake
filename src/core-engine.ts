import fs from "node:fs";
import path from "node:path";
import {
  BAKE_CORE_ABI_VERSION,
  decideBakeFact
} from "./core/protocol";

export type BakeEngineMode = "auto" | "host" | "wasm";
export type BakeEngineImplementation = "host" | "wasm";

export interface BakeCoreEngine {
  readonly implementation: BakeEngineImplementation;
  readonly version: number;
  decide(kind: number, flags: number, auxiliary0: number, auxiliary1: number): number;
}

type BakeWasmExports = WebAssembly.Exports & {
  bakeCoreVersion(): number;
  bakeDecideFact(kind: number, flags: number, auxiliary0: number, auxiliary1: number): number;
};

class HostedBakeCore implements BakeCoreEngine {
  readonly implementation = "host" as const;
  readonly version = BAKE_CORE_ABI_VERSION;

  decide(kind: number, flags: number, auxiliary0: number, auxiliary1: number): number {
    return decideBakeFact(kind >>> 0, flags >>> 0, auxiliary0 >>> 0, auxiliary1 >>> 0) >>> 0;
  }
}

class WasmBakeCore implements BakeCoreEngine {
  readonly implementation = "wasm" as const;
  readonly version: number;
  private readonly exports: BakeWasmExports;

  constructor(file: string) {
    const bytes = fs.readFileSync(file);
    const module = new WebAssembly.Module(bytes);
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024 });
    const instance = new WebAssembly.Instance(module, { env: { memory } });
    this.exports = instance.exports as BakeWasmExports;
    this.version = this.exports.bakeCoreVersion() >>> 0;
    if (this.version !== BAKE_CORE_ABI_VERSION) {
      throw new Error(`Bake core ABI ${this.version} does not match host ABI ${BAKE_CORE_ABI_VERSION}`);
    }
  }

  decide(kind: number, flags: number, auxiliary0: number, auxiliary1: number): number {
    return this.exports.bakeDecideFact(
      kind >>> 0,
      flags >>> 0,
      auxiliary0 >>> 0,
      auxiliary1 >>> 0
    ) >>> 0;
  }
}

export function defaultBakeWasmPath(): string {
  const configured = process.env.BAKE_WASM;
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, "../dist-wasm/bake-core.wasm");
}

export function createBakeCoreEngine(mode: BakeEngineMode = "auto", wasmFile?: string): BakeCoreEngine {
  if (mode === "host") return new HostedBakeCore();

  const file = path.resolve(wasmFile ?? defaultBakeWasmPath());
  if (!fs.existsSync(file)) {
    if (mode === "auto") return new HostedBakeCore();
    throw new Error(`Bake Wasm core was requested but ${file} does not exist. Run npm run bootstrap first.`);
  }

  try {
    return new WasmBakeCore(file);
  } catch (error) {
    if (mode === "auto") return new HostedBakeCore();
    throw error;
  }
}
