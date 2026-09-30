# Alicia

**Rol:** AI Companion. **Estado en Foundation v0.1:** solo la frontera arquitectónica; no está
implementada.

Alicia es una asistente persistente inspirada en los asistentes de escritorio de los 90,
reinterpretada con IA moderna. **No reemplaza a ningún agente.** Es una capacidad nueva de La
Pitaya, no un worker del hive.

## Frontera (lo que existe hoy)

[`src/shared/lapitaya/alicia.ts`](../../src/shared/lapitaya/alicia.ts):

```text
core (hive, El Inge, CIMA) ──AliciaEvent──▶ alicia().notify(event) ──▶ AliciaCapability
```

- `AliciaEvent` es la unión de eventos que el core puede emitir: `agent-activity`, `cima-phase`,
  `finding`, `verdict`, `error` y `approval-needed`.
- `AliciaCapability` es la interfaz de una implementación (`id`, `enabled`, `notify`).
- `ALICIA_DISABLED` es el default, un no-op.
- `registerAlicia(impl)` instala una implementación y devuelve la función para restaurar la
  anterior.
- `alicia()` es el único punto de entrada del core. Si una implementación lanza una excepción,
  `alicia()` la contiene: Alicia nunca puede romper el hive.

Reglas del contrato:

1. **Solo lectura respecto al hive.** Alicia explica; no actúa. Lo que sugiera pasa por El Inge y
   la política de autonomía.
2. **La evidencia no se altera.** Los eventos traen la salida original en `evidence`. Alicia la
   explica en `notificationLocale`.
3. **Fire-and-forget.** `notify` no bloquea ni devuelve nada al core.

Incorporar Alicia después no requiere tocar el core: se registra una implementación en el arranque
del renderer y se agregan llamadas `alicia().notify(...)` en los puntos de emisión.

## Roadmap (no implementado)

| Fase | Capacidad |
| --- | --- |
| ALICIA | Explicar actividad de agentes, findings, ciclos CIMA y errores; notificaciones; presencia en la UI |
| DESKTOP COMPANION | Presencia de escritorio fuera de la ventana |
| PETS | Mascotas: ciclo de vida, cuidado, interacción con Alicia |
| PITAYA HARDWARE | Conexión con hardware PitayaCode |

Explícitamente fuera de esta fase: pets (ciclo de vida, muerte, breeding), desktop companion,
hardware y su protocolo, asistente de voz, marketplace de criaturas, personalidad avanzada,
despliegue autónomo a producción y agentes que se modifican a sí mismos.
