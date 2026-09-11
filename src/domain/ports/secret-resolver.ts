import type { Result } from "../../shared/result.js";

export interface ResolvedSecrets {
  readonly values: ReadonlyMap<string, string>;
  dispose(): void;
}
export interface SecretResolutionRefusal { readonly rule: "secret-source-unavailable" | "secret-source-empty"; readonly reference: string; }

/** Resolved values are transient and must be disposed after the operation. */
export interface SecretResolver {
  resolve(references: readonly string[]): Promise<Result<ResolvedSecrets, SecretResolutionRefusal>>;
}
