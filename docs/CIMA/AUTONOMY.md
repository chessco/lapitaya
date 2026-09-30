# Política de autonomía

Fuente: [`src/shared/lapitaya/autonomy.ts`](../../src/shared/lapitaya/autonomy.ts).

```text
LOW RISK     → AUTO
MEDIUM RISK  → SUPERVISED
HIGH RISK    → HUMAN_APPROVAL
```

| Riesgo | Categorías (`ActionCategory`) |
| --- | --- |
| LOW | `read-code`, `analysis`, `run-tests`, `lint`, `documentation`, `generate-tests`, `static-analysis` |
| MEDIUM | `api-change`, `broad-refactor`, `structural-change`, `major-dependency-change` |
| HIGH | `production`, `destructive-migration`, `critical-security`, `auth`, `permissions`, `infrastructure`, `data-deletion`, `multi-tenancy`, `irreversible` |

**Una acción desconocida es HIGH.** Es el default seguro.

## Etapas

`modeFor(action, stage)`:

| Etapa | LOW | MEDIUM | HIGH |
| --- | --- | --- | --- |
| `HUMAN_CONTROLLED` | HUMAN_APPROVAL | HUMAN_APPROVAL | HUMAN_APPROVAL |
| `SUPERVISED` (default) | AUTO | SUPERVISED | HUMAN_APPROVAL |
| `SEMI_AUTONOMOUS` | AUTO | AUTO | HUMAN_APPROVAL |
| `AUTONOMOUS` | AUTO | AUTO | HUMAN_APPROVAL |

HIGH siempre es `HUMAN_APPROVAL`. Human Governance no depende de la etapa.

## Qué se aplica hoy (v0.1)

Es una **abstracción mínima**, no un motor de políticas:

- El texto de la política (`AUTONOMY_PROMPT`) va en el prompt de orientación de El Inge, así que
  el orquestador ya opera con ella.
- El control efectivo de herramientas sigue siendo el del upstream: modo auto / preguntar primero
  por CLI (Configuración → Autonomía y presupuestos), cortacircuitos y límites de tokens.
- `modeFor` y `riskOf` están probados (`test/lapitaya-foundation.test.cjs`), pero todavía no se
  llaman desde el hive.

Observación: la configuración existente del usuario tiene `autoMode: true`. En ese modo los CLIs
no piden aprobación de herramientas, y la gobernanza humana de acciones HIGH depende de que El
Inge obedezca su prompt. Aplicarla en el runtime es trabajo de la siguiente fase.

## Evolución

1. **v0.1 (ahora)**: vocabulario compartido, clasificador y prompt.
2. Etiquetar tareas del hive con `ActionCategory` y bloquear las `HUMAN_APPROVAL` en el tablero
   PREGÚNTAME (`askMe`) hasta que el humano responda.
3. Mapear la etapa a los flags de cada CLI (p. ej. `HUMAN_CONTROLLED` fuerza "preguntar primero").
4. Etapa configurable por proyecto, con auditoría de cada cambio de etapa.
5. Promoción de etapa basada en historial de evidencia (Progressive Autonomy real), siempre
   aprobada por el humano.
