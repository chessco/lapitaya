# Flujo CIMA

```text
CONTEXT ─▶ ARCHITECT ─▶ BUILD ─▶ TEST ─▶ AUDIT ─▶ LEARN ─▶ DECISION ─▶ ITERATE
   ▲                                                                     │
   └─────────────────────────────────────────────────────────────────────┘
```

Núcleo mínimo para cambios pequeños: `BUILD → TEST → LEARN → ITERATE`.

## Identificadores

`CONTEXT`, `ARCHITECT`, `BUILD`, `TEST`, `AUDIT`, `LEARN`, `DECISION`, `ITERATE` y `CIMA` son
**identificadores estables**: nunca se traducen en código, mensajes del hive ni archivos de
evidencia. Solo el label visible se localiza (`lapitaya:cima.phases.<PHASE>`):

| Id | es-MX | en-US |
| --- | --- | --- |
| BUILD | Construir | Build |
| TEST | Probar | Test |
| LEARN | Aprender | Learn |
| ITERATE | Iterar | Iterate |

## Ejecución sobre el hive actual (v0.1)

1. El humano despacha la solicitud a El Inge (Centro de mando → Despachar, Slack, webhook o
   programación).
2. **CONTEXT**: El Inge lee inbox, `board.md`, `tasks.json` y `fleet.json`, y clasifica el riesgo
   con la política de autonomía.
3. **ARCHITECT**: si Valentín está contratado, El Inge le manda la solicitud. Valentín responde con
   plan y criterios.
4. **BUILD**: El Beni implementa y responde con evidencia.
5. **TEST** y **AUDIT**: Margarito y José Juan reciben el trabajo por separado. José Juan no es El
   Beni (Builder != Auditor).
6. **LEARN** y **DECISION**: El Tutú consolida y propone. El Inge escala al humano lo que la
   política marque `HUMAN_APPROVAL`.
7. **ITERATE**: nuevo ciclo o cierre en `tasks.json`.

Si un rol no está contratado, El Inge lo cubre o se lo pide al humano. El briefing lo dice como
"when these agents are on the roster".

## Estado en v0.2

- Hecho: cada fase se reporta con el campo `cima` y el router del hive la valida (Evidence First,
  Builder != Auditor, transiciones, autoridad de DECISION). El veredicto del runtime queda en el
  ledger y sellado en el mensaje.
- Hecho: El Inge etiqueta cada delegación con `cima: {taskId, phase}`, que se registra como
  `cima-assignment` (entrega de fase, no veredicto).
- Validado en vivo: la tarea LP-CIMA-001 recorrió ARCHITECT → BUILD → TEST → AUDIT → LEARN →
  DECISION → ITERATE con los seis agentes (ver `docs/LA_PITAYA_CIMA_RUNTIME_02.md`).

## Pendiente

- `tasks.json` se sigue editando directamente. Marcar una tarjeta `done` todavía no exige
  DECISION PASS en el ledger.
- CONTEXT no tiene un reclamo propio: El Inge lo ejecuta (hay trazas), pero su primer registro
  CIMA es la asignación a ARCHITECT.
- Emitir eventos `cima-phase` y `verdict` hacia Alicia.
