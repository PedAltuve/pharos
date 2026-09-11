import { isAbsolute, join } from "node:path";
import { err, ok, type Result } from "../../shared/result.js";

export interface ResolvePharosHomeInput {
  readonly override?: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
}

export type PharosHomeResolution = Result<
  string,
  { readonly rule: "invalid-pharos-home" } | { readonly rule: "unsupported-platform" }
>;

function absoluteHome(value: string | undefined): PharosHomeResolution | undefined {
  if (value === undefined) return undefined;
  return isAbsolute(value)
    ? ok(value)
    : err({ rule: "invalid-pharos-home" });
}

/** Resolve only explicit absolute overrides or documented platform defaults. */
export function resolvePharosHome(input: ResolvePharosHomeInput): PharosHomeResolution {
  const explicit = absoluteHome(input.override);
  if (explicit !== undefined) return explicit;

  const configured = absoluteHome(input.environment.PHAROS_HOME);
  if (configured !== undefined) return configured;

  if (input.platform === "linux") {
    const xdg = absoluteHome(input.environment.XDG_DATA_HOME);
    if (xdg !== undefined) return xdg.ok ? ok(join(xdg.value, "pharos")) : xdg;
    return ok(join(input.homeDirectory, ".local", "share", "pharos"));
  }
  if (input.platform === "darwin") {
    return ok(join(input.homeDirectory, "Library", "Application Support", "pharos"));
  }
  return err({ rule: "unsupported-platform" });
}
