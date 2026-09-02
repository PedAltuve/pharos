import canonicalizeModule from "canonicalize";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { Hasher, JsonValue } from "../../domain/ports/index.js";

const canonicalize = canonicalizeModule as unknown as (
  input: JsonValue,
) => string | undefined;

export class JcsSha256Hasher implements Hasher {
  hash(value: JsonValue): string {
    const canonical = canonicalize(value);
    if (canonical === undefined) {
      throw new TypeError("Canonicalization failed for a JSON-safe value");
    }
    const bytes = Buffer.from(canonical, "utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    return `sha256:${digest}`;
  }
}
