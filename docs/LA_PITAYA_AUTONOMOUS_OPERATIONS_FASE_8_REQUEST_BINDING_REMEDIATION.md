# FASE 8 — REQUEST binding remediation

## Finding

The first production start bridge required the confirmed REQUEST subject to
equal the AutonomyEnvelope objective byte-for-byte. The real human-facing
REQUEST flow naturally adds framing such as `Quiero que El Inge prepare una
propuesta para...`; the runtime correctly classified that message as a
REQUEST, but CompanyOperations could not bind it to the already `ACTIVE`
envelope. The REQUEST was confirmed and entered `PLANNING`, while no project,
mission, or operation was created.

## Remediation

CompanyOperations now accepts a confirmed REQUEST only when its normalized
objective contains the complete normalized objective of an `ACTIVE` envelope.
Normalization removes accents, folds case, and collapses whitespace. Project
and mission records retain the envelope's canonical objective for the later
start validation; the human wording remains preserved on the REQUEST. The
envelope remains the authority boundary; this change does not create,
authorize, widen, or mutate an envelope.

Requests that do not contain the complete authorized objective still fail
closed and cannot bind to the envelope.

The CIMA Capability Registry also declares the internal
`autonomous-operation:start` proposal as the LOW `autonomy.start` capability.
This allows CIMA to evaluate the production start boundary instead of
rejecting it as an unknown tool. It is reachable only from the main-process
El Inge orchestration callback; no renderer IPC or agent capability is added.
The registry name validator also accepts `:` for this namespaced internal
boundary.

## Verification

- `START8`: 28/28 PASS, including natural REQUEST framing, canonical objective
  preservation, and idempotent start.
- `START8`: 29/29 PASS after the CIMA registry validation fix.
- `test:autonomy`: 132/132 PASS.
- `typecheck`: PASS.
- `build`: PASS after the registry validation fix; the known static/dynamic
  `store.ts` import warning remains.

## Acceptance consequence

The FASE 8 live gate must be restarted from this remediation commit. The
previous confirmed REQUEST is historical evidence of the defect and must not
be reused as proof of a successful operation. A new human REQUEST and a new
human confirmation are required in Electron.
