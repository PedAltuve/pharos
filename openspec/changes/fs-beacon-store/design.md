# Design: fs-beacon-store (Slice D) — canonical on-disk Beacon store

**Change**: `fs-beacon-store` · **Phase**: design · **Store**: hybrid (this file authoritative) · **Ratified inputs**: `docs/technical-design-v1.md` §4–§6, G1–G7

> **Revision 2 (remediation).** Sections marked **[R]** were changed or added to close thirteen defects found by fresh-context validation. The largest structural change: **supersession is derived by a backward walk from committed roots, not by an unqualified `supersedes` witness** (D1), and **every mutation now has an explicit commit point, crash window, and classification row** — not just `approveDraft` (D1b, D1c, D1d). Unmarked sections are unchanged and were validated as sound; a defect-to-section index closes the document.
>
> **Revision 3 (surgical).** Sections marked **[R3]** close three MAJOR defects that revision 2's own remediation introduced, nine minor ones, and encode four operator rulings. The three MAJOR fixes: **on-disk casing no longer applies to caller-keyed payloads** (K2 in D6 — revision 2's blanket snake_case rule silently corrupted `SemanticSource` and `SemanticProjection`); **adoption compares input-determined fields, not bytes** (D6b — `local_number` and `supersedes_version` are aggregate-derived, so a normal interleaving was being classified as corruption); and **the three draft mutations' post-commit journal window now has a classification row and a recovery action** (D1e). Everything revision 2 fixed stays fixed: D1's rooted backward walk, D3's `inputHash` builders, D2/D4/D5/D8/D10–D13 are untouched by this revision.

## Technical Approach **[R]**

`FsBeaconStore` is a **transaction orchestrator over pure domain mutations**. Every mutating port method executes the same envelope: acquire the project lock → run the target beacon's approval replay → read and reconstruct the `Beacon` from disk → check the idempotency journal → call the *unchanged* Slice C domain function (`createDraft`, `updateDraft`, `forkDraft`, `abandonDraft`, `approveDraft`, `revokeVersion`) → project the returned `Beacon` back to files through the atomic-write seam → write the journal entry → release the lock.

The domain stays the sole author of Beacon semantics; the adapter contributes only durability, exclusivity, and reconstruction. Three decisions carry the slice: the **write seam** (durability), the **committed-chain derivation rule** (reconstruction), and the **idempotency stamp carried by every store-written file except `active.json`** (replay — see D6b for the exclusion). Everything else follows from them.

**Two invariants govern every mutating path** and are relied on by the crash analysis throughout:

- **I1 — a refused mutation leaves no *projection* of itself on disk. [R3]** No file that projects the current command's `Beacon` is created, modified or removed before the domain call returns `ok`. Revision 2 stated this as the stronger "no file is written before the domain call returns `ok`", which the envelope's own steps contradict: step (1) creates `lock` and D2's liveness probe, and step (1a) applies replay writes. Those three are **not** projections of this command — they are mutual exclusion, a filesystem-clock reading, and the completion of a *previously committed* mutation, respectively — and each is separately justified where it is introduced. `fs-beacon-store` R5 scenario 1 states the projection property for `approveDraft`; the adapter generalises it to all six mutations. This is what closes D10's bootstrap-ordering trap, and the weaker wording closes it just as completely, because a `duplicate-draft-id` refusal still cannot leave a `beacon.json`.
- **I2 — every mutation has exactly one commit point, and every crash window reconstructs into a well-formed `Beacon` on which no domain function throws. [R3]** A pre-commit window reconstructs to the pre-state. A post-commit window reconstructs either to the committed post-state or to an *intermediate* that a declared replay action completes to it. Revision 2 additionally claimed every window yields "a `Beacon` the domain itself could have produced"; that is false in exactly the window recovery R3 describes — `active.json → V` with draft `D` still `open` is unreachable as a domain return value, because `approveDraft` closes `D` in the same value that activates `V`. Narrowed accordingly: an intermediate need only be **reconstructible and completable**, not domain-producible. Totality (no reconstruction makes a domain function throw) is the property the crash analysis actually relies on, and it survives unchanged.

| Mutation | Commit point | Post-commit replayable steps | Classification rows |
|---|---|---|---|
| `createDraft` (incl. bootstrap) | `drafts/<D>/draft.json` | journal entry | D1d + **D1e [R3]** |
| `updateDraft` | `drafts/<D>/draft.json` | journal entry | **D1e [R3]** |
| `forkDraft` | `drafts/<D2>/draft.json` | journal entry | **D1e [R3]** |
| `abandonDraft` | `drafts/<D>/tombstone.json` | remove `draft.json`; journal entry | D1b |
| `approveDraft` | `active.json` | close `draft.json`; journal entry | D1 |
| `revokeVersion` | `versions/<V>/revocation.json` | remove `active.json` when it named `V`; journal entry | D1c |

**Every declared commit point has a classification row and a recovery action. [R3]** Revision 2 declared "journal entry" a post-commit replayable step for the three draft mutations but supplied no mechanism for it: D1 is version-scoped, D1b covers only abandonment, D1d only the bootstrap window, and no `RecoverAction` member fired. D1e supplies the missing rows.

---

## Architecture Decisions

> **Revision 4 (orchestrator, surgical).** Sections marked **[R3]** in this revision were applied directly by the orchestrator under explicit operator authorization, after revision 3's validation found two MAJOR defects that were each a one-cell table correction. Applied: `actions[].value`, `nonSensitiveExample` and each constraint's `value` added to D6's exempt-node table, which had claimed exhaustiveness while omitting them; K2 split into K2a (open-keyed record — keys verbatim, values recursed) and K2b (opaque subtree — verbatim throughout), resolving the undefined granularity; `approved_revision` moved to D6b's aggregate-derived column, since `approval.ts:74` reads it from the aggregate and `ApproveDraftCommand` never declares it; a positive-integer guard on the lock holder's `pid`, because POSIX `kill` treats a non-positive pid as a process group and would have made a `"pid": 0` lock permanently unbreakable; `.tmp.` excluded from the id alphabet, which had silently collided with D8's listing filter; the `idempotency` stamp claim scoped to exclude `active.json`; the key-ordering claim corrected for integer-like keys; the lint citation split into its two real rules; and the ports barrel pinned to `export type` only. Two spec amendments accompany this revision: `fs-beacon-store` R2 (the `rename`-versus-exclusive-create impossibility, plus a carve-out for the lock and probe per ratified G1) and `beacon-store-recovery` R1 (modifying an existing write-once file versus creating a missing one).
>
> **Revision 4, second pass.** Validation of the first pass found that four of its fixes had been applied at one site while the identical claim survived at sibling sites, and that amending spec R2 had left stale departure notes standing against the amended text in six places. Swept: the `idempotency`-stamp scoping propagated to all four sites; the key-ordering correction propagated to D8; every `fs-beacon-store` R2 departure note re-attributed, since no departure from the amended R2 remains and the residual one is from `docs/technical-design-v1.md:151`; the leaked-temp age gate **removed** from the lock-free scan phase, which has neither lock nor clock, with the convergence question resolved at the spec level instead; C2's scenario-2 conformance claim corrected, since call 1's action set is bounded by *completion of already-committed mutations*, not by the replay requirement's narrower text; D6b's classification test restated as "does this field hold the same value for a given command input across every legal interleaving", which is what its own columns implement; D2's `hostname` check made conditional on the holder record having parsed, so a zero-byte lock reaches the age gate instead of being permanently unbreakable; and id-validation failure split by provenance — a caller-supplied id returns a not-found refusal, an on-disk segment throws. `beacon-store-recovery` R1 scenario 2 was amended a second time accordingly.

### D1 — Committed state is derived by a backward walk from committed roots **[R]**

`beacon-store-recovery` R3 defers the algorithm. This is it.

> **What changed and why.** Revision 1 declared `V` committed if "some `W`'s manifest declares `supersedes: V`", with `W` unqualified. That is unsound. Trace: `V1` active → `approveDraft`→`V2` crashes after step 3 (orphan manifest, `supersedes: V1`) → a later `approveDraft`→`V3` succeeds and, because the active version at *its* step 3 was still `V1`, also records `supersedes: V1`. Two manifests then name `V1`, which revision 1's D4 table turned into a permanent `getBeacon` throw — falsifying its own claim that the rule made R2 "true by construction". Worse, if the orphan `V2` were chosen as the witness, `Beacon.versions[V1].supersededBy` would name a version deliberately excluded from the aggregate, breaking `fs-beacon-store` R1's round-trip scenario. Both breaks are fixed below by making the witness relation *directional and rooted* instead of *existential*.

**Read order** (per beacon `B`, every listing sorted first — see D8):

| # | Path | Yields |
|---|---|---|
| 1 | `beacons/B/versions/` | sorted version ids |
| 2 | `beacons/B/versions/<V>/manifest.json` | `version_id`, `local_number`, `approval`, `provenance`, `supersedes_version`, `idempotency` |
| 3 | `beacons/B/versions/<V>/revocation.json` | `RevocationRecord` + `previous_status` |
| 4 | `beacons/B/active.json` | `{ "active_version": "ver_…" }`, or absent |
| 5 | `beacons/B/drafts/<D>/tombstone.json` | abandoned-draft record (**wins over `draft.json`** — D1b) |
| 6 | `beacons/B/drafts/<D>/draft.json` | `status: "open" \| "closed"`, `approved_version_id`, `idempotency` (**[R3]** — the stamp of the last mutation that wrote this file; D1e reads it) |
| 7 | `journal/idempotency/<keyHash>.json` | entry present / absent |

#### The committed set

`manifest.json` carries `supersedes_version` — the id of the version that was active at *this* version's step 3, or `null`. It is a **back-pointer**, not a witness. The committed set is the transitive closure of the back-pointer from a set of roots:

**Roots** = { the version named by `active.json`, if present } ∪ { every `V` where `versions/V/revocation.json` exists }.

**Committed** = every version reachable from a root by repeatedly following `supersedes_version` until `null`. Only committed versions enter `Beacon.versions`.

Why roots are complete: `active.json` is absent only when no approval has ever committed, or when the active version was revoked — and a revoked version is itself a root by definition. So every committed version stays reachable across every legal sequence.

Why orphans stay excluded (`beacon-store-recovery` R2, both scenarios): an orphan `V2` is never *pointed at*. A later approval reads its predecessor from `active.json`, which the crashed transaction never advanced, so the successor's back-pointer skips `V2` and names `V1`. No number of later approvals can pull `V2` into the closure. The two-manifests-name-`V1` state is therefore **normal and expected**, not corruption.

**Supersession is read off the walk, not searched for.** When the walk steps from `W` to `V`, that step *is* the supersession fact: `V.status = "superseded"`, `V.supersededBy = W.versionId`, `V.supersededAt = W.approval.approvedAt`. Uniqueness is structural — a walk step has exactly one origin — so the reconstruction can never pick an orphan as `supersededBy`. The domain's `supersededBy` (`versions.ts:11-13`) is thus reproduced exactly, with no on-disk field of that name.

**Status derivation**, applied to committed versions only:

| Condition | Derived `Version` variant |
|---|---|
| `revocation.json` exists | `revoked`, `previousStatus` from the file, `revocation` from the file |
| else, reached as a walk step from `W` | `superseded`, `supersededBy = W.versionId`, `supersededAt = W.approval.approvedAt` |
| else (a root reached from nothing) | `active` |

**At most one version derives to `active`**, which is what the aggregate requires. Row 3 can only apply to an `active.json` root: a revocation root always matches row 1, and every other committed version is reached as a walk step and matches row 2. There is at most one `active.json` root, so there is at most one `active` version.

**`activeVersionId` derivation.** `Beacon.activeVersionId` = the id in `active.json`, **unless that version derives to a non-`active` variant, in which case `null`**. This one clause is what keeps `resolveActiveVersion` (`active-version.ts:11-15`) from throwing in the revocation crash window (D1c) and reproduces `revocation.ts:41-42` exactly.

#### Keeping `supersedes_version` — the alternative considered

Deriving supersession from `local_number` or `approval.approved_at` ordering would remove the field, but both fail in the presence of orphans: an aborted orphan consumes a `local_number` that the next committed version reuses (Open Question 3), and `approved_at` is caller-supplied and may tie or move backwards. Only an explicit predecessor pointer — knowable at step 3, before the commit point — makes the committed set derivable at all. Kept, and recorded as an extension to §4:119's manifest field list (D9).

#### Classification table

Version-scoped rows (an approval artifact for version `V`, approved draft `D`):

| manifest | semantics | in committed set? | draft `D` | journal | Class → action |
|---|---|---|---|---|---|
| present | present | no | `open` | absent | **aborted** — report, never activate (R2) |
| absent | present | no | any | absent | **aborted** (partial step-3 artifact, no provenance to link) |
| present | present | yes, as root via `active.json` | `open` | absent | **replay 5–6** — close `D`, write journal entry (R3) |
| present | present | yes, as root via `active.json` | `closed`→`V` | absent | **replay 6** — write journal entry only |
| present | present | yes | `closed`→`V` | present | **complete** — no action |
| present | present | yes, superseded or revoked | `closed`→`V` | present | **complete** — normal history |
| present | present | yes, revoked | any | absent | see D1c revocation rows |
| any | any | *other combination* | — | — | **unclassified** — report, take no action |

Draft-scoped and beacon-scoped rows are in D1b and D1d. Every row of every table is a RED test case.

Replay is possible only because `manifest.json` (written at step 3, **before** the commit point) carries the caller's idempotency stamp. Without it the key would exist only in the crashed process's memory and step 6 could never be reconstructed.

`recoverProject()` **never throws**: an unrecognised combination becomes an `unclassified` report entry and is left untouched. Read paths (`getBeacon`) do throw on the corruption conditions of D4 — a repair tool must survive what a read must not silently accept.

**Alternatives rejected**: scanning `journal/idempotency/*.json` and reverse-indexing by result reference (O(journal) per call, and still cannot reconstruct a *missing* entry's key); journal-first / event sourcing (explore Approach 3 — contradicts ratified §4/§5).

### D1b — All three `Draft` variants reconstruct; abandonment's write path **[R]**

> **What changed and why.** Revision 1 mapped `draft.json` to `"open" | "closed"` only. `src/domain/beacon/types.ts:37-46` defines a **third** variant, `abandoned`, which carries no `content` and instead carries `finalRevision`, `finalHash`, `reason`, `abandonedAt`. `tombstone.json` appeared in four places in revision 1 but in no read order, no reconstruction rule, and no write path — the same failure class as Slice C's closed-`Draft`-without-content defect. Fixed here.

**Reconstruction rule (total over the union):**

| On disk under `drafts/<D>/` | Reconstructed variant |
|---|---|
| `tombstone.json` present (regardless of `draft.json`) | `abandoned` — all fields from the tombstone |
| `draft.json` only, `status: "open"` | `open` — `revision`, `origin`, `content` |
| `draft.json` only, `status: "closed"` | `closed` — plus `approved_version_id`, `closed_at`, `content` retained |
| neither | directory ignored; reported `unclassified` if it exists at all |

**`tombstone.json` wins over `draft.json`.** That single precedence rule makes abandonment's crash window total: the tombstone is the commit point, and removing `draft.json` becomes replayable cleanup rather than part of the transaction.

**`abandonDraft` write sequence** (inside the same locked envelope, after I1's domain `ok`):

1. `createExclusive drafts/<D>/tombstone.json` ← ★ **COMMIT POINT** ★ (also gives `fs-beacon-store` R3 scenario 2 verbatim: a second abandonment hits `EEXIST` → `immutable-file-exists`)
2. `removeAtomic drafts/<D>/draft.json` (§4:116, §6:178)
3. `createExclusive` journal entry

| Crash window | On-disk state | Class → action |
|---|---|---|
| after 1, before 2 | tombstone + `draft.json` | **replay 2–3** — remove `draft.json`, write journal entry |
| after 2, before 3 | tombstone only, no journal | **replay 3** — write journal entry only |
| after 3 | tombstone + journal | **complete** |

**The `label` problem, and the departure it forces.** `docs/technical-design-v1.md:178` enumerates the tombstone as "(draft ID, origin, final revision + hash, timestamps, reason)" — **no `label`**. But the `abandoned` variant requires `label: string`, and §4:116/§6:178 both delete `draft.json`, the only other place `label` lives. The field would be permanently unrecoverable.

**Resolution: `tombstone.json` carries `label`.** Declared as a departure from §6:178, justified because `fs-beacon-store` R1 scenario 1 ("the reconstructed `Beacon` is structurally identical to the original") is normative and §6's parenthetical is an enumeration inside a prose bullet, not a schema. *Alternative rejected*: retain `draft.json` beside the tombstone — contradicts "replaces" (§6:178) and "draft.json removed" (§4:116) directly, and would leave two sources of truth for `origin`.

Tombstone payload: `draft_id`, `label` *(departure)*, `origin`, `final_revision`, `final_hash`, `reason`, `abandoned_at`, `idempotency`.

### D1c — `revokeVersion`'s on-disk projection **[R]**

> **What changed and why.** Revision 1 specified no write path for `revokeVersion` at all. `revocation.ts:41-42` sets `activeVersionId = null` when the revoked version is the active one, and the undeclared crash window (`active.json → V` while `V/revocation.json` exists) would have made `getActiveVersion` → `resolveActiveVersion` throw permanently.

**Write sequence** (inside the locked envelope, after I1's domain `ok`):

1. `createExclusive versions/<V>/revocation.json` ← ★ **COMMIT POINT** ★
2. if `active.json` named `V`: `removeAtomic beacons/<B>/active.json` (§4:112 — absent is the ratified representation of "no active version")
3. `createExclusive` journal entry

Step 1 is the commit point rather than step 2 because **the revoked state is fully derivable from `revocation.json` alone**: D1's `activeVersionId` clause already returns `null` when `active.json` names a version deriving to `revoked`. The `active.json` removal is redundant-but-tidy cleanup, so the window between 1 and 2 reconstructs to *exactly* the same `Beacon` the completed transaction produces. That is invariant I2 discharged for revocation, and it is why `resolveActiveVersion` never sees a corrupt pointer.

Making step 2 the commit point was rejected for the opposite reason: removing `active.json` first destroys the only root for the whole committed chain (D1), so a crash there would make every committed version unreachable — silent, total history loss.

| Crash window | On-disk state | Reconstruction | Class → action |
|---|---|---|---|
| before 1 | nothing written | version still `active`/`superseded` | **complete** — refused or unstarted, no artifact |
| after 1, before 2 | `revocation.json` + stale `active.json → V` | `V` revoked, `activeVersionId = null` | **replay 2–3** — remove `active.json`, write journal entry |
| after 2, before 3 | `revocation.json`, no `active.json`, no journal | correct | **replay 3** — write journal entry only |
| after 3 | all present | correct | **complete** |

Revoking a *superseded* (non-active) version never touches `active.json`, so its only windows are "after 1, before 3" (**replay 3**) and complete.

### D1d — `createDraft` bootstrap and the beacon-scoped rows **[R]**

`beacon-not-found` fires for exactly five mutations — `updateDraft`, `forkDraft`, `abandonDraft`, `approveDraft`, `revokeVersion` — and **not** for `createDraft`, which bootstraps (C3). See **D10 [R3]** in the data-flow section for the ordering that keeps invariant I1 intact.

| On disk under `beacons/<B>/` | Class |
|---|---|
| `beacon.json` present, no drafts, no versions | **complete** — a legal empty aggregate, not an artifact (this is also the `createDraft` crash window between `beacon.json` and `draft.json`) |
| draft or version directory present, `beacon.json` absent | **unclassified** — report, take no action |

### D1e — The mutable-commit-point journal window **[R3]**

> **What changed and why.** `createDraft`, `updateDraft` and `forkDraft` commit at the mutable `drafts/<D>/draft.json` and then write a journal entry. Revision 2 declared that window replayable but gave it no mechanism, so a crash there stranded the caller: a same-key `updateDraft` retry hit `stale-draft-revision` (`drafts.ts:69-76`) because the domain had already incremented the revision, and a `createDraft`/`forkDraft` retry hit `duplicate-draft-id` (`drafts.ts:39-41`, `drafts.ts:98-100`). D6b's adoption probe cannot cover it: adoption indexes write-once artifacts, and `draft.json` is mutable.

**The mechanism is the stamp already on the file, not a new index.** D6b puts `idempotency` on every store-written file except `active.json`, `draft.json` included. Revision 3 widens that stamp by one field:

```
"idempotency": { "key": "…", "key_hash": "…", "input_hash": "sha256:…", "method": "updateDraft" }
```

`method` **[R3]** is required because replay must author a journal entry, and a journal entry names its `method`. It was already implicitly needed by D1b's and D1c's "write journal entry only" replay rows, which revision 2 left unable to name the method they were replaying; adding it here discharges those rows too.

**Draft-scoped classification rows** (draft `D` under beacon `B`, `draft.json` present, no `tombstone.json`):

| `draft.json` stamp `key_hash` | `journal/idempotency/<key_hash>.json` | Class → action |
|---|---|---|
| present, `K` | present | **complete** — no action |
| present, `K` | absent | **replay journal** — write the entry from the stamp (`wrote-journal-entry`) |
| absent (a pre-Slice-D or hand-edited file) | — | **unclassified** — report, take no action |

The replayed entry is fully reconstructible from `draft.json` alone: `key`, `key_hash`, `input_hash` and `method` come from the stamp, and `result` is `{ beacon_id: B, draft_id: D, version_id: null, revision }` with `revision` read from the same file. No stored snapshot and no re-execution.

**Why this closes the stranding.** Step (1a) of the envelope runs scan-and-apply *before* step (1b)'s journal lookup. So on the honest same-key retry the replay writes the missing entry first, and (1b) then finds a journal hit with an equal `input_hash` and returns the re-read `Beacon` — the domain function is never reached, so neither `stale-draft-revision` nor `duplicate-draft-id` can fire. The window is closed by ordering that already existed, not by new machinery.

**Convergence.** The replay only ever *creates* a journal entry that is missing; it never rewrites one. From call 2 onward the first row applies and nothing is written, so `beacon-store-recovery` R1's convergence scenario holds for this window exactly as it does for the others.

**Overlap with D1, and why it is harmless.** When `approveDraft` crashes between the draft close and its journal entry, `draft.json` carries `approveDraft`'s stamp, so D1's *replay 6* row and D1e's *replay journal* row describe the same missing entry. `apply` deduplicates by `key_hash`: at most one `wrote-journal-entry` action is emitted per key per pass, and the write itself is `createExclusive`, so a redundant attempt would return `"exists"` rather than duplicate. When `approveDraft` crashes *before* the draft close, `draft.json` still carries the earlier draft mutation's stamp, whose entry is already present — D1e reads **complete** while D1 independently drives *replay 5–6*. The two tables key on different files and never contradict.

**Alternative rejected**: moving these mutations' commit point to the journal entry (write the entry first, `draft.json` second). That would make the journal the commit point for three mutations and `draft.json` for none, contradicting §5's "committed result reference" reading — the entry would reference a result that does not yet exist — and it would leave the opposite, worse window: a journal entry claiming a draft revision that no `draft.json` carries, which reconstructs into a `Beacon` the domain cannot produce (violating I2).

### D2 — Lock liveness: same-host PID probe, gated by a filesystem-clock age check **[R]**

Lock content: `{ pid, hostname, nonce }`. No timestamp field — there is no `Clock` port (Slice C deferred it) and age comes from the file's own `mtime`.

**Acquisition** (`fs-beacon-store` R4):

1. **`fs.open("<project>/lock", "wx")` [R3]**, write the holder record, close. Success → held; record `nonce`. The lock is created by `ProjectLock` itself, **not** through `AtomicWriter.createExclusive` — see the departure note below.
2. `EEXIST` → read the holder. Unparseable, zero-byte, **or a `pid` failing `Number.isInteger(pid) && pid > 0` [R3]** → treat as `pid: null`.
3. **Applies only when `pid !== null` and a `hostname` field is present [R4, predicate corrected in the second pass]**: `hostname !== os.hostname()` → **never break** (a remote PID is unprobeable). Wait, then refuse. In every other case — `pid === null` from step 2 for any reason, or a parsed record carrying a usable `pid` but no `hostname` — skip straight to step 5's age gate. The routing is decided by `pid` and by `hostname`'s *presence*, never by a parse-success flag.

   > **Two wrong predicates, both corrected [R4].** Revision 4's first pass left this check unconditional, so `undefined !== os.hostname()` was true for every zero-byte lock and step 5 was unreachable — a crashed holder's zero-byte lock became permanently unbreakable. The second pass then gated it on *"the holder record parsed"*, which is a different predicate again and diverges from this one on exactly the malformed inputs that matter: a record like `{"pid": 0, "hostname": "other-host"}` **does** parse and **does** carry a hostname, so it would have been routed to "never break" and stayed stuck, while a parsed record with a positive `pid` and no `hostname` would have hit `undefined !== os.hostname()` and stuck the same way. Neither shape is producible by this store — `process.pid` is always a positive integer — but D2 claims a *total* reading of any malformed lock, and only the predicate stated above delivers it.
4. `process.kill(pid, 0)` — reached only for a positive integer `pid` that step 3 did not divert **[R3]**: no throw or `EPERM` → **alive → never break**. `ESRCH` → **confirmed dead → break immediately, no age gate [R3]**. There is no `pid === null` case here: step 3 routes every `pid === null` lock straight to step 5, so this step is only ever entered with a probeable pid **[R4]**.

   > **Why step 2's positive-integer guard is load-bearing [R3].** POSIX `kill(2)` does not treat a non-positive `pid` as a process id: `0` targets the caller's **process group**, `-1` every process the caller may signal, and `pid < -1` a named process group. With signal `0` each of those is a permission check that **succeeds**. A lock file containing `"pid": 0` would therefore probe as *alive* at this step, and step 4's "alive → never break" would make it **permanently unbreakable** — total mutation denial on that project, not the bounded process-existence disclosure the Threat Matrix previously claimed. Revision 3's own DEF-10 fix removed the backstop that had masked this, by scoping the age gate to `pid === null`; routing a non-positive `pid` to `null` at step 2 restores it and is the correct fix regardless.
5. **Age gate [R], scoped to every holder step 3 could not identify well enough to probe [R4 — previously stated as "the `pid === null` case only", which step 3's corrected predicate widened].** Two classes reach it: `pid === null` from step 2 for any reason, and a parsed record carrying a usable positive `pid` but no `hostname`. `fs.open("<project>/probe.tmp.<uuid>", "wx")` in the project root — the same directory as `lock`, so both timestamps come from one filesystem clock. `stat` both, `unlink` the probe, then break only if `lock.mtime + staleAfterMs <= probe.mtime` (`staleAfterMs` default **`2_000` [R3]**).
6. Break = `unlink` the lock + fsync dir, then retry from 1.
7. Not breakable → sleep with jittered backoff (25 ms, doubling, cap 250 ms) until `waitMs` (default `5_000`), then refuse `lock-unavailable` carrying `{ holderPid, waitedMs }`.

**Why the age gate no longer covers `ESRCH` — and why revision 2's defaults broke R4 scenario 2 [R3].** Revision 2 gated *both* stale candidates behind `staleAfterMs` `30_000` while `waitMs` defaulted to `5_000`. A holder **confirmed dead** by `process.kill(pid, 0)` → `ESRCH` was therefore refused rather than broken for a full 30 seconds, so `fs-beacon-store` R4 scenario 2 — "the stale lock is **broken and the new call proceeds**" — was simply false in the shipped default configuration. Two changes fix it, and they interlock with step 1's `wx`:

- **`ESRCH` on a same-host PID is direct evidence of death**, not a heuristic. Nothing is gained by waiting, so the break is immediate and R4 scenario 2 holds with zero delay. PID recycling is still safe, because a recycled PID reports *alive* at step 4 and we over-refuse (below).
- **The age gate's real job is the `pid === null` case.** Step 1 creates the lock and writes its content as two operations, so a genuinely live holder has a sub-millisecond window in which `lock` is zero-byte and its holder unidentifiable. That window — not a dead process — is the only thing the gate ever needed to protect. `staleAfterMs` drops to `2_000`: orders of magnitude above that window, and now strictly below `waitMs`, so an orphaned unidentifiable lock is also broken within a single wait cycle instead of outliving it. The constructor asserts `staleAfterMs < waitMs`.

**The lock does not use the atomic-write protocol — and the amended R2 grants it that [R4].** `proposal.md:20` and ratified **G1** say the lock is "hand-rolled via `fs.open` `wx` plus liveness check". Revision 2 routed `lock` through `createExclusive` (tmp + `link`), conforming to neither. Revision 3 conformed to G1 and recorded a departure from `fs-beacon-store` R2, which then still demanded tmp → fsync → rename for every file the store writes. **That departure no longer exists**: the orchestrator amended R2, which now reads "The advisory lock file and any liveness-probe file are process-coordination artifacts, not Beacon state, and are exempt from this protocol: they MAY be created with a single exclusive-create open." This design conforms to the amended requirement literally. The residual departure is from `docs/technical-design-v1.md:151`, which still says "rename" for every write and has its own amendment path. The reasoning that motivated the amendment is preserved here because it is what justifies it: (a) the lock carries no Beacon state, so R2 scenario 1's guarantee — that no reconstructable content is ever observed half-written — has nothing to protect here; (b) step 2 already defines a **total** reading of a partial or zero-byte lock (`pid: null` → unidentifiable → age gate), so a torn lock is a modelled input rather than corruption; and (c) `wx` is a single syscall, so acquisition leaves no temp to leak on the store's hottest crash path, whereas tmp + `link` leaks one temp per interrupted acquisition. C1's `link` fork stays scoped to write-once **artifacts**. Same reasoning and same mechanism for `probe.tmp.<uuid>`, whose content is the empty string.

**Probe file properties [R]** — revision 1 left this file unnamed, unsequenced and unfiltered:

- **Named and sequenced**: `probe.tmp.<uuid>`, created and removed inside step 5 above. It is never a persistent artifact.
- **Filtered**: the `.tmp.` infix means D8's universal `.tmp.` listing filter already excludes it from every semantic listing — no separate rule, and no risk of it being read as a beacon id.
- **Never on a lock-free path**: the probe runs *only* during lock acquisition. Reads (`getBeacon`, `listBeacons`, `getActiveVersion`) never acquire, and `recoverProject()`'s scan phase never acquires (D5's two-phase design), so no lock-free path ever creates it. This is what keeps `beacon-store-recovery` R1 scenario 1 literally true.
- **Leak on crash**: a crash between create and `unlink` leaks one zero-byte `probe.tmp.<uuid>`. It is semantically inert (filtered) and is swept by the same leaked-temp rule as C1's write temps.

**Stale PID reuse** is handled by *never* breaking a live PID. If a dead holder's PID was recycled, step 4 reports alive and we over-refuse rather than break — safe by construction, and `lock-unavailable` surfaces **`holderPid` and `waitedMs` [R3]** so an operator can intervene. Note that the gate covers two classes, not one — `pid === null`, and a positive `pid` with no `hostname` **[R4]**; the clock-skew argument below holds for both, since it depends only on the gate being a *conjunct* with the break condition, never a disjunct. Revision 2's prose here named `heldForMs`, a field that exists in no interface in this document and could not exist without a `Clock` port; D3's `LockUnavailable` (`{ rule, holderPid, waitedMs }`) is authoritative and the prose now matches it. **Clock skew** cannot cause an unsafe break either: the gate now guards only the `pid === null` branch, where skew can delay acquisition but never authorise one, because the gate is a *conjunct* of the break condition and never a disjunct. The gate compares `mtime` against a probe file created in the same directory, so both timestamps come from the same filesystem clock.

**Release**: re-read the lock, verify our `nonce`, `unlink`, fsync dir. A foreign nonce means we lost the lock mid-transaction — throw (D4), because the transaction's guarantees are void.

All three constants are constructor options so tests can drive them to zero.

**Alternatives rejected**: mtime-only staleness (breaks a live but idle holder — forbidden by R4's third scenario); PID-only (never recovers from a crashed holder whose PID is free); `proper-lockfile` (new production dependency — G1/G6 forbid).

### D3 — The closed refusal union

`src/domain/ports/beacon-store-refusals.ts` defines the disk-only union required by `beacon-store-port` R3, plus the method-level union every port method returns:

```ts
export type ImmutableArtifact =
  | "manifest" | "semantics" | "revocation" | "tombstone" | "journal-entry";

export interface LockUnavailable {
  readonly rule: "lock-unavailable";
  readonly holderPid: number | null;
  readonly waitedMs: number;
}
export interface IdempotencyKeyConflict {
  readonly rule: "idempotency-key-conflict";
  readonly key: string;
  readonly storedInputHash: string;
  readonly requestedInputHash: string;
}
export interface ImmutableFileExists {
  readonly rule: "immutable-file-exists";
  readonly artifact: ImmutableArtifact;
  readonly beaconId: string;
  readonly ownerId: string;      // draftId | versionId | keyHash
}
export interface BeaconNotFound {
  readonly rule: "beacon-not-found";
  readonly beaconId: string;
}
export interface StoredVersionNotFound {
  readonly rule: "stored-version-not-found";
  readonly beaconId: string;
  readonly versionId: string;
}
// [R3] An earlier interrupted attempt under this same key left a write-once
// artifact whose aggregate-derived fields are now stale. Normal interleaving,
// not corruption. Named exit: retry with a fresh versionId and a fresh key.
export interface StaleAttemptArtifact {
  readonly rule: "stale-attempt-artifact";
  readonly artifact: ImmutableArtifact;
  readonly beaconId: string;
  readonly ownerId: string;
  readonly key: string;
}

// [R4] InvalidId: a caller-supplied id failing D7 layer 1 validation. Needed because
// a *new* id on a creation path (createDraft/forkDraft's draftId, approveDraft's
// versionId) is neither "not found" nor corruption, and beacon-store-port R3 forbids
// throwing for caller input. R3 says "at minimum", so a seventh member is permitted.
export interface InvalidId {
  readonly rule: "invalid-id";
  readonly field: "beaconId" | "draftId" | "versionId";
  readonly value: string;
}

export type BeaconStoreDiskRefusal =
  | LockUnavailable | IdempotencyKeyConflict | ImmutableFileExists
  | BeaconNotFound | StoredVersionNotFound | StaleAttemptArtifact
  | InvalidId;

export type BeaconStoreRefusal = BeaconRefusal | BeaconStoreDiskRefusal;
```

Naming follows `src/domain/beacon/refusals.ts` exactly: a `rule` discriminant in kebab-case plus flat identifying payload, one exported interface per member, union assembled last. No `path` field — an absolute path would leak `<pharos-home>` into a technology-neutral port; `artifact` + ids identify the file store-relatively.

`StoredVersionNotFound` is deliberately distinct from Slice C's `VersionNotFound` (`{ rule: "version-not-found", versionId }`): the domain's means "not in this aggregate", the store's means "no version directory under this beacon". Distinct discriminants keep exhaustive narrowing intact while satisfying R3's "not-found condition for beacons **and** versions addressed by id".

**Interaction with the committed set [R]**: `revokeVersion` addressed at an *orphan* version id hits the domain's `version-not-found`, not the store's — the directory exists, but D1 excludes it from `Beacon.versions`, so the domain is the one that refuses. `stored-version-not-found` is reserved for an id with no directory at all. The two are never both reachable for one call.

`BeaconStoreRefusal` composes in `BeaconRefusal` because a port mutation delegates to a domain mutation that can refuse, and R3 mandates a single error type per method. `beacon-store-port` R4's "stale-revision refusal" is therefore Slice C's existing `StaleDraftRevision` — literally "mirroring the pure domain's revision-bound semantics", raised after comparing `expectedRevision` to the persisted `draft.json`.

**Scenario mapping**: R3/lock-failure → `lock-unavailable`; R3/not-found → `beacon-not-found`; R2/different-input → `idempotency-key-conflict`; `fs-beacon-store` R3 (both scenarios) → `immutable-file-exists`; `beacon-store-port` R4 → `stale-draft-revision`.

**`stale-attempt-artifact` is the sixth member, and R3's "at minimum" permits it [R3].** `beacon-store-port` R3 enumerates four *minimum* disk-only failure modes; `stored-version-not-found` was already a fifth. This one exists because D6b's adoption probe has three outcomes, not two, and collapsing the third into `immutable-file-exists` was exactly the defect revision 3 fixes: it told the caller "corruption" about a state that is ordinary concurrency. Distinct discriminant, distinct remedy, exhaustive narrowing preserved. It is never returned by a read method.

### D4 — Result for refusals, throw for corruption **[R]**

Mirrors `resolveActiveVersion`'s identity-mismatch throw.

| Disk condition | Boundary |
|---|---|
| Lock unacquirable within the wait policy | `Result` refusal |
| Journal entry present, `inputHash` differs | `Result` refusal |
| A write-once path already holds another transaction's artifact (D6b) | `Result` refusal — `immutable-file-exists` |
| A write-once path holds *this key's* artifact with stale aggregate-derived fields (D6b) **[R3]** | `Result` refusal — `stale-attempt-artifact` |
| Beacon / version directory absent | `Result` refusal |
| Any `BeaconRefusal` from the pure mutation | `Result` refusal |
| Malformed JSON, or a `contract` string whose major version ≠ `1` | **throw** `BeaconStoreCorruptionError` |
| Embedded id ≠ directory name (beacon/draft/version) | **throw** |
| `active.json` names a version with no `manifest.json` | **throw** |
| `supersedes_version` names a version with no `manifest.json`, or the walk revisits a node (cycle) | **throw [R]** |
| A write-once path holds this key's artifact with an equal `input_hash` but a differing **input-determined** field (D6b) | **throw [R3]** |
| Path segment **read from disk** failing id validation (D7) | **throw** — corrupt store state **[R4]** |
| **Caller-supplied** id failing id validation, addressing existing state (D7) | `Result` refusal — not-found; never a throw, per `beacon-store-port` R3 scenario 2 **[R4]** |
| **Caller-supplied** id failing id validation, naming something being created (D7) | `Result` refusal — `invalid-id`; never a throw **[R4]** |
| Unmodelled `errno` (`EACCES`, `ENOSPC`, `EPERM` on write) | **throw** |
| Foreign nonce on lock release | **throw** |

**Rows deleted in revision 2, and why they were wrong [R]:**

| Deleted row | Why it was wrong |
|---|---|
| *Two versions both declaring `supersedes: V` → throw* | This is the **expected** state after one aborted approval followed by a successful one (D1's trace). Throwing here made `getBeacon` fail permanently on a beacon that revision 1's own R2 analysis claimed was safe. Superseded: the walk is directional, so multiple back-pointers to one predecessor are ordinary. |

**Rows explicitly declared NOT corruption [R]** — each is a legal crash window, and each has a RED test asserting no throw:

| Disk condition | Reconstruction |
|---|---|
| `active.json` names a version whose derived status is `revoked` | `activeVersionId = null` (D1c) — never a throw |
| `tombstone.json` and `draft.json` both present | `abandoned`; tombstone wins (D1b) |
| Two or more manifests carrying the same `supersedes_version` | orphan plus committed successor (D1) |
| Two or more manifests carrying the same `local_number` | orphan consumed a number the successor reused (D8, Open Question 3) |
| A version directory with `manifest.json` but outside the committed set | orphan — excluded from `Beacon.versions`, reported `aborted` |
| An orphan `manifest.json` carrying this key's stamp whose `local_number` or `supersedes_version` no longer matches what the retry derives **[R3]** | an unrelated mutation committed between the crash and the retry — refused `stale-attempt-artifact`, never a throw (D6b) |

`BeaconStoreCorruptionError` lives in the adapter (`corruption.ts`), never in the port — R3 requires only that documented *refusals* are values.

### D5 — The atomic-write seam **[R]**

`src/adapters/fs-beacon-store/atomic-writer.ts`, adapter-internal (not a domain port — it names paths and bytes):

```ts
export type WriteStage =
  | "tmp-written" | "tmp-fsynced" | "materialized" | "dir-fsynced";

export interface WriteObserver {
  onStage(stage: WriteStage, path: string): void | Promise<void>;
}

export interface AtomicWriter {
  writeAtomic(path: string, bytes: string): Promise<void>;
  createExclusive(path: string, bytes: string): Promise<"created" | "exists">;
  // [R4] Absent path is a no-op, never an error — D1b and D1c replay through this,
  // so idempotent convergence depends on it. Fsyncs the parent directory after an
  // actual unlink; skips the fsync when nothing was removed.
  removeAtomic(path: string): Promise<void>;
  readonly leakedTempPolicy: "sweep-on-recover";
}

// The observer belongs to the writer, not to the store. [R]
export class FsAtomicWriter implements AtomicWriter {
  constructor(options?: { observer?: WriteObserver });
}
```

**The observer is writer-owned [R].** Revision 1 had `FsBeaconStore` take both `writer` and `observer`, so an injected writer carrying its own observer could silently disagree with the store's. `FsBeaconStore` now takes `writer?: AtomicWriter` only (defaulting to `new FsAtomicWriter()` with a no-op observer); crash tests inject `new FsAtomicWriter({ observer })`. One source of truth, and the store no longer knows what a `WriteObserver` is.

`FsAtomicWriter` implements two materialisation strategies:

- **Mutable files** (`beacon.json`, `active.json`, `draft.json`) — `writeAtomic`: write `<name>.tmp.<uuid>` in the same directory → `fsync` file → `rename` → `fsync` parent dir. Literal `fs-beacon-store` R2.
- **Write-once artifacts** (`manifest`, `semantics`, `revocation`, `tombstone`, journal entry) — `createExclusive`: open tmp with `wx` → write → `fsync` file → **`link(tmp, final)`** → `unlink(tmp)` → `fsync` parent dir. `link` is atomic and fails `EEXIST` when the destination exists, giving TOCTOU-proof exclusive create. A crash before the link leaves **nothing** at the final path, so R2's "never observable half-complete" scenario holds for write-once files too.

**`lock` and `probe.tmp.<uuid>` are not on this list [R3].** They are `ProjectLock`'s own files, created with a direct `fs.open(path, "wx")` per **G1** and `proposal.md:20`, and they never route through `AtomicWriter`. Revision 2 listed them here, which put the lock on a tmp + `link` path that neither G1 nor the proposal specifies. The departure and its justification are stated in D2; the consequence for this seam is simply that `AtomicWriter` writes **artifacts only**.

**Why the temp is still opened `wx` [R].** All exclusivity lives in `link`; the UUID makes a temp collision effectively impossible, so `wx` on the temp is *not* load-bearing. It is kept for one reason: it converts an impossible-but-catastrophic collision (two concurrent writers silently sharing a temp path, one overwriting the other's bytes before `link`) into a loud `EEXIST`. Cost is zero. This is documented as decorative-but-retained so no future reader mistakes it for the immutability mechanism.

**Leaked temps [R].** A crash between temp-create and `link` (or `rename`) leaves an unreferenced `<name>.tmp.<uuid>` with no cleanup in revision 1. Policy now:

1. **Inert by default** — D8's universal `.tmp.` filter excludes every leftover from every semantic listing, so a leak can never be read as a beacon, draft, version or journal entry.
2. **Reported, and proposed unconditionally** — `recoverProject()`'s lock-free scan phase lists them as `leaked-temp` artifacts and proposes `swept-leaked-temp` for each, **without any age test [R4]**: it has neither the lock nor a clock, and D2's probe is created only during lock acquisition. A clean project has no leaked temps, so it proposes nothing and `beacon-store-recovery` R1 scenario 1 still holds literally.

   > **Why phase 1 proposes without judging age [R4].** The second pass removed the age test from this phase but did not say what phase 1 then does with a leaked temp, leaving both readings broken: proposing nothing would make `leakedTempPolicy: "sweep-on-recover"` false and the sweep unreachable from a standalone `recoverProject()`, while proposing conditionally is impossible without the clock this phase does not have. Proposing unconditionally and letting the locked phase 2 decline on age is the only coherent split. The consequence is explicit: a leaked temp younger than `staleAfterMs` means call 2 acquires the lock again and declines again. That is why the amended `beacon-store-recovery` R1 scenario 2 excludes clock-dependent temporary-file housekeeping from its convergence assertion — and why C2's conformance claim below is scoped to *completion* actions, not to every action.
3. **Swept** — the action phase, under the lock, `unlink`s only those whose `mtime` is older than `staleAfterMs` by D2's probe comparison. That phase holds the lock, so it may create the probe and read the one filesystem clock the design defines. The age gate prevents deleting a concurrent writer's in-flight temp; the lock makes concurrency impossible anyway, so this is defence in depth.

> **Why the age test lives only in the action phase [R4].** Revision 4's first pass mandated the same gate in the scan phase, to force convergence. That was wrong twice over. The scan phase is defined as lock-free, and `design.md`'s D2 states as a load-bearing property that the probe is created *only* during lock acquisition — so a scan-phase age test would either create a probe on a lock-free path, falsifying that property and `beacon-store-recovery` R1 scenario 1's literal truth, or introduce an undeclared wall clock and compare it against `mtime`, which is the cross-clock comparison D2 exists to avoid. It also did not achieve what it claimed: a temp younger than the gate at call 1 and older at call 2 still lets call 2 act where call 1 did not, so convergence was narrowed to the age boundary, never closed **by construction**. The honest resolution is at the spec level, and the orchestrator amended it: `beacon-store-recovery` R1 scenario 2 now excludes clock-dependent temporary-file housekeeping from its convergence assertion, on the ground that a temp is never reconstructable content and sweeping one cannot change any reconstructed `Beacon`. Convergence is asserted over completion of already-committed mutations, which *is* achievable by construction.

See **Conformance concern C1** — `rename` and exclusive-create are mutually exclusive; `link` is the materialization the amended `fs-beacon-store` R2 now mandates for write-once files, and `open(final, "wx")` is the recorded fork.

**Crash injection**: the seam invokes `observer.onStage(stage, path)` after every stage (default observer is a no-op). A test supplies an observer that throws `InjectedCrash` at a chosen `(stage, path)` pair. That interrupts a write *mid-sequence* — `"tmp-fsynced"` on `.../manifest.json` reproduces R2's before-rename scenario, and `"tmp-fsynced"` on `.../active.json` reproduces R5's crash-before-swap scenario — with **no `vi.mock("node:fs/promises")` anywhere**.

**Reuse by `fs-evidence-store`**: the seam names no Beacon concept — only paths, bytes and stages — so the future adapter imports it unchanged (`adapters → adapters` is permitted by `eslint.config.base.js`).

### D6 — Contract envelope, on-disk key casing, idempotency hashing **[R]**

**Envelope [R].** Revision 1 invented `{ "contract": { "kind", "version" }, "data": { … } }`. §7:202 already fixes the form — a top-level `contract` *string* — so conform instead of inventing:

```json
{
  "contract": "pharos.version-manifest/1",
  "idempotency": { "key": "…", "key_hash": "…", "input_hash": "sha256:…", "method": "approveDraft" },
  "version_id": "ver_…", "local_number": 3, "…": "…"
}
```

Kinds: `pharos.beacon/1`, `pharos.beacon-active/1`, `pharos.beacon-draft/1`, `pharos.beacon-tombstone/1`, `pharos.version-manifest/1`, `pharos.beacon-semantics/1`, `pharos.version-revocation/1`, `pharos.idempotency-entry/1`. A major version other than `1` is corruption (D4). This is the seam where §7's future preserve-but-block-authority policy lands; Ajv validation stays out of scope (**G5**).

**On-disk key casing — two rules, not one [R3].** Revision 1 wrote `activeVersionId` and a camelCase envelope while §4:112 specifies `{ "active_version": "ver_…" }` and §6:176 specifies `branched_from_version`, `branched_from_hash`, `forked_from_draft`. Revision 2 conformed by ruling that "**every on-disk key is snake_case**" — a blanket rule with no carve-out, which is **wrong and silently destructive**. Two payloads do not survive it:

- `draft.json` stores `Draft.content: SemanticSource`, and `src/domain/semantics/types.ts:104-106` defines `SemanticSource = SemanticSourceCore & { readonly [excludedField: string]: unknown }` — an **open record of caller-supplied keys**.
- `semantics.json` stores the `SemanticProjection`, whose `variables`, `outcomes`, `allowedVariation`, `prohibitedRegressions`, `checkpoints.entries` (in the `"keyed"` variant), each checkpoint's `expectations`, each `VariableDecl.constraints`, `entryPoint.query`, and `readinessIntent.isolation.scope` are all `Readonly<Record<string, …>>` keyed by **user-supplied logical identities** (`types.ts:12`, `40`, `57`, `63`, `94-97`).

Snake-casing those is **not invertible**: `foo_bar` reads back as either `fooBar` or `foo_bar`, and nothing on disk distinguishes them. That falsifies `fs-beacon-store` R1 scenario 1's "structurally identical" round-trip outright, and — far worse — it changes `project(draft.content)` and therefore `hasher.hash(project(draft.content))`. A store restart would then produce a different `currentHash` for unchanged content, breaking `reviewed-hash-mismatch` (`approval.ts:35`) and `Draft.finalHash` (`drafts.ts:143`) silently, with no error anywhere. The casing rule is therefore split and scoped:

> **K1 — closed-key envelope casing.** Keys the **store itself authors** are snake_case. Their set is closed and enumerated per file kind in `serialization.ts` as explicit object literals in a fixed authored order (never a generic string converter — D8 requires that order for byte stability). This covers `contract`, `idempotency`, `version_id`, `local_number`, `supersedes_version`, `active_version`, `branched_from_version`, `branched_from_hash`, `forked_from_draft`, `approved_version_id`, `previous_status`, and every other field this document names. It is the rule §4 and §6 were actually asking for.
>
> **K2 — caller-keyed payloads are stored verbatim.** Any JSON node whose **key set is open** — supplied by the caller rather than authored by the store — is written **key-verbatim**: never case-converted, never renamed, never filtered, never dropped. The boundary is drawn **per node, not per file**: a closed-key parent is snake_cased by K1 and its open-key child is passed through untouched by K2.

**K2 has two granularities, and the distinction is normative [R3].** Revision 3's validation found the single-granularity table undecidable — it listed `variables` and, separately, "each variable's `constraints`", which is redundant under a subtree reading and required under a key-level one. Split explicitly:

- **K2a — open-keyed record.** A node typed `Readonly<Record<string, T>>` whose *keys* are caller- or schema-supplied. Its **own keys** are emitted verbatim; each **value** is then processed recursively by K1/K2 according to that value's own type. So `VariableDecl.secretReferenceId`, a closed store-owned field sitting inside the open `variables` record, is still emitted as `secret_reference_id`.
- **K2b — opaque subtree.** A node whose *entire contents* are caller-authored, i.e. typed `SemanticSource` or `SemanticValue`. The whole subtree is emitted verbatim — keys, nesting and all. Nothing beneath it is ever converted.

Exempt nodes, exhaustively:

| File | Node held verbatim | Rule | Why it is open |
|---|---|---|---|
| `draft.json` | `content` (whole subtree, including its `SemanticSourceCore` fields) | K2b | `SemanticSource = SemanticSourceCore & { readonly [excludedField: string]: unknown }` (`semantics/types.ts:104-106`) — once the record is open, no key in it can be safely converted |
| `semantics.json` | `variables`, `outcomes`, `allowed_variation`, `prohibited_regressions`, `entry_point.query`, `readiness_intent.isolation.scope`, `checkpoints.entries` (`"keyed"` variant), each checkpoint's `expectations`, each variable's `constraints` | K2a | `Readonly<Record<string, …>>` keyed by logical identity or by schema-owned vocabulary |
| `semantics.json` | each action's `value.value` when `value.kind === "literal"` **[R3]** | K2b | `NormalizedActionValue`'s literal arm is `{ kind: "literal"; value: SemanticValue }` (`semantics/types.ts:44-46`), and `SemanticValue` admits `{ readonly [key: string]: SemanticValue }`. `normalize.ts:156-169` passes the caller's raw value through unchanged |
| `semantics.json` | each variable's `nonSensitiveExample` **[R3]** | K2b | `SemanticValue \| null` (`semantics/types.ts:30`) — same open record |
| `semantics.json` | each constraint's `value` **[R3]** | K2b | `NormalizedConstraint.value: SemanticValue` (`semantics/types.ts:22`) — same open record |

> **Why the last three rows exist.** Revision 3's first pass listed only the nine K2a nodes under a heading claiming exhaustiveness. `SemanticBundle.actions` is a *closed-key* member, so K1 applies down through it and an implementer reading the table would have snake_cased caller keys inside action literals — into `semantics.json`, which is **write-once and unrepairable** (`§4:121`). It escaped every mitigation: `semantics.json` is absent from D1's read order, so no round-trip test covers it, and D6b compares both sides through the same serializer, so adoption would still pass. A table that says "exhaustively" must be checked against the type graph, because implementers stop reading at the table and never reach the general rule above it.

Note the containers: `semantics.json`'s *own* field names are closed `SemanticBundle` members, so K1 snake_cases `allowedVariation` → `allowed_variation`, `entryPoint` → `entry_point`, and so on — and K2 then leaves the exempt nodes exactly as the caller wrote them. Determinism is unaffected: caller-keyed nodes are emitted in `Object.keys` order after an explicit `Array.prototype.sort` (never `localeCompare`). Note that JavaScript enumerates array-index-like keys first, in ascending numeric order, regardless of insertion order **[R3]** — so a record keyed `{"10","2","foo"}` emits `2,10,foo`. That is still deterministic, byte-stable and key-preserving, which is all D6b and D8 require; the earlier claim of strict UTF-16 code-unit order was simply not the observed behaviour. JCS sorts keys itself before hashing, so on-disk key order can never move a hash.

**The lesson recorded [R3].** This MAJOR was introduced while remediating D9 — a purely cosmetic casing MINOR. A cosmetic rule stated without a scope became a silent data-corruption rule. K1/K2 are stated as named rules with their rationale for exactly that reason, not as a footnote.

**Declared extensions to §4/§6 — ratified 2026-09-03 [R3]:**

| Extension | File | Justification | Status |
|---|---|---|---|
| `supersedes_version` | `manifest.json` | the committed set is underivable without it (D1) | **ratified by the operator, 2026-09-03** — approved as an extension to §4:119's prose enumeration |
| `label` | `tombstone.json` | the `abandoned` `Draft` variant requires it and §6 deletes its only other home (D1b) | **ratified by the operator, 2026-09-03** — approved as an extension to §6:178's prose enumeration |
| `idempotency` (`key`, `key_hash`, `input_hash`, `method`) | every store-written file **except `active.json`** (D6b) | replay across non-approval crash windows (D6b, D1e) | design-internal; §4/§6 enumerate no journal stamp either way |

Neither ratified extension is an open question any longer. Both §4:119 and §6:178 are prose enumerations inside bullets, not schemas, and the operator approved extending them.

**`keyHash` — plain `sha256` over the key's raw bytes, conforming to §5:170 literally [R3].** File: `journal/idempotency/<keyHash>.json`, where

```ts
// src/adapters/fs-beacon-store/journal.ts
import { createHash } from "node:crypto";
const keyHash = (key: string): string =>
  createHash("sha256").update(key, "utf8").digest("hex");
```

Revision 2 routed this through the injected `Hasher` and then *declared a departure*, because JCS quotes a top-level string: `canonicalize("abc")` is `"\"abc\""`, so the digest was `sha256("\"" + key + "\"")`, not §5:170's `sha256(key)`. The operator rejected that departure, and it is now deleted rather than justified — §5:170 is conformed to literally. Three lines, no new dependency: `node:crypto` is a Node builtin, so **G6**'s "exactly one production dependency (`canonicalize@2.1.0`)" is untouched, and the lint config scopes both relevant bans to `domain` and `shared` — `boundaries/external` at `eslint.config.base.js:51-57` and the separate `no-restricted-imports` block for `node:*` at `eslint.config.base.js:60-76` **[R3: the earlier citation folded both rules into one line range]**. So `src/adapters/fs-beacon-store/**` may import `node:crypto` exactly as `src/adapters/hashing/jcs-sha256-hasher.ts:3` already does.

**Scope of the change: `keyHash` only.** The injected `Hasher` remains the JCS path for `inputHash` and for all content hashing — those compare *logical* values, where canonicalisation is the whole point. `keyHash` compares nothing; it only maps an opaque key string to a filename, where a raw digest is both simpler and spec-literal. The "second untested hashing surface" objection revision 2 raised is answered by a golden-vector test (`keyHash("abc") === "ba7816bf…"`, the canonical SHA-256 of `abc`) in the journal unit suite.

**`inputHash` — the typechecking construction [R].** Revision 1 wrote `hasher.hash({ method, beaconId, command })`. That does not compile. `Hasher.hash(value: JsonValue)` where `JsonValue = SemanticValue | SemanticProjection`; `SemanticValue`'s object member is `{ readonly [key: string]: SemanticValue }`, and a TypeScript **interface** gets no implicit index signature, so any command interface nested inside an object literal is unassignable:

```
error TS2345: Type 'ApproveDraftCommand' is not assignable to type
  '{ readonly [key: string]: SemanticValue; }'.
    Index signature for type 'string' is missing in type 'ApproveDraftCommand'.
```

The domain's own working call, `hasher.hash(project(draft.content))` (`drafts.ts:143`), compiles only because `SemanticProjection` is a **top-level** union member — nesting it inside a record would fail for exactly the same reason.

**Rule: `inputHash` is computed over a hand-built `SemanticValue` literal per method. No domain command interface, and no `SemanticProjection`, is ever nested.** `journal.ts` exports one small builder per method, each with an explicit `SemanticValue` return annotation, so the object literal is contextually checked against the index signature and compiles with no cast and no widening of `JsonValue`:

```ts
// src/adapters/fs-beacon-store/journal.ts
function approveInput(beaconId: string, c: ApproveDraftCommand): SemanticValue {
  return {
    method: "approveDraft", beaconId,
    draftId: c.draftId, versionId: c.versionId, reviewedHash: c.reviewedHash,
    approvedAt: c.approvedAt, actor: c.actor,
    staleOriginAcknowledged: c.staleOriginAcknowledged,
  };                       // every value is string | boolean | null
}

function createDraftInput(
  beaconId: string, c: StoreCreateDraftCommand, hasher: Hasher,
): SemanticValue {
  return {
    method: "createDraft", beaconId, draftId: c.draftId, label: c.label,
    beaconTitle: c.beaconTitle,
    contentHash: hasher.hash(project(c.content)),   // top-level call — the drafts.ts:143 precedent
    origin: {                                       // DraftOrigin spelled out, never nested
      branchedFromVersion: c.origin.branchedFromVersion,
      branchedFromHash: c.origin.branchedFromHash,
      forkedFromDraft: c.origin.forkedFromDraft,
    },
  };
}

const inputHash = hasher.hash(approveInput(beaconId, cmd));
```

Embedding `project(content)`'s **hash** rather than the projection itself is not a workaround, it is the better contract: "logically identical input" for the two content-carrying commands (`createDraft`, `updateDraft`) then means *the domain's own projection hash is equal*, so two calls whose sources differ only in fields `project()` excludes are logically identical — the only defensible meaning of the phrase in this domain.

Consequence to document for callers: `approveDraft`/`abandonDraft`/`revokeVersion` carry caller-supplied timestamps, so a retry must reuse the original timestamp along with the key, otherwise the input is genuinely different and `idempotency-key-conflict` is correct.

**Journal entry payload**:

```json
{ "contract": "pharos.idempotency-entry/1",
  "key": "…", "key_hash": "…", "method": "approveDraft", "beacon_id": "bcn_…",
  "input_hash": "sha256:…",
  "result": { "beacon_id": "bcn_…", "version_id": "ver_…", "draft_id": null, "revision": null } }
```

No timestamp field: there is no `Clock` port, and `Date.now()` would make a byte-stable file nondeterministic.

`result` is §5's "committed result reference". On replay the store returns the `Beacon` re-read from current disk state rather than a stored snapshot. **Against R2 scenario 1's exact wording ("the store returns the previously committed result and does not create a second version") [R3]**: the result of every mutating method is the *aggregate* `Beacon`, not a snapshot of it, so "the previously committed result" names the beacon that call committed — which is what the re-read returns, now including anything committed after `K`, whereas a frozen snapshot would return a `Beacon` that is only still true when nothing followed and is a stale lie otherwise; and the scenario's second clause, "does not create a second version", holds by construction because the replay branch reaches no domain function and writes nothing.

**Additional on-disk fields, and why the round-trip still holds**: `manifest.json` stores `supersedes_version` (D1); `revocation.json` stores `previous_status`. Version `status` is never stored — it is derived by D1's three-row status table. That reconstructs all three `Version` variants exactly (`fs-beacon-store` R1 scenario 1) without ever mutating an immutable file.

### D6b — The pre-commit retry window, and how the stamp closes it **[R]**

> **What changed and why.** Revision 1 asserted that the embedded stamp is "what makes replay possible", but D1's `aborted` row took no action on it: the stamp was written and never read. The undeclared consequence was a permanent dead end. Trace: `approveDraft` with key `K` crashes at step 3 after `semantics.json` lands. Retry with the same `K` and the same input — the journal entry was never written, so no replay hit; `readBeacon()` excludes the orphan, so the domain call succeeds; then `createExclusive("semantics.json")` returns `"exists"` → `immutable-file-exists`, **forever**, for that `versionId`.

**Every store-written file *except `active.json`* carries `idempotency: { key, key_hash, input_hash, method }`** (`method` added in revision 3 — D1e; the `active.json` exclusion made explicit in revision 3 **[R3]**) for the mutation that produced it: `manifest.json`, `semantics.json`, `draft.json`, `beacon.json`, `tombstone.json`, `revocation.json` and the journal entry alike. `active.json` is excluded because `§4:112` fixes its shape as exactly `{ "active_version": "ver_…" }`, and nothing needs the stamp there — D1's replay reads it from the referenced `manifest.json` instead. The earlier unqualified "every store-written file" contradicted this section's own enumeration. `semantics.json` is included specifically so the window *before* `manifest.json` is also recoverable; it is safe there because `Version` carries no content field, so `semantics.json` participates in no round-trip assertion.

**Only two artifacts ever have a pre-commit window [R3].** Adoption's whole domain is `approveDraft`'s `semantics.json` and `manifest.json`. `tombstone.json` and `revocation.json` *are* their mutations' commit points, so no retry can ever find one already present under its own key; and the journal entry is always the last write. Stating this narrows the analysis to the only case that exists.

**The byte-identity premise revision 2 asserted is false [R3].** Revision 2 tested adoption by byte-equality and justified it with "bytes cannot differ for identical input under D8's deterministic serialisation". They can. `manifest.json` carries two fields that are **not** functions of the command input:

- `local_number`, computed by the domain from the aggregate (`approval.ts:55-59`), and
- `supersedes_version`, defined as the version active at *this* version's step 3.

The failing trace: `approveDraft(K)` crashes after `manifest.json` lands; an unrelated `approveDraft(K2)` on a different draft commits and advances `active.json`; the honest retry of `K` now derives a different `local_number` and a different `supersedes_version`, so the bytes differ; revision 2's probe called that **corruption** and returned `immutable-file-exists` — reproducing the exact dead end D6b was written to close, for what is nothing but a normal interleaving of two concurrent approvals.

**The probe compares input-determined fields, and re-derives the rest [R3].** Partition each artifact's fields:

| Artifact | Input-determined (compared) | Aggregate-derived (re-derived, compared semantically) |
|---|---|---|
| `semantics.json` | the entire body — it is `project(draft.content)`, and step 2's reviewed-hash re-verification has already established the content is unchanged | none |
| `manifest.json` | `contract`, `version_id`, `idempotency`, all of `approval` (`approved_at`, `reviewed_hash`, `stale_origin_acknowledged`, `assurance`, `actor`), and from `provenance`: `approved_draft_id`, `branched_from_version`, `branched_from_hash` | `local_number`, `supersedes_version`, `approved_revision` **[R3]** |

> **Why `approved_revision` is aggregate-derived, not input-determined [R3, test restated R4].** The test is: **does this field hold the same value for a given command input across every legal interleaving?** If yes it is input-determined and may be compared directly; if it can move while the command stays identical, it must be re-derived and compared semantically. A field the command interface declares always passes trivially, but declaration is not the test — revision 4's first pass stated it that way and thereby mis-described its own columns, since `branched_from_version`, `branched_from_hash` and `assurance` are all undeclared by `ApproveDraftCommand` yet correctly sit in the input-determined column: `origin` is frozen at draft creation and preserved verbatim by `updateDraft`'s spread (`drafts.ts:78-82`), so it is fixed by `cmd.draftId`, and `assurance` is the constant `"operator_confirmed"` (`approval.ts:69`), which can never differ. `approved_revision` fails the test outright. `approval.ts:74` sets `approvedRevision: draft.revision` — read from the aggregate — and `ApproveDraftCommand` (`approval.ts:10-17`) has no revision field at all. Revision 3's first pass classified all of `provenance` as input-determined, which produced exactly the failure D6b exists to prevent, one row lower down: `approveDraft(K)` crashes after `manifest.json` lands carrying `approved_revision: 3`; a legal `updateDraft` then runs on the same draft with byte-identical content (`drafts.ts:78-82` increments `revision` unconditionally, and identical content leaves `hasher.hash(project(content))` unchanged so `cmd.reviewedHash` still matches at `approval.ts:35`); the honest retry of `K` now derives `approved_revision: 4`, an input-determined field "differs" under an equal `input_hash`, and the probe **throws** `BeaconStoreCorruptionError`. A throw, not even a value — strictly worse than the wrong refusal this section was written to remove. In the correct column the same trace lands on `stale-attempt-artifact` and its named exit. `approved_draft_id`, `branched_from_version` and `branched_from_hash` stay input-determined correctly: `origin` is preserved across `updateDraft` by the spread at `drafts.ts:78-82` and is never mutated after creation.

**Probe outcomes.** Step 2a resolves the stored artifact against what this call would write:

| Stored artifact at the target path | Outcome |
|---|---|
| absent | ordinary write |
| stamp `key_hash` ≠ this call's | a genuinely different transaction owns this path → **`immutable-file-exists`** (`fs-beacon-store` R3's two scenarios, literally) |
| same `key_hash`, different `input_hash` | **`idempotency-key-conflict`** |
| same `key_hash` and `input_hash`; input-determined fields equal; aggregate-derived fields equal | our own interrupted attempt, still current → **adopt** (count it as written) and resume from the next step |
| same `key_hash` and `input_hash`; input-determined fields equal; aggregate-derived fields **differ** | our own interrupted attempt, now **stale** — an unrelated mutation committed in between. **Normal concurrency, not corruption** → **`stale-attempt-artifact`** with the named exit below |
| same `key_hash` and `input_hash`; an **input-determined** field differs | impossible under deterministic serialisation with an equal input → **throw** `BeaconStoreCorruptionError` (D4) |

The comparison needs no stored snapshot: serialisation is deterministic (D8) and both sides are reproducible — the input-determined side from the command, the aggregate-derived side from the `Beacon` the domain just returned.

**Why the stale attempt cannot simply be adopted.** Adopting it would leave the aggregate carrying a `local_number` that collides with the intervening version's and a back-pointer that skips it — and skipping it makes every version behind it unreachable from D1's roots, which is silent, total history loss. Rewriting the manifest in place is forbidden by `fs-beacon-store` R3. A correct outcome therefore genuinely requires a new `versionId`, which only the caller can choose. The refusal is the honest boundary, and it is a *distinct* refusal precisely so the caller can tell it apart from the corruption case.

**Where the probe sits, and why it moved [R3].** Revision 2 placed it at step (1c), *before* `readBeacon()` and the domain call. As sequenced it was not computable: its test needs `local_number` and `supersedes_version`, and both require the reconstructed aggregate. Revision 3 moves it to **step (2a) — after the domain call returns `ok`, before any write**. The index it consults is unchanged and still free: step (1a)'s scan already reads every write-once artifact's stamp, yielding a `keyHash → artifacts` map; only the *lookup* moved, not the scan. Step (1b)'s journal lookup stays where it was, because it needs only `keyHash` and `inputHash`, both computable from the command alone.

Adoption still runs **before any write**, as part of replay detection — never as a fallback after `createExclusive` returns `"exists"`. That distinction matters for conformance: `fs-beacon-store` R3's two scenarios describe a *genuine second write* (a different transaction targeting an existing immutable path), which still refuses with the original bytes unchanged. Adoption recognises the *same* write, so R3's scenarios keep their literal meaning and their RED tests are unaffected.

**Named recovery path when the probe refuses.** On either refusing branch the caller is not stranded: the orphan is excluded from the aggregate (D1), so `duplicate-version-id` cannot fire, and re-issuing the approval **with a fresh `versionId` under a fresh idempotency key** always succeeds. The orphan remains reported by `recoverProject()` for operator inspection and never becomes active. This exit is stated in the port's doc comment, not left to be discovered.

### D7 — Prototype-shadowing safety at the directory-to-`Record` boundary

Three layers, applied where directory names become `Record` keys:

1. **Validate the segment.** Every id must match `/^[A-Za-z0-9._-]{1,128}$/`, must not be `.` or `..`, must not be `__proto__`, `constructor` or `prototype`, and **must not contain the substring `.tmp.` [R3]**. **The failure mode depends on where the id came from, and on what it addresses [R4].** A **caller-supplied** id always yields a refusal *value*, never a throw, as `beacon-store-port` R3 requires. Which refusal depends on the id's role: an id that **addresses existing state** (`getBeacon`'s `beaconId`, `getActiveVersion`'s, and every mutation's target *except* `createDraft`'s `beaconId` — see below) fails validation, therefore names nothing, and returns the corresponding not-found refusal — exactly what R3 scenario 2 asks for ("resolves to `{ ok: false, error }` with a not-found refusal"). An id that **names something being created** (`createDraft`/`forkDraft`'s new `draftId`, `approveDraft`'s new `versionId`) is neither absent nor corrupt, so "not found" would be a lie; it returns `invalid-id` (D3). The second pass stated a blanket not-found rule and missed this third case.

> **`createDraft`'s `beaconId` sits in the creation bucket [R4].** It is the only id that is simultaneously a mutation target and a name for something that may not exist yet: D10's bootstrap branch creates `beacon.json` when the beacon directory is absent (C3), and D1d states that `beacon-not-found` never fires for `createDraft`. Routing it to not-found would contradict D1d directly, so a `createDraft` whose `beaconId` fails validation returns `invalid-id` with `field: "beaconId"` — which is also the only call site that makes that union arm reachable. Every other mutation's `beaconId` addresses existing state and keeps the not-found route. A segment read **from disk** that fails validation is corrupt store state, and reports `unclassified` (D1) or throws (D4) as that section specifies. Revision 4's first pass routed every failure to a throw, which was already a gap for hostile-looking segments and became materially more reachable once `.tmp.` joined the rejected set, since `bcn_a.tmp.1` looks like a perfectly ordinary id. This also closes path traversal: no segment can contain `/` or `..`.

   > **Why `.tmp.` is excluded from ids [R3].** The regex admits dots, while D8 filters `.tmp.` out of *every* listing. Without this clause a legal id such as `bcn_a.tmp.1` would validate, be written, and then be silently excluded from every semantic listing — vanishing from the reconstructed `Beacon` with no error at all, which falsifies `fs-beacon-store` R1 scenario 1 for that input. The collision between an open id alphabet and a substring-based listing filter survived three revisions unnoticed. Excluding the substring at the validation boundary is the narrower fix; making the filter positional would also work but would leave the two rules coupled by convention rather than by construction.
2. **Build safely.** Records are accumulated in a `Map` and materialised with `Object.fromEntries`, which uses `CreateDataProperty` — unlike literal assignment, `__proto__` becomes an ordinary own property rather than mutating the prototype.
3. **Read safely.** Every lookup goes through an adapter-local three-line `getOwn` mirror in `src/adapters/fs-beacon-store/records.ts`, applying the same `Object.hasOwn` discipline as `src/domain/beacon/records.ts`. We deliberately do **not** re-export the domain's `getOwn` from `src/domain/beacon/index.ts` — its own comment marks it internal, and widening Slice C's public surface is out of scope.

Layer 1 alone is sufficient; 2 and 3 are defence in depth. The independent identity self-check (embedded id must equal the directory name) makes a shadowing segment unusable even if all three were bypassed.

### D8 — Determinism **[R]**

**`localNumber` is stored, never derived [R].** Revision 1 was self-contradictory: it read `localNumber` from `manifest.json` in D1's read order *and* listed "`localNumber` derivation" among the sort-dependent sites. Resolved in favour of **stored**: §4:119 explicitly says the manifest carries "local number", the domain already computes it at approval time (`approval.ts:55-59`) from the in-memory aggregate, and step 3 simply persists that value. Reconstruction reads it verbatim and never recomputes — which is also why an orphan can leave a reused `local_number` on disk without any effect on the aggregate.

| Site | Rule |
|---|---|
| `beacons/`, `versions/`, `drafts/`, `journal/idempotency/` listings | `Array.prototype.sort()` (UTF-16 code-unit order, **not** `localeCompare`) before *any* semantic use — `listBeacons` ordering, the committed-chain walk's root enumeration, and the whole reconcile scan of D1 |
| `localNumber` | **read from `manifest.json`**; never derived from listing order [R] |
| Temp leftovers | every listing filters `.tmp.` names, so an interrupted write — and D2's `probe.tmp.<uuid>` — never enters a semantic listing |
| Serialisation **[R3]** | `JSON.stringify(value, null, 2) + "\n"`. **K1** closed-key nodes are emitted from explicit per-file-kind object literals in a fixed authored order, snake_cased. **K2** caller-keyed nodes are emitted verbatim with their keys passed through an explicit `Array.prototype.sort()`; note that JS enumerates array-index-like keys first in ascending numeric order regardless, so the emitted order is not strictly UTF-16 code-unit order — it is nonetheless deterministic, byte-stable *and* key-preserving, which is all this section requires (see D6's note). Both halves are byte-stable across runs and platforms, which is what makes D6b's field-level adoption comparison decidable |
| Timestamps | never generated by the adapter; only caller-supplied values are persisted |

### D9 — `project.json` is structurally unreachable (G7)

`layout.ts` is the single source of every path the store constructs and has no `project.json` accessor. The project-level listing filters `project.json`, `lock`, `journal` and every `.tmp.` name (which covers D2's `probe.tmp.<uuid>`) before mapping. Proven by a byte-equality assertion around every port method.

---

## Data Flow — the uniform mutating envelope **[R]**

Every one of the six mutations runs the same envelope. Only the shaded projection step differs.

```
caller ── <mutation>(beaconId, cmd, key) ──▶ FsBeaconStore
   │
   │ (1)  ProjectLock.acquire()  ── EEXIST ──▶ liveness (D2) ──▶ lock-unavailable ✗
   │ (1a) scan(beaconId) + apply pending replay actions      (D1, D1b–D1e / D5, lock held)
   │        ·  builds the keyHash → artifacts index used at (2a)
   │ (1b) journal lookup <keyHash>                            (needs only the command)
   │        ├ hit, same inputHash  ──▶ re-read Beacon, return  (no mutation)
   │        └ hit, other inputHash ──▶ idempotency-key-conflict ✗
   │ (2)  readBeacon()
   │        ├ absent  ── createDraft ──▶ BOOTSTRAP: synthesize the empty Beacon  [R]
   │        └ absent  ── other five  ──▶ beacon-not-found ✗
   │        ──▶ domain <mutation>(beacon, cmd, hasher?)
   │        └ refuses ──▶ release lock, return ✗
   │        ·  I1: no PROJECTION of this command has been written yet  [R3]
   │ (2a) adoption probe on the scan index                    (D6b)  [R3]
   │        ·  moved here from (1c): it needs local_number and
   │        ·  supersedes_version, hence the aggregate the domain just returned
   │        ├ adopt          ──▶ resume step (3) from the next unwritten artifact
   │        ├ stale attempt  ──▶ stale-attempt-artifact ✗   (normal interleaving)
   │        └ other owner    ──▶ immutable-file-exists ✗
   │        ·  still strictly BEFORE any write — never a post-EEXIST fallback
   │ (3)  project the returned Beacon to files, per the table below
   │ (4)  createExclusive journal entry
   │ (5)  ProjectLock.release()
   ▼
Result<Beacon, BeaconStoreRefusal>
```

### Step 3 per mutation, with commit points marked ★

| Mutation | Ordered writes |
|---|---|
| `createDraft` (bootstrap) | `writeAtomic beacon.json` → **★** `writeAtomic drafts/<D>/draft.json` (D10) |
| `createDraft` (existing beacon) | **★** `writeAtomic drafts/<D>/draft.json` |
| `updateDraft` | **★** `writeAtomic drafts/<D>/draft.json` (revision incremented by the domain) |
| `forkDraft` | **★** `writeAtomic drafts/<D2>/draft.json` |
| `abandonDraft` | **★** `createExclusive drafts/<D>/tombstone.json` → `removeAtomic drafts/<D>/draft.json` (D1b) |
| `approveDraft` | `createExclusive semantics.json` → `createExclusive manifest.json` → **★** `writeAtomic active.json` → `writeAtomic drafts/<D>/draft.json` (closed) (D1) |
| `revokeVersion` | **★** `createExclusive versions/<V>/revocation.json` → `removeAtomic active.json` if it named `V` (D1c) |

`approveDraft`'s inner ordering is §5 step for step, and step 4's `active.json` swap is the sole commit point (`fs-beacon-store` R5). A crash between `manifest.json` and `active.json` leaves the *aborted* row of D1 (R5 scenario 2, recovery R2). A crash between `active.json` and the draft close leaves the *replay 5–6* row (recovery R3). Crash windows for the other five are tabulated in D1b, D1c, D1d and **D1e [R3]**.

### D10 — `createDraft` bootstrap ordering **[R]**

`beacon-not-found` fires for five mutations and not for `createDraft`. Revision 1 stated neither the branch nor its ordering, leaving the trap that writing `beacon.json` before the domain call would let a `duplicate-draft-id` refusal (`drafts.ts:40`) leave a side effect on disk.

Closed by invariant **I1**: on an absent beacon directory, `createDraft` synthesizes the aggregate **in memory** —

```ts
const beacon: Beacon = {
  beaconId, title: cmd.beaconTitle, drafts: {}, versions: {}, activeVersionId: null,
};
```

— runs the domain `createDraft` against it, and writes **only** after `ok`. `duplicate-draft-id` is then unreachable on a bootstrap (the record is empty) and harmless on a non-bootstrap (the beacon directory already exists, so no file is created). No refused mutation ever leaves a side effect.

The window between `beacon.json` and `draft.json` leaves a beacon with zero drafts and zero versions. That is a legal `Beacon`, not an artifact: D1d classifies it **complete**, and a same-key retry replays cleanly (`beacon.json` is mutable, so rewriting identical bytes is permitted by R2's protocol). The *next* window — `draft.json` written, journal entry not — is D1e's. **[R3]**

---

## File Changes

| File | Action | Description |
|---|---|---|
| `src/domain/ports/beacon-store.ts` | Create | `BeaconStore` (9 methods), `IdempotencyKey`, port command types |
| `src/domain/ports/beacon-store-refusals.ts` | Create | `BeaconStoreDiskRefusal`, `BeaconStoreRefusal` (D3) |
| `src/domain/ports/index.ts` | Modify | Barrel exports for both new modules — `export type` only, as today **[R3]** |
| `src/adapters/fs-beacon-store/index.ts` | Modify | Replaces `export {};` with the adapter barrel |
| `src/adapters/fs-beacon-store/fs-beacon-store.ts` | Create | `FsBeaconStore` — 9 port methods + `recoverProject()` |
| `src/adapters/fs-beacon-store/atomic-writer.ts` | Create | `AtomicWriter`, `WriteObserver`, `FsAtomicWriter` (D5) |
| `src/adapters/fs-beacon-store/lock.ts` | Create | `ProjectLock` — acquire, liveness, break, release (D2) |
| `src/adapters/fs-beacon-store/journal.ts` | Create | `node:crypto` `keyHash`, per-method `SemanticValue` `inputHash` builders, adoption probe, entry read/write (D6, D6b) **[R3]** |
| `src/adapters/fs-beacon-store/layout.ts` | Create | Path construction + id validation (D7, D9) |
| `src/adapters/fs-beacon-store/serialization.ts` | Create | §7 `contract`-string envelope, K1 closed-key snake_case↔camelCase bijection per file kind, K2 verbatim pass-through for caller-keyed nodes (D6, D8, D9) **[R3]** |
| `src/adapters/fs-beacon-store/records.ts` | Create | Safe record assembly + adapter-local `getOwn` (D7) |
| `src/adapters/fs-beacon-store/reconcile.ts` | Create | Lock-free `scan` + lock-required `apply`, committed-chain walk, classification, `RecoverReport` (D1, D1b–**D1e**, D5b) **[R3]** |
| `src/adapters/fs-beacon-store/corruption.ts` | Create | `BeaconStoreCorruptionError` (D4) |
| `tests/contract/beacon-store/` | Create | Shared adapter-agnostic port-contract suite |
| `tests/adapters/fs-beacon-store/` | Create | Temp-dir, crash-injection, concurrency, determinism |
| `package.json` | Unchanged | Still exactly one production dependency (**G6**) |

## Interfaces / Contracts

```ts
// src/domain/ports/beacon-store.ts — zero node:* imports.
// [R3] Every import here is `import type`. src/domain/beacon/drafts.ts:3 already
// imports from ../ports/index.js, and this module imports from ../beacon/index.js,
// which re-exports value functions — so the cycle must erase at compile time.
export type IdempotencyKey = string;

// createDraft also bootstraps beacon.json when the beacon does not exist yet
// (see Conformance concern C3). beaconTitle is used only on bootstrap.
export interface StoreCreateDraftCommand extends CreateDraftCommand {
  readonly beaconTitle: string;
}

export interface BeaconStore {
  getBeacon(beaconId: string): Promise<Result<Beacon, BeaconStoreRefusal>>;
  listBeacons(): Promise<Result<readonly Beacon[], BeaconStoreRefusal>>;
  getActiveVersion(
    beaconId: string,
  ): Promise<Result<ActiveVersion | null, BeaconStoreRefusal>>;

  createDraft(b: string, c: StoreCreateDraftCommand, k: IdempotencyKey): Promise<Result<Beacon, BeaconStoreRefusal>>;
  updateDraft(b: string, c: UpdateDraftCommand,      k: IdempotencyKey): Promise<Result<Beacon, BeaconStoreRefusal>>;
  forkDraft(b: string, c: ForkDraftCommand,          k: IdempotencyKey): Promise<Result<Beacon, BeaconStoreRefusal>>;
  abandonDraft(b: string, c: AbandonDraftCommand,    k: IdempotencyKey): Promise<Result<Beacon, BeaconStoreRefusal>>;
  approveDraft(b: string, c: ApproveDraftCommand,    k: IdempotencyKey): Promise<Result<Beacon, BeaconStoreRefusal>>;
  revokeVersion(b: string, c: RevokeVersionCommand,  k: IdempotencyKey): Promise<Result<Beacon, BeaconStoreRefusal>>;
}
```

`recoverProject()` is **deliberately not on the port**: `beacon-store-port` R1 scenario 2 forbids any additional mutating port method, and `beacon-store-recovery` R1 requires it on `FsBeaconStore`. It lives on the adapter class only.

### D5b — `recoverProject()`'s lock scope: two-phase **[R]**

> **What changed and why.** Revision 1 put `reconcile(beaconId)` inside the mutating envelope's lock but discussed no lock at all for standalone `recoverProject()`, which nevertheless mutates (R3's replay writes `draft.json` and creates a journal entry). Lock-free would race a concurrent `approveDraft`; unconditionally locked would make `beacon-store-recovery` R1 scenario 1's "no on-disk file is modified" false, because acquisition creates and unlinks `lock` (and D2's probe).

**Phase 1 — scan, lock-free, pure read.** Walk the project, classify every artifact, produce `artifacts` and a *proposed* `actions` list. Touches nothing.

**Phase 2 — apply, only if phase 1 proposed at least one action.** Acquire the lock, **re-scan under it** (phase 1's result is advisory; the under-lock scan is authoritative and is what actually drives the writes), apply, release.

A project with no interrupted transaction never reaches phase 2, so it never creates `lock` and never creates `probe.tmp.<uuid>` — **R1 scenario 1 holds literally, not by interpretation**. A project needing replay converges after one call: from call 2 onward phase 1 proposes no *completion* action, so no completion work is ever repeated. Phase 2 is skipped entirely from call 2 **unless a leaked temp is still present and younger than `staleAfterMs`** — phase 1 proposes `swept-leaked-temp` unconditionally because it has no clock (D5), so such a project re-enters phase 2 on each call and declines the sweep on age until the temp ages out **[R4]**. That is why the amended `beacon-store-recovery` R1 scenario 2 excludes clock-dependent temporary-file housekeeping from its convergence assertion. It matters in practice: the crash that leaves a replay-pending orphan is often the same crash that leaves a fresh temp.

The same two functions serve the in-envelope path: step 1a calls `scan` + `apply` directly, with the lock already held by the caller. `apply` documents "lock MUST be held" as a precondition and is never exported from the adapter barrel.

```ts
// src/adapters/fs-beacon-store/reconcile.ts
export type ArtifactClass =
  | "aborted" | "complete" | "unclassified" | "leaked-temp";

// [R] artifacts are no longer version-only: abandonment, bootstrap and temp
// leaks are draft-, beacon- and project-scoped respectively.
export type ArtifactRef =
  | { readonly scope: "version"; readonly beaconId: string; readonly versionId: string }
  | { readonly scope: "draft";   readonly beaconId: string; readonly draftId: string }
  | { readonly scope: "beacon";  readonly beaconId: string }
  | { readonly scope: "project"; readonly relativePath: string };

export type RecoverAction =
  | "closed-draft"                     // D1 replay 5
  | "wrote-journal-entry"              // D1 replay 6, D1b step 3, D1c step 3,
                                       // and D1e's mutable-commit-point window [R3]
  | "removed-abandoned-draft-file"     // D1b step 2
  | "removed-revoked-active-pointer"   // D1c step 2
  | "swept-leaked-temp";               // D5

export interface RecoverReport {
  readonly artifacts: readonly {
    readonly ref: ArtifactRef;
    readonly classification: ArtifactClass;
    readonly reason: string;
  }[];                                  // post-scan state — the equivalence surface
  readonly actions: readonly {          // empty once converged
    readonly ref: ArtifactRef;
    readonly action: RecoverAction;
  }[];
}

// Lock acquisition can fail, so the report is Result-wrapped; the ok branch is
// the report `beacon-store-recovery` R1 scenario 1 asks for.
recoverProject(): Promise<Result<RecoverReport, LockUnavailable>>;
```

The widened `ArtifactRef` is what makes the scan match `beacon-store-recovery` R1's project-wide scope rather than revision 1's approval-only view.

The store is project-bound at construction, so no method takes a `projectId`. **`observer` is gone [R]** — it belongs to the writer (D5):

```ts
new FsBeaconStore({
  projectRoot,
  hasher,
  writer: new FsAtomicWriter({ observer }),   // observer is writer-owned
  // [R4] staleAfterMs gates the holders step 3 could not identify well enough to
  // probe — pid === null, or a positive pid with no hostname — and MUST be < waitMs
  // (asserted at construction) so an orphaned lock cannot outlive one wait cycle.
  lock: { waitMs: 5_000, staleAfterMs: 2_000, pollMs: 25 },
});
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit — seam | tmp/fsync/rename/link/fsync-dir ordering; `link` `EEXIST`; nothing at final path on interruption | `WriteObserver` stage hooks against a real `mkdtemp` directory |
| Unit — lock **[R3]** | live PID not broken; **`ESRCH` broken immediately with no age wait — R4 scenario 2 asserted at default configuration**; zero-byte/unparseable lock broken only after `staleAfterMs`; `staleAfterMs < waitMs` asserted at construction; foreign hostname never broken **when the record also carries a probeable positive `pid` — `{"pid": 0, "hostname": "other-host"}` reaches the age gate instead [R4]**; a parsed record with a positive `pid` and no `hostname` reaches the age gate **[R4]**; wait policy exhaustion → `lock-unavailable` carrying `holderPid` and `waitedMs` (**no `heldForMs` field exists**); `lock` created by `fs.open` `wx` with no `.tmp.` sibling ever appearing; nonce-guarded release | Fabricated lockfiles with synthetic pids; injected clock-free `mtime` via `utimes`; directory listing asserted during acquisition |
| Unit — journal **[R3]** | `keyHash` matches a plain SHA-256 golden vector (`keyHash("abc") === "ba7816bf…"`) and is **not** the JCS digest; `inputHash` builders compile and are `project()`-normalised; conflict vs replay vs adopt vs `stale-attempt-artifact` (D6b's six-outcome table); journal entry reconstructed from a `draft.json` stamp (D1e) | Property tests (`fast-check@4.9.0`) over source variants differing only in excluded fields |
| Unit — reconcile | every row of D1, **D1b, D1c, D1d and D1e** [R3], including `unclassified` and `leaked-temp` | Hand-built on-disk fixtures per row |
| Unit — caller-keyed round-trip **[R3]** | a `SemanticSource` whose excluded fields include `foo_bar`, `fooBar`, `__proto__`, an empty-string key and a Unicode key round-trips **key-identical**; the same for `SemanticProjection`'s `variables`/`outcomes`/`expectations`/`query`/`scope` records; `hasher.hash(project(content))` is byte-identical before and after a store restart | `toStrictEqual` on the reconstructed `Beacon` plus a hash-equality assertion — this is the RED test for K2 |
| Unit — committed walk [R] | orphan excluded; two manifests sharing `supersedes_version` do **not** throw; `supersededBy` never names an orphan; dangling pointer and cycle **do** throw; roots survive revocation of the active version | Fixtures built from D1's failing trace (`V1` active, orphan `V2`, committed `V3`) |
| Unit — serialisation [R3] | K1 snake_case bijection per file kind; K2 verbatim pass-through with sorted open-record keys; `contract` string round-trip; byte stability across two runs | Golden bytes per file kind |
| Unit — records | `__proto__`/`constructor`/`../` segments rejected; `Object.fromEntries` own-property assembly | Adversarial directory names |
| Integration — crash | crash before rename (R2); crash after step 3 before step 4 (R5); crash after step 4 before step 5 (recovery R3); replay run twice; **[R]** abandonment between tombstone and `draft.json` removal; revocation between `revocation.json` and the `active.json` clear (assert `getActiveVersion` returns `null` and does **not** throw); bootstrap between `beacon.json` and `draft.json`; same-key retry after a pre-commit crash adopts instead of refusing; **[R3]** crash between `draft.json` and its journal entry for each of `createDraft`/`updateDraft`/`forkDraft`, then a same-key retry — assert it returns the committed `Beacon` and raises neither `stale-draft-revision` nor `duplicate-draft-id` (D1e); **[R3]** crash after `manifest.json`, then an *unrelated* successful `approveDraft`, then the same-key retry — assert `stale-attempt-artifact`, **not** `immutable-file-exists` and not a throw, and that a fresh `versionId` under a fresh key then succeeds (D6b) | `FsAtomicWriter({ observer })` throwing `InjectedCrash` at `(stage, path)`; reopen the store and assert |
| Integration — recovery lock [R] | a clean project's `recoverProject()` creates neither `lock` nor `probe.tmp.*` (R1 scenario 1, literal); a replay-pending project performs no further *completion* action from call 2; a project holding a leaked temp younger than `staleAfterMs` re-enters phase 2 each call and declines the sweep, changing no reconstructable content **[R4]**; the three id-validation outcomes are distinguished — on-disk segment throws, caller-supplied addressing id refuses not-found, caller-supplied creation id refuses `invalid-id` **[R4]** | Byte-and-inode snapshot of the whole project directory before and after |
| Integration — concurrency | interleaved in-process mutations serialize (R4) | Concurrent promises against one temp project; assert full-write-sequence ordering |
| Integration — determinism | sorted listings; byte-stable JSON; `project.json` bytes unchanged | Repeated round-trips + byte comparison |
| Contract — shared | all 9 methods, idempotency replay/conflict, immutability refusals, revision binding | `tests/contract/beacon-store/` parameterised over any `BeaconStore` factory; instantiated for `FsBeaconStore` |

Strict TDD (`openspec/config.yaml` `strict_tdd: true`): every case above is authored RED first.

## Threat Matrix

**N/A** — no routing, shell command, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. `process.kill(pid, 0)` sends no signal and only probes existence; it is a liveness read, not process integration, and its adversarial surface (a fabricated `pid` in an attacker-writable lockfile) is bounded to process-existence disclosure and handled in D2. The adversarial *input* surface that does exist — caller-supplied ids becoming path segments — is addressed by D7 layer 1 (which also closes path traversal) with dedicated RED tests listed above. Per the reference, the matrix is recorded as not applicable rather than expanded.

## Migration / Rollout

No migration required. Slice D is purely additive — nothing imports `BeaconStore` yet, and no on-disk data exists to migrate. Rollback is the proposal's per-unit PR revert.

## Conformance Concerns

Flagged for the orchestrator rather than silently absorbed.

**C1 — RESOLVED BY SPEC AMENDMENT. [R4]** As originally written, `fs-beacon-store` R2 ("rename") and R3 ("exclusive-create") were mutually exclusive: `fs.rename` always overwrites the destination (confirmed empirically — `rename` over an existing file silently replaced it), Node exposes no `RENAME_NOREPLACE` constant, and `link` throws `EEXIST` leaving the original bytes intact. A write-once file could not be both renamed into place and refused when it already exists. The orchestrator amended R2 rather than leaving the design in permanent departure from an unsatisfiable requirement; R2 now mandates `rename` for mutable files and, for write-once files, "an atomic operation that fails when the destination already exists". **This design conforms to the amended R2 literally, and no departure from it remains.** The analysis below is retained because it is the argument the amendment rests on, and because a residual departure from `docs/technical-design-v1.md:151` — which still says "rename" for every write — does survive and belongs to a different document with its own amendment path.

**The fork this design must record.** `proposal.md:22` names a different mechanism — "write-once immutability enforced by `wx` exclusive create". A direct `open(final, "wx")` does satisfy R3 with no `link` at all:

| Option | R3 (refuse second write) | R2 scenario 1 (no partial content at the final path) | Portability |
|---|---|---|---|
| tmp → `link(tmp, final)` | ✅ `EEXIST`, original bytes intact | ✅ a crash leaves **nothing** at the final path | ✗ unsupported on FAT and some network mounts |
| `open(final, "wx")` direct | ✅ `EEXIST` | ✗ a crash mid-write leaves a **partial file at the final path** | ✅ everywhere |
| rename over a reservation | ✗ silently overwrites | ✗ leaves an observable zero-byte file | ✅ |

**`link` remains the pick.** R2 scenario 1 is the *normative durability guarantee*; the old "rename" wording was the *mechanism wording* that implemented it. `wx`-direct trades away the normative scenario to preserve the mechanism wording — the wrong side of the trade. The amended R2 now states the guarantee rather than the mechanism, so this is conformance, not a reading **[R4]**.

**Residual risk and fallback.** On a filesystem where `link` is unsupported the store throws an environment error at first write rather than degrading silently. `wx`-direct is the documented fallback if such a platform must be supported, and adopting it would require R2 scenario 1 to be renegotiated first — it is not a drop-in.

Two further points revision 1 left open (both now in D5): the temp file's own `wx` is decorative, not the immutability mechanism, and is retained only to make an impossible UUID collision loud; and a crash between temp-create and `link` leaks an unreferenced temp, now inert by filter, reported by the scan, and swept under the lock.

**Scope: write-once *artifacts* only. [R3]** C1's `link` fork governs `manifest.json`, `semantics.json`, `revocation.json`, `tombstone.json` and journal entries. It does **not** govern `lock` or `probe.tmp.<uuid>`, which revision 2 mistakenly routed through `createExclusive`; those use a direct `fs.open(path, "wx")` per **G1** and `proposal.md:20`, which the amended R2 now explicitly exempts (see D2) **[R4]**. The operator confirmed C1's own conflict empirically — `rename` silently overwrote an existing destination, `link` threw `EEXIST`, and Node exposes no `RENAME_*` constant — so **`link` stays** for artifacts. No departure from `fs-beacon-store` R2 remains anywhere in this design; the only surviving one is from `docs/technical-design-v1.md:151`.

**C2 — RESOLVED by spec amendment; the escalation is withdrawn. [R3]** Revision 2 escalated an apparent conflict between `beacon-store-recovery` R1 and R3 and asked the orchestrator to choose between a convergence *reading* and a reword. The orchestrator amended the spec instead, so there is no longer anything to interpret. The capability now carries **3 requirements and 7 scenarios**. The design satisfies the amended text **literally**, clause by clause:

| Amended spec text | How the design satisfies it literally |
|---|---|
| R1: "MUST NOT modify or delete any write-once file that already exists" | Every write-once path is reached only through `AtomicWriter.createExclusive`, whose `link` step fails `EEXIST` against an existing destination and leaves its bytes untouched (D5). No code path removes a write-once artifact: `RecoverAction`'s only removals are `removed-abandoned-draft-file` (`draft.json`, mutable) and `removed-revoked-active-pointer` (`active.json`, mutable). |
| R1: "Completing pending approval work … MAY create files that do not yet exist" | This is exactly what replay does: `wrote-journal-entry` creates a missing entry, `closed-draft` rewrites the mutable `draft.json`. Both are now expressly permitted, so revision 2's "no *existing* immutable byte is ever changed" is no longer a narrowing gloss on the requirement — it **is** the requirement. |
| R1 scenario 1: "no on-disk file is modified" for a project with no interrupted transaction | D5b's two-phase design: phase 2 is entered only when phase 1 proposed at least one action, so a clean project never acquires the lock and never creates `lock` or D2's `probe.tmp.<uuid>`. |
| R1 scenario 2 (now "Repeated scans converge"): "the first call performs only actions that complete a mutation already committed before the scan began, the second call performs no such action and changes no reconstructable on-disk content, and both reports describe an equivalent post-scan state" **[R4]** | Every member of `RecoverAction` completes a mutation whose own commit point had already been crossed before the scan: `closed-draft` and `wrote-journal-entry` finish approval steps 5–6 past the `active.json` swap (D1); `removed-abandoned-draft-file` finishes an abandonment whose commit point is the already-present `tombstone.json` (D1b); `removed-revoked-active-pointer` finishes a revocation whose commit point is the already-present `revocation.json` (D1c); D1e's journal entries finish draft mutations whose commit point is the already-written `draft.json`. None initiates anything. After call 1, phase 1 proposes no *completion* action, so call 2 performs none and writes no reconstructable content. `RecoverReport.artifacts` classifies **post-scan** state, so it is *equivalent* across both calls in the sense the amended scenario requires — not byte-identical, since a temp swept by call 1 is absent from call 2's report **[R4]**; `actions` records what each call did and carries no completion action on call 2. `swept-leaked-temp` is the one clock-dependent action: phase 1 proposes it unconditionally (it has no clock — see D5), so call 2 may re-enter phase 2 and decline it again on age. The amended scenario expressly excludes temporary-file housekeeping from this assertion, and a temp is never reconstructable content, so neither the convergence clause nor the "changes no reconstructable on-disk content" clause is affected **[R4]**. |

> **What revision 4's first pass got wrong here [R4].** It claimed call 1's action set was "a subset of R3's mandated replay work … all of which R3's 'the remaining approval work' and the commit-point table enumerate." That was false twice: R3's text mandates only "closing the draft and writing the journal entry" for an approval and mentions none of the abandonment, revocation or draft-mutation cleanups; and "the commit-point table" is this design's own artifact, not a spec one, so it cannot license anything. The orchestrator's first amendment of scenario 2 had written the bound as "at most the pending replay work the replay requirement mandates", which was too narrow for what reconcile legitimately does. The scenario was amended a second time to bound call 1 by *completion of already-committed mutations*, which is the property the design actually has and can be tested directly.
| R1 scenario 3 (new): "no on-disk file is created, modified, or deleted, including the lock file", any number of times | Same mechanism as scenario 1, and the "any number of times" quantifier is free because phase 1 is a pure read. The RED test is the byte-and-inode snapshot already listed under *Integration — recovery lock*. |

No interpretive reading remains, and no open question survives from C2.

**C3 — the port surface has no way to create a `beacon.json`. [R]** `beacon-store-port` R1 fixes exactly nine methods and forbids a tenth mutating one, yet all six domain mutations require an existing `Beacon`. Resolution: `createDraft` bootstraps `beacon.json` inside the same locked transaction when the beacon directory is absent, taking `beaconTitle` for that case (ordering in **D10 [R3]**).

**On `StoreCreateDraftCommand` versus R1's "domain-owned types only" [R].** R1 enumerates `Beacon`, `Draft`, `Version`, *the port's own refusal union*, `Result`, `Promise` — the enumeration already contemplates port-owned types, and a strict reading would exclude `CreateDraftCommand`, `UpdateDraftCommand`, `ApproveDraftCommand` and every other existing domain command type from the signatures, which is absurd. R1's *scenario* is what operationalizes the requirement — "no `node:*` module is imported, and the boundary lint rule for `src/domain/**` passes" — and `StoreCreateDraftCommand` satisfies it. That is the sane reading, and the one this design adopts.

**`beaconTitle` on a non-bootstrap `createDraft`: silently ignored, and a refusal member is NOT warranted [R].** Conclusion recorded rather than left open. A caller generally cannot know whether the beacon already exists, so a `title-mismatch` refusal would make `createDraft` fail for a reason unrelated to the draft being created and would make it behave differently on bootstrap than on retry — directly at odds with the idempotency contract. There is no `renameBeacon` mutation, so the persisted title simply wins. Documented in the port's doc comment.

## Settled by the Operator, 2026-09-03 **[R3]**

Recorded here so they are not re-opened. None of these is an open question.

| Item | Ruling |
|---|---|
| `label` in `tombstone.json` (departure from §6:178) | **Ratified.** Approved as an extension to a prose enumeration. See D6's extensions table and D1b. |
| `supersedes_version` in `manifest.json` (departure from §4:119) | **Ratified.** Same basis. See D6's extensions table and D1. |
| `keyHash` vs §5:170 | **Departure rejected.** `keyHash` is now a plain `sha256` over the key's raw bytes via `node:crypto`, conforming to §5:170 literally. The declared departure is deleted, not justified (D6). |
| C2 — recovery R1 vs R3 | **Resolved by spec amendment.** The escalation is withdrawn; the design satisfies the amended text literally (C2). |
| C1 — `link` vs R2's "rename" | **Resolved by spec amendment [R4].** `link` is kept for write-once artifacts, confirmed empirically; the orchestrator amended `fs-beacon-store` R2 so it mandates the guarantee rather than the mechanism, and also exempts the lock and probe per G1. No departure from R2 remains. The residual departure is from `docs/technical-design-v1.md:151`. |

## Open Questions

- [ ] `link` conforms to the amended `fs-beacon-store` R2, so nothing is open against the spec **[R4]**. Two residuals remain: `docs/technical-design-v1.md:151` still says "rename" for every write and has not been amended, so the design departs from that ratified document rather than from the spec; and `link` is unsupported on FAT and some network mounts, where the store throws an environment error. Note the ordering of that failure — `beacon.json` and `draft.json` use `writeAtomic` and succeed, so the hard failure lands mid-lifecycle at the first `approveDraft` or `abandonDraft`, not at store construction.
- [ ] The port's disk-refusal union now has **seven** members. `beacon-store-port` R3 says "at minimum", so both additions are permitted, but confirm they are wanted: `stale-attempt-artifact` **[R3]** — folding it back into `immutable-file-exists` would restore the dead end D6b exists to close; and `invalid-id` **[R4]** — needed because a malformed *new* id on a creation path is neither not-found nor corruption, and R3 forbids throwing for caller input. The alternative to `invalid-id` is throwing, which R3's refusal discipline rules out for caller-supplied values.
- [ ] Two on-disk fields can legitimately collide across *files* while the aggregate stays correct: an aborted orphan consumes a `local_number` that a later committed version reuses, and two manifests can carry the same `supersedes_version`. Both are excluded from the aggregate by D1's committed-chain walk and are explicitly declared non-corruption in D4. Confirm no future slice depends on either being unique across files. **[R — the `supersedes_version` half was the CRITICAL defect in revision 1; revision 1 spotted only the `local_number` half.]**

## Remediation Index **[R]**

Left column = validator defect id. Right column = the **decision section** of this document (`D1`…`D10`, `C1`…`C3`) that now carries the fix. The two numbering spaces are independent.

| Validator defect | Summary | Decision section carrying the fix |
|---|---|---|
| D1 (CRITICAL) | unqualified `supersedes` witness breaks recovery R2 | **D1** (committed-chain walk) + **D4** (throw row deleted) |
| D2 | `abandoned` `Draft` variant unreconstructable | **D1b** |
| D3 | `inputHash` does not typecheck | **D6** (`SemanticValue` builders) |
| D4 | `revokeVersion` projection unspecified | **D1c** |
| D5 | `recoverProject()` lock scope unstated | **D5b** (two-phase) |
| D6 | same-key retry after pre-commit crash is a dead end | **D6b** (adoption probe) |
| D7 | false `keyHash` equivalence claim | **D6** (`keyHash`) |
| D8 | `localNumber` stored vs derived | **D8** (stored) |
| D9 | on-disk key casing drift | **D6** (snake_case + §7 envelope) |
| D10 | age-gate probe unnamed/unsequenced/unfiltered | **D2** (step 5 + probe properties) |
| D11 | `createDraft` bootstrap absent from the envelope | **D10** + **D1d** |
| D12 | `RecoverReport.artifacts` version-only | **D5b** (`ArtifactRef`) |
| D13 | `writer` and `observer` can disagree | **D5** + constructor |
| C1 refinement | `wx`-direct fork, decorative temp `wx`, temp leak | **C1** + **D5** |
| C2 refinement | word-game resolution replaced | **C2** |
| C3 refinement | port-owned command type, `beaconTitle` conclusion | **C3** |

### Revision 3 index **[R3]**

Left column = attempt-3 defect id. Revision 2 introduced the first three while remediating revision 1.

| Defect | Severity | Summary | Section carrying the fix |
|---|---|---|---|
| DEF-1 | MAJOR (new in rev 2) | blanket snake_case corrupts caller-keyed payloads | **D6** — rules **K1**/**K2** + exempt-node table; **D8** serialisation row; new caller-keyed round-trip test |
| DEF-2 | MAJOR (new in rev 2) | adoption's byte-identity premise is false; normal interleaving classified as corruption | **D6b** — input-determined vs aggregate-derived comparison, six-outcome table; **D3** `StaleAttemptArtifact`; **D4** rows |
| DEF-3 | MAJOR (new in rev 2) | three declared post-commit journal windows had no mechanism | **D1e** (new) + `method` on the stamp + `wrote-journal-entry` |
| DEF-4 | minor | I1 contradicted by the envelope's own pre-domain steps | **I1** restated as a projection property |
| DEF-5 | minor | I2 false in recovery R3's window | **I2** narrowed to reconstructible-and-completable |
| DEF-6 | minor | `heldForMs` exists nowhere | **D2** — prose now matches D3's `{ rule, holderPid, waitedMs }` |
| DEF-7 | minor | dangling "D11" cross-references | **D1d** and **C3** now cite **D10** |
| DEF-8 | minor | adoption probe sequenced before the aggregate exists | **D6b** + data-flow envelope — probe moved from (1c) to (2a) |
| DEF-9 | minor (carried) | lock routed through `createExclusive` instead of `wx` | **D2** step 1 + **D5** exclusion note + **C1** scope note |
| DEF-10 | minor (carried) | `staleAfterMs` 30 s > `waitMs` 5 s breaks R4 scenario 2 | **D2** — `ESRCH` breaks immediately; gate scoped to `pid === null`; default `2_000`, asserted `< waitMs` |
| DEF-12 | minor (carried) | re-read vs "previously committed result" unjustified | **D6** journal-payload note |
| Rulings 1–4 | — | departures ratified / rejected, C2 resolved, C1 stands | **Settled by the Operator, 2026-09-03** |
