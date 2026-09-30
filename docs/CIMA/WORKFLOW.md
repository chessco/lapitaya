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

## Pendiente (fase AGENT AUTOMATION)

- Etiquetar tareas con su fase CIMA en `tasks.json`.
- Aplicar `canApprove` al cerrar tareas y `isVerdictBacked` al marcar PASS, en `hive.ts`.
- Emitir eventos `cima-phase` y `verdict` hacia Alicia.
