# Source compatibility analysis

`analyseSourceFile(root, source, program, checker, core, target)` walks a TypeScript AST, queries the configured policy engine and returns diagnostics for incompatible types, imports and runtime operations. Repeated findings at the same location and code are deduplicated. This pass does not change source files.
