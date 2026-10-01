# Electron Application Validation (CIMA v0.10)

## Objective
Validate that the Electron main process, IPC handlers, and renderer integration adhere to CIMA v0.10 authenticity hardening without breaking existing user interface interactions or leaking capability tokens.

## Handlers & IPC Channels Audited
1. `hive:send`:
   - IPC handler in `src/main/index.ts` verifies `from === 'human'` via `humanIdentity.resolve(_evt)`.
   - If trusted human context is missing, returns `{ ok: false, error: 'NOT_AUTHORIZED' }`.
   - Payload-based `agent_id` or `from` header overrides are strictly ignored.
2. `hive:confirmRequest` / `hive:cancelRequest`:
   - Enforce `trusted: true` context from Electron IPC frame.
   - Ignore `payloadHuman` string submitted from renderer.
3. Hook Server (`HookServer.handle` in `src/main/hooks.ts`):
   - Validates `agent_token` from payload against `HiveManager.verifyAgentToken()`.
   - Returns deterministic error codes (`IDENTITY_UNTRUSTED`, `IDENTITY_MISMATCH`, `ACTOR_CONTEXT_MISSING`).
   - Output contains no internal stack traces, secret keys, or raw capability tokens.

## Verification Results
- Trusted Electron IPC Human Confirmation → **PASS** (`CONFIRMED`).
- Renderer-forged IPC payload → **FAIL CLOSED** (`NOT_AUTHORIZED`).
- Secret / token leak check (`[AUTH-28]`, `[AUTH-29]`) → **PASS** (No tokens or secret keys present in IPC responses or evidence records).
- Real Electron suite validation (`[AUTH-30]`) → **PASS**.
