import { describe, expect, it } from "vitest";
import { AnnotateCapture } from "../../src/application/annotate-capture.js";
import { AjvContractValidator } from "../../src/adapters/validation/ajv-contract-validator.js";
import type { Beacon } from "../../src/domain/beacon/index.js";
import type { CaptureBeaconAssociation, CaptureSession } from "../../src/domain/capture/index.js";
import type { BeaconStore, CaptureStore, Hasher, IdGenerator, SecretResolver } from "../../src/domain/ports/index.js";
import { err, ok } from "../../src/shared/result.js";
import { validAnnotation as annotation } from "../fixtures/capture-annotation.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000001" as const;
const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
const timestamp = "2026-03-05T00:00:00.000Z";

function promoted(
  overrides: Partial<Extract<CaptureSession, { status: "promoted" }>> = {},
): Extract<CaptureSession, { status: "promoted" }> {
  return { contract: "pharos.capture-session/2", projectId, captureId, requestId, inputHash: "capture", secretSourceReferences: ["env:CHECKOUT_TOKEN"], createdAt: timestamp, status: "promoted", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 0, sha256: "a".repeat(64) }, completedAt: timestamp, ...overrides };
}
function dependencies(session = promoted()) {
  let association: CaptureBeaconAssociation | undefined;
  let drafts = 0;
  const hasher: Hasher = { hash: (value) => `sha256:${JSON.stringify(value)}` };
  const captureStore: CaptureStore = {
    async getSession(id, capture) { return id === session.projectId && capture === session.captureId ? ok(session) : err({ rule: "capture-not-found", captureId: capture }); },
    async claimAnnotation(proposed) { association ??= proposed; return ok(association); },
    async commitAssociation(proposed) { association = proposed; return ok(proposed); },
    async getAssociationByCapture() { return ok(association ?? null); },
    async getAssociationByBeacon() { return ok(association ?? null); },
    async beginLaunch() { return err({ rule: "capture-not-found", captureId }); },
    async recordRecorderStarted() { return err({ rule: "capture-not-found", captureId }); },
    async markPostExit() { return err({ rule: "capture-not-found", captureId }); },
    async resolve() { return err({ rule: "capture-not-found", captureId }); },
    async recoverProject() { return ok({ recovered: [], blocked: [] }); },
  };
  const beaconStore: BeaconStore = {
    async createDraft(id, command) {
      drafts += 1;
      const beacon: Beacon = { beaconId: id, title: command.beaconTitle, versions: {}, activeVersionId: null, drafts: { [command.draftId]: { status: "open", draftId: command.draftId, label: command.label, revision: 1, origin: command.origin, content: command.content } } };
      return ok(beacon);
    },
    async getBeacon() { return err({ rule: "beacon-not-found", beaconId }); },
    async listBeacons() { return ok([]); },
    async getActiveVersion() { return ok(null); },
    async updateDraft() { return err({ rule: "beacon-not-found", beaconId }); },
    async forkDraft() { return err({ rule: "beacon-not-found", beaconId }); },
    async abandonDraft() { return err({ rule: "beacon-not-found", beaconId }); },
    async approveDraft() { return err({ rule: "beacon-not-found", beaconId }); },
    async revokeVersion() { return err({ rule: "beacon-not-found", beaconId }); },
  };
  let disposals = 0;
  const resolver: SecretResolver = { async resolve() { return ok({ values: new Map([["env:CHECKOUT_TOKEN", "canary-secret"]]), dispose() { disposals += 1; } }); } };
  const useCase = new AnnotateCapture({ clock: { now: () => new Date(timestamp) }, ids: { next: (kind) => kind === "beacon" ? beaconId : draftId } as IdGenerator, hasher, captureStore, beaconStore, validator: new AjvContractValidator(), resolver });
  return { useCase, calls: () => drafts, disposals: () => disposals, captureStore, beaconStore };
}

describe("AnnotateCapture", () => {
  it("creates one open revision-one draft from a promoted capture and excludes capture metadata from its hash", async () => {
    const configured = dependencies();
    await expect(configured.useCase.execute({ projectId, captureId, requestId, annotation })).resolves.toMatchObject({ ok: true, value: { beaconId, draftId, revision: 1, status: "open", captureId } });
    expect(configured.calls()).toBe(1);
  });

  it("keeps semanticHash invariant when capture/request/artifact metadata differ", async () => {
    const first = dependencies();
    const alternativeSession = promoted({
      captureId: "cap_018f47de-7a00-7cc0-8000-000000000099",
      requestId: "req_018f47de-7a00-7cc0-8000-000000000099",
      artifact: { reference: "captures/cap_018f47de-7a00-7cc0-8000-000000000099/recording.spec.ts", byteSize: 999, sha256: "b".repeat(64) },
    });
    const second = dependencies(alternativeSession);
    const firstResult = await first.useCase.execute({ projectId, captureId, requestId, annotation });
    const secondResult = await second.useCase.execute({ projectId, captureId: alternativeSession.captureId, requestId: alternativeSession.requestId, annotation });
    if (!firstResult.ok || !secondResult.ok) throw new Error("expected successful annotations");
    expect(secondResult.value.semanticHash).toBe(firstResult.value.semanticHash);
  });

  it("refuses schema and semantic policy violations before normalization, claiming, or draft creation", async () => {
    const configured = dependencies();
    await expect(configured.useCase.execute({ projectId, captureId, requestId, annotation: { ...annotation, unexpected: true } })).resolves.toMatchObject({ ok: false, error: { rule: "invalid-contract" } });
    await expect(configured.useCase.execute({ projectId, captureId, requestId, annotation: { ...annotation, actions: [{ ...annotation.actions[0], target: "getByRole" }] } })).resolves.toMatchObject({ ok: false, error: { rule: "invalid-annotation-policy" } });
    expect(configured.calls()).toBe(0);
  });

  it("disposes resolved secrets on every post-resolution result and thrown failure", async () => {
    const invoke = (configured: ReturnType<typeof dependencies>) => configured.useCase.execute({ projectId, captureId, requestId, annotation });
    const success = dependencies();
    await expect(invoke(success)).resolves.toMatchObject({ ok: true });
    expect(success.disposals()).toBe(1);

    const policyRefusal = dependencies();
    await expect(policyRefusal.useCase.execute({ projectId, captureId, requestId, annotation: { ...annotation, actions: [{ ...annotation.actions[0], target: "BrowserContext" }] } })).resolves.toMatchObject({ ok: false });
    expect(policyRefusal.disposals()).toBe(1);

    const claimRefusal = dependencies();
    claimRefusal.captureStore.claimAnnotation = async () => err({ rule: "capture-association-conflict", captureId });
    await expect(invoke(claimRefusal)).resolves.toMatchObject({ ok: false });
    expect(claimRefusal.disposals()).toBe(1);

    const draftRefusal = dependencies();
    draftRefusal.beaconStore.createDraft = async () => err({ rule: "beacon-not-found", beaconId });
    await expect(invoke(draftRefusal)).resolves.toMatchObject({ ok: false });
    expect(draftRefusal.disposals()).toBe(1);

    const commitRefusal = dependencies();
    commitRefusal.captureStore.commitAssociation = async () => err({ rule: "capture-association-conflict", captureId });
    await expect(invoke(commitRefusal)).resolves.toMatchObject({ ok: false });
    expect(commitRefusal.disposals()).toBe(1);

    const mismatch = dependencies();
    const create = mismatch.beaconStore.createDraft.bind(mismatch.beaconStore);
    mismatch.beaconStore.createDraft = async (...args) => {
      const created = await create(...args);
      if (!created.ok) return created;
      const draft = created.value.drafts[draftId];
      if (draft === undefined || draft.status !== "open") throw new Error("test fixture invariant");
      return ok({ ...created.value, drafts: { ...created.value.drafts, [draftId]: { ...draft, content: { ...draft.content, purpose: "mismatched semantics" } } } });
    };
    await expect(invoke(mismatch)).resolves.toMatchObject({ ok: false, error: { rule: "draft-association-mismatch" } });
    expect(mismatch.disposals()).toBe(1);

    const thrown = dependencies();
    thrown.beaconStore.createDraft = async () => { throw new Error("store failure"); };
    await expect(invoke(thrown)).rejects.toThrow("store failure");
    expect(thrown.disposals()).toBe(1);
  });
});
