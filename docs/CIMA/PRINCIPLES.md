# Principios CIMA

Ids estables en `CIMA_PRINCIPLES` (`src/shared/lapitaya/cima.ts`).

## 1. Builder != Auditor — `BUILDER_NOT_AUDITOR`

El agente que implementa no puede cerrar ni aprobar su propio trabajo.

- Código: `canApprove({ builderId, approverId })` devuelve `false` si coinciden (sin distinguir
  mayúsculas y recortando espacios) o si el aprobador está vacío.
- Prompt: cada preset lo lleva en su objetivo. José Juan además tiene prohibido modificar el
  código que audita.

## 2. Evidence First — `EVIDENCE_FIRST`

No se declara PASS sin evidencia: salida de pruebas, salida de comandos, exit codes, salida de
build, findings de auditoría o una verificación reproducible.

- Código: `isVerdictBacked(verdict, evidence)` exige al menos una pieza con salida cruda no vacía
  para `PASS` o `PASS_WITH_OBSERVATIONS`. `evidenceAllowsPass(evidence)` además rechaza cualquier
  exit code distinto de 0.
- Ver [EVIDENCE.md](EVIDENCE.md).

## 3. Human Governance — `HUMAN_GOVERNANCE`

El humano conserva la autoridad sobre arquitectura crítica, seguridad, autenticación,
autorización, multi-tenancy, migraciones destructivas, infraestructura, producción, eliminación de
datos y cambios irreversibles.

- Código: todas esas categorías son `HIGH` en `ACTION_RISK` y producen `HUMAN_APPROVAL` en
  **todas** las etapas de autonomía. Una etapa más autónoma no puede apagarlo.

## 4. Progressive Autonomy — `PROGRESSIVE_AUTONOMY`

```text
HUMAN_CONTROLLED → SUPERVISED → SEMI_AUTONOMOUS → AUTONOMOUS
```

La autonomía crece por política explícita, nunca por defecto. Ver [AUTONOMY.md](AUTONOMY.md).
