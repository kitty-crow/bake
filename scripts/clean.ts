import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = process.argv.includes("--bootstrap")
  ? ["build/self-host", "build/baguette-generated", "dist-wasm"]
  : ["dist", "dist-test"];

for (const relative of paths) {
  rmSync(path.join(repositoryRoot, relative), { recursive: true, force: true });
}
