export function read(value: unknown): number {
  if (typeof value !== "object" || value === null) return -1;
  if (!("kind" in value) || value.kind !== "point") return -1;
  if (!("id" in value) || typeof value.id !== "number") return -1;
  return value.id;
}
