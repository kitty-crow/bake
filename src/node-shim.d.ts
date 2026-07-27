declare const __dirname: string;

declare const process: {
  argv: string[];
  cwd(): string;
  exitCode?: number;
  stdout: { write(value: string): void };
  stderr: { write(value: string): void };
};

declare module "node:fs" {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string, encoding?: "utf8"): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function relative(from: string, to: string): string;
  export function join(...paths: string[]): string;
  export function extname(path: string): string;
  export function basename(path: string, suffix?: string): string;
  export function parse(path: string): { root: string; dir: string; base: string; ext: string; name: string };
  export const sep: string;
}

declare module "node:test" {
  type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
  const test: TestFunction;
  export default test;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    match(actual: string, expected: RegExp, message?: string): void;
    ok(value: unknown, message?: string): void;
  };
  export default assert;
}
