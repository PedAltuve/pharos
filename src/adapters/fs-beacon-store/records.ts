/**
 * Builds records without assigning directory names through an object literal.
 * Map plus Object.fromEntries keeps `__proto__` an ordinary own key.
 */
export function recordFromEntries<T>(
  entries: Iterable<readonly [string, T]>,
): Readonly<Record<string, T>> {
  const values = new Map<string, T>();
  for (const [key, value] of entries) {
    values.set(key, value);
  }
  return Object.fromEntries(values);
}

/** Adapter-local mirror of the domain record lookup guard. */
export function getOwn<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
