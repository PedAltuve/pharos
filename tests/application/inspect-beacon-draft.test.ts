import { describe, expect, it } from "vitest";
import { InspectBeaconDraft } from "../../src/application/inspect-beacon-draft.js";
import type { Beacon } from "../../src/domain/beacon/index.js";
import type { SemanticSource } from "../../src/domain/semantics/index.js";
import type { CaptureBeaconAssociation, CaptureSession } from "../../src/domain/capture/index.js";
import type { BeaconStore, CaptureStore, Hasher } from "../../src/domain/ports/index.js";
import { ok } from "../../src/shared/result.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
const semanticHash = "sha256:semantic";
const content: SemanticSource = { purpose: "Renew", actor: { type: "guest", identityRef: null }, entryPoint: { path: "/checkout", query: null, fragment: null }, actions: [{ action: "continue_checkout", target: null, value: null }], checkpoints: { ordered: true, entries: [{ id: "checkout_open", afterAction: null, expectations: { visible: true } }] }, variables: [], outcomes: [{ id: "renewed", description: null }], allowedVariation: [], prohibitedRegressions: [{ id: "no_double_charge", description: null }], readinessIntent: { sideEffectClass: "stateless", isolation: null } };
const association: CaptureBeaconAssociation = { contract: "pharos.capture-beacon-association/1", state: "committed", projectId, captureId, requestId: "req_018f47de-7a00-7cc0-8000-000000000001", inputHash: "input", beaconId, draftId, revision: 1, semanticHash, createdAt: "2026-03-05T00:00:00.000Z", committedAt: "2026-03-05T00:00:00.000Z" };

function inspect(
  hash = semanticHash,
  aggregateBeaconId: string = beaconId,
  embeddedDraftId: string = draftId,
  revision = 1,
  status: "open" | "closed" = "open",
): InspectBeaconDraft {
  const captureStore: CaptureStore = {
    async getAssociationByBeacon() { return ok(association); },
    async getSession() { return ok({ contract: "pharos.capture-session/2", projectId, captureId, requestId: association.requestId, inputHash: "capture", secretSourceReferences: [], createdAt: association.createdAt, status: "promoted", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 0, sha256: "a".repeat(64) }, completedAt: association.committedAt! } as CaptureSession); },
    async beginLaunch() { throw new Error("read only"); }, async recordRecorderStarted() { throw new Error("read only"); }, async markPostExit() { throw new Error("read only"); }, async resolve() { throw new Error("read only"); }, async recoverProject() { throw new Error("read only"); }, async claimAnnotation() { throw new Error("read only"); }, async commitAssociation() { throw new Error("read only"); }, async getAssociationByCapture() { return ok(association); },
  };
  const draft = status === "open"
    ? { status, draftId: embeddedDraftId, label: "Renew checkout", revision, origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }
    : { status, draftId: embeddedDraftId, label: "Renew checkout", revision, origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content, approvedVersionId: "ver_018f47de-7a00-7cc0-8000-000000000001", closedAt: "2026-03-05T00:00:00.000Z" };
  const beacon: Beacon = { beaconId: aggregateBeaconId as typeof beaconId, title: "Renew checkout", versions: {}, activeVersionId: null, drafts: { [draftId]: draft } };
  const beaconStore: BeaconStore = { async getBeacon() { return ok(beacon); }, async listBeacons() { return ok([]); }, async getActiveVersion() { return ok(null); }, async createDraft() { throw new Error("read only"); }, async updateDraft() { throw new Error("read only"); }, async forkDraft() { throw new Error("read only"); }, async abandonDraft() { throw new Error("read only"); }, async approveDraft() { throw new Error("read only"); }, async revokeVersion() { throw new Error("read only"); } };
  return new InspectBeaconDraft({ captureStore, beaconStore, hasher: { hash: () => hash } as Hasher });
}

describe("InspectBeaconDraft", () => {
  it("returns read-only authoritative Beacon semantics and explicitly supporting capture data", async () => {
    await expect(inspect().execute({ projectId, beaconId })).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        beacon: expect.objectContaining({ authority: "authoritative", beaconId, draftId, revision: 1, status: "open", semanticHash }),
        capture: expect.objectContaining({ authority: "supporting-non-authoritative", captureId }),
      }),
    });
  });
  it("refuses a persisted association whose semantic hash no longer agrees", async () => {
    await expect(inspect("sha256:changed").execute({ projectId, beaconId })).resolves.toMatchObject({ ok: false, error: { rule: "draft-association-mismatch" } });
  });
  it("refuses an aggregate whose embedded Beacon ID disagrees with the committed association", async () => {
    await expect(inspect(semanticHash, "bcn_018f47de-7a00-7cc0-8000-000000000099").execute({ projectId, beaconId })).resolves.toMatchObject({ ok: false, error: { rule: "draft-association-mismatch" } });
  });
  it.each([
    ["embedded draft ID", inspect(semanticHash, beaconId, "drf_018f47de-7a00-7cc0-8000-000000000099")],
    ["revision", inspect(semanticHash, beaconId, draftId, 2)],
    ["status", inspect(semanticHash, beaconId, draftId, 1, "closed")],
  ] as const)("refuses a mismatched authoritative draft %s", async (_caseName, useCase) => {
    await expect(useCase.execute({ projectId, beaconId })).resolves.toMatchObject({ ok: false, error: { rule: "draft-association-mismatch" } });
  });
});
