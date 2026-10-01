import { createPublicKey } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { rotateHostTrust, type HostTrustState, type HostTrustReadback, type RotateHostTrustCommand, type TrustedHostRegistry } from "../../domain/ports/operator-consent.js";
import { err, type Result } from "../../shared/result.js";
import { ensurePrivateDirectory, isErrno, readJson, writePrivateJson } from "../fs-project/filesystem.js";
import { ProjectLock } from "../fs-project/project-lock.js";

const refusal = () => new Error("Host trust refused");
const prefix = Buffer.from("302a300506032b6570032100", "hex");
const id = (value: string): boolean => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
function decode(value: string): Buffer | undefined {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{59}=$/.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 44 || bytes.toString("base64") !== value || !bytes.subarray(0, 12).equals(prefix)) return undefined;
  try { if (createPublicKey({ key: bytes, format: "der", type: "spki" }).asymmetricKeyType !== "ed25519") return undefined; }
  catch { return undefined; }
  return bytes;
}
type RecordState = HostTrustState & { readonly contract: "pharos.host-trust/1"; readonly status: "active" | "revoked" };
function valid(value: unknown, hostId: string): value is RecordState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== 7 || !["contract", "status", "hostId", "revision", "activeKeyId", "activePublicKey", "retiredKeyIds"].every(k => Object.hasOwn(r, k))) return false;
  if (r.contract !== "pharos.host-trust/1" || !["active", "revoked"].includes(r.status as string) || r.hostId !== hostId || !Number.isSafeInteger(r.revision) || (r.revision as number) < 0 || !id(r.activeKeyId as string) || !decode(r.activePublicKey as string)) return false;
  return Array.isArray(r.retiredKeyIds) && r.retiredKeyIds.length <= 256 && r.retiredKeyIds.every((k: unknown) => id(k as string) && k !== r.activeKeyId) && new Set(r.retiredKeyIds).size === r.retiredKeyIds.length && r.retiredKeyIds.length === r.revision;
}

/** Host-only provisioning. No private signing material crosses this adapter. */
export class FsHostTrustRegistry implements TrustedHostRegistry {
  readonly version = 1 as const;
  private readonly directory: string;
  private readonly lock: ProjectLock;
  constructor(private readonly projectRoot: string, lock?: ProjectLock) {
    this.directory = join(projectRoot, "host-trust");
    this.lock = lock ?? new ProjectLock(projectRoot);
  }
  private path(hostId: string): string { return join(this.directory, `${hostId}.json`); }
  private async directorySafe(): Promise<void> {
    const root = await lstat(this.projectRoot);
    if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o077) !== 0) throw refusal();
    await ensurePrivateDirectory(this.directory);
  }
  private async load(hostId: string): Promise<RecordState | undefined> {
    try {
      const stat = await lstat(this.path(hostId));
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.nlink !== 1 || stat.size > 8192) throw refusal();
      const value: unknown = await readJson(this.path(hostId));
      if (!valid(value, hostId)) throw refusal();
      return value;
    } catch (e) { if (isErrno(e, "ENOENT")) return undefined; throw refusal(); }
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    try {
      await this.directorySafe();
      const lease = await this.lock.acquire();
      if (!lease.ok) throw refusal();
      try { return await work(); } finally { await lease.value.release(); }
    } catch { throw refusal(); }
  }
  async trustState(hostId: string): Promise<HostTrustReadback | undefined> {
    if (!id(hostId)) return undefined;
    try {
      await this.directorySafe();
      const state = await this.load(hostId);
      if (!state) return undefined;
      return { hostId: state.hostId, revision: state.revision, activeKeyId: state.activeKeyId, activePublicKey: state.activePublicKey, retiredKeyIds: [...state.retiredKeyIds], status: state.status };
    } catch { return undefined; }
  }
  async activeHostKey(hostId: string, keyId: string): Promise<Uint8Array | undefined> {
    if (!id(hostId) || !id(keyId)) return undefined;
    try {
      await this.directorySafe();
      const state = await this.load(hostId);
      return state?.status === "active" && state.activeKeyId === keyId ? decode(state.activePublicKey) : undefined;
    } catch { return undefined; }
  }
  async register(hostId: string, keyId: string, publicKey: string): Promise<void> {
    if (!id(hostId) || !id(keyId) || !decode(publicKey)) throw refusal();
    await this.locked(async () => {
      const state = await this.load(hostId);
      if (state) {
        if (state.status === "active" && state.activeKeyId === keyId && state.activePublicKey === publicKey) return;
        throw refusal();
      }
      await writePrivateJson(this.path(hostId), { contract: "pharos.host-trust/1", status: "active", hostId, revision: 0, activeKeyId: keyId, activePublicKey: publicKey, retiredKeyIds: [] });
    });
  }
  async rotate(command: RotateHostTrustCommand): Promise<Result<HostTrustState, "stale-host-trust" | "invalid-host-key">> {
    if (!id(command.hostId) || !id(command.expectedKeyId) || !id(command.nextKeyId) || !decode(command.nextPublicKey)) return err("invalid-host-key");
    return this.locked(async () => {
      const state = await this.load(command.hostId);
      if (!state || state.status !== "active") return err("stale-host-trust");
      if (state.retiredKeyIds.length >= 256) return err("invalid-host-key");
      const result = rotateHostTrust(state, command);
      if (!result.ok) return result;
      await writePrivateJson(this.path(command.hostId), { ...result.value, contract: "pharos.host-trust/1", status: "active" });
      return result;
    });
  }
  async revoke(hostId: string, keyId: string): Promise<void> {
    if (!id(hostId) || !id(keyId)) throw refusal();
    await this.locked(async () => {
      const state = await this.load(hostId);
      if (!state || state.status !== "active" || state.activeKeyId !== keyId) throw refusal();
      await writePrivateJson(this.path(hostId), { ...state, status: "revoked" });
    });
  }
}
