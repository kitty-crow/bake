# Native frontend

`analyseClangSourceFile(root, source, checker)` returns diagnostics for constructs without a freestanding native representation. `lowerClangSourceFile(source, checker)` materialises inferred local types, removes non-null assertion syntax and hoists supported top-level function bindings. It returns a BakeFileResult containing the new AST and a changed flag.
