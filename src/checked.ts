/** Reject an unexpected missing AST node instead of assuming it exists. */
export function required<T>(value: T): NonNullable<T> {
  if (value == null) throw new Error("Missing required Bake AST node");
  return value;
}
