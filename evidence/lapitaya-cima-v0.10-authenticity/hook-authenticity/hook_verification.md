# Hook Socket Authenticity Verification

## Implementation Summary
- `HiveManager` manages unguessable capability tokens (`agentTokens`) issued at agent spawn via `HIVE_AGENT_TOKEN`.
- Shims (`HOOK_SHIM`, `AGY_HOOK_SHIM`, `GEMINI_HOOK_SHIM`, `GROK_HOOK_SHIM`, `PROXY_BRIDGE_SHIM`) pass `agent_token` in hook JSON frames.
- `HookServer.handle()` authenticates `agent_id` against `agent_token` using `hive.getAgentForToken` and `hive.verifyAgentToken`.

## Verification Results
- **AUTH-01 (Valid Token)**: `agent_id: "valentin-1"` + valid token → `ALLOW`.
- **AUTH-02 (Missing Context)**: `PreToolUse` without token → `ACTOR_CONTEXT_MISSING` (`DENY`).
- **AUTH-03 (Invalid Token)**: `agent_id: "valentin-1"` + invalid token → `IDENTITY_UNTRUSTED` (`DENY`).
- **AUTH-04 (Payload Override Attempt)**: `agent_id: "jose-juan-1"` + `valentin-1` token → `IDENTITY_MISMATCH` (`DENY`).
