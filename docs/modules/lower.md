# Structural lowering

`lowerSourceFile(root, source, checker, core, target)` returns a BakeFileResult. The policy selects safe nullish-coalescing, array/tuple iteration and destructuring rewrites. Non-repeatable operands are not duplicated for native code. The transformed AST retains source ownership and reports rejected transformations.
