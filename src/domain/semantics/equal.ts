import type { SemanticProjection, SemanticValue } from "./types.js";

function deepEqual(a: SemanticValue, b: SemanticValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, b[index] as SemanticValue));
  }

  if (
    typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null
  ) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        deepEqual(
          (a as Record<string, SemanticValue>)[key] as SemanticValue,
          (b as Record<string, SemanticValue>)[key] as SemanticValue,
        ),
    );
  }

  return a === b;
}

export function projectionsEqual(
  a: SemanticProjection,
  b: SemanticProjection,
): boolean {
  return deepEqual(
    a as unknown as SemanticValue,
    b as unknown as SemanticValue,
  );
}

export function isMigrationEquivalent(
  source: SemanticProjection,
  target: SemanticProjection,
): boolean {
  return projectionsEqual(source, target);
}
