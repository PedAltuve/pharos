import { normalize } from "./normalize.js";
import type { SemanticProjection, SemanticSource } from "./types.js";

/**
 * The allowlist — the only place exclusion lives. Every field on
 * `SemanticProjection` comes from `normalize()`; nothing else on `source`
 * (identities, local address/title, schema version, approval metadata,
 * artifact refs, secret contents, runtime-resolved values, setup
 * mechanics, readiness-validation results) reaches the result.
 */
export function project(source: SemanticSource): SemanticProjection {
  return normalize(source);
}
