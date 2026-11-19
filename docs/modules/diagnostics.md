# Diagnostics

`diagnosticAt(root, node, code, severity, message, ...details)` computes a one-based source line and column from an AST node. Paths use forward slashes. `formatDiagnostic(diagnostic)` produces text with nullable hints and replacement guidance, without writing to a stream.
