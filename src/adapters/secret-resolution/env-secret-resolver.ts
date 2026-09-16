import { err, ok } from "../../shared/result.js";
import type { ResolvedSecrets, SecretResolver } from "../../domain/ports/secret-resolver.js";

export interface EnvSecretResolverOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

const ENV_REFERENCE = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;

/** Resolves only declared environment names; values never leave the disposable result. */
export class EnvSecretResolver implements SecretResolver {
  private readonly environment: Readonly<Record<string, string | undefined>>;

  constructor(options: EnvSecretResolverOptions = {}) {
    this.environment = options.environment ?? process.env;
  }

  async resolve(references: readonly string[]) {
    const values = new Map<string, string>();
    for (const reference of references) {
      const match = ENV_REFERENCE.exec(reference);
      const name = match?.[1];
      const value = name === undefined ? undefined : this.environment[name];
      if (value === undefined) return err({ rule: "secret-source-unavailable" as const, reference });
      if (value.length === 0) return err({ rule: "secret-source-empty" as const, reference });
      values.set(reference, value);
    }
    const resolved: ResolvedSecrets = {
      values,
      dispose() { values.clear(); },
    };
    return ok(resolved);
  }
}
