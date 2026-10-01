import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
// Structural subset of Pi's documented ExtensionAPI and ExtensionCommandContext;
// Pi supplies the actual interfaces at runtime without bundling another Pi copy.
type CommandContext = { mode: string; ui: { notify(message: string, kind: "info" | "error"): void; select(title: string, options: string[]): Promise<string | undefined> } };
type CommandAPI = { registerCommand(name: string, command: { description: string; handler(args: string, ctx: CommandContext): Promise<void> }): void };
import { canonicalConsentGrantPayload, canonicalConsentGrantPayloadV2, createHostConsentRuntime, type ConsentRequest, type ConsentGrant, type ConsentRequestV2, type ConsentGrantV2 } from "pharos/host-consent";

type Broker = ReturnType<typeof createHostConsentRuntime>;
type Signer = { privateKey: KeyObject; publicKey: string; keyId: string };
const hostId = "pharos-pi";

// Fixed narrow columns leave space for Pi's select border and option labels.
// Split by code point so a long unbroken JSON string cannot hide its suffix.
function reviewPages(request: ConsentRequest | ConsentRequestV2, comparison?: unknown): string[] {
  const text = `Exact public request and binding:\n${JSON.stringify(request, null, 2)}${comparison === undefined ? "" : `\nTrusted semantic comparison (active / draft):\n${JSON.stringify(comparison, null, 2)}`}`;
  // Encode source delimiters and slashes too: no literal text can impersonate a marker.
  const safe = Array.from(text, (char) => ((/[\p{Cc}\p{Cf}\p{M}\p{Zl}\p{Zp}]/u.test(char) || (char !== " " && /\p{White_Space}/u.test(char)) || "\\⟦⟧".includes(char)) && char !== "\n")
    ? `⟦U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧` : char).join("");
  const lines = safe.split("\n").flatMap((line) => {
    const chars = line.match(/⟦U\+[0-9A-F]{4,6}⟧|[\s\S]/gu) ?? [];
    const chunks: string[] = [];
    let chunk = "";
    for (const char of chars) {
      if (chunk.length + char.length > 24) { chunks.push(chunk); chunk = ""; }
      chunk += char;
    }
    chunks.push(chunk);
    return chunks;
  });
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += 6) pages.push(`Pharos review ${pages.length + 1}/${Math.ceil(lines.length / 6)}\n${i === 0 ? "Markers: ⟦U+XXXX⟧ = source codepoint\n" : ""}${lines.slice(i, i + 6).join("\n")}`);
  return pages;
}

// 24 wide Unicode columns can occupy 48 cells; reserve 16 for Pi chrome.
function safeViewport(width: () => number | undefined, height: () => number | undefined): boolean {
  const columns = width();
  const rows = height();
  return Number.isSafeInteger(columns) && columns! >= 64 && Number.isSafeInteger(rows) && rows! >= 20;
}
async function showReview(ctx: CommandContext, width: () => number | undefined, height: () => number | undefined, request: ConsentRequest | ConsentRequestV2, comparison?: unknown): Promise<boolean> {
  for (const page of reviewPages(request, comparison)) {
    if (!safeViewport(width, height)) return false;
    if (await ctx.ui.select(page, ["Continue", "Cancel"]) !== "Continue" || !safeViewport(width, height)) return false;
  }
  return safeViewport(width, height);
}

/** Injection is for hermetic tests; the default is the in-process host runtime, never a CLI or tool. */
export default function extension(pi: CommandAPI, seams: { broker?: () => Broker; width?: () => number | undefined; height?: () => number | undefined } = {}): void {
  let signer: Signer | undefined;
  const broker = seams.broker ?? (() => createHostConsentRuntime());
  const width = seams.width ?? (() => process.stdout.columns);
  const height = seams.height ?? (() => process.stdout.rows);
  pi.registerCommand("pharos-consent-recover", {
    description: "Resume a claimed Pharos consent request after inspecting its public binding",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") { ctx.ui.notify("Pharos recovery requires interactive TUI", "error"); return; }
      const requestId = args.trim();
      if (!/^req_[A-Za-z0-9_-]+$/.test(requestId)) { ctx.ui.notify("Provide one claimed request ID", "error"); return; }
      try {
        const runtime = broker();
        const inspected = await runtime.inspectRecovery(requestId);
        if (!inspected.ok) { ctx.ui.notify("Pharos recovery outcome unconfirmed; inspect status before taking further action", "error"); return; }
        const request = inspected.value.request;
        if (!(["pharos.operator-consent-request/1", "pharos.operator-consent-request/2"] as string[]).includes(request.contract) || request.binding.requestId !== requestId || !["approve", "revoke"].includes(request.binding.action)) {
          ctx.ui.notify("Pharos recovery outcome unconfirmed; inspect status before taking further action", "error"); return;
        }
        const comparison = request.contract === "pharos.operator-consent-request/2" ? await runtime.reviewComparison(requestId) : undefined;
        if (comparison && !comparison.ok) { ctx.ui.notify("Trusted comparison unavailable", "error"); return; }
        const recoveryState = comparison?.ok ? comparison.value.alreadyCommitted ? "Already committed; resume finalization" : "Pending mutation" : "Claimed action";
        if (!await showReview(ctx, width, height, request, comparison?.ok ? comparison.value : undefined)) return;
        if (!safeViewport(width, height)) return;
        const choice = await ctx.ui.select(`Pharos ${recoveryState}. Original binding reviewed on every page.`, ["Resume", "Cancel"]);
        if (choice !== "Resume" || !safeViewport(width, height)) return;
        if (comparison) {
          const checked = await runtime.reviewComparison(requestId);
          if (!checked.ok || !comparison.ok || JSON.stringify(checked.value) !== JSON.stringify(comparison.value)) { ctx.ui.notify("Trusted comparison changed", "error"); return; }
        }
        const result = await runtime.resumeClaim(requestId);
        ctx.ui.notify(result.ok ? "Pharos recovery completed; inspect status for the public result" : "Pharos recovery outcome unconfirmed; inspect status before taking further action", result.ok ? "info" : "error");
      } catch {
        try { ctx.ui.notify("Pharos recovery outcome unconfirmed; inspect status before taking further action", "error"); } catch { /* UI itself may be interrupted. */ }
      }
    },
  });
  pi.registerCommand("pharos-consent", {
    description: "Review a pending Pharos operator consent request in the interactive terminal",
    handler: async (args, ctx) => {
      try {
      if (ctx.mode !== "tui") { ctx.ui.notify("Pharos consent requires interactive TUI", "error"); return; }
      const requestId = args.trim();
      if (!/^req_[A-Za-z0-9_-]+$/.test(requestId)) { ctx.ui.notify("Provide one pending request ID", "error"); return; }
      const runtime = broker();
      const inspected = await runtime.inspect(requestId);
      if (!inspected.ok) { ctx.ui.notify("Consent request unavailable or no longer pending", "error"); return; }
      const candidate = inspected.value.request;
      if (!(["pharos.operator-consent-request/1", "pharos.operator-consent-request/2"] as string[]).includes(candidate.contract) || candidate.binding.requestId !== requestId || !["approve", "revoke"].includes(candidate.binding.action) || !Number.isSafeInteger(candidate.expiresAtEpochMs) || Date.now() >= candidate.expiresAtEpochMs) {
        ctx.ui.notify("Unsupported or expired consent request", "error"); return;
      }
      const request = candidate;
      const comparison = request.contract === "pharos.operator-consent-request/2" ? await runtime.reviewComparison(requestId) : undefined;
      if (comparison && !comparison.ok) { ctx.ui.notify("Trusted comparison unavailable", "error"); return; }
      // The complete public binding and trusted comparison precede the decision.
      if (!await showReview(ctx, width, height, request, comparison?.ok ? comparison.value : undefined)) return;
      if (!safeViewport(width, height)) return;
      const staleWarning = request.binding.action === "approve" && request.binding.staleOriginAcknowledged === true
        ? "WARNING: stale origin. Selecting Approve acknowledges divergence from the draft's origin.\n"
        : "";
      const choice = await ctx.ui.select(`Pharos pending action (binding reviewed on every page):\n${staleWarning}Approve only the reviewed request.`, ["Approve", "Decline"]);
      if ((choice !== "Approve" && choice !== "Decline") || !safeViewport(width, height)) return;
      if (choice === "Decline") {
        const result = await runtime.decline(requestId);
        ctx.ui.notify(result.ok ? "Pharos request declined" : "Pharos consent outcome unconfirmed; inspect status before taking further action", result.ok ? "info" : "error");
        return;
      }
      if (comparison) {
        const checked = await runtime.reviewComparison(requestId);
        if (!checked.ok || !comparison.ok || !isDeepStrictEqual(checked.value, comparison.value)) { ctx.ui.notify("Trusted comparison changed", "error"); return; }
      }
      // Provision only after a recorded human decision. Private material never leaves this closure.
      if (!signer) {
        const keys = generateKeyPairSync("ed25519");
        signer = { privateKey: keys.privateKey, publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64"), keyId: `key_${randomUUID()}` };
      }
      const state = await runtime.trustState(hostId);
      if (!state.ok) { ctx.ui.notify("Host trust unavailable", "error"); return; }
      if (!state.value) {
        const registered = await runtime.register(hostId, signer.keyId, signer.publicKey);
        if (!registered.ok) { ctx.ui.notify("Host registration refused", "error"); return; }
      } else if (state.value.status !== "active") {
        ctx.ui.notify("Host trust revoked", "error"); return;
      } else if (state.value.activeKeyId !== signer.keyId || state.value.activePublicKey !== signer.publicKey) {
        const rotated = await runtime.rotate({ hostId, expectedRevision: state.value.revision, expectedKeyId: state.value.activeKeyId, nextKeyId: signer.keyId, nextPublicKey: signer.publicKey });
        if (!rotated.ok) { ctx.ui.notify("Host key rotation refused", "error"); return; }
      }
      const base = { decision: "granted", challengeId: request.challengeId, expiresAtEpochMs: request.expiresAtEpochMs, hostId, keyId: signer.keyId, algorithm: "ed25519" } as const;
      let grant: ConsentGrant | ConsentGrantV2;
      if (request.contract === "pharos.operator-consent-request/2") {
        const unsigned = { ...base, contract: "pharos.operator-consent-grant/2", binding: (request as ConsentRequestV2).binding } as const;
        const payload = canonicalConsentGrantPayloadV2(unsigned);
        if (!payload) { ctx.ui.notify("Unsupported consent grant", "error"); return; }
        grant = { ...unsigned, signature: sign(null, payload, signer.privateKey).toString("base64url") };
      } else {
        const unsigned = { ...base, contract: "pharos.operator-consent-grant/1", binding: (request as ConsentRequest).binding } as const;
        const payload = canonicalConsentGrantPayload(unsigned);
        if (!payload) { ctx.ui.notify("Unsupported consent grant", "error"); return; }
        grant = { ...unsigned, signature: sign(null, payload, signer.privateKey).toString("base64url") };
      }
      const result = await runtime.complete(requestId, grant);
      ctx.ui.notify(result.ok ? "Pharos consent completed; inspect status for the public result" : "Pharos consent outcome unconfirmed; inspect status before taking further action", result.ok ? "info" : "error");
      } catch {
        // Pi reports uncaught command failures; never let private broker errors reach that channel.
        try { ctx.ui.notify("Pharos consent unavailable; inspect status before retrying", "error"); } catch { /* UI itself may be interrupted. */ }
      }
    },
  });
}
