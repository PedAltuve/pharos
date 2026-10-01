import type { BeaconId, RequestId } from "../domain/capture/index.js";
import type { ConsentGrant, ConsentRequest, ConsentStoreRefusal, OperatorConsentStore, VerifiedRevokeCommand } from "../domain/ports/operator-consent.js";
import type { ProjectId } from "../domain/project/index.js";
import type { BeaconStoreRefusal } from "../domain/ports/beacon-store-refusals.js";
import type { BeaconStore, Clock } from "../domain/ports/index.js";
import type { JsonValue } from "../domain/ports/json-value.js";
import { err, ok, type Result } from "../shared/result.js";

export interface RevokeActiveBeaconRequest {
  readonly beaconId: BeaconId;
  readonly requestId: RequestId;
  /** Prepared by the confirmation boundary; locked store validation owns its freshness. */
  readonly expectedActiveVersionId: string | null;
  readonly reason: string;
  readonly actor: string | null;
}

export interface RevokedActiveBeacon {
  readonly beaconId: BeaconId;
  readonly versionId: string;
  readonly status: "revoked";
  readonly reason: string;
}

export interface ActiveVersionNotFound {
  readonly rule: "active-version-not-found";
  readonly beaconId: BeaconId;
}

export type RevokeActiveBeaconRefusal =
  | BeaconStoreRefusal
  | ActiveVersionNotFound;

export interface PrepareRevocationConsentRequest {
  readonly projectId: ProjectId;
  readonly beaconId: BeaconId;
  readonly requestId: RequestId;
  readonly reason: string;
}

export interface RevocationConsentDisplay {
  readonly request: ConsentRequest;
  readonly auditId: string;
}

export interface RevokeActiveBeaconDependencies {
  /** Project identity from trusted composition, not caller input. Required for consent operations. */
  readonly canonicalProjectId?: ProjectId;
  readonly consentStore?: OperatorConsentStore;
  /** Trusted host boundary, never sourced from the model request. */
  readonly issueChallenge?: () => { readonly challengeId: string; readonly expiresAtEpochMs: number };
  readonly clock: Clock;
  readonly beaconStore: BeaconStore & {
    readonly revokeActiveVersion: NonNullable<BeaconStore["revokeActiveVersion"]>;
  };
}

/** Revokes only the active immutable version; historical versions are never selected or reactivated. */
export class RevokeActiveBeacon {
  constructor(private readonly dependencies: RevokeActiveBeaconDependencies) {}

  async prepareConsent(input: PrepareRevocationConsentRequest): Promise<Result<RevocationConsentDisplay, RevokeActiveBeaconRefusal | ConsentStoreRefusal>> {
    const { beaconStore, consentStore, issueChallenge, clock } = this.dependencies;
    if (!consentStore || !issueChallenge || !this.dependencies.canonicalProjectId || this.dependencies.canonicalProjectId !== input.projectId) return err({ rule: "invalid-consent-request", requestId: input.requestId });
    const reason = input.reason.trim();
    if (!reason || reason.length > 4096 || /[\r\n]/.test(reason)) return err({ rule: "invalid-revocation-reason" });
    const active = await beaconStore.getActiveVersion(input.beaconId);
    if (!active.ok) return active;
    if (active.value === null) return err({ rule: "active-version-not-found", beaconId: input.beaconId });
    const binding: ConsentRequest["binding"] = { action: "revoke", projectId: input.projectId, beaconId: input.beaconId, expectedActiveVersion: active.value.versionId, reason, requestId: input.requestId };
    const replay = async (): Promise<Result<RevocationConsentDisplay | undefined, ConsentStoreRefusal>> => {
      const existing = await consentStore.getChallenge(input.requestId, clock.now().getTime());
      if (!existing.ok) return existing;
      if (!existing.value) return ok(undefined);
      if (existing.value.status !== "pending" || JSON.stringify(existing.value.request.binding) !== JSON.stringify(binding)) return err({ rule: "consent-request-conflict", requestId: input.requestId });
      const current = await consentStore.getChallenge(input.requestId, clock.now().getTime());
      if (!current.ok) return current;
      if (current.value?.status !== "pending" || JSON.stringify(current.value.request) !== JSON.stringify(existing.value.request)) return err({ rule: "consent-request-conflict", requestId: input.requestId });
      if (current.value.request.contract !== "pharos.operator-consent-request/1") return err({ rule: "consent-request-conflict", requestId: input.requestId });
      return ok({ request: current.value.request, auditId: current.value.auditId });
    };
    const existing = await replay();
    if (!existing.ok || existing.value) return existing as Result<RevocationConsentDisplay, ConsentStoreRefusal>;
    const now = clock.now().getTime();
    const challenge = issueChallenge();
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(challenge.expiresAtEpochMs) || challenge.expiresAtEpochMs <= now || typeof challenge.challengeId !== "string" || !challenge.challengeId || challenge.challengeId.length > 256) return err({ rule: "invalid-consent-request", requestId: input.requestId });
    const request: ConsentRequest = { contract: "pharos.operator-consent-request/1", binding, ...challenge };
    const persistenceNow = clock.now().getTime();
    if (!Number.isSafeInteger(persistenceNow) || persistenceNow < 0 || persistenceNow >= challenge.expiresAtEpochMs) return err({ rule: "invalid-consent-request", requestId: input.requestId });
    const created = await consentStore.createChallenge(request, persistenceNow);
    if (!created.ok) {
      if (created.error.rule !== "consent-request-conflict") return created;
      const raced = await replay();
      if (!raced.ok) return raced;
      return raced.value ? ok(raced.value) : created;
    }
    if (created.value.status !== "pending") return err({ rule: "consent-request-conflict", requestId: input.requestId });
    if (created.value.request.contract !== "pharos.operator-consent-request/1") return err({ rule: "consent-request-conflict", requestId: input.requestId });
    return ok({ request: created.value.request, auditId: created.value.auditId });
  }

  async completeConsent(input: { readonly requestId: RequestId; readonly grant: ConsentGrant }): Promise<Result<RevokedActiveBeacon, RevokeActiveBeaconRefusal | ConsentStoreRefusal>> {
    const store = this.dependencies.consentStore;
    const requestId = input.requestId;
    const grant = input.grant;
    const binding = grant?.binding;
    const exact = (value: object, keys: string[]) => Reflect.ownKeys(value).length === keys.length && keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    }) && Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key));
    const short = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256;
    if (!store || !grant || typeof grant !== "object" || !exact(grant, ["contract", "decision", "binding", "challengeId", "expiresAtEpochMs", "hostId", "keyId", "algorithm", "signature"]) ||
      !binding || typeof binding !== "object" || !exact(binding, ["action", "projectId", "beaconId", "expectedActiveVersion", "reason", "requestId"]) || binding.action !== "revoke" ||
      grant.contract !== "pharos.operator-consent-grant/1" || grant.decision !== "granted" || grant.algorithm !== "ed25519" ||
      !short(grant.challengeId) || !short(grant.hostId) || !short(grant.keyId) || typeof grant.signature !== "string" || !grant.signature || grant.signature.length > 1024 ||
      !Number.isSafeInteger(grant.expiresAtEpochMs) || grant.expiresAtEpochMs < 0 || !short(binding.projectId) || !short(binding.beaconId) || !short(binding.expectedActiveVersion) || !short(binding.requestId) || binding.requestId !== requestId ||
      typeof binding.reason !== "string" || !binding.reason || binding.reason.length > 4096 || binding.reason.trim() !== binding.reason || /[\r\n]/.test(binding.reason)) return err({ rule: "invalid-consent-request", requestId });
    const signedRequest: ConsentRequest = { contract: "pharos.operator-consent-request/1", binding, challengeId: grant.challengeId, expiresAtEpochMs: grant.expiresAtEpochMs };
    if (!this.dependencies.canonicalProjectId || this.dependencies.canonicalProjectId !== binding.projectId) return err({ rule: "invalid-consent-request", requestId });
    const actionHash = store.actionHash(signedRequest);
    const existing = await store.getChallenge(requestId, this.dependencies.clock.now().getTime());
    if (!existing.ok) return existing;
    if (!existing.value || existing.value.status === "declined") return err({ rule: "consent-not-found", requestId });
    if (existing.value.status === "pending" && store.actionHash(existing.value.request) !== actionHash) return err({ rule: "consent-consumption-conflict", requestId });
    if (existing.value.status !== "pending" && (existing.value.provenance !== "verified" || existing.value.actionHash !== actionHash || !existing.value.revokeCommand)) return err({ rule: "consent-consumption-conflict", requestId });
    let command: VerifiedRevokeCommand = existing.value.status === "pending"
      ? { expectedActiveVersionId: binding.expectedActiveVersion, reason: binding.reason, revokedAt: this.dependencies.clock.now().toISOString(), actor: null, bindingHash: actionHash }
      : existing.value.revokeCommand!;
    let claimed = await store.beginVerifiedRevocation(requestId, actionHash, grant, command, this.dependencies.clock.now().getTime());
    if (!claimed.ok && claimed.error.rule === "consent-consumption-conflict" && existing.value.status === "pending") {
      const raced = await store.getChallenge(requestId, this.dependencies.clock.now().getTime());
      if (!raced.ok) return raced;
      if (!raced.value || (raced.value.status !== "claimed" && raced.value.status !== "consumed") || raced.value.provenance !== "verified" || raced.value.actionHash !== actionHash || !raced.value.revokeCommand) return claimed;
      command = raced.value.revokeCommand;
      claimed = await store.beginVerifiedRevocation(requestId, actionHash, grant, command, this.dependencies.clock.now().getTime());
    }
    if (!claimed.ok) return claimed;
    if (claimed.value.status === "consumed") return this.revokedResult(claimed.value.result, command, binding.beaconId, requestId);
    if (claimed.value.status !== "claimed" || claimed.value.provenance !== "verified" || claimed.value.actionHash !== actionHash || !claimed.value.revokeCommand) return err({ rule: "consent-consumption-conflict", requestId });
    command = claimed.value.revokeCommand;
    if (command.bindingHash !== actionHash || command.expectedActiveVersionId !== binding.expectedActiveVersion || command.reason !== binding.reason) return err({ rule: "consent-consumption-conflict", requestId });
    const revoked = await this.dependencies.beaconStore.revokeActiveVersion(binding.beaconId as BeaconId, {
      expectedActiveVersionId: command.expectedActiveVersionId, reason: command.reason, actor: command.actor, revokedAt: command.revokedAt,
    }, `beacon-revoke:${binding.projectId}:${binding.beaconId}:${requestId}`);
    if (!revoked.ok) return revoked;
    const version = Object.hasOwn(revoked.value.versions, command.expectedActiveVersionId) ? revoked.value.versions[command.expectedActiveVersionId] : undefined;
    if (revoked.value.activeVersionId !== null || version?.status !== "revoked" || version.revocation.reason !== command.reason || version.revocation.revokedAt !== command.revokedAt || version.revocation.actor !== command.actor) return err({ rule: "consent-consumption-conflict", requestId });
    const result: RevokedActiveBeacon = { beaconId: binding.beaconId as BeaconId, versionId: version.versionId, status: "revoked", reason: version.revocation.reason };
    const completed = await store.completeVerifiedConsumption(requestId, actionHash, { ...result }, this.dependencies.clock.now().getTime());
    if (!completed.ok) return completed;
    return this.revokedResult(completed.value.status === "consumed" ? completed.value.result : undefined, command, binding.beaconId, requestId);
  }

  private revokedResult(value: JsonValue | undefined, command: VerifiedRevokeCommand, beaconId: string, requestId: string): Result<RevokedActiveBeacon, ConsentStoreRefusal> {
    const result = value as Record<string, unknown> | undefined;
    if (!result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).sort().join(",") !== "beaconId,reason,status,versionId" || result.beaconId !== beaconId || result.versionId !== command.expectedActiveVersionId || result.reason !== command.reason || result.status !== "revoked") return err({ rule: "consent-consumption-conflict", requestId });
    return ok(value as unknown as RevokedActiveBeacon);
  }

  async execute(request: RevokeActiveBeaconRequest): Promise<Result<RevokedActiveBeacon, RevokeActiveBeaconRefusal>> {
    const reason = request.reason.trim();
    if (reason.length === 0) return err({ rule: "invalid-revocation-reason" });

    const revoked = await this.dependencies.beaconStore.revokeActiveVersion(
      request.beaconId,
      {
        expectedActiveVersionId: request.expectedActiveVersionId,
        reason,
        actor: request.actor,
        revokedAt: this.dependencies.clock.now().toISOString(),
      },
      `beacon-revoke:${request.beaconId}:${request.requestId}`,
    );
    if (!revoked.ok) return revoked;

    const versionId = request.expectedActiveVersionId;
    if (versionId === null) {
      return err({ rule: "active-version-not-found", beaconId: request.beaconId });
    }
    const version = revoked.value.versions[versionId];
    if (version?.status !== "revoked") {
      return err({
        rule: "active-version-mismatch",
        expectedActiveVersionId: request.expectedActiveVersionId,
        currentActiveVersionId: revoked.value.activeVersionId,
      });
    }
    return ok({
      beaconId: request.beaconId,
      versionId,
      status: "revoked",
      reason: version.revocation.reason,
    });
  }
}
