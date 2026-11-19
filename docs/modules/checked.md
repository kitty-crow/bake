# Checked AST access

`required<T>(value)` returns a defined value, preserving its concrete type. An undefined input throws before an invalid AST node can be passed to the compiler factory. It does not supply fallback nodes or reinterpret data.
