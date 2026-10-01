# LA PITAYA — ALICIA v0.7
## Human Governance & Decision Center

**PitayaCode — Sonora, Mexico**
**Branch**: `lapitaya/alicia-v0.7-human-governance-decision-center` (from `lapitaya/alicia-v0.6-governance-observability`, `8999a4aa`)
**Date**: September 30, 2026
**Evidence**: [`evidence/lapitaya-alicia-v0.7/`](../evidence/lapitaya-alicia-v0.7/)

> Runtime decides. Evidence proves. Alicia explains. Human decides.

---

## 1. Objective

Unify the human decision experience in one place: Alicia REQUEST confirmations, HIGH-risk human
approvals/rejections, runtime-backed explanations, evidence, decision state, decision history and the
next human action. The Decision Center is a presentation and decision-collection surface, not a
governance engine. v0.7 is UX integration only.

## 2. Source of truth

Foundation v0.1, CIMA Runtime v0.2 / v0.3 / v0.3.1, Alicia v0.4 / v0.4.1 / v0.4.2 / v0.5 and, above
all, v0.6 (`docs/LA_PITAYA_ALICIA_GOVERNANCE_OBSERVABILITY_06.md` and its code). Every API name used
here exists in that code; none was invented.

## 3. Base branch

`lapitaya/alicia-v0.6-governance-observability`.

## 4. New branch

`lapitaya/alicia-v0.7-human-governance-decision-center`. `main` was not touched or merged.

## 5. Architecture

```text
RUNTIME (authorize / approvals / proposals / ledger)
   ↓
projectObservability()  (v0.6, extended: pendingApprovals, byApproval, history)
   ↓
lapitaya:observability  (read-only IPC)
   ↓
DECISION CENTER  (renderer: presents, collects a click)
   ↓
HUMAN
   ↓
lapitaya:confirmRequest | lapitaya:cancelRequest | lapitaya:decide   (existing IPC)
   ↓
RUNTIME AUTHORITY
```

There is no path Alicia → authority. After any click the Decision Center re-reads the runtime; what
the runtime answered is what is shown.

## 6. Decision Center

Mounted in the existing `#human` tab, above Governance Activity. Files:
`DecisionCenterView.tsx` (view), `decisionCenter.ts` (pure mapping of runtime facts to cards),
`useDecisionCenter.ts` (hook), `decisionCenterPresence.ts` (presentation flag).

```text
Human
├── Human Decisions   — pending REQUESTs, pending HIGH approvals, resolved history
├── Governance Activity (v0.6, kept)
└── Alicia
```

Counts and a badge on the tab show what needs a decision. Pending and resolved are separated; the
resolved list is collapsed by default. While the Decision Center is mounted, the classic Governance
panel stands down its Approve/Reject buttons so there is exactly one set of controls per decision;
its activity listing stays.

## 7. REQUEST confirmation

Card `REQUEST CONFIRMATION`: request, scope, state, explanation, evidence, timeline, required human
action. Actions: **Confirm** → `lapitaya:confirmRequest`; **Cancel** → `lapitaya:cancelRequest`.
Scope, state and explanation come from the runtime. Runtime refusals (`STALE_PROPOSAL`,
`NOT_CONFIRMABLE`, `TAMPERED`, …) are shown as the runtime reported them.

## 8. HIGH approval

Card `HIGH-RISK HUMAN APPROVAL`: runtime risk, operation, agent, related REQUEST/task when known,
explanation, rule, evidence, timeline, approval state. Actions: **Approve** / **Reject** →
`lapitaya:decide` → `decide(id, approve, 'human')`, the existing CIMA mechanism. Approve is
deliberate: it requires an acknowledgement first, is not the default focus and has no shortcut.
The card states that confirming the REQUEST did not approve this action, and that one approval
authorizes one execution of that exact call.

## 9. Runtime authority

CIMA, `authorize()`, `PreToolUse` and `completionGate()` are unchanged. Approval and confirmation are
one-shot in the runtime; the UI has no locking of its own. If UI and runtime disagree, the runtime
wins (DC-25; Electron stale-UI race).

## 10. Alicia boundary

Alicia presents, explains, shows evidence and timelines, receives a human click and reflects the
result. She does not decide, approve, reject, compute or change risk or autonomy, execute, write the
ledger or modify tasks. REQUEST confirmation ≠ HIGH approval, in both directions (DC-10, DC-11).

## 11. IPC boundary

**No new IPC channel.** Used: `lapitaya:observability`, `lapitaya:requests`, `lapitaya:approvals`,
`lapitaya:confirmRequest`, `lapitaya:cancelRequest`, `lapitaya:decide`. One narrowing change:
`lapitaya:decide` now returns only `{ id, status, decidedAt, decidedBy }` (or `null` if not pending)
instead of the whole approval, so the call summary (the command) and fingerprint no longer reach the
renderer. Nothing exposes `authorize`, `executeTool`, ledger writes, risk or autonomy.

## 12. Observability integration

`projectObservability` gained three read-only fields: `pendingApprovals`, `byApproval`, `history`.
Same projection, same whitelist, same deep freeze; no second projection. If a pending approval's
ledger record is outside the window, the approval's own record (`approvals.json`) is the evidence,
with enumerated fields only.

## 13. Evidence model

`NO EVIDENCE → NO CLAIM`. Each reference is a ledger `EVT-…`, a `traces.jsonl` id or an
`approvals.json` id, and resolves to a real runtime record (DC-23; 25/25 and 28/28 in the live DOM).
Unresolvable evidence shows the v0.6 unavailable state; nothing is fabricated.

## 14. Security

The DOM contains no secrets, commands, paths, approval summaries, fingerprints or proposal tokens
(DC-21, DC-22; Electron: 0 leaks across two DOM scans). v0.6 whitelist boundary preserved.

## 15. i18n

`es-MX` and `en-US`: identical key sets, no fallback, no hardcoded visible text. Agent names remain
untranslated; English identifiers are ASCII (DC-26, DC-27).

## 16. Accessibility

Native buttons with accessible names, named sections and labelled groups, visible focus, logical tab
order, polite state announcements, no approval shortcut, no destructive default focus, Approve
visually and textually distinct from Confirm (DC-28; keyboard-only cancel/reject in Electron).

## 17. Tests

`test/lapitaya-alicia-v07.test.cjs`: 14 tests covering DC-01…DC-28 plus `DC-NEG` (all negatives of
spec §24) and `DC-INV` (invariants). DC-29 / DC-30 are the real-Electron flows (section 21). Result:
14/14 pass (`validation/alicia-v07-suite.txt`).

## 18. Regression

All `test/lapitaya-*.test.cjs` (Foundation, CIMA v0.2/v0.3/v0.3.1, Alicia v0.4–v0.7): 199/199 pass
(185 prior + 14 new). Full repository suite: 20 failures, the same 20 as the v0.6 baseline; 0 new
(`validation/failure-classification.txt`). They are pre-existing symlink/worktree/IPC-counting
tests unrelated to La Pitaya.

## 19. Typecheck

`npm run typecheck`: PASS (node + web).

## 20. Build

`npm run build`: PASS.

## 21. Electron validation

Real built app driven over CDP, throwaway user-data-dir and hive. All 20 checks of spec §27 passed,
including double-click one-shot, forged/replayed/tampered/stale decisions, a two-window race
(the runtime applied one decision; the other card became `ALREADY_RESOLVED`), es-MX and en-US, and
no renderer errors. Details: `evidence/lapitaya-alicia-v0.7/electron/ELECTRON_VALIDATION.md`.

## 22. Evidence

`evidence/lapitaya-alicia-v0.7/`: `request-decisions.json`, `high-decisions.json`, `negatives.json`,
`i18n-and-a11y.json`, `security-boundary.json`, `html/`, `electron/` (screenshots, DOM checks,
renderer errors, redacted traces, ledger), `validation/` (suite, regression, typecheck, build,
failure classification), `reproduce.cjs`. No secrets are stored.

## 23. Observations

- The classic Governance panel hides its approval buttons while the Decision Center is mounted
  (intentional, to avoid duplicate controls).
- Reloading the renderer returns the app's hive picker (existing behavior).
- The 20 baseline failures are unchanged from v0.6.

## 23b. Code-review follow-up

A high-effort review of this branch produced 10 findings. Fixed: the stale card after an accepted
decision (now stays APPROVING/REJECTING, no second decision offered); the missing fallback (the
classic Governance panel now stands down only while the projection is available); projection
failures no longer hide REQUESTs or the badge; the approval acknowledgement no longer claims
knowledge of the command; the view model is memoized. Test `DC-REV`.
Deferred: `lapitaya:approvals` still returns summaries to the renderer (unchanged since v0.5; the
classic panel needs it as the fallback); pending approvals are labelled by their runtime risk, not
filtered to HIGH; per-session cleanup of resolved cards; duplicated fallback mapping in the
projection; test guards in `App.tsx`/`useResolvedGodName.ts`.

## 24. Limitations

- The history window is bounded (default 20 resolved decisions).
- Pending HIGH approvals whose ledger record has aged out show fewer fields (approval record only).
- Electron validation ran on Windows only, with one language switch via persisted setting + reload.

## 25. Remaining risks

- `lapitaya:decide` identity is the existing `'human'` actor set in main; there is no per-user
  identity (out of scope: no new authentication).
- Two renderer windows rely entirely on runtime one-shot semantics (verified, but UI can briefly
  show a stale button until the next refresh).

## 26. Final verdict

**PASS_WITH_OBSERVATIONS.** All required invariants are verified by tests and by real Electron
execution; observations are the baseline failures (unchanged) and the limitations above.
