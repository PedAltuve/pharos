/**
 * Guards against `Object.prototype` keys ("toString", "constructor", …)
 * being read as domain records. Every caller-supplied-id lookup against a
 * `Beacon`-owned `Record` store MUST route here. Internal — not re-exported
 * by `src/domain/beacon/index.ts`.
 */
export function getOwn<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
