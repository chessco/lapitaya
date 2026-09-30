# Deterministic intent classification (shared/lapitaya/intent.ts)

| Message | Type | Category | Risk | Signals |
|---|---|---|---|---|
| ¿Qué está haciendo El Beni? | CONVERSATION | - | - | frame:question |
| Explícame qué significa BLOCKED. | CONVERSATION | - | - | frame:knowledge |
| ¿Cuál es el estado del proyecto? | CONVERSATION | - | - | frame:question |
| ¿Qué ocurrió durante la auditoría? | CONVERSATION | - | - | frame:question |
| Explícame por qué la auditoría quedó bloqueada. | CONVERSATION | - | - | frame:knowledge |
| Hola Alicia | CONVERSATION | - | - | - |
| Explícame cómo desplegar a producción | CONVERSATION | - | - | action:deploy, frame:knowledge, demoted:knowledge-question |
| Quiero que revisemos este proyecto. | REQUEST | - | - | request:verb |
| Analiza este problema. | REQUEST | - | - | request:verb |
| Quiero que El Beni implemente esto. | REQUEST | - | - | request:verb |
| Prepara una tarea para el equipo. | REQUEST | - | - | request:verb |
| Quiero que analicemos este módulo. | REQUEST | - | - | request:verb |
| Modifica este archivo. | ACTION | code-change | MEDIUM | action:modify |
| Ejecuta los tests. | ACTION | run-tests | LOW | action:run-checks |
| Haz una migración. | ACTION | destructive-migration | HIGH | action:migrate |
| Despliega esto. | ACTION | production | HIGH | action:deploy |
| Elimina estos datos. | ACTION | data-deletion | HIGH | action:delete |
| Modifica src/main/hooks.ts. | ACTION | code-change | MEDIUM | action:modify |
| borra la base de datos | ACTION | data-deletion | HIGH | action:delete |
| Explícame por qué falló y luego borra la base de datos | ACTION | data-deletion | HIGH | action:delete, frame:knowledge, frame:chained |
| Emite DECISION PASS para la tarea T-1 | ACTION | - | - | authority:decision-pass |
| Marca la tarea T-1 como terminada | ACTION | - | - | action:complete-task |

Risk for a concrete call or a named path is decided by the RUNTIME (CimaRuntimeService), not by this table; see positive-tests/ and negative-tests/.
