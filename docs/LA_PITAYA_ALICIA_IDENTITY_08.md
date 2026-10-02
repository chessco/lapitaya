# LA PITAYA — ALICIA v0.8
## Human Identity & Decision Ownership

**PitayaCode — Sonora, Mexico**
**Branch**: `lapitaya/alicia-v0.8-human-identity-decision-ownership` (from `lapitaya/alicia-v0.7-human-governance-decision-center`, `d8be5d6c`)
**Date**: October 1, 2026
**Evidence**: [`evidence/lapitaya-alicia-v0.8/`](../evidence/lapitaya-alicia-v0.8/)

> Identity identifies the human. Runtime authorizes the action. Evidence records what happened. Alicia explains it.

---

## 1. Objective

Make "who decided" a runtime-backed fact: WHO requested, WHO is being asked, WHO confirmed / cancelled /
approved / rejected, WHEN, and under which trusted context. v0.8 changes **who is recorded**, never
**what governance decides**: CIMA, `authorize()`, `completionGate()`, risk and autonomy are untouched.

## 2. Source of truth

Foundation v0.1 … Alicia v0.7 (code and reports). v0.7's `lapitaya:decide`, `lapitaya:confirmRequest`,
`lapitaya:cancelRequest` and the v0.6 projection are the base. No API name here is invented.

## 3. Base branch

`lapitaya/alicia-v0.7-human-governance-decision-center` (`d8be5d6c`).

## 4. New branch

`lapitaya/alicia-v0.8-human-identity-decision-ownership`. `main` untouched, no merge.

## 5. Existing identity model (what was found)

There was **no per-person identity**. "The human" was the literal string `'human'`, hard-coded in the
IPC handlers (`confirmRequest(id, {by:'human'})`, `cancelRequest(id,'human')`, `decide(id, approve,
'human')`). The handlers already ignored anything the renderer added (they took `id`/`approve`/`token`
and nothing else), so a renderer could not choose `by`; but nothing recorded *which* human, from
*which* window or session, and no sender check existed: any `webContents` that reached the channel
was "the human". Records kept `confirmedBy: 'human'`, `closedBy: 'human'`, `decidedBy: 'human'`.

`'human'` stays as the **actor role** (the existing gate: only `by === 'human'` decides). v0.8 adds an
identity **beside** it; it replaces nothing.

## 6. Trusted identity source

Resolved in **main** only (`src/main/humanIdentity.ts`), from the application's own context:

| Part | Source |
|---|---|
| `id` | `hum-<20 hex>`, created once by main and persisted in the profile's `config.json` (`humanId`). Stable across launches and windows. Never the display name. |
| `displayName` | the OS user name, sanitized (control characters and `<>` stripped, capped at 64). Presentation only; not unique, not authoritative. |
| `session` | `ses-<16 hex>`, one per app launch. |
| `window` | `webContents.id` of the sender. |

`resolve(evt)` returns a context only if the sender is **one of the app's own `BrowserWindow`s, is its
main frame, is not destroyed, and its frame URL starts with the app's own renderer (the build
directory as a `file://` URL, or the dev-server origin)**. Otherwise it returns `null` and the caller
refuses. Shapes are strict (`parseHumanContext`): a malformed context is never downgraded to
"anonymous".

This is an **application identity boundary, not authentication**: there is no password, account,
OAuth or network identity (all out of scope).

## 7. IPC boundary

`src/main/humanGovernanceIpc.ts` holds the handlers main wires to the **same channel names**. Each takes
only what the human's UI can say (id, boolean, single-use token); extra arguments are not read.

| Channel | Change |
|---|---|
| `lapitaya:confirmRequest` / `cancelRequest` / `completeRequest` / `decide` | Same names and renderer signatures. Main resolves the context from the event and passes it to the existing runtime method. Untrusted sender: confirm goes to the runtime as `by:'untrusted-sender'` (the existing gate refuses and records it); cancel/complete are refused; decide returns `null`. |
| `lapitaya:identity` (**new, read-only**) | Returns `{id, displayName, session}` for the sender, or `null`. It sets nothing and delegates nothing. It exists so the Decision Center can say who it acts for. |
| `alicia:submit` | After the intent boundary opens a REQUEST, main records WHO submitted it (`attributeRequest`, write-once, only while `PROPOSED`; changes no status, token, scope or fingerprint). |
| `lapitaya:approvals` | **Untouched** (intentionally out of scope: #5). |

The runtime validates the context (`parseHumanContext`) and records it. The renderer cannot pass
`userId`, `approvedBy`, `confirmedBy`, `rejectedBy` or an identity object and have it trusted (it is
not read), and there is no renderer-side way to build a context (tested structurally and in the real
app).

## 8. REQUEST ownership

* `confirmRequest` → ledger `request/CONFIRMED` carries `human: {id, displayName, session, window}`;
  the proposal keeps `confirmedOwner` (write-once, with the existing `confirmedBy: 'human'`).
* `cancelRequest` / `completeRequest` → `closedOwner` and the same field on the ledger record.
* A refused attempt (`CONFIRMATION_DENIED`) records the **attempt's** context, never a CONFIRMED record.
* `requestedOwner` (who submitted) lives in the proposal state (`proposals.json`), written once.
* Already resolved elsewhere → `NOT_CONFIRMABLE` (existing code), never silent success.

## 9. HIGH approval ownership

`decide(id, approve, 'human', ctx)` → the approval record keeps `decidedOwner`; the ledger
`HUMAN_APPROVED` / `HUMAN_REJECTED` line carries `human`. Semantics unchanged: pending-only, one-shot,
the agent must retry through `PreToolUse`, and `authorize()` decides every execution. Confirming a
REQUEST still never approves a HIGH action.

## 10. Cross-window behavior

The runtime is the single source. `lapitaya:governance` events now reach **every** app window (before:
only the primary), so another window's Decision Center follows a decision without acting. A second
window cannot replay: a stale token → `NOT_CONFIRMABLE`; a second approve/reject → `null`; the owner of
the first decision (including its `window`) never changes. Validated with two real windows (§20).

## 11. Evidence

No second ledger or store. The owner rides on the **existing** `cima-ledger.jsonl` records and the
existing `proposals.json` / `approvals.json` state. WHEN is the runtime's own `ts`. Test `ID-18` asserts
no `human-*`/`identity-*`/`approval-history` file appears.

## 12. Observability

The v0.6/v0.7 projection gained `decisionOwner: {id, displayName} | null`, whitelist-read from the
ledger record, only on human decisions (REQUEST confirmed / cancelled / completed / refused attempt,
APPROVAL_GRANTED / REJECTED). It never carries session, window, token, fingerprint or raw ledger lines.
Legacy records without `human` project `null` (nothing is invented). The Decision Center shows: who it
acts for, "requested / confirmed / cancelled / completed by" on REQUEST cards, "decided by" on HIGH
cards, and "by …" in the resolved history. No identity logic lives in the renderer.

## 13. Security

* Renderer identity is never trusted; main resolves it from the sender.
* Sender checks: own window, main frame, not destroyed, own renderer URL (prefix-trick, other origins,
  files outside the build directory and child frames are refused, ID-02).
* DOM / projection / IPC replies contain no token, fingerprint, session, window, command, path
  (ID-08, ID-23–25, Electron DOM scans).
* Display name is data: stripped and capped, rendered as text.

## 14. i18n

New keys under `alicia.decisions.owner` in es-MX and en-US, identical key sets, no fallback, ASCII in
en-US (ID-26, ID-27). Verified live with one window per language at once.

## 15. Accessibility

Identity and owner lines are plain text inside the existing structure: no new interactive element, no
shortcut, no color-only meaning, no destructive default focus; the count of controls is identical with
and without an identity (ID-28).

## 16. Tests

`test/lapitaya-alicia-v08.test.cjs`: 13 tests covering ID-01 … ID-28 plus the IPC-boundary and
no-second-store checks (real runtime, real handlers, real identity service; the sender is a plain object
because `describeSender` is the one Electron-specific seam). 13/13 pass. ID-29 / ID-30: §20.

Negative proofs: spoofed identity / confirmedBy / approvedBy / rejectedBy, malformed contexts, other
agents/Alicia as `by`, untrusted senders (every channel), replay, stale, second decision, approve-then-
reject, owner immutability, cross-window, REQUEST confirmation ≠ HIGH approval, identity ≠ confirmation.

## 17. Regression

`test/lapitaya-*.test.cjs` (Foundation, CIMA v0.2/v0.3/v0.3.1, Alicia v0.4–v0.8): **213/213**. Full
repository suite: 1064 tests, 20 failures — the **same 20** as the v0.6 baseline; **0 new**
(`validation/failure-classification.txt`).

**Pinned tests updated (deliberately, invariants kept or strengthened):** the wiring moved from
`index.ts` into `humanGovernanceIpc.ts`, so seven structural tests that pinned the old text were
updated: v0.4.1 INTENT-ARCH-01 / v0.6 OBS-18 / v0.7 DC-17 (import allow-lists gained the pure
`identity` module), v0.4.2 REQ-ARCH (the human-only call sites are now `humanGovernanceIpc.ts` and the
IPC wiring; main must not call the runtime directly), v0.5 UI-04 and v0.7 DC-08 (handler text), and v0.7
DC-17 (the renderer's allowed bridge methods gained read-only `lapitayaIdentity`). One failure
(v0.5 UI-12: renderer imports from `@shared` must be type-only) was a **real** violation in my first
draft and was fixed in the code, not the test.

## 18. Typecheck

`npm run typecheck`: PASS.

## 19. Build

`npm run build`: PASS.

## 20. Electron validation

Real built app, throwaway profile **and** throwaway hive root (seeded through the profile's
`config.json`), driven over CDP; HIGH calls through the hive's hook pipe. Details and screenshots:
`evidence/lapitaya-alicia-v0.8/electron/README.md`. All of: trusted identity exists and is persisted;
the Decision Center shows it; REQUEST submit / confirm / cancel and HIGH approve / reject each recorded
the same `hum-…` id, the app's session and a window id in the ledger; a forged token, a replay and a
flipped decision were refused; two real windows (one es-MX, one en-US) stayed consistent; no leaks; no
renderer errors.

## 21. Evidence path

`evidence/lapitaya-alicia-v0.8/` (`validation/`, `electron/`). The OS user name is replaced by
`<os-user>` in the text artifacts; the screenshots show it unredacted.

## 22. Observations

* The second window the app opens is the **Floor** window; it also hosts the human tab and bridge, so
  it served as a genuine second renderer. Both had a Decision Center in the final scenario.
* The history lists refused attempts ("by …") as the **attempt's** author; the category text says it
  was refused.
* In an earlier Electron attempt a stale window approved a pending approval by mistake of my script
  (roles confused); the leftover one-shot approval was consumed by the next call exactly as designed.
  `flow8b` records that run; `flow8c` / `flow8e` are the clean runs. Nothing else depends on it.
* The v0.7 evidence claimed the renderer receives no token; that was wrong (a PROPOSED REQUEST hands
  its single-use token to the renderer, v0.5 design). Corrected in v0.7 (`d8be5d6c`).

## 23. Limitations

* Attribution, not authentication: anyone using the same OS user and profile is the same human.
* `displayName` is the OS user name (may be personal data); it is shown to the local human only.
* `requestedOwner` is state-backed (`proposals.json`), not a ledger record.
* Decisions made before v0.8 have no owner (`null`), never a guessed one.
* `window` is Electron's `webContents.id`: not stable across launches (the `session` disambiguates).
* Validated on Windows only.

## 24. Remaining risks

* A compromised renderer inside an app window is still "the human" for that window (as before; the
  boundary is the window, not the page's honesty). It still cannot name another human, and it cannot
  change a recorded owner.
* `humanId` lives in `config.json`; copying a profile copies the identity.
* `lapitaya:approvals` still returns approval summaries (incl. `decidedOwner.session/window`) to the
  renderer — intentionally untouched (#5, future slice), as is the classic Governance panel fallback.
* The single-use REQUEST token is in renderer memory (v0.5 design).

## 25. Final verdict

**PASS_WITH_OBSERVATIONS.** Identity ownership is verified end to end in unit tests against the real
runtime and in the real Electron app with two windows. Observations and limits above.
