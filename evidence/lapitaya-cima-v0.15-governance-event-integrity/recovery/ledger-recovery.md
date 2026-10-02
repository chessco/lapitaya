# ledger-recovery.md — the recovery model

Code: `CimaRuntimeService.recover()` / `verifyGovernanceState()` / `recoveryHistory()` (`src/main/cimaRuntime.ts`),
operator tool `scripts/lapitaya-recover.cjs`, artifact `governance-recovery.json`.
Tests: EVENT-16, 17, 33, 34, 35, 36, 31. Real Electron: `electron_validation_v15.txt` R1–R7, C7.

## Two different statements

| | meaning | who says it |
|---|---|---|
| **detected** | verification found damage (`CORRUPTED` / `INCONSISTENT`) | the runtime, on every verification; recorded once per distinct defect in `governance-recovery.json` as `RECOVERY_REQUIRED` |
| **repaired and validated** | an explicit recovery was performed and the result verified | the runtime, after an OPERATOR action (`RECOVERED`), or after verifying a repair made outside it (`VERIFIED_AFTER_EXTERNAL_REPAIR`) |

States: `HEALTHY → CORRUPTED (detected) → RECOVERY_REQUIRED (recorded) → RECOVERED`. `RECOVERED` stays visible (Alicia shows it) so "never damaged" and "damaged and recovered" are never conflated. A persistent defect is recorded once (`signature`), not on every call.

## What recovery does (and the rules it keeps)

`recover({ scope: 'ledger' | 'state' | 'all', operator: { name, os, host }, confirm: 'RECOVER' })` — operator tooling only; **no IPC channel, preload method, renderer path, agent or Alicia can call it** (EVENT-31 scans the sources; the real app's bridge has no such key: real-app smoke D4).

**ledger**
1. a fresh FULL verification finds the first defect and the end of the verified prefix;
2. the damaged ledger is copied **whole** to `cima-ledger.quarantine-<ts>-<sha8>.jsonl` (never edited; its SHA-256 is recorded; EVENT-33 / Electron R3 prove it is byte-identical to what was found);
3. the new ledger is the verified prefix **byte for byte** (EVENT-33 compares the lines);
4. one `LEDGER_RECOVERED` event is appended and the head re-anchored: it names the quarantine file and SHA-256, the first bad line/byte, the sequence recovered through, the anchor sequence before, the reason codes and **the operator** (name, OS user, host);
5. everything is re-verified from genesis. Only then is `RECOVERED` recorded.

**state** — unreadable `proposals.json` / `approvals.json` are quarantined (kept as evidence, replaced by empty state); state that claims MORE than the events justify is brought DOWN to the events: a proposal becomes the status its events say (or `BLOCKED`), an approval becomes `invalid` (`APPROVAL_RETIRED` event). Each change is an event.

## What recovery never does

* **never creates `APPROVED`, `CONFIRMED`, `PASS`, `EXECUTED`** — or any other fact. Events at and after the first defect are quarantined, **not replayed**: what only they established is simply no longer established. EVENT-33: after recovering a ledger corrupted at a `HUMAN_APPROVED`, the previously approved-and-consumed call gets `HUMAN_APPROVAL_REQUIRED` again — the human is asked again. Electron R6/R7: no `HUMAN_APPROVED`, `APPROVAL_CONSUMED`, `REQUEST_CONFIRMED` or `TOOL_EXECUTED` exists after the recovery boundary.
* never deletes evidence, never repairs silently on startup, never continues past a defect.
* is never automatic: a damaged ledger stays closed (`LEDGER_CORRUPTED`) until an operator acts (EVENT-15, EVENT-16, EVENT-34).

## The recovery artifact (`governance-recovery.json`)

An append-only list; each entry: `state`, `reason`, `findings[]` (codes, files, lines, sequences), `action`, `operator`, `quarantined[] {file, sha256, bytes}`, `recoveredThroughSequence`, `anchorSequenceBefore`, `corruptedFromLine`, `previousEntryHash` (its own hash chain), `entryHash` (SHA-256) and `mac` (HMAC under the seal key). Tampering with, removing or reordering entries is itself detected as `STATE_FILE_CORRUPTED` (EVENT-36). It is not a governance event stream: governance facts live only in the ledger.

## Usage

```
node scripts/lapitaya-recover.cjs verify  --hive <hive> --seal-key <key> [--full]
node scripts/lapitaya-recover.cjs history --hive <hive> --seal-key <key>
node scripts/lapitaya-recover.cjs recover --hive <hive> --seal-key <key> --scope all --operator "<name>" --confirm RECOVER
```
Run it with La Pitaya closed. The seal key is the app's `<userData>/lapitaya-governance-seal.key` (production) or `<hive>/lapitaya/.seal.key` (tests/tools).

## Remaining limits

Recovery is manual by design: automating it would require deciding which lost facts to believe. Losing the seal key loses the ability to verify any event (every MAC fails; the verified prefix is empty) — keep a backup of it. Events lost with the quarantined suffix are lost for governance purposes; the quarantine keeps them for forensics.
