# Unknown type evidence

`inferUnknownParameter(parameter, checker)` returns a proposed BakeSuggestion based on comparisons, property access and Array.isArray calls within the enclosing function.

| Evidence | Output |
| --- | --- |
| No supported use | undefined |
| Primitive comparisons | Literal or primitive union |
| Known property accesses | Proposed interface |
| Unresolved property types or array contents | Low confidence |
| AST changes | None |
