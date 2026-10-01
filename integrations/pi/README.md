# Local Pi consent adapter

Build and install this separate package locally before using `/pharos-consent`; the root CLI does not install it automatically. `@pharos/pi-consent` is private, version `0.0.0`, and unpublished. It depends on the `pharos` `0.0.0` runtime and expects Pi (`@earendil-works/pi-coding-agent`) from the host as a peer, not a bundled copy.

## Local setup

From this checkout, build Pharos with `npm run build`, then pack the root package and `integrations/pi/` and install **both** local tarballs in an isolated Pi environment with the Pi peer available. Load the installed package's `extension.ts` with Pi's extension loader (its `pi.extensions` metadata names that file); do not import TypeScript from `node_modules` using Node's native loader. An offline install may require `--legacy-peer-deps` when the Pi peer is not cached; that flag does not install Pi. Root tests alone do not prove isolated Pi loading or a live human TUI decision.

## Human decision

In a non-production project, use the CLI to prepare the action, then enter the slash command in an interactive Pi TUI:

```text
pharos beacon prepare approve <beacon-id> --request-id <req_id> --format json
/pharos-consent <req_id>
pharos beacon consent-status <req_id> --format json
pharos status <beacon-id> --format json
pharos beacon prepare revoke <beacon-id> --request-id <new_req_id> --reason "Reason for revocation" --format json
/pharos-consent <new_req_id>
pharos beacon consent-status <new_req_id> --format json
pharos status <beacon-id> --format json
```

After an interrupted completion that already claimed a request, inspect its public consent status and invoke `/pharos-consent-recover <req_id>` in the interactive TUI. This separate command displays the exact original public request and offers **Resume** / **Cancel**; for stale approval it also revalidates and displays the original semantic comparison, marking whether the new version already committed. Only Resume calls the host's stored-grant recovery path. The signed grant and private key are never displayed or supplied as command arguments. A claimed request may have expired since verification. If the outcome is unconfirmed, inspect status; the command does not automatically retry. Do not use the pending-decision command to recover a claimed request.

First initialize, capture, annotate, and inspect the Beacon as described in the [root guide](../../README.md). Use distinct `req_` IDs and a non-empty normalized revocation reason. The CLI returns a public `host-decision-required` request; Pi shows the complete public binding across numbered **Continue / Cancel** pages for approval and revocation, then offers fixed **Approve** / **Decline** choices. Recovery also pages the original binding before **Resume / Cancel**. Review pages JSON-serialize the public data and then display Unicode controls (Cc/Cf), combining marks, line/paragraph separators, and non-ASCII whitespace as atomic `⟦U+XXXX⟧` codepoint markers. Literal backslashes and marker delimiters are also encoded (`⟦U+005C⟧`, `⟦U+27E6⟧`, `⟦U+27E7⟧`), so source text cannot impersonate an actual control even across pages. This display-only encoding does not change the request or grant. Pi must report at least 64 terminal columns (48 content cells plus 16 reserved chrome cells) and 20 rows (header, first-page legend, six content lines, two options and Pi chrome). Unknown or smaller dimensions, or a resize detected before or after any page or final choice, refuse the action without deciding. Tests inject both dimensions; a real TUI uses `process.stdout.columns` and `process.stdout.rows`. Pi's select renderer does not expose a resize event to this adapter, so a transient resize entirely within one pending select call cannot be observed; inspect every page in a stable terminal before deciding. For stale-origin drafts, preparation creates a signed-request candidate under the separate version-2 contract with `staleOriginAcknowledged: true` and the reviewed active version ID/hash (both null if no active version) and comparison digest; no authority is granted by preparation. Pi reads the trusted active version's stored semantics and presents the complete public request plus redacted, difference-marked active/draft comparison (or explicit no-active state) across numbered **Continue / Cancel** pages. Only after those pages does it offer **Approve / Decline**, warn about intentional replacement, and recheck the displayed snapshot before signing. Recovery similarly pages the original review before **Resume / Cancel**. The Beacon store makes the final locked check; if the active version or its semantics changed, start a new request rather than reusing the stale one. Decline is terminal for that request without mutation. The command refuses non-TUI use and is not a model-callable tool. On interruption or an uncertain completion, inspect consent status before trying anything else. Never paste signing material or grants into chat, commands, or logs.

Legacy TTY `beacon approve` and `beacon revoke` routes are unregistered; historical internal builders are not a supported route. `operator_confirmed` is not proof of human identity. Arbitrary malicious same-user shell/process access is outside scope. Production targets, readiness, handoff, generation, execution, and verification are unavailable; local setup makes no publication or delivery claim.
