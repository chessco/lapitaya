# Evidencia

## Qué cuenta

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
