import { describe, it, expect, vi } from "vitest";
import { createHash, createPublicKey, verify } from "node:crypto";
import { canonicalConsentGrantPayloadV2 } from "../../../src/adapters/host-consent-verifier/index.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { FsCaptureStore } from "../../../src/adapters/fs-capture-store/index.js";
import { ApproveBeaconDraft } from "../../../src/application/approve-beacon-draft.js";
import { FsProjectContextStore } from "../../../src/adapters/fs-project-context-store/index.js";
import { FsConsentStore } from "../../../src/adapters/fs-consent-store/index.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/index.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import { createHostConsentRuntime } from "pharos/host-consent";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsHostTrustRegistry } from "../../../src/adapters/fs-host-trust-registry/index.js";
import extension from "../../../integrations/pi/extension.js";
type CommandContext = Parameters<Parameters<typeof extension>[0]["registerCommand"]>[1]["handler"] extends (a: string, ctx: infer C) => Promise<void> ? C : never;
import type { ConsentGrant, ConsentRequest } from "../../../src/host-consent/index.js";

const request = { contract: "pharos.operator-consent-request/1" as const, binding: { action: "revoke" as const, projectId: "prj_a", beaconId: "bcn_a", expectedActiveVersion: "ver_a", reason: "Unsafe", requestId: "req_a" }, challengeId: "challenge", expiresAtEpochMs: Date.now() + 100000 };

function reviewed(ui: { select: { mock: { calls: [string, string[]][] } } }): string {
  return ui.select.mock.calls.filter(([, options]) => options.includes("Continue")).map(([title]) => title.split("\n").slice(1).filter((line) => !line.startsWith("Markers:")).join("\n")).join("").replace(/\n/g, "");
}

function setup(choice: string | undefined, mode = "tui", width: () => number | undefined = () => 80, height: () => number | undefined = () => 24) {
  const handlers = new Map<string, (args: string, ctx: CommandContext) => Promise<void>>();
  const pi = { registerCommand: vi.fn((name: string, command: { handler: (args: string, ctx: CommandContext) => Promise<void> }) => { handlers.set(name, command.handler); }), registerTool: vi.fn() };
  const broker = { inspectRecovery: vi.fn(async () => ({ ok: true, value: { request, auditId: "audit_a" } })), resumeClaim: vi.fn(async () => ({ ok: true, value: { status: "revoked" } })), inspect: vi.fn(async () => ({ ok: true, value: { status: "pending", request: request as ConsentRequest } })), decline: vi.fn(async () => ({ ok: true, value: { status: "declined" } })), complete: vi.fn(async (requestId: string, grant: ConsentGrant) => { void requestId; void grant; return { ok: true, value: { status: "revoked" } }; }), trustState: vi.fn(async () => ({ ok: true, value: undefined })), register: vi.fn(async (hostId: string, keyId: string, publicKey: string) => { void hostId; void keyId; void publicKey; return { ok: true, value: { status: "registered" } }; }), rotate: vi.fn() };
  const ui = { select: vi.fn(async (_title: string, options: string[]) => options.includes("Continue") ? (choice === undefined || choice === "Cancel" ? choice : "Continue") : choice), notify: vi.fn() };
  extension(pi as unknown as Parameters<typeof extension>[0], { broker: () => broker as unknown as ReturnType<typeof import("../../../src/host-consent/index.js").createHostConsentRuntime>, width, height });
  return { run: (name = "pharos-consent", id = "req_a") => handlers.get(name)!(id, { mode, ui } as unknown as CommandContext), broker, pi, ui };
}

describe("bounded review for every consent version", () => {
  it.each(["\u202e", "\u200b", "\u0301"])('escapes unsafe v1 reason %s', async (char) => {
    const s = setup("Approve");
    s.ui.select.mockImplementation(async (_title, options) => options.includes("Continue") ? "Continue" : "Decline");
    s.broker.inspect.mockResolvedValueOnce({ ok: true, value: { status: "pending", request: { ...request, binding: { ...request.binding, reason: `before${char}after literal \\u202e` } } } });
    await s.run();
    const titles = s.ui.select.mock.calls.map(([title]) => title).join("\n");
    expect(titles).toContain(`⟦U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧`);
    expect(reviewed(s.ui)).toContain("literal ⟦U+005C⟧⟦U+005C⟧u202e");
    expect(titles).not.toContain(char);
    expect(titles).toContain("Markers:");
  });
  it('distinguishes literal escape spelling from an actual control across page boundaries', async () => {
    const s = setup("Approve");
    s.broker.inspect.mockResolvedValueOnce({ ok: true, value: { status: "pending", request: { ...request, binding: { ...request.binding, reason: `${"x".repeat(140)}\\u{202E}\u202e⟦U+202E⟧` } } } });
    await s.run();
    const displayed = s.ui.select.mock.calls.filter(([, options]) => options.includes("Continue")).map(([title]) => title).join(" ");
    expect(reviewed(s.ui)).toContain("⟦U+005C⟧⟦U+005C⟧u{202E}⟦U+202E⟧");
    expect(displayed.match(/⟦U\+[0-9A-F]{4,6}⟧/g)?.length).toBeGreaterThan(3);
    expect(displayed).toContain("⟦U+202E⟧");
    expect(displayed).toContain("⟦U+27E6⟧U+202E⟦U+27E7⟧");
    expect(displayed).not.toContain("\u202e");
  });
  it('refuses unknown, short and resized terminal rows before decisions and recovery', async () => {
    for (const heights of [[undefined], [19], [24, 19]]) {
      let i = 0;
      const s = setup("Approve", "tui", () => 80, () => heights[Math.min(i++, heights.length - 1)]);
      await s.run();
      expect(s.ui.select.mock.calls.some(([, choices]) => choices.includes("Approve"))).toBe(false);
      expect(s.broker.complete).not.toHaveBeenCalled();
      expect(s.broker.register).not.toHaveBeenCalled();
      expect(s.broker.decline).not.toHaveBeenCalled();
    }
    const s = setup("Resume", "tui", () => 80, () => 19);
    await s.run("pharos-consent-recover");
    expect(s.broker.resumeClaim).not.toHaveBeenCalled();
    expect(s.ui.select).not.toHaveBeenCalled();
  });
  it('refuses unknown, narrow and resized terminal before decisions', async () => {
    for (const widths of [[undefined], [30], [80, 30]]) {
      let i = 0;
      const s = setup("Approve", "tui", () => widths[Math.min(i++, widths.length - 1)]);
      await s.run();
      expect(s.ui.select.mock.calls.some(([, options]) => options.includes("Approve"))).toBe(false);
      expect(s.broker.register).not.toHaveBeenCalled();
    }
  });
  it("shows every wide character across bounded pages before approval", async () => {
    const s = setup("Continue");
    const wide = "界".repeat(180);
    s.broker.inspect.mockResolvedValueOnce({ ok: true, value: { status: "pending", request: { ...request, binding: { ...request.binding, reason: wide } } } });
    s.ui.select.mockImplementation(async (_title, options) => options.includes("Continue") ? "Continue" : "Approve");
    await s.run();
    const pages = s.ui.select.mock.calls.filter(([, options]) => options.includes("Continue"));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map(([title]) => title).join("").split("界").length - 1).toBe(180);
    expect(pages.every(([title]) => title.split("\n").every((line) => Array.from(line).reduce((n, c) => n + (c === "界" ? 2 : 1), 0) <= 48))).toBe(true);
    expect(s.ui.select.mock.calls.at(-1)?.[1]).toEqual(["Approve", "Decline"]);
  });
  it("cancels a middle v1 revoke page without touching pending consent", async () => {
    const s = setup("Continue");
    s.broker.inspect.mockResolvedValueOnce({ ok: true, value: { status: "pending", request: { ...request, binding: { ...request.binding, reason: "界".repeat(180) } } } });
    s.ui.select.mockResolvedValueOnce("Continue").mockResolvedValueOnce("Cancel");
    await s.run();
    expect(s.ui.select).toHaveBeenCalledTimes(2);
    expect(s.broker.decline).not.toHaveBeenCalled();
    expect(s.broker.complete).not.toHaveBeenCalled();
    expect(s.broker.register).not.toHaveBeenCalled();
  });
});

describe("v2 Pi semantic decision boundary", () => {
  const v2 = { contract: "pharos.operator-consent-request/2" as const, challengeId: "challenge_v2", expiresAtEpochMs: Date.now() + 60_000, binding: { action: "approve" as const, projectId: "prj_a", beaconId: "bcn_a", draftId: "drf_a", expectedRevision: 2, semanticHash: "sha256:draft", requestId: "req_a", staleOriginAcknowledged: true as const, reviewed: { activeVersionId: null, activeSemanticHash: null, comparisonDigest: "sha256:comparison" } } };
  const comparison = { activeVersionId: null, activeSemanticHash: null, active: null, draft: { purpose: "Reviewed" }, equal: false };
  function seeded(choice: string | undefined, recover = false) {
    const s = setup(choice);
    s.broker.inspect.mockResolvedValue({ ok: true, value: { status: "pending", request: v2 } } as never);
    s.broker.inspectRecovery.mockResolvedValue({ ok: true, value: { request: v2, auditId: "audit_a" } } as never);
    Object.assign(s.broker, { reviewComparison: vi.fn(async () => ({ ok: true, value: comparison })) });
    return { ...s, runV2: () => s.run(recover ? "pharos-consent-recover" : "pharos-consent") };
  }
  it("escapes v2 purpose controls and marks in the trusted projection", async () => {
    const s = seeded("Continue");
    const review = s.broker as typeof s.broker & { reviewComparison: ReturnType<typeof vi.fn> };
    review.reviewComparison.mockResolvedValue({ ok: true, value: { ...comparison, draft: { purpose: "A\u202eB\u200bC\u0301\u00a0D\u2028E" } } });
    s.ui.select.mockImplementation(async (_title, options) => options.includes("Continue") ? "Continue" : "Decline");
    await s.runV2();
    const titles = s.ui.select.mock.calls.map(([title]) => title).join("\n");
    for (const code of ["202E", "200B", "0301", "00A0", "2028"]) expect(reviewed(s.ui)).toContain(`⟦U+${code}⟧`);
    for (const char of ["\u202e", "\u200b", "\u0301", "\u00a0", "\u2028"]) expect(titles).not.toContain(char);
    expect(reviewed(s.ui)).toContain('"comparisonDigest": "sha256:comparison"');
  });
  it("keeps wide trusted semantic projection visible before final approval", async () => {
    const s = seeded("Continue");
    const wide = "界".repeat(150);
    const review = s.broker as typeof s.broker & { reviewComparison: ReturnType<typeof vi.fn> };
    review.reviewComparison.mockResolvedValue({ ok: true, value: { ...comparison, draft: { purpose: wide } } });
    s.ui.select.mockImplementation(async (_title, options) => options.includes("Continue") ? "Continue" : "Approve");
    await s.runV2();
    const pages = s.ui.select.mock.calls.filter(([, options]) => options.includes("Continue"));
    expect(pages.map(([title]) => title).join("").split("界").length - 1).toBe(150);
    expect(pages.every(([title]) => title.split("\n").every((line) => Array.from(line).reduce((n, c) => n + (c === "界" ? 2 : 1), 0) <= 48))).toBe(true);
    expect(s.ui.select.mock.calls.at(-1)?.[1]).toEqual(["Approve", "Decline"]);
    expect(s.broker.complete).toHaveBeenCalledOnce();
  });
  it("shows the trusted comparison and signs the v2 domain only after approval", async () => {
    const s = seeded("Continue");
    s.ui.select.mockImplementation(async (_title, options) => options.includes("Continue") ? "Continue" : "Approve");
    await s.runV2();
    const pages = s.ui.select.mock.calls.filter(([, options]) => options.includes("Continue"));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every(([title, options]) => title.split("\n").length <= 8 && options.join() === "Continue,Cancel")).toBe(true);
    const displayed = reviewed(s.ui);
    for (const value of ["pharos.operator-consent-request/2", "req_a", "sha256:draft", "sha256:comparison", "Reviewed", "active", "draft"]) expect(displayed).toContain(value);
    expect(s.ui.select.mock.calls.at(-1)?.[1]).toEqual(["Approve", "Decline"]);
    expect(s.broker.complete).toHaveBeenCalledOnce();
    const grant = s.broker.complete.mock.calls[0]![1] as never;
    expect(grant).toMatchObject({ contract: "pharos.operator-consent-grant/2", binding: v2.binding });
    const publicKey = s.broker.register.mock.calls[0]![2];
    expect(verify(null, canonicalConsentGrantPayloadV2(grant)!, createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }), Buffer.from((grant as { signature: string }).signature, "base64url"))).toBe(true);
    expect(JSON.stringify(s.ui.notify.mock.calls)).not.toContain((grant as { signature: string }).signature);
  });
  it.each(["Decline", undefined])("does not sign a %s decision", async (choice) => {
    const s = seeded(choice); await s.runV2();
    expect(s.broker.complete).not.toHaveBeenCalled();
    expect(s.broker.register).not.toHaveBeenCalled();
  });
  it("cancels a middle review page without signing or declining", async () => {
    const s = seeded("Continue");
    s.ui.select.mockResolvedValueOnce("Continue").mockResolvedValueOnce("Cancel");
    await s.runV2();
    expect(s.ui.select).toHaveBeenCalledTimes(2);
    expect(s.broker.complete).not.toHaveBeenCalled();
    expect(s.broker.decline).not.toHaveBeenCalled();
    expect(s.broker.register).not.toHaveBeenCalled();
  });
  it("refuses a changed trusted comparison before signing", async () => {
    const s = seeded("Approve");
    const review = s.broker as typeof s.broker & { reviewComparison: ReturnType<typeof vi.fn> };
    review.reviewComparison.mockResolvedValueOnce({ ok: true, value: comparison }).mockResolvedValueOnce({ ok: false, error: { rule: "draft-association-mismatch" } });
    await s.runV2();
    expect(s.broker.complete).not.toHaveBeenCalled();
    expect(s.broker.register).not.toHaveBeenCalled();
  });
  it.each(["alreadyCommitted", "activeVersionId", "draft", "active", "redacted marker"])("refuses an ok-but-changed %s comparison before provisioning", async (field) => {
    const s = seeded("Continue");
    s.ui.select.mockImplementation(async (_title, options) => options.includes("Continue") ? "Continue" : "Approve");
    const changed = field === "redacted marker" ? { ...comparison, draft: { purpose: "Reviewed", actor: { identityRef: "[redacted; changed]" } } } :
      field === "draft" ? { ...comparison, draft: { purpose: "Different" } } :
      field === "active" ? { ...comparison, active: { purpose: "New active" } } :
      { ...comparison, [field]: field === "alreadyCommitted" ? true : "ver_new" };
    const review = s.broker as typeof s.broker & { reviewComparison: ReturnType<typeof vi.fn> };
    review.reviewComparison.mockResolvedValueOnce({ ok: true, value: comparison }).mockResolvedValueOnce({ ok: true, value: changed });
    await s.runV2();
    expect(s.broker.register).not.toHaveBeenCalled();
    expect(s.broker.complete).not.toHaveBeenCalled();
    expect(s.ui.notify).toHaveBeenCalledWith("Trusted comparison changed", "error");
  });
  it("refuses unavailable comparison before choice and non-TUI before broker", async () => {
    const s = seeded("Approve");
    (s.broker as typeof s.broker & { reviewComparison: ReturnType<typeof vi.fn> }).reviewComparison.mockResolvedValueOnce({ ok: false, error: { rule: "corrupt" } });
    await s.runV2();
    expect(s.ui.select).not.toHaveBeenCalled();
    expect(s.broker.complete).not.toHaveBeenCalled();
    const nonTui = setup("Approve", "rpc"); await nonTui.run();
    expect(nonTui.broker.inspect).not.toHaveBeenCalled();
  });
  it("displays a verified claim before resuming without a new signature", async () => {
    const s = seeded("Continue", true);
    s.ui.select.mockImplementation(async (_title, options) => options.includes("Continue") ? "Continue" : "Resume");
    await s.runV2();
    expect(s.ui.select.mock.calls.filter(([, options]) => options.includes("Continue")).map(([title]) => title).join("\n")).toContain("Reviewed");
    expect(s.ui.select.mock.calls.at(-1)?.[1]).toEqual(["Resume", "Cancel"]);
    expect(s.broker.resumeClaim).toHaveBeenCalledOnce();
    expect(s.broker.register).not.toHaveBeenCalled();
  });
});

describe("human-only Pi recovery", () => {
  it("refuses non-TUI and invalid IDs before broker access", async () => {
    const nonTui = setup("Resume", "rpc");
    await nonTui.run("pharos-consent-recover");
    expect(nonTui.broker.inspectRecovery).not.toHaveBeenCalled();
    const invalid = setup("Resume");
    await invalid.run("pharos-consent-recover", "invalid");
    expect(invalid.broker.inspectRecovery).not.toHaveBeenCalled();
  });
  it.each([undefined, "Cancel", "Approve"])('never resumes without explicit Resume (%s)', async (choice) => {
    const s = setup(choice);
    await s.run("pharos-consent-recover");
    if (choice === "Approve") expect(s.ui.select.mock.calls.at(-1)?.[1]).toEqual(["Resume", "Cancel"]);
    expect(reviewed(s.ui)).toContain('"contract": "pharos.operator-consent-request/1"');
    expect(s.broker.resumeClaim).not.toHaveBeenCalled();
  });
  it("resumes an expired claimed request without exposing grant or calling pending decision", async () => {
    const s = setup("Resume");
    const expired = { ...request, expiresAtEpochMs: 1 };
    s.broker.inspectRecovery.mockResolvedValueOnce({ ok: true, value: { request: expired, auditId: "audit_a" } });
    await s.run("pharos-consent-recover");
    expect(reviewed(s.ui)).toContain('"expiresAtEpochMs": 1');
    expect(s.ui.select.mock.calls.at(-1)?.[1]).toEqual(["Resume", "Cancel"]);
    expect(s.broker.resumeClaim).toHaveBeenCalledExactlyOnceWith("req_a");
    expect(s.broker.complete).not.toHaveBeenCalled();
    expect(s.broker.inspect).not.toHaveBeenCalled();
    expect(s.ui.notify).toHaveBeenCalledWith("Pharos recovery completed; inspect status for the public result", "info");
  });
  it.each(["returned", "thrown"])('reports %s errors as fixed unconfirmed outcome without retry', async (failure) => {
    const s = setup("Resume");
    if (failure === "returned") s.broker.resumeClaim.mockResolvedValueOnce({ ok: false, error: { rule: "private-grant-marker" } } as never);
    else s.broker.resumeClaim.mockRejectedValueOnce(new Error("private-grant-marker"));
    await s.run("pharos-consent-recover");
    expect(s.ui.notify).toHaveBeenCalledWith("Pharos recovery outcome unconfirmed; inspect status before taking further action", "error");
    expect(JSON.stringify(s.ui)).not.toContain("private-grant-marker");
    expect(s.broker.resumeClaim).toHaveBeenCalledTimes(1);
  });
});

describe("human-only Pi consent", () => {
  it.each(["Approve", "Decline"])("reports returned %s failure as unconfirmed without leaking broker rules or retrying", async (choice) => {
    const s = setup(choice);
    s.broker.complete.mockResolvedValueOnce({ ok: false, error: { rule: "private-canary" } } as never);
    s.broker.decline.mockResolvedValueOnce({ ok: false, error: { rule: "private-canary" } } as never);
    await s.run();
    expect(s.ui.notify).toHaveBeenCalledWith("Pharos consent outcome unconfirmed; inspect status before taking further action", "error");
    expect(JSON.stringify(s.ui.notify.mock.calls)).not.toContain("private-canary");
    expect(JSON.stringify(s.ui.notify.mock.calls)).not.toContain("consent refused");
    expect(s.broker.complete).toHaveBeenCalledTimes(choice === "Approve" ? 1 : 0);
    expect(s.broker.decline).toHaveBeenCalledTimes(choice === "Decline" ? 1 : 0);
  });
  it.each(["select", "inspect", "trustState", "complete"])("contains %s exceptions without exposing private material", async (step) => {
    const s = setup("Approve");
    const secret = "private-grant-marker";
    if (step === "select") s.ui.select.mockRejectedValueOnce(new Error(secret));
    if (step === "inspect") s.broker.inspect.mockRejectedValueOnce(new Error(secret));
    if (step === "trustState") s.broker.trustState.mockRejectedValueOnce(new Error(secret));
    if (step === "complete") s.broker.complete.mockRejectedValueOnce(new Error(secret));
    await expect(s.run()).resolves.toBeUndefined();
    expect(s.ui.notify).toHaveBeenCalledWith("Pharos consent unavailable; inspect status before retrying", "error");
    expect(JSON.stringify(s.ui.notify.mock.calls)).not.toContain(secret);
    if (step === "select" || step === "inspect") {
      expect(s.broker.register).not.toHaveBeenCalled();
      expect(s.broker.decline).not.toHaveBeenCalled();
      expect(s.broker.complete).not.toHaveBeenCalled();
    }
    if (step === "trustState") expect(s.broker.complete).not.toHaveBeenCalled();
  });
  it("completes and declines through a real project-scoped runtime with simulated TUI choices", async () => {
    const root = await mkdtemp(join(tmpdir(), "pharos-pi-real-"));
    try {
      const home = join(root, "home"), cwd = join(root, "project");
      await mkdir(cwd);
      const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
      const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
      const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
      const contexts = new FsProjectContextStore({ home });
      expect(await contexts.initialize({ context: { contract: "pharos.project-context/1", projectId, revision: 1, name: "Checkout", mode: "external", environment: "staging", baseUrl: "https://staging.example.test/", createdAt: "2026-03-01T00:00:00.000Z" }, associationPath: cwd, requestId: "req_init", inputHash: "init" })).toMatchObject({ ok: true });
      const projectRoot = join(home, "store", projectId);
      const beacon = new FsBeaconStore({ projectRoot, hasher: new JcsSha256Hasher() });
      const content = { purpose: "Renew", actor: { type: "user" }, entryPoint: { path: "/checkout" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } } as const;
      expect(await beacon.createDraft(beaconId, { draftId, label: "Renew", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "seed-draft")).toMatchObject({ ok: true });
      const versionId = "ver_018f47de-7a00-7cc0-8000-000000000001";
      expect(await beacon.approveDraft(beaconId, { draftId, expectedRevision: 1, reviewedHash: new JcsSha256Hasher().hash(project(content)), versionId, approvedAt: new Date().toISOString(), actor: "operator", staleOriginAcknowledged: false }, "seed-approval")).toMatchObject({ ok: true });
      const store = new FsConsentStore({ projectRoot });
      const makeRequest = (id: string) => ({ contract: "pharos.operator-consent-request/1" as const, binding: { action: "revoke" as const, projectId, beaconId, expectedActiveVersion: versionId, reason: "withdrawn", requestId: id }, challengeId: `challenge_${id}`, expiresAtEpochMs: Date.now() + 60_000 });
      const approved = makeRequest("req_approve");
      const declined = makeRequest("req_decline");
      expect(await store.createChallenge(approved, Date.now())).toMatchObject({ ok: true });
      expect(await store.createChallenge(declined, Date.now())).toMatchObject({ ok: true });
      const runtime = createHostConsentRuntime({ home, cwd, projectId });
      const invoke = async (id: string, choice: string | undefined, mode = "tui") => {
        const handlers = new Map<string, (args: string, ctx: CommandContext) => Promise<void>>();
        const pi = { registerCommand: (name: string, command: { handler: (args: string, ctx: CommandContext) => Promise<void> }) => { handlers.set(name, command.handler); } };
        const ui = { select: vi.fn(async (_title: string, options: string[]) => options.includes("Continue") ? (choice === undefined ? undefined : "Continue") : choice), notify: vi.fn() };

        extension(pi as unknown as Parameters<typeof extension>[0], { broker: () => runtime, width: () => 80, height: () => 24 });
        await handlers.get("pharos-consent")!(id, { mode, ui } as unknown as CommandContext);
        return ui;
      };
      const cancelled = await invoke(approved.binding.requestId, undefined);
      expect(cancelled.select).toHaveBeenCalledOnce();
      expect(await store.getChallenge(approved.binding.requestId, Date.now())).toMatchObject({ ok: true, value: { status: "pending" } });
      const noTui = await invoke(approved.binding.requestId, "Approve", "rpc");
      expect(noTui.select).not.toHaveBeenCalled();
      expect(await runtime.trustState("pharos-pi")).toMatchObject({ ok: true, value: undefined });
      await invoke(declined.binding.requestId, "Decline");
      expect(await store.getChallenge(declined.binding.requestId, Date.now())).toMatchObject({ ok: true, value: { status: "declined" } });
      expect(await runtime.trustState("pharos-pi")).toMatchObject({ ok: true, value: undefined });
      const ui = await invoke(approved.binding.requestId, "Approve");
      expect(reviewed(ui)).toContain(`"requestId": "${approved.binding.requestId}"`);
      expect(ui.select.mock.calls.at(-1)?.[1]).toEqual(["Approve", "Decline"]);
      expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
      expect(await store.getChallenge(approved.binding.requestId, Date.now())).toMatchObject({ ok: true, value: { status: "consumed" } });
      const trust = await runtime.trustState("pharos-pi");
      expect(trust).toMatchObject({ ok: true, value: { status: "active" } });
      expect(JSON.stringify(ui.notify.mock.calls)).not.toContain("signature");
      expect(await runtime.complete(declined.binding.requestId, {} as ConsentGrant)).toMatchObject({ ok: false });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("approves a persisted promoted capture through the real Pi callback and rotates trust on restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "pharos-pi-approval-"));
    try {
      const home = join(root, "home"), cwd = join(root, "project");
      await mkdir(cwd);
      const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
      const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
      const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
      const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
      const contexts = new FsProjectContextStore({ home });
      expect(await contexts.initialize({ context: { contract: "pharos.project-context/1", projectId, revision: 1, name: "Checkout", mode: "external", environment: "staging", baseUrl: "https://staging.example.test/", createdAt: "2026-03-01T00:00:00.000Z" }, associationPath: cwd, requestId: "req_init", inputHash: "init" })).toMatchObject({ ok: true });
      const projectRoot = join(home, "store", projectId);
      const hasher = new JcsSha256Hasher();
      const beacon = new FsBeaconStore({ projectRoot, hasher });
      const capture = new FsCaptureStore({ projectRoot });
      const content = { purpose: "Renew", actor: { type: "user" }, entryPoint: { path: "/checkout" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } } as const;
      const semanticHash = hasher.hash(project(content));
      const begin = { projectId, captureId, requestId: "req_018f47de-7a00-7cc0-8000-000000000001" as const, inputHash: "sha256:capture", secretSourceReferences: [], createdAt: "2026-03-01T00:00:00.000Z" };
      expect(await capture.beginLaunch(begin)).toMatchObject({ ok: true });
      expect(await capture.recordRecorderStarted(projectId, captureId, { pid: 4242, identity: "a".repeat(64) })).toMatchObject({ ok: true });
      expect(await capture.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z")).toMatchObject({ ok: true });
      const artifact = { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 0, sha256: createHash("sha256").update("").digest("hex") };
      await writeFile(join(projectRoot, "capture-staging", captureId, "recording.spec.ts"), "", { mode: 0o600 });
      expect(await capture.resolve(projectId, captureId, { resolution: "promote", artifact }, "2026-03-01T00:02:00.000Z")).toMatchObject({ ok: true, value: { status: "promoted" } });
      expect(await beacon.createDraft(beaconId, { draftId, label: "Renew", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "seed-draft")).toMatchObject({ ok: true });
      const pending = { contract: "pharos.capture-beacon-association/1" as const, state: "pending" as const, projectId, captureId, requestId: begin.requestId, inputHash: "sha256:annotation", beaconId, draftId, revision: 1 as const, createdAt: "2026-03-01T00:03:00.000Z" };
      expect(await capture.claimAnnotation(pending)).toMatchObject({ ok: true });
      expect(await capture.commitAssociation({ ...pending, state: "committed", semanticHash, committedAt: "2026-03-01T00:04:00.000Z" })).toMatchObject({ ok: true });
      const consent = new FsConsentStore({ projectRoot });
      const prepare = new ApproveBeaconDraft({ clock: { now: () => new Date() }, ids: { next: () => "ver_018f47de-7a00-7cc0-8000-000000000001" }, hasher, captureStore: capture, beaconStore: beacon, consentStore: consent, issueChallenge: () => ({ challengeId: "challenge_approval", expiresAtEpochMs: Date.now() + 60_000 }) });
      const requestId = "req_018f47de-7a00-7cc0-8000-000000000002" as const;
      const prepared = await prepare.prepareConsent({ projectId, beaconId, requestId });
      expect(prepared).toMatchObject({ ok: true, value: { request: { binding: { action: "approve", projectId, beaconId, draftId, expectedRevision: 1, semanticHash } } } });
      if (!prepared.ok) throw new Error("approval preparation failed");
      const runtime = createHostConsentRuntime({ home, cwd, projectId });
      const invoke = async (id: string) => {
        const handlers = new Map<string, (args: string, ctx: CommandContext) => Promise<void>>();
        const pi = { registerCommand: (name: string, command: { handler: (args: string, ctx: CommandContext) => Promise<void> }) => { handlers.set(name, command.handler); }, registerTool: vi.fn() };
        const ui = { select: vi.fn(async (_title: string, options: string[]) => options.includes("Continue") ? "Continue" : "Approve"), notify: vi.fn() };
        extension(pi as unknown as Parameters<typeof extension>[0], { broker: () => runtime, width: () => 80, height: () => 24 });
        await handlers.get("pharos-consent")!(id, { mode: "tui", ui } as unknown as CommandContext);
        expect(pi.registerTool).not.toHaveBeenCalled();
        return ui;
      };
      const first = await invoke(requestId);
      expect(reviewed(first)).toContain(`"requestId": "${requestId}"`);
      expect(first.select.mock.calls.at(-1)?.[1]).toEqual(["Approve", "Decline"]);
      expect(first.notify).toHaveBeenCalledWith("Pharos consent completed; inspect status for the public result", "info");
      const active = await beacon.getActiveVersion(beaconId);
      expect(active).toMatchObject({ ok: true, value: { status: "active" } });
      expect(await consent.getChallenge(requestId, Date.now())).toMatchObject({ ok: true, value: { status: "consumed", result: { assurance: "operator_confirmed", status: "active", versionId: active.ok && active.value ? active.value.versionId : "" } } });
      const registry = new FsHostTrustRegistry(projectRoot);
      const old = await registry.trustState("pharos-pi");
      expect(old).toMatchObject({ status: "active", revision: 0 });
      if (!old) throw new Error("missing registered host");
      const secondRequestId = "req_018f47de-7a00-7cc0-8000-000000000003" as const;
      const second = { contract: "pharos.operator-consent-request/1" as const, binding: { action: "revoke" as const, projectId, beaconId, expectedActiveVersion: active.ok && active.value ? active.value.versionId : "", reason: "withdrawn", requestId: secondRequestId }, challengeId: "challenge_revoke", expiresAtEpochMs: Date.now() + 60_000 };
      expect(await consent.createChallenge(second, Date.now())).toMatchObject({ ok: true });
      const restarted = await invoke(secondRequestId);
      expect(restarted.notify).toHaveBeenCalledWith("Pharos consent completed; inspect status for the public result", "info");
      const rotated = await registry.trustState("pharos-pi");
      expect(rotated).toMatchObject({ status: "active", revision: old.revision + 1 });
      expect(rotated?.activeKeyId).not.toBe(old.activeKeyId);
      expect(await registry.activeHostKey("pharos-pi", old.activeKeyId)).toBeUndefined();
      expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("registers no tool and refuses non-TUI before accessing broker", async () => {
    const s = setup("Approve", "rpc"); await s.run();
    expect(s.pi.registerTool).not.toHaveBeenCalled(); expect(s.broker.inspect).not.toHaveBeenCalled();
  });
  it("shows the exact pending request and never mutates on cancellation", async () => {
    const s = setup(undefined); await s.run();
    expect(s.ui.select.mock.calls[0]?.[1]).toEqual(["Continue", "Cancel"]);
    expect(s.broker.register).not.toHaveBeenCalled(); expect(s.broker.decline).not.toHaveBeenCalled(); expect(s.broker.complete).not.toHaveBeenCalled();
  });
  it.each([undefined, "Decline", "Approve"])('warns that Approve acknowledges stale origin divergence (%s)', async (choice) => {
    const s = setup(choice);
    const stale = { ...request, binding: { action: "approve" as const, projectId: "prj_a", beaconId: "bcn_a", draftId: "drf_a", expectedRevision: 2, semanticHash: "sha256:abc", requestId: "req_a", staleOriginAcknowledged: true } };
    s.broker.inspect.mockResolvedValueOnce({ ok: true, value: { status: "pending", request: stale } });
    await s.run();
    const [title, choices] = s.ui.select.mock.calls.at(-1)!;
    if (choice !== undefined) expect(reviewed(s.ui)).toContain('"staleOriginAcknowledged": true');
    if (choice !== undefined) {
      expect(title).toContain("WARNING: stale origin");
      expect(title).toContain("Selecting Approve acknowledges divergence from the draft's origin.");
      expect(choices).toEqual(["Approve", "Decline"]);
    } else expect(choices).toEqual(["Continue", "Cancel"]);
    expect(s.broker.complete).toHaveBeenCalledTimes(choice === "Approve" ? 1 : 0);
    expect(s.broker.decline).toHaveBeenCalledTimes(choice === "Decline" ? 1 : 0);
    expect(s.broker.register).toHaveBeenCalledTimes(choice === "Approve" ? 1 : 0);
    if (choice === "Approve") expect(s.broker.complete.mock.calls[0]![1].binding).toEqual(stale.binding);
  });
  it("does not warn for ordinary approval", async () => {
    const s = setup(undefined);
    const ordinary = { ...request, binding: { action: "approve" as const, projectId: "prj_a", beaconId: "bcn_a", draftId: "drf_a", expectedRevision: 2, semanticHash: "sha256:abc", requestId: "req_a" } };
    s.broker.inspect.mockResolvedValueOnce({ ok: true, value: { status: "pending", request: ordinary } });
    await s.run();
    expect(reviewed(s.ui)).toContain('"contract": "pharos.operator-consent-request/1"');
    expect(s.ui.select.mock.calls[0]![0]).not.toContain("stale origin");
  });
  it("declines only after explicit choice", async () => {
    const s = setup("Decline"); await s.run(); expect(s.broker.decline).toHaveBeenCalledWith("req_a"); expect(s.broker.complete).not.toHaveBeenCalled();
  });
  it("registers a key accepted by the real filesystem trust registry before completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "pharos-pi-trust-"));
    try {
      const registry = new FsHostTrustRegistry(root);
      const s = setup("Approve");
      s.broker.register.mockImplementation(async (hostId, keyId, publicKey) => {
        await registry.register(hostId, keyId, publicKey);
        return { ok: true, value: { status: "registered" } };
      });
      await s.run();
      expect(s.broker.complete).toHaveBeenCalledOnce();
      const [, grant] = s.broker.complete.mock.calls[0]!;
      expect(await registry.activeHostKey(grant.hostId, grant.keyId)).toBeDefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("registers an ephemeral key and completes with a signed exact grant", async () => {
    const s = setup("Approve"); await s.run(); expect(s.broker.register).toHaveBeenCalledOnce();
    const grant = (s.broker.complete as unknown as { mock: { calls: [string, ConsentGrant][] } }).mock.calls[0]![1];
    expect(grant.binding).toEqual(request.binding); expect(grant.signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(JSON.stringify(s.ui.notify.mock.calls)).not.toContain(grant.signature);
  });
});
