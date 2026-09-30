# Agentes de La Pitaya

Registro fuente: [`src/shared/lapitaya/agents.ts`](../src/shared/lapitaya/agents.ts).

## Cómo encajan en el runtime

El runtime upstream tiene **un** agente incorporado (el orquestador, `isGod`) y agentes que el
humano contrata. La Pitaya no reemplaza ese motor:

| Agente | Rol | Fases CIMA | Existe como | Sprite | Viene de |
| --- | --- | --- | --- | --- | --- |
| **El Inge** | Primary Orchestrator | CONTEXT, DECISION, ITERATE | god (se lanza solo) | `michael` | Michael / god |
| **Valentín** | Architect | ARCHITECT | preset de hire | `oscar` | rol nuevo |
| **El Beni** | Builder | BUILD | preset de hire | `jim` | rol nuevo |
| **Margarito** | Tester | TEST | preset de hire | `dwight` | rol nuevo |
| **José Juan** | Auditor | AUDIT | preset de hire | `angela` | rol nuevo |
| **El Tutú** | Learner | LEARN, DECISION | preset de hire | `kevin` | rol nuevo |
| **Alicia** | AI Companion | — | capability (no es agente del hive) | — | nueva |

- **El Inge** es el god. Solo cambió su nombre por defecto (`DEFAULT_GOD_NAME`), su prompt de
  orientación (que ahora incluye CIMA y la política de autonomía) y su prompt de voz. Un hive
  creado por el upstream con el nombre heredado exacto "Michael" migra a El Inge; cualquier otro
  nombre que el usuario haya puesto se respeta.
- **Valentín, El Beni, Margarito, José Juan y El Tutú** se contratan desde **Agregar agente →
  Equipo La Pitaya**. Cada botón llena nombre, personaje, descripción y objetivo (con las reglas
  CIMA). Como cualquier hire, **nada se lanza sin que el humano revise el comando y presione
  lanzar**.
- **Alicia** no se lanza en esta fase. Ver [ALICIA/README.md](ALICIA/README.md).

## Nombres por idioma

Los nombres son identidad del producto y no se traducen. Solo cambia la ortografía:

| es-MX | en-US |
| --- | --- |
| El Inge | El Inge |
| Valentín | Valentin |
| El Beni | El Beni |
| Margarito | Margarito |
| José Juan | Jose Juan |
| El Tutú | El Tutu |
| Alicia | Alicia |

`agentDisplayName(id, locale)` aplica la regla, y en-US siempre sale en ASCII exacto. Los ids de
hive se generan quitando diacríticos: "Valentín" produce `valentin-…`.

## Reglas por rol

Van en el objetivo de cada preset y en [CIMA/ROLES.md](CIMA/ROLES.md):

- **El Inge** coordina, delega, verifica y escala al humano. No es omnipotente: respeta la
  [política de autonomía](CIMA/AUTONOMY.md).
- **Valentín** analiza y diseña en solo lectura; no modifica código.
- **El Beni** implementa solo el alcance autorizado, entrega evidencia y no aprueba su propio
  trabajo.
- **Margarito** prueba y registra evidencia; no da la aprobación final.
- **José Juan** audita de forma independiente y produce findings estructurados. **Nunca modifica
  el código que audita.**
- **El Tutú** consolida evidencia y findings, extrae aprendizajes y produce un _Decision
  Candidate_. No toma decisiones irreversibles.

## Idioma de trabajo de los agentes

`agentLocale` (Configuración → General) es independiente del idioma de la interfaz. Por defecto es
en-US. Si es otro, el objetivo del preset agrega una línea pidiendo escribir en ese idioma, con
comandos, código, logs y salida de pruebas citados sin traducir.
