export function sum(values: number[], fallback: number | null): number {
  const [first, second] = values;
  let total = first ?? fallback ?? 0;
  for (const value of values) {
    total += value;
  }
  return total + second;
}
