# CIMA

CIMA es la metodología operativa de La Pitaya.

```text
Ciclo núcleo:    BUILD → TEST → LEARN → ITERATE
Flujo completo:  CONTEXT → ARCHITECT → BUILD → TEST → AUDIT → LEARN → DECISION → ITERATE ↺
```

El humano conserva la autoridad sobre las decisiones de alto impacto.

| Documento | Contenido |
| --- | --- |
| [PRINCIPLES.md](PRINCIPLES.md) | Los cuatro principios |
| [ROLES.md](ROLES.md) | Qué agente es dueño de cada fase |
| [WORKFLOW.md](WORKFLOW.md) | El flujo y cómo se ejecuta sobre el hive actual |
| [EVIDENCE.md](EVIDENCE.md) | Qué cuenta como evidencia y la regla de no traducirla |
| [AUTONOMY.md](AUTONOMY.md) | Política de autonomía y su evolución |

## Implementación en Foundation v0.1

CIMA se integra **conceptualmente** sobre el runtime existente, sin un motor de workflow nuevo:

| Pieza | Dónde |
| --- | --- |
| Ids de fase estables, orden, `nextPhase()` | `src/shared/lapitaya/cima.ts` |
| Builder != Auditor (`canApprove`) | `cima.ts` |
| Evidence First (`isVerdictBacked`, `evidenceAllowsPass`) | `cima.ts` |
| Política de autonomía (`modeFor`, `riskOf`) | `src/shared/lapitaya/autonomy.ts` |
| Briefing de El Inge (equipo + reglas + autonomía) | `cimaBriefing.ts` → `initialGodPrompt()` en `useHive.ts` |
| Reglas en cada preset de agente | `agents.ts` (`HARD_RULES`) |
| Labels localizados | namespace i18n `lapitaya` → `cima.phases.<PHASE>` |
| Pruebas | `test/lapitaya-foundation.test.cjs` |

El ruteo sigue siendo el del hive: El Inge recibe la solicitud, la mueve por inbox y outbox entre
agentes y lleva el estado en `tasks.json` y `board.md`. Las funciones de `cima.ts` son el contrato
contra el que se construirá la automatización de la siguiente fase.
