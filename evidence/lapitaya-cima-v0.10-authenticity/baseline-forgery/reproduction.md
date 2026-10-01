# Baseline Identity Forgery Reproduction

## Executive Summary
Prior to La Pitaya CIMA v0.10, identity and governance facts accepted by the runtime were self-asserted by actors in payload text, directory structures, or unverified header fields rather than authenticated by the runtime.

## Baseline Vulnerabilities (v0.9 Baseline)

### Finding 1: Hook Socket Identity Forgery
- **Vulnerability**: `HookServer.handle()` extracted `agent_id` directly from `payload.agent_id` in socket JSON frames over local domain socket.
- **Impact**: Any process or agent connecting to the socket could pass `{"agent_id": "another-agent"}` or `{"agent_id": "jose-juan-1"}` and be authorized under that identity.
- **Evidence**: `PreToolUse` hook authorization executed under self-declared payload `agent_id`.

### Finding 2: Message Sender Identity Forgery
- **Vulnerability**: Messages processed by `HiveManager.routeOnce()` and `HiveManager.send()` derived sender identity from unauthenticated payload fields or directory folder names without runtime token verification.
- **Impact**: An agent could send a message claiming `from: "human"` or `from: "jose-juan-1"`.

### Finding 3: DECISION Human Forgery
- **Vulnerability**: `evaluateSubmission()` accepted `sub.phase === 'DECISION'` when `agentId === 'human'` without verifying if the submission originated from trusted v0.8 human context.
- **Impact**: An agent could write a message containing `cima: { taskId: "T", phase: "DECISION", verdict: "PASS" }` and claim `from: "human"`, bypassing human authority and marking tasks completed.

## Hardened Guarantee (v0.10 Verification)
In v0.10, identity must be verified by the runtime BEFORE governance can trust the fact:
- **Hook socket identity**: Authenticated using runtime-issued capability tokens (`HIVE_AGENT_TOKEN`). Mismatch or missing token → `IDENTITY_MISMATCH` / `IDENTITY_UNTRUSTED` (`DENY`).
- **Message sender identity**: Sender bound to trusted runtime token and v0.8 human IPC context. Self-asserted `from: "human"` from agents → `HUMAN_IDENTITY_REQUIRED` (`DENY`).
- **Human decision authority**: `DECISION PASS` requires verified `HumanContext` from v0.8 IPC. Self-asserted `human` → `DECISION_AUTHORITY` / `HUMAN_IDENTITY_REQUIRED` (`BLOCKED`).
