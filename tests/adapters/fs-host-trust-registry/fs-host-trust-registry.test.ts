import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, chmod, symlink, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FsHostTrustRegistry } from "../../../src/adapters/fs-host-trust-registry/index.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pharos-trust-")); roots.push(root);
  return { root, registry: new FsHostTrustRegistry(root) };
}
function key() { return generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }); }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("persists only public SPKI; exact registration replays, different keys never replace", async () => {
  const { root, registry } = await fixture(); const first = key(); const second = key();
  await registry.register("host_1", "key_1", first.toString("base64"));
  await registry.register("host_1", "key_1", first.toString("base64"));
  await expect(registry.register("host_1", "key_1", second.toString("base64"))).rejects.toThrow("Host trust refused");
  expect(await new FsHostTrustRegistry(root).activeHostKey("host_1", "key_1")).toEqual(first);
  expect(await registry.activeHostKey("host_1", "other")).toBeUndefined();
  const record = await readFile(join(root, "host-trust", "host_1.json"), "utf8");
  expect(record).not.toContain("PRIVATE KEY");
});

it("serializes CAS rotation, retires old keys, and revocation survives restart", async () => {
  const { root, registry } = await fixture(); const first = key(); const next = key();
  await registry.register("host_1", "key_1", first.toString("base64"));
  const command = { hostId: "host_1", expectedRevision: 0, expectedKeyId: "key_1", nextKeyId: "key_2", nextPublicKey: next.toString("base64") };
  const results = await Promise.all([registry.rotate(command), new FsHostTrustRegistry(root).rotate(command)]);
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect(await registry.activeHostKey("host_1", "key_1")).toBeUndefined();
  expect(await registry.activeHostKey("host_1", "key_2")).toEqual(next);
  await expect(registry.register("host_1", "key_1", first.toString("base64"))).rejects.toThrow("Host trust refused");
  await registry.revoke("host_1", "key_2");
  expect(await new FsHostTrustRegistry(root).activeHostKey("host_1", "key_2")).toBeUndefined();
  await expect(registry.register("host_1", "key_2", next.toString("base64"))).rejects.toThrow("Host trust refused");
});

it("reads public trust state for restart CAS and refuses stale or revoked restarts", async () => {
  const { root, registry } = await fixture();
  const first = key(); const second = key();
  expect(await registry.trustState("missing")).toBeUndefined();
  await registry.register("host_1", "key_1", first.toString("base64"));
  expect(await new FsHostTrustRegistry(root).trustState("host_1")).toEqual({ hostId: "host_1", revision: 0, activeKeyId: "key_1", activePublicKey: first.toString("base64"), retiredKeyIds: [], status: "active" });
  const command = { hostId: "host_1", expectedRevision: 0, expectedKeyId: "key_1", nextKeyId: "key_2", nextPublicKey: second.toString("base64") };
  const results = await Promise.all([registry.rotate(command), new FsHostTrustRegistry(root).rotate(command)]);
  expect(results.map(result => result.ok).sort()).toEqual([false, true]);
  expect(await registry.trustState("host_1")).toEqual({ hostId: "host_1", revision: 1, activeKeyId: "key_2", activePublicKey: second.toString("base64"), retiredKeyIds: ["key_1"], status: "active" });
  await registry.revoke("host_1", "key_2");
  expect((await new FsHostTrustRegistry(root).trustState("host_1"))?.status).toBe("revoked");
  expect((await registry.rotate({ ...command, expectedRevision: 1, expectedKeyId: "key_2", nextKeyId: "key_3" })).ok).toBe(false);
  await expect(registry.register("host_1", "key_2", second.toString("base64"))).rejects.toThrow();
});

it("fails closed for malformed keys, IDs, symlinks and incompatible records", async () => {
  const { root, registry } = await fixture();
  await expect(registry.register("../escape", "key", key().toString("base64"))).rejects.toThrow("Host trust refused");
  await expect(registry.register("host_1", "key_1", "bad")).rejects.toThrow("Host trust refused");
  expect(await registry.activeHostKey("../escape", "key")).toBeUndefined();
  await mkdir(join(root, "host-trust"));
  await symlink(join(root, "elsewhere"), join(root, "host-trust", "host_1.json"));
  expect(await registry.activeHostKey("host_1", "key_1")).toBeUndefined();
  expect(await registry.trustState("host_1")).toBeUndefined();
  await expect(registry.register("host_1", "key_1", key().toString("base64"))).rejects.toThrow("Host trust refused");
  const { root: other, registry: incompatible } = await fixture();
  await mkdir(join(other, "host-trust"));
  await writeFile(join(other, "host-trust", "host_1.json"), '{"contract":"future"}');
  expect(await incompatible.activeHostKey("host_1", "key_1")).toBeUndefined();
  expect(await incompatible.trustState("host_1")).toBeUndefined();
  await expect(incompatible.register("host_1", "key_1", key().toString("base64"))).rejects.toThrow("Host trust refused");
  await chmod(join(other, "host-trust", "host_1.json"), 0o600);
});
