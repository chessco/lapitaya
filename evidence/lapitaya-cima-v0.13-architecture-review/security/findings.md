# security — findings (v0.13 review, HEAD 3e6ae0c8)

Probes: `tests/probes/probe1..5.cjs` (+ `.output.txt`). They load the real TS sources through `test/load-ts.cjs`, operate on temp hives under `%TEMP%`, and modify no repository file.

## S-1 FNV-32 is the approval binding (second preimage is trivial)
- CODE: `src/shared/lapitaya/governance.ts:95-116` (fnv1a, toolCallFingerprint), `:156-158` (approval lookup = agentId + fingerprint only), `src/main/cimaRuntime.ts:415-418` (consumption).
- OBSERVED (`probe2.output.txt`): approval granted for `git push origin feature-x` (fp 7e8dbd9e). A command `rm -rf /important/data # 9 LUpT` was built in 52 ms with the same fingerprint. `authorize()` returned `APPROVED / data-deletion / shell:recursive-delete` and consumed the approval of the push.
- RATIONALE: the approval does not store or compare the call itself, nor its category. 32-bit non-cryptographic hash, public algorithm, attacker-controlled suffix. Human approval therefore does not bind to "this call".

## S-2 Sender identity on the message channel is not runtime-verified
- CODE: `src/main/hive.ts:1829` (`msg.from = id; // sender is authoritative — the owning directory`), `src/main/index.ts:3567-3583` (`hive:send` takes `from` from the renderer; only `human`/`alicia` are policed), token check exists only in `src/main/hooks.ts:210-230`.
- OBSERVED (`probe3.output.txt`): `Write` into `<hive>/agents/god/outbox/*.json` → `ALLOW / hive-coordination / LOW`; shell redirect there → `SUPERVISED`.
- RATIONALE: HIVE_GOVERNANCE (toolRisk.ts:62) protects `bin/`, `lapitaya/`, `registry.json`, per-agent `settings.json|identity.md|cursor.json`, but not `outbox/`. An agent can author a message that the router attributes to another agent (including the orchestrator).

## S-3 Governance-path classification does not normalize paths
- CODE: `src/shared/lapitaya/toolRisk.ts:68-84` (`norm()` only swaps `\` and lowercases).
- OBSERVED (`probe1.output.txt` P2, `probe2.output.txt` P2b): `<hive>/lapitaya/approvals.json` → governance-tamper (HIGH); `C:/Windows/../<same path>` and relative paths → `config-change / MEDIUM`; `authorize()` on the `..` form → `SUPERVISED`.
- LIMIT: whether the CLI hands the hook un-normalized paths was not verified end to end.

## S-4 State files carry no integrity tag
- OBSERVED (`probe1` P3): a hand-written `approvals.json` containing an `approved` entry with the right fingerprint → `APPROVED`.
- RATIONALE: crash/corruption detection = JSON-parse validity only. Any writer of the file is accepted. Combined with S-3 (+ S-1 for fingerprint computation) this is a route to self-approval; each link was verified separately, the chain was not run through a real CLI.

## S-5 Shell classification is lexical
- OBSERVED (`probe1` P9): `node fix.js` and `node -e "...'ta'+'sks.json'..."` → `shell-command / MEDIUM`; direct mentions of tasks.json → HIGH. `taskLedgerWriteGate` keys on `/tasks\.json/` in the command text (cimaRuntime.ts:794-804). There is no post-hoc check of tasks.json (grep: no reconciler in src/main).

## S-6 MCP / WebFetch
- OBSERVED (`probe3`): `mcp__github__delete_repository` → `SUPERVISED / MEDIUM / rule mcp`; at SEMI_AUTONOMOUS and AUTONOMOUS the same call → `ALLOW/AUTO`. `WebFetch` with data in the URL → `ALLOW / LOW`.

## Trust table → see report §25.
