import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsCaptureStore } from "../../src/adapters/fs-capture-store/index.js";
import { FsBeaconStore } from "../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { JcsSha256Hasher } from "../../src/adapters/hashing/jcs-sha256-hasher.js";
import { AjvContractValidator } from "../../src/adapters/validation/ajv-contract-validator.js";
import { AnnotateCapture } from "../../src/application/annotate-capture.js";
import type { CaptureId, RequestId } from "../../src/domain/capture/index.js";
import type { BeaconStore, CaptureStore, IdGenerator, SecretResolver } from "../../src/domain/ports/index.js";
import { ok } from "../../src/shared/result.js";

let root: string;
const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as CaptureId;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000001" as RequestId;
const time = "2026-03-05T00:00:00.000Z";
const annotation = {
  contract: "pharos.capture-annotation/1", title: "Renew checkout", purpose: "Renew checkout", actor: { type: "guest", identity_ref: null }, entry_point: { path: "/checkout", query: null, fragment: null }, actions: [{ action: "continue_checkout", target: "checkout_form", value: null }], checkpoints: { ordered: true, entries: [{ id: "checkout_open", after_action: "continue_checkout", expectations: { visible: true } }] }, variables: [], outcomes: [{ id: "checkout_renewed", description: "Checkout is renewed" }], allowed_variation: [], prohibited_regressions: [{ id: "no_double_charge", description: "Charge once" }], readiness_intent: { side_effect_class: "stateless", isolation: null },
};

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function promoted(store: FsCaptureStore): Promise<void> {
  await store.beginLaunch({ projectId, captureId, requestId, inputHash: "capture", secretSourceReferences: [], createdAt: time });
  await store.markPostExit(projectId, captureId, time);
  const bytes = "supporting recorder output";
  const stage = join(root, "capture-staging", captureId, "recording.spec.ts");
  await writeFile(stage, bytes);
  await store.resolve(projectId, captureId, {
    resolution: "promote",
    artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") },
  }, time);
}

function useCase(captureStore: CaptureStore, ids: IdGenerator, beaconStore?: BeaconStore): AnnotateCapture {
  const hasher = new JcsSha256Hasher();
  const resolver: SecretResolver = { async resolve() { return ok({ values: new Map(), dispose() {} }); } };
  return new AnnotateCapture({
    clock: { now: () => new Date(time) }, ids, hasher, captureStore,
    beaconStore: beaconStore ?? new FsBeaconStore({ projectRoot: root, hasher }), validator: new AjvContractValidator(), resolver,
  });
}

describe("annotation association recovery", () => {
  it("converges a reverse-link crash to one draft using the durable claim identity", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-annotation-association-"));
    let arm = false;
    // This final write is also the committed association state: CaptureStore
    // has no separate completion record after the matching reverse link.
    const crashingStore = new FsCaptureStore({ projectRoot: root, observer: { onStage(stage) { if (arm && stage === "association-beacon-written") throw new Error("reverse-link crash"); } } });
    await promoted(crashingStore);
    const ids: IdGenerator = { next: (kind) => kind === "beacon" ? "bcn_018f47de-7a00-7cc0-8000-000000000001" : "drf_018f47de-7a00-7cc0-8000-000000000001" };
    arm = true;
    await expect(useCase(crashingStore, ids).execute({ projectId, captureId, requestId, annotation })).rejects.toThrow("reverse-link crash");
    arm = false;
    const replayIds: IdGenerator = { next: (kind) => kind === "beacon" ? "bcn_018f47de-7a00-7cc0-8000-000000000099" : "drf_018f47de-7a00-7cc0-8000-000000000099" };
    await expect(useCase(new FsCaptureStore({ projectRoot: root }), replayIds).execute({ projectId, captureId, requestId, annotation })).resolves.toMatchObject({ ok: true, value: { draftId: "drf_018f47de-7a00-7cc0-8000-000000000001" } });
    const hasher = new JcsSha256Hasher();
    const beacons = await new FsBeaconStore({ projectRoot: root, hasher }).listBeacons();
    expect(beacons).toMatchObject({ ok: true, value: [{ drafts: { "drf_018f47de-7a00-7cc0-8000-000000000001": { status: "open", revision: 1 } } }] });
  });

  it("replays a completed durable claim after the caller crashes before createDraft", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-annotation-after-claim-"));
    const durable = new FsCaptureStore({ projectRoot: root });
    await promoted(durable);
    const ids: IdGenerator = { next: (kind) => kind === "beacon" ? "bcn_018f47de-7a00-7cc0-8000-000000000001" : "drf_018f47de-7a00-7cc0-8000-000000000001" };
    const afterClaimCrash = {
      ...durable,
      async getSession(...args: Parameters<CaptureStore["getSession"]>) { return durable.getSession(...args); },
      async claimAnnotation(...args: Parameters<CaptureStore["claimAnnotation"]>) {
        await durable.claimAnnotation(...args);
        throw new Error("after-claim crash");
      },
    } as unknown as CaptureStore;
    await expect(useCase(afterClaimCrash, ids).execute({ projectId, captureId, requestId, annotation })).rejects.toThrow("after-claim crash");
    await expect(useCase(new FsCaptureStore({ projectRoot: root }), ids).execute({ projectId, captureId, requestId, annotation })).resolves.toMatchObject({ ok: true });
  });

  it("repairs a partial claim write without another draft", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-annotation-claim-crash-"));
    let armClaim = true;
    const claimCrash = new FsCaptureStore({ projectRoot: root, observer: { onStage(stage) { if (armClaim && stage === "association-capture-written") throw new Error("claim crash"); } } });
    await promoted(claimCrash);
    const ids: IdGenerator = { next: (kind) => kind === "beacon" ? "bcn_018f47de-7a00-7cc0-8000-000000000001" : "drf_018f47de-7a00-7cc0-8000-000000000001" };
    await expect(useCase(claimCrash, ids).execute({ projectId, captureId, requestId, annotation })).rejects.toThrow("claim crash");
    armClaim = false;
    await expect(useCase(new FsCaptureStore({ projectRoot: root }), ids).execute({ projectId, captureId, requestId, annotation })).resolves.toMatchObject({ ok: true });
  });

  it("recovers an after-createDraft crash using BeaconStore idempotency", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-annotation-post-create-"));
    const captures = new FsCaptureStore({ projectRoot: root });
    await promoted(captures);
    const ids: IdGenerator = { next: (kind) => kind === "beacon" ? "bcn_018f47de-7a00-7cc0-8000-000000000001" : "drf_018f47de-7a00-7cc0-8000-000000000001" };
    const hasher = new JcsSha256Hasher();
    const durable = new FsBeaconStore({ projectRoot: root, hasher });
    const postCreateCrash = {
      async createDraft(...args: Parameters<BeaconStore["createDraft"]>) {
        await durable.createDraft(...args);
        throw new Error("post-create crash");
      },
    } as unknown as BeaconStore;
    await expect(useCase(captures, ids, postCreateCrash).execute({ projectId, captureId, requestId, annotation })).rejects.toThrow("post-create crash");
    await expect(useCase(new FsCaptureStore({ projectRoot: root }), ids).execute({ projectId, captureId, requestId, annotation })).resolves.toMatchObject({ ok: true });
    const listed = await durable.listBeacons();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("refuses conflicting retries and cross-project capture forgery before another draft", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-annotation-conflict-"));
    const captures = new FsCaptureStore({ projectRoot: root });
    await promoted(captures);
    const ids: IdGenerator = { next: (kind) => kind === "beacon" ? "bcn_018f47de-7a00-7cc0-8000-000000000001" : "drf_018f47de-7a00-7cc0-8000-000000000001" };
    const annotate = useCase(captures, ids);
    await expect(annotate.execute({ projectId, captureId, requestId, annotation })).resolves.toMatchObject({ ok: true });
    await expect(annotate.execute({ projectId, captureId, requestId, annotation: { ...annotation, purpose: "Changed semantics" } })).resolves.toMatchObject({ ok: false, error: { rule: "capture-association-conflict" } });
    await expect(annotate.execute({ projectId, captureId, requestId: "req_018f47de-7a00-7cc0-8000-000000000099" as RequestId, annotation })).resolves.toMatchObject({ ok: false, error: { rule: "capture-association-conflict" } });
    await expect(annotate.execute({ projectId: "proj_018f47de-7a00-7cc0-8000-000000000099" as typeof projectId, captureId, requestId, annotation })).resolves.toMatchObject({ ok: false, error: { rule: "capture-store-corruption" } });
    const hasher = new JcsSha256Hasher();
    const listed = await new FsBeaconStore({ projectRoot: root, hasher }).listBeacons();
    expect(listed.ok && listed.value).toHaveLength(1);
  });
});
