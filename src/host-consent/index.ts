import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
export { canonicalConsentGrantPayload, canonicalConsentGrantPayloadV2 } from "../adapters/host-consent-verifier/index.js";
export type { ConsentGrant, ConsentRequest, ConsentGrantV2, ConsentRequestV2 } from "../domain/ports/operator-consent.js";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FsProjectContextStore } from "../adapters/fs-project-context-store/index.js";
import { resolvePharosHome } from "../adapters/fs-project/index.js";
import { FsCaptureStore } from "../adapters/fs-capture-store/index.js";
import { FsBeaconStore } from "../adapters/fs-beacon-store/index.js";
import { FsConsentStore } from "../adapters/fs-consent-store/index.js";
import { FsHostTrustRegistry } from "../adapters/fs-host-trust-registry/index.js";
import { JcsSha256Hasher } from "../adapters/hashing/index.js";
import { staleComparisonDigest } from "../adapters/host-consent-verifier/index.js";
import { project } from "../domain/semantics/index.js";
import type { SemanticProjection } from "../domain/semantics/index.js";
import type { JsonValue } from "../domain/ports/json-value.js";
import { HostConsentDecision } from "../application/operator-consent-host.js";
import { ApproveBeaconDraft, type ApprovedBeaconDraft } from "../application/approve-beacon-draft.js";
import { RevokeActiveBeacon, type RevokedActiveBeacon } from "../application/revoke-active-beacon.js";
import type { AnyConsentGrant } from "../domain/ports/operator-consent.js";
import type { ProjectId } from "../domain/project/index.js";

/** Host-only in-process API. Never expose this object as a model-callable tool. */
export interface HostConsentOptions {
  readonly home?: string;
  readonly cwd?: string;
  readonly projectId?: ProjectId;
}
export type HostResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly rule: string } };
const failure = (rule: string): HostResult<never> => ({ ok: false, error: { rule } });

export function createHostConsentRuntime(options: HostConsentOptions = {}) {
  async function scoped() {
    const resolved = resolvePharosHome({ override: options.home, environment: process.env, platform: process.platform, homeDirectory: homedir() });
    if (!resolved.ok) return undefined;
    try {
      const path = await realpath(options.cwd ?? process.cwd());
      const projects = new FsProjectContextStore({ home: resolved.value });
      const project = await projects.resolveByPath(path);
      if (!project.ok || (options.projectId !== undefined && options.projectId !== project.value.projectId)) return undefined;
      const projectRoot = join(resolved.value, "store", project.value.projectId);
      const registry = new FsHostTrustRegistry(projectRoot);
      const store = new FsConsentStore({ projectRoot, activeHostKey: (hostId, keyId) => registry.activeHostKey(hostId, keyId) });
      const beaconStore = new FsBeaconStore({ projectRoot, hasher: new JcsSha256Hasher() });
      const clock = { now: () => new Date() };
      const issueChallenge = () => ({ challengeId: randomUUID(), expiresAtEpochMs: Date.now() + 300_000 });
      return { projectId: project.value.projectId, registry, store, approveBeaconStore: beaconStore, decision: new HostConsentDecision({ consentStore: store, clock: Date.now }),
        approve: new ApproveBeaconDraft({ clock, ids: { next: () => `ver_${randomUUID().replace(/^(.{14})./, "$17")}` }, hasher: new JcsSha256Hasher(), captureStore: new FsCaptureStore({ projectRoot }), beaconStore, consentStore: store, issueChallenge }),
        revoke: new RevokeActiveBeacon({ clock, beaconStore, canonicalProjectId: project.value.projectId, consentStore: store, issueChallenge }) };
    } catch { return undefined; }
  }
  async function run<T>(operation: (context: NonNullable<Awaited<ReturnType<typeof scoped>>>) => Promise<{ readonly ok: boolean; readonly value?: T; readonly error?: { readonly rule: string } }>): Promise<HostResult<T>> {
    let context: Awaited<ReturnType<typeof scoped>>;
    try { context = await scoped(); } catch { return failure("project-unavailable"); }
    if (!context) return failure("project-unavailable");
    try {
      const result = await operation(context);
      if (!result.ok) return failure(result.error?.rule ?? "consent-refused");
      return { ok: true, value: result.value as T };
    } catch { return failure("consent-refused"); }
  }
  // Compare original values before redaction; never copy references or examples into presentation.
  function redact(semantics: SemanticProjection, other: SemanticProjection | null): SemanticProjection {
    const marker = (value: unknown, previous: unknown) => value === null ? null :
      isDeepStrictEqual(value, previous) ? "[redacted; same]" : "[redacted; changed]";
    const variables = Object.fromEntries(Object.entries(semantics.variables).map(([key, value]) => [key,
      { ...value, secretReferenceId: marker(value.secretReferenceId, other?.variables[key]?.secretReferenceId),
        nonSensitiveExample: marker(value.nonSensitiveExample, other?.variables[key]?.nonSensitiveExample) }]));
    return { ...semantics, variables, actor: { ...semantics.actor, identityRef: marker(semantics.actor.identityRef, other?.actor.identityRef) } };
  }
  return {
    reviewComparison: (requestId: string) => run(async (c) => {
      const pending = await c.store.getChallenge(requestId, Date.now());
      if (!pending.ok) return pending;
      const claim = pending.value?.status === "claimed" ? await c.store.recoveryClaim(requestId) : undefined;
      const request = claim?.request ?? (pending.value?.status === "pending" ? pending.value.request : undefined);
      if (!request || request.contract !== "pharos.operator-consent-request/2" || request.binding.action !== "approve" ||
        request.binding.projectId !== c.projectId || request.binding.requestId !== requestId || request.binding.staleOriginAcknowledged !== true ||
        (pending.value?.status === "claimed" && !claim)) return { ok: false, error: { rule: "invalid-consent-request" } };
      const beacon = await c.approveBeaconStore.getBeacon(request.binding.beaconId);
      if (!beacon.ok) return beacon;
      const draft = Object.hasOwn(beacon.value.drafts, request.binding.draftId) ? beacon.value.drafts[request.binding.draftId] : undefined;
      if (!draft || draft.draftId !== request.binding.draftId || draft.status !== (claim ? "closed" : "open") && !(claim && draft.status === "open") ||
        draft.revision !== request.binding.expectedRevision || (!claim && Object.values(beacon.value.drafts).filter(d => d.status === "open").length !== 1)) return { ok: false, error: { rule: "draft-association-mismatch" } };
      const draftSemantics = project(draft.content);
      if (new JcsSha256Hasher().hash(draftSemantics as JsonValue) !== request.binding.semanticHash) return { ok: false, error: { rule: "draft-association-mismatch" } };
      const snapshot = await c.approveBeaconStore.getActiveSemanticSnapshot(request.binding.beaconId);
      if (!snapshot.ok) return snapshot;
      const current = snapshot.value;
      const command = pending.value && "approvalCommand" in pending.value ? pending.value.approvalCommand : undefined;
      if (claim && (!command || command.bindingHash !== c.store.actionHash(request) || command.versionId === request.binding.reviewed.activeVersionId)) return failure("draft-association-mismatch");
      const alreadyCommitted = !!claim && (current?.versionId ?? null) === command?.versionId;
      if (claim && !alreadyCommitted && (current?.versionId ?? null) !== request.binding.reviewed.activeVersionId) return failure("draft-association-mismatch");
      if (alreadyCommitted) {
        const version = Object.hasOwn(beacon.value.versions, command!.versionId) ? beacon.value.versions[command!.versionId] : undefined;
        if (!version || version.status !== "active" || version.approval.reviewedHash !== request.binding.semanticHash ||
          version.provenance.approvedDraftId !== draft.draftId || version.provenance.approvedRevision !== draft.revision ||
          current?.semanticHash !== request.binding.semanticHash || (draft.status === "closed" && draft.approvedVersionId !== command!.versionId)) return failure("draft-association-mismatch");
      } else if (claim && draft.status !== "open") return failure("draft-association-mismatch");
      const originalId = request.binding.reviewed.activeVersionId;
      const originalResult = alreadyCommitted && originalId !== null
        ? await c.approveBeaconStore.getCommittedSemanticSnapshot(request.binding.beaconId, originalId) : undefined;
      if (originalResult && !originalResult.ok) return originalResult;
      const active = alreadyCommitted ? (originalResult?.value ?? null) : current;
      if ((!claim && (current?.versionId ?? null) !== beacon.value.activeVersionId) ||
        (active?.versionId ?? null) !== originalId ||
        (active?.semanticHash ?? null) !== request.binding.reviewed.activeSemanticHash ||
        request.binding.reviewed.comparisonDigest !== staleComparisonDigest(request.binding.semanticHash, active?.versionId ?? null, active?.semanticHash ?? null)) return failure("draft-association-mismatch");
      return { ok: true, value: { activeVersionId: active?.versionId ?? null, activeSemanticHash: active?.semanticHash ?? null,
        draft: redact(draftSemantics, active?.semantics ?? null), active: active ? redact(active.semantics, draftSemantics) : null,
        equal: active !== null && request.binding.semanticHash === active.semanticHash, alreadyCommitted } };
    }),
    inspect: (requestId: string) => run((c) => c.decision.inspect(requestId)),
    inspectRecovery: (requestId: string) => run(async (c) => {
      const claim = await c.store.recoveryClaim(requestId);
      if (!claim || claim.request.binding.projectId !== c.projectId) return { ok: false, error: { rule: "consent-not-claimed" } };
      return { ok: true, value: { request: claim.request, auditId: claim.auditId } };
    }),
    resumeClaim: (requestId: string) => run<ApprovedBeaconDraft | RevokedActiveBeacon>(async (c) => {
      const claim = await c.store.recoveryClaim(requestId);
      if (!claim || claim.request.binding.projectId !== c.projectId) return { ok: false, error: { rule: "consent-not-claimed" } };
      if (claim.grant.contract !== "pharos.operator-consent-grant/1" && claim.grant.contract !== "pharos.operator-consent-grant/2") return { ok: false, error: { rule: "invalid-consent-request" } };
      if (claim.grant.contract === "pharos.operator-consent-grant/2" && claim.request.contract !== "pharos.operator-consent-request/2") return { ok: false, error: { rule: "invalid-consent-request" } };
      return claim.request.binding.action === "approve"
        ? c.approve.completeConsent({ requestId: requestId as `req_${string}`, grant: claim.grant })
        : claim.grant.contract === "pharos.operator-consent-grant/1" ? c.revoke.completeConsent({ requestId: requestId as `req_${string}`, grant: claim.grant }) : { ok: false as const, error: { rule: "invalid-consent-request" } };
    }),
    decline: (requestId: string) => run((c) => c.decision.decline(requestId)),
    complete: (requestId: string, grant: AnyConsentGrant) => run<ApprovedBeaconDraft | RevokedActiveBeacon>(async (c) => {
      const pending = await c.store.getChallenge(requestId, Date.now());
      if (!pending.ok) return pending;
      if (!pending.value || grant?.binding?.projectId !== c.projectId || grant.binding.requestId !== requestId) return { ok: false, error: { rule: "consent-not-pending" } };
      if (pending.value.status === "pending" && pending.value.request.binding.projectId !== c.projectId) return { ok: false, error: { rule: "consent-not-pending" } };
      if (pending.value.status !== "pending" && pending.value.status !== "claimed" && pending.value.status !== "consumed") return { ok: false, error: { rule: "consent-not-pending" } };
      // For durable claims the grant is only a routing hint; the application/store
      // authenticates it against the persisted request and immutable command.
      const action = pending.value.status === "pending" ? pending.value.request.binding.action : grant.binding.action;
      if (action !== "approve" && action !== "revoke") return { ok: false, error: { rule: "consent-not-pending" } };
      return action === "approve"
        ? c.approve.completeConsent({ requestId: requestId as `req_${string}`, grant })
        : grant.contract === "pharos.operator-consent-grant/1" ? c.revoke.completeConsent({ requestId: requestId as `req_${string}`, grant }) : { ok: false as const, error: { rule: "invalid-consent-request" } };
    }),
    trustState: (hostId: string) => run(async (c) => ({ ok: true, value: await c.registry.trustState(hostId) })),
    register: (hostId: string, keyId: string, publicKey: string) => run(async (c) => { await c.registry.register(hostId, keyId, publicKey); return { ok: true, value: { status: "registered" as const } }; }),
    rotate: (command: Parameters<FsHostTrustRegistry["rotate"]>[0]) => run(async (c) => {
      const result = await c.registry.rotate(command);
      return result.ok ? { ok: true, value: { status: "rotated" as const, revision: result.value.revision } } : { ok: false, error: { rule: result.error } };
    }),
    revokeHost: (hostId: string, keyId: string) => run(async (c) => { await c.registry.revoke(hostId, keyId); return { ok: true, value: { status: "revoked" as const } }; }),
  };
}
