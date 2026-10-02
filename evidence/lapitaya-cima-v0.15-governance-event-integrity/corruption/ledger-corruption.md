# ledger-corruption.md — what v0.14 accepted, what v0.15 detects

Reproduction script: `../baseline/repro_v014_findings.cjs` (temp hives only). Raw output: `../baseline/repro_pre_fix.txt` (v0.14, commit `687ba744`) and `../baseline/repro_post_fix.txt` (v0.15).
Tests: `test/lapitaya-cima-v0.15.test.cjs` EVENT-04…EVENT-16, EVENT-34, ADV-1…ADV-5. Real Electron: `../electron/electron_validation_v15.txt` (C1–C7, R1) and `real_app_smoke_v15.txt` (D1–D7).

## v0.14 behaviour (FACT, reproduced)

| # | Manipulation of `cima-ledger.jsonl` | v0.14 result |
|---|---|---|
| R1 | delete the LAST event cleanly | `authorize → ALLOW` — undetected |
| R2 | delete a MIDDLE event | `ALLOW` — undetected |
| R3 | reorder two events | `ALLOW` — undetected |
| R4 | **insert a text-forged BUILD/TEST/AUDIT/DECISION PASS chain** | `completionGate → allowed: true` — **a task could be completed by editing a text file** |
| R5 | insert a fake `HUMAN_APPROVED` line | `ALLOW` — undetected (inert only because nothing read it) |
| R9 | truncate the final record | `DENY GOVERNANCE_STATE_CORRUPT`, no recovery API, nothing named the defect |

The only corruption v0.14 noticed was a line that does not parse. Everything that still parses — which is everything an attacker would write — was trusted.

## v0.15 detection model

Each new line is an event: `{ …record…, schemaVersion:2, eventId, eventType, sequence, previousEventHash, eventHash, eventMac }`
(`src/main/ledgerChain.ts`; format and procedure in the document §4–§8).

| Defect | Code | Where the test is |
|---|---|---|
| line is not JSON | `MALFORMED_JSON` (names the line) | EVENT-13 |
| final record incomplete | `TRUNCATED_TAIL` | EVENT-12 |
| not an object / envelope incomplete / blank line in the chain | `INVALID_SCHEMA` | EVENT-14 |
| `schemaVersion` this runtime does not understand | `UNKNOWN_SCHEMA` | EVENT-14 |
| a legacy-format line after the chain started | `LEGACY_AFTER_CHAIN` | EVENT-10 |
| same `sequence` twice / going backwards / skipping | `SEQUENCE_DUPLICATE` / `SEQUENCE_REGRESSION` / `SEQUENCE_GAP` | EVENT-04, 09, 11 |
| same `eventId` twice | `DUPLICATE_EVENT_ID` | EVENT-05 |
| `previousEventHash` ≠ previous event | `PREVIOUS_HASH_MISMATCH` | EVENT-07 |
| event content ≠ `eventHash` | `EVENT_HASH_MISMATCH` | EVENT-08 |
| event not sealed by the runtime key (forged, or re-hashed after an edit) | `EVENT_MAC_INVALID` | EVENT-08, 10, ADV-3 |
| legacy prefix altered/deleted after the migration | `BOUNDARY_MISMATCH` | EVENT-32 |
| **tail events deleted (chain still valid)** | `ANCHOR_TRUNCATION` (keyed head anchor `ledger-head.json`) | EVENT-09 |
| coherent rewrite that does not match the anchor | `ANCHOR_MISMATCH` | ADV-5 |
| anchor missing / unverifiable | `ANCHOR_MISSING` / `ANCHOR_INVALID` | — |

All of these are **CORRUPTED**. Governance then fails closed with the explicit rule **`LEDGER_CORRUPTED`**:
`authorize → DENY`, `recordIntent → false`, `recordTrace → null`, `submit → BLOCKED / STATE_UNAVAILABLE`, `openRequest → null`, `decide → null`, `confirm → LEDGER_CORRUPTED`, `completionGate → not allowed`, `ledger() → []`. The damaged bytes are never modified (EVENT-15 compares the file byte for byte).

## v0.15 results on the same manipulations (`repro_post_fix.txt`)

R1/R2/R3/R5/R9 → `DENY LEDGER_CORRUPTED`; R4 → `completionGate not allowed (DECISION_GATE: governance state file corrupted: cima-ledger.jsonl [...])`.

## What detection does NOT claim (stated, tested)

* A bare hash chain can be recomputed by anyone who can write the file. That is why every event also carries `eventMac = HMAC-SHA256(seal key, eventHash)` and the head is anchored under the same key: forging, inserting, re-chaining or tail-truncating needs the key (EVENT-10: a correctly chained event without the key → `EVENT_MAC_INVALID`).
* A writer who **holds the seal key** and rewrites the whole chain **and** the anchor is not detected (ADV-5 demonstrates the boundary). The production key lives outside the hive (v0.14); arbitrary code an agent runs through the shell can still read it — that is **PENDING — Execution Isolation**.
