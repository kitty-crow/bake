# AST construction

`initialisedVariable(name, value, annotation)` makes a variable declaration with an initialiser and a nullable type annotation. `NamedFunctionParts` supplies the name, modifiers, generic and formal parameters, return type and body to `namedFunction`.

Both use grammar templates and the TypeScript visitor to insert the original child nodes. The resulting AST retains the child identities needed for later type analysis. Absent optional syntax is handled by the TypeScript visitor rather than by untyped values in the compiler.
