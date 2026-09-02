import type { JsonValue } from "./json-value.js";

export interface Hasher {
  hash(value: JsonValue): string;
}
