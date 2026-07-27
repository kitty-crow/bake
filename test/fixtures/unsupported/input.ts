export function* values(input: any) {
  try {
    yield input;
  } catch {
    throw input;
  }
}
