# Alicia

**Rol:** AI Companion. **Estado en v0.4:** arquitectura transversal implementada y probada; sin UI,
sin personalidad, sin voz. Documento de arquitectura:
[LA_PITAYA_ALICIA_ARCHITECTURE_04.md](../LA_PITAYA_ALICIA_ARCHITECTURE_04.md).

Alicia es una asistente persistente inspirada en los asistentes de escritorio de los 90,
reinterpretada con IA moderna. **No reemplaza a ningún agente.** Es una capacidad nueva de La
Pitaya, no un worker del hive: no tiene fase CIMA, no emite veredictos, no tiene autoridad de
DECISION y no orquesta. El Inge sigue siendo el orquestador.

## Frontera (lo que existe hoy)

Capa: [`src/shared/lapitaya/alicia/`](../../src/shared/lapitaya/alicia/).

```text
core (hive, El Inge, CIMA) ──AliciaEvent──▶ alicia().notify(event) ──▶ companion
humano ──▶ Alicia ──intent──▶ solicitud en el hive ──▶ El Inge ──▶ CIMA / gobernanza
```

- `registry.ts`: la costura de v0.1 (`alicia()`, `registerAlicia()`, `ALICIA_DISABLED`).
- `events.ts`: modelo de eventos y adaptadores de las fuentes existentes; no hay bus nuevo.
- `status.ts`, `evidence.ts`: `CimaStatus` derivado del runtime y evidencia citada textual.
- `messages.ts`, `notifications.ts`: texto localizado alrededor de identificadores intactos.
- `context.ts`, `presence.ts`: `AliciaContext` (derivado, mínimo, auditable) y `AliciaPresence`.
- `intent.ts`: la única salida. `prepare` y `request` se convierten en una solicitud del hive a El
  Inge, enviada como `alicia`.
- `conversation.ts`, `provider.ts`: solo interfaces.
- `companion.ts`: estado, preferencias y los *ports* que el host le presta.

Reglas del contrato:

1. **Solo lectura respecto al core.** Alicia explica y retransmite; no ejecuta, no aprueba, no
   decide y no cambia el estado de CIMA ni de las tareas.
2. **La evidencia no se altera.** Se cita textual; Alicia solo agrega palabras alrededor.
3. **Sin privilegios.** La gobernanza no reconoce el id `alicia` como especial: una acción HIGH
   recibe `HUMAN_APPROVAL_REQUIRED`, igual que con cualquier otro actor.

## Roadmap (no implementado)

| Fase | Capacidad |
| --- | --- |
| ALICIA UI | Panel y notificaciones en la app usando `aliciaSnapshot()` |
| CONVERSATION | Implementar `AliciaConversation` sobre un `AliciaProvider` |
| DESKTOP COMPANION | Presencia de escritorio fuera de la ventana (Companion Protocol) |
| PETS | Mascotas: ciclo de vida, cuidado, interacción con Alicia |
| PITAYA HARDWARE | Conexión con hardware PitayaCode |

Explícitamente fuera de v0.4: pets (ciclo de vida, muerte, breeding), transformaciones, desktop
companion, hardware y su protocolo, voz, RAG, memoria de largo plazo, personalidad avanzada,
autonomía de Alicia.
