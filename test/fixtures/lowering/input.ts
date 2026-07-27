export function sum(
  values: number[],
  first: number | null,
  fallback: number | null
): number {
  const [head, second] = values;
  let total = first ?? fallback ?? head ?? 0;
  for (const value of values) {
    total += value;
  }
  return total + second;
}
