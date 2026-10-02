# Human Decision Authenticity Verification (CIMA v0.10)

## Objective
Verify that human DECISION authority requires trusted v0.8 human context (`DecisionOwner`) established via secure IPC, and that untrusted claims (`actor: "human"` or payload `humanId`) are rejected with fail-closed behavior (`HUMAN_IDENTITY_REQUIRED` / `DECISION_AUTHORITY`).

## Test Suite Coverage
- `[AUTH-08] Agent cannot self-declare human`: Agent payload specifying `from: 'human'` rejected by `send()` and `routeOnce()`.
- `[AUTH-09] Human DECISION requires trusted human identity`: CIMA submission with phase `DECISION` submitted without trusted human context produces `BLOCKED` verdict with `DECISION_AUTHORITY` violation.
- `[AUTH-10] Fake human identity denied`: Untrusted human IPC payload rejected (`NOT_AUTHORIZED`).
- `[AUTH-11] Human identity from renderer payload ignored`: `payloadHuman` string in untrusted payload ignored.
- `[AUTH-12] Human identity from trusted v0.8 IPC accepted`: Trusted IPC handler `confirmRequest({ trusted: true }, ...)` succeeds (`CONFIRMED`).
- `[AUTH-22] Decision owner remains v0.8 trusted identity`: Decided approvals record `decidedOwner` matching `hum-operator123456`.
- `[AUTH-23] Cross-window human identity remains correct`: Renderer `whoAmI` only succeeds when called over trusted IPC.

## Verification Result
- Valid trusted human IPC call → `ALLOW` (`CONFIRMED` / `DECIDED`).
- Untrusted / self-asserted human claim → `DENY` (`NOT_AUTHORIZED` / `BLOCKED`).
