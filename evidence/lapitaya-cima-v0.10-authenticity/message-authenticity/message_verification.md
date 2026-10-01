# Message Authenticity Verification

## Implementation Summary
- `HiveManager.send()` and IPC `hive:send` enforce sender identity verification.
- Messages with `from: "human"` require trusted v0.8 `HumanContext` (`humanIdentity.resolve(_evt)`). Unauthenticated callers attempting `from: "human"` are rejected with `HUMAN_IDENTITY_REQUIRED`.
- Outbox file processing in `routeOnce()` forces `msg.from` to the directory owner (`id`) and strips self-asserted sender overrides.

## Verification Results
- **AUTH-05 (Impersonation)**: Agent A sending as Agent B → `IDENTITY_MISMATCH` / `AGENT_IDENTITY_MISMATCH`.
- **AUTH-06 (Folder Forgery)**: Writing to `agents/human/outbox` → ignored/dropped, outbox routing requires valid agent folder.
- **AUTH-07 (Message Payload Forgery)**: Self-asserted `from: "human"` in payload inside agent directory → forced to agent ID by router.
- **AUTH-08 (Self-Declared Human)**: Agent claiming `from: "human"` via IPC → `HUMAN_IDENTITY_REQUIRED` error.
