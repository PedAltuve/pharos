export type GeneratedIdKind = "project" | "capture" | "beacon" | "draft" | "request";

/** Produces opaque, typed-prefixed identifiers. Implementations provide UUIDv7 entropy. */
export interface IdGenerator {
  next(kind: GeneratedIdKind): string;
}
