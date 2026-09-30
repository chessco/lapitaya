# Evidencia

## Modelo de runtime (v0.2)

La evidencia que el runtime acepta tiene dos mitades
([`cimaRuntime.ts`](../../src/shared/lapitaya/cimaRuntime.ts)):

- **`EvidenceItem`**, lo que el agente cita: `{ type, source, description, result, timestamp }`,
  con `type` ∈ `test-result | command-output | static-analysis | file-inspection | diff |
  runtime-result | audit-finding | execution-trace`.
- **`ExecutionTrace`**, lo que el harness observó en `PostToolUse` / `PostToolUseFailure`:
  `{ agentId, kind: command|read|write|tool, subject, ok, outputHead }`.

Un `EvidenceItem` solo cuenta si su `source` coincide con una traza **del mismo agente**: el
comando que ejecutó (se ignoran anotaciones como `(cwd …)`) o el archivo que leyó. Un texto del
agente diciendo "todo está correcto" no coincide con nada, así que no es evidencia. Un PASS o un
FAIL con alguna cita no verificable se registra **BLOCKED**.

## Tipos v0.1 (se mantienen en `cima.ts`)

`EvidenceKind` en `src/shared/lapitaya/cima.ts`:

| Tipo | Ejemplo |
| --- | --- |
| `test-output` | Salida de `npm run test:focused` |
| `command-output` | Salida de cualquier comando |
| `exit-code` | `exit=0` |
| `build-output` | Salida de `npm run build` |
| `audit-findings` | Findings de José Juan |
| `reproduction` | Pasos + resultado reproducible |

Cada pieza tiene `source` (el comando tal cual), `raw` (la salida original), `exitCode` opcional y
`note` opcional, que es la explicación en lenguaje humano.

## La evidencia no se traduce

Nunca se alteran logs, stack traces, salida de CLI, salida de pruebas, salida de Git, respuestas
de API, código, rutas de archivos ni errores originales.

Un agente o Alicia pueden **explicar** la evidencia en el idioma del usuario, en `note`, en un
mensaje o en una notificación, pero `raw` se conserva byte por byte. Es obligatorio para Evidence
First: una evidencia traducida ya no es reproducible.

Esto se aplica en:

- Los presets de agente (`agentLanguageDirective`): "quote commands, code, logs and test output
  verbatim, untranslated".
- El contrato de Alicia (`AliciaEvent.evidence`: puede explicarla, no alterarla).
- El briefing de El Inge: "never translate or rewrite evidence".

## Dónde vive

La evidencia de esta fase está en `evidence/lapitaya-foundation/` (logs crudos de typecheck, build
y tests, antes y después) y se resume en
[`docs/LA_PITAYA_FOUNDATION_01.md`](../LA_PITAYA_FOUNDATION_01.md).
