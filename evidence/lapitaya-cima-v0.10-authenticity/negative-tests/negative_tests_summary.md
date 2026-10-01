# Negative Tests Summary (CIMA v0.10)

## Overview
Summary of negative test cases verifying fail-closed behavior across identity and context validation boundaries.

## Test Cases
| Test ID | Test Description | Expected Result | Actual Verdict / Status Code |
| :--- | :--- | :--- | :--- |
| `AUTH-02` | Missing agent capability token in hook frame | DENY | `IDENTITY_UNTRUSTED` (`permissionDecision: "deny"`) |
| `AUTH-03` | Invalid agent capability token in hook frame | DENY | `IDENTITY_UNTRUSTED` (`permissionDecision: "deny"`) |
| `AUTH-04` | Payload `agent_id` mismatch with token | DENY | `IDENTITY_MISMATCH` (`permissionDecision: "deny"`) |
| `AUTH-05` | Agent A token attempting action as Agent B | DENY | `IDENTITY_MISMATCH` (`permissionDecision: "deny"`) |
| `AUTH-06` | Message path/folder name as authority | DENY | `IDENTITY_UNTRUSTED` |
| `AUTH-07` | Untrusted message payload `from` header | DENY | `IDENTITY_UNTRUSTED` |
| `AUTH-08` | Agent payload claiming `from: "human"` | DENY | `NOT_AUTHORIZED` |
| `AUTH-09` | `DECISION PASS` submission without human context | BLOCKED | `DECISION_AUTHORITY` |
| `AUTH-10` | Fake human IPC request | DENY | `NOT_AUTHORIZED` |
| `AUTH-11` | `payloadHuman` override in renderer payload | DENY | `NOT_AUTHORIZED` |
| `AUTH-13` | Builder attempting AUDIT phase | BLOCKED | `ROLES_MUST_BE_DISTINCT` |
| `AUTH-14` | Auditor attempting BUILD phase | BLOCKED | `AGENT_NOT_ASSIGNED` / `ROLES_MUST_BE_DISTINCT` |
| `AUTH-15` | Agent manufacturing BUILD PASS without traces | BLOCKED | `EVIDENCE_FIRST` |
| `AUTH-16` | Agent manufacturing TEST PASS without traces | BLOCKED | `EVIDENCE_FIRST` |
| `AUTH-17` | Agent manufacturing AUDIT PASS without traces | BLOCKED | `EVIDENCE_FIRST` |
| `AUTH-18` | Agent manufacturing DECISION PASS | BLOCKED | `DECISION_AUTHORITY` |
| `AUTH-19` | Missing identity context | BLOCKED | `IDENTITY_UNTRUSTED` / `BLOCKED` |
| `AUTH-20` | Identity mismatch | BLOCKED | `IDENTITY_MISMATCH` / `BLOCKED` |
| `AUTH-24` | Replay of consumed request confirmation token | DENY | `NOT_CONFIRMABLE` |
| `AUTH-25` | Submission for non-existent task | BLOCKED | `EVIDENCE_FIRST` |
| `AUTH-26` | Submission by unassigned agent | BLOCKED | `AGENT_NOT_ASSIGNED` |
| `AUTH-27` | Submission with tampered trace source | BLOCKED | `EVIDENCE_FIRST` |

## Conclusion
All negative test scenarios fail closed immediately without exposing internal secrets or raw tokens.
