import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LiteralSensitivityScanner } from "../../../src/adapters/sensitivity/literal-sensitivity-scanner.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
const canary = "encoded-canary-value";
let root = "";

afterEach(async () => {
  if (root !== "") await rm(root, { recursive: true, force: true });
  root = "";
});

async function stage(bytes: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pharos-sensitivity-"));
  const directory = join(root, "capture-staging", captureId);
  await writeFile(join(root, "placeholder"), "", "utf8");
  await mkdir(directory, { recursive: true });
  const artifact = join(directory, "recording.spec.ts");
  await writeFile(artifact, bytes, "utf8");
  return artifact;
}

function scan() {
  return new LiteralSensitivityScanner({ projectRoot: root }).scan({
    projectId,
    captureId,
    resolvedSecrets: new Map([["env:CAPTURE_TOKEN", canary]]),
  });
}

describe("LiteralSensitivityScanner", () => {
  it.each([canary, JSON.stringify(canary), encodeURIComponent(canary)])("rejects a staged literal representation without returning it", async (representation) => {
    await stage(`export const token = ${JSON.stringify(representation)};`);

    const result = await scan();

    expect(result).toEqual({ ok: false, error: { category: "detected", count: 1 } });
    expect(JSON.stringify(result)).not.toContain(canary);
  });

  it("rejects a secret escaped inside a JavaScript single-quoted literal without returning it", async () => {
    const secret = "don't\\ship";
    await stage("export const token = 'don\\'t\\\\ship';\n");

    const result = await new LiteralSensitivityScanner({ projectRoot: root }).scan({
      projectId,
      captureId,
      resolvedSecrets: new Map([["env:CAPTURE_TOKEN", secret]]),
    });

    expect(result).toEqual({ ok: false, error: { category: "detected", count: 1 } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects lowercase percent-encoded secret content without returning it", async () => {
    const secret = "keep/secret";
    await stage('export const token = "keep%2fsecret";\n');

    const result = await new LiteralSensitivityScanner({ projectRoot: root }).scan({
      projectId,
      captureId,
      resolvedSecrets: new Map([["env:CAPTURE_TOKEN", secret]]),
    });

    expect(result).toEqual({ ok: false, error: { category: "detected", count: 1 } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects backspace and form-feed escapes in a single-quoted JavaScript literal", async () => {
    const secret = "back\bform\feed";
    await stage("export const token = 'back\\bform\\feed';\n");

    const result = await new LiteralSensitivityScanner({ projectRoot: root }).scan({
      projectId,
      captureId,
      resolvedSecrets: new Map([["env:CAPTURE_TOKEN", secret]]),
    });

    expect(result).toEqual({ ok: false, error: { category: "detected", count: 1 } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("returns only stable digest metadata for a clean regular staged artifact", async () => {
    await stage("export const journey = 'safe';\n");

    await expect(scan()).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        reference: `captures/${captureId}/recording.spec.ts`,
        byteSize: 31,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
  });

  it("refuses a staged replacement and incomplete source values without exposing bytes", async () => {
    const artifact = await stage("safe");
    const replacement = new LiteralSensitivityScanner({
      projectRoot: root,
      async beforeOpen() { await rm(artifact); await writeFile(artifact, "changed"); },
    });

    await expect(replacement.scan({
      projectId,
      captureId,
      resolvedSecrets: new Map([["env:CAPTURE_TOKEN", canary]]),
    })).resolves.toEqual({ ok: false, error: { rule: "unsafe-artifact" } });
  });

  it("refuses incomplete source values and symlinked staged artifacts without exposing bytes", async () => {
    const artifact = await stage("safe");
    await rm(artifact);
    await symlink(join(root, "placeholder"), artifact);

    const symlinkResult = await scan();
    const shortResult = await new LiteralSensitivityScanner({ projectRoot: root }).scan({
      projectId,
      captureId,
      resolvedSecrets: new Map([["env:CAPTURE_TOKEN", "abc"]]),
    });

    expect(symlinkResult).toEqual({ ok: false, error: { rule: "unsafe-artifact" } });
    expect(shortResult).toEqual({ ok: false, error: { category: "incomplete", count: 0 } });
  });
});
