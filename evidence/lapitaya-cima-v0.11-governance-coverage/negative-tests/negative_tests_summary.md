# Negative Tests Summary (CIMA v0.11)

## Overview
Summary of negative test scenarios verifying fail-closed behavior across shell mutation, decision gate, evidence correlation, and provider spawn boundaries.

## Test Matrix
| Test ID | Test Description | Expected Result | Actual Result |
| :--- | :--- | :--- | :--- |
| `COVERAGE-01` | Shell `>` mutation on `tasks.json` | HIGH risk (`governance-tamper`) | `governance-tamper` / `HIGH` |
| `COVERAGE-02` | Shell `>>` mutation on `tasks.json` | HIGH risk (`governance-tamper`) | `governance-tamper` / `HIGH` |
| `COVERAGE-03` | Shell `2>` mutation on `cima-ledger.jsonl` | HIGH risk (`governance-tamper`) | `governance-tamper` / `HIGH` |
| `COVERAGE-04` | Command substitution mutation | HIGH risk (`governance-tamper`) | `governance-tamper` / `HIGH` |
| `COVERAGE-05` | `find . -delete` | HIGH risk (`data-deletion`) | `data-deletion` / `HIGH` |
| `COVERAGE-06` | `find . -exec rm {} \;` | HIGH risk (`data-deletion`) | `data-deletion` / `HIGH` |
| `COVERAGE-07` | `tee` / `cp` / `mv` / `rm` on `tasks.json` | HIGH risk (`governance-tamper`) | `governance-tamper` / `HIGH` |
| `COVERAGE-08` | Shell `>` attempting task completion | DENY (`DECISION_GATE`) | `DENY` (`DECISION_GATE`) |
| `COVERAGE-09` | `completionGate` without DECISION PASS | allowed: false (`DECISION_GATE`) | `allowed: false` |
| `COVERAGE-10` | PowerShell `Set-Content` on `tasks.json` | DENY (`DECISION_GATE`) | `DENY` (`DECISION_GATE`) |
| `COVERAGE-11` | MCP `mcp__write_file` on `tasks.json` | DENY (`DECISION_GATE`) | `DENY` (`DECISION_GATE`) |
| `COVERAGE-12` | Provider `Write` on `tasks.json` | DENY (`DECISION_GATE`) | `DENY` (`DECISION_GATE`) |
| `COVERAGE-13` | Evidence verification on `ok: false` trace | verified: false | `verified: false` |
| `COVERAGE-14` | Submission citing failed command trace | BLOCKED (`EVIDENCE_FIRST`) | `BLOCKED` (`EVIDENCE_FIRST`) |
| `COVERAGE-15` | Submission citing wrong command trace | verified: false | `verified: false` |
| `COVERAGE-16` | Submission citing trace by wrong actor | BLOCKED (`EVIDENCE_FIRST`) | `BLOCKED` (`EVIDENCE_FIRST`) |
| `COVERAGE-18` | Spawning unbridged provider (`kimi`) | Throw `LAPITAYA_GOVERNANCE_UNENFORCEABLE` | Throws error |
| `COVERAGE-19` | Spawning non-blocking provider (`copilot`) | allowed: false | `allowed: false` |
| `COVERAGE-23` | Ambiguous shell mutation | MEDIUM risk (`shell:mutation`) | `shell:mutation` / `MEDIUM` |
| `COVERAGE-24` | Empty/malformed call authorization | DENY | `DENY` |
| `COVERAGE-25` | Adversarial forged governance chain | BLOCKED / DENY | Fail closed at step 1 |

## Conclusion
All 25 test cases passed cleanly, demonstrating fail-closed enforcement across all governance coverage boundaries.
