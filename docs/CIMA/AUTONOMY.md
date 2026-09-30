# Política de autonomía

Fuentes: [`autonomy.ts`](../../src/shared/lapitaya/autonomy.ts) (política),
[`toolRisk.ts`](../../src/shared/lapitaya/toolRisk.ts) (clasificador),
[`governance.ts`](../../src/shared/lapitaya/governance.ts) (decisión),
[`src/main/cimaRuntime.ts`](../../src/main/cimaRuntime.ts) (servicio) y
[`src/main/hooks.ts`](../../src/main/hooks.ts) (punto de aplicación).

```text
LOW RISK     → AUTO            → se ejecuta, queda en el ledger (ALLOW)
MEDIUM RISK  → SUPERVISED      → se ejecuta, queda en el ledger (SUPERVISED) y se muestra en vivo
HIGH RISK    → HUMAN_APPROVAL  → NO se ejecuta (HUMAN_APPROVAL_REQUIRED) hasta que el humano aprueba
```

| Riesgo | Categorías (`ActionCategory`) |
| --- | --- |
| LOW | `read-code`, `analysis`, `run-tests`, `lint`, `documentation`, `static-analysis`, `hive-coordination` |
| MEDIUM | `code-change`, `config-change`, `generate-tests`, `shell-command`, `api-change`, `broad-refactor`, `structural-change`, `major-dependency-change` |
| HIGH | `production`, `destructive-migration`, `critical-security`, `auth`, `permissions`, `infrastructure`, `data-deletion`, `multi-tenancy`, `irreversible`, `secrets`, `governance-tamper` |

**Una herramienta desconocida es HIGH.** Un comando de shell que no es ni de lectura/pruebas
conocido ni destructivo conocido es MEDIUM, nunca LOW. `generate-tests` pasó de LOW (v0.1) a
MEDIUM (v0.2), porque crear pruebas modifica el repo.

## Dónde se aplica (v0.2)

En el hook `PreToolUse` de **cada** llamada a herramienta de cada agente, El Inge incluido:

```text
CLI del agente ──PreToolUse──▶ HookServer ──▶ CimaRuntimeService.authorize()
                                   │              clasificar → modeFor(etapa) → decisión
                                   ◀── deny + "HUMAN_APPROVAL_REQUIRED …"   (HIGH sin aprobación)
                                   ◀── {}                                   (LOW / MEDIUM / HIGH aprobado)
```

- Es una **decisión del hook**, no texto de prompt. Con `autoMode: true` el CLI corre en
  `bypassPermissions`, que solo apaga sus propias preguntas; un `deny` de `PreToolUse` detiene la
  llamada de todos modos. Ningún prompt puede saltárselo.
- El orden de precedencia es: gobernanza humana y de sistema → política de autonomía → agente →
  herramienta → acción.
- **Aprobación humana**: la solicitud aparece en Centro de mando → pregúntame → *Aprobaciones de
  gobernanza*. **Aprobar** concede **una** ejecución de esa llamada **idéntica**: mismo agente,
  herramienta y entrada, con huella FNV-1a sobre JSON canónico. Otra llamada, otro agente o un
  segundo intento siguen bloqueados. **Rechazar** la deja bloqueada, y una solicitud ya decidida
  no se puede volver a decidir.
- **Anti-manipulación**: escribir en los hooks del agente (`agents/*/settings.json`, `bin/`), en
  el ledger o las aprobaciones (`hive/lapitaya/`), en `registry.json` o en el propio código de la
  política es `governance-tamper`, que es HIGH.

## Etapas

`modeFor(action, stage)`. La etapa se lee de `lapitayaAutonomyStage` en la config; si falta, se
usa `SUPERVISED`.

| Etapa | LOW | MEDIUM | HIGH |
| --- | --- | --- | --- |
| `HUMAN_CONTROLLED` | HUMAN_APPROVAL | HUMAN_APPROVAL | HUMAN_APPROVAL |
| `SUPERVISED` (default) | AUTO | SUPERVISED | HUMAN_APPROVAL |
| `SEMI_AUTONOMOUS` | AUTO | AUTO | HUMAN_APPROVAL |
| `AUTONOMOUS` | AUTO | AUTO | HUMAN_APPROVAL |

HIGH siempre es `HUMAN_APPROVAL`. Human Governance no depende de la etapa.

## Límites conocidos

- **Fail-open del shim**: si el socket del harness no responde (app cerrada o caída), el shim
  `cth-hook` sale con 0 y la llamada sigue. Los agentes solo corren dentro de la app, pero el
  cierre total requiere que el shim niegue HIGH por sí mismo (siguiente fase).
- **Proveedores no-Claude**: los bridges (agy, codex, gemini, grok…) reenvían `PreToolUse`, pero
  no se verificó que respeten el `deny`. La garantía validada es para Claude Code.
- **Clasificación por reglas**: es explícita y auditable, no exhaustiva. Un comando destructivo
  escrito de forma no reconocida cae en MEDIUM, no en HIGH.

## Evolución

1. **v0.1**: vocabulario, clasificador y prompt.
2. **v0.2 (ahora)**: aplicación en runtime (`PreToolUse`), aprobación humana de un solo uso, ledger
   y evidencia observada.
3. Shim fail-closed para HIGH y verificación del `deny` en cada bridge no-Claude.
4. Etapa configurable desde la UI y por proyecto, con auditoría de cada cambio.
5. Promoción de etapa basada en historial de evidencia, siempre aprobada por el humano.
