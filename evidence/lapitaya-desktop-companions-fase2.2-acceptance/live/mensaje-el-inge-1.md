Inge, ciclo CIMA real y pequeño para el ACCEPTANCE GATE de Desktop Companions FASE 2.2. Trabaja SOLO en C:\Users\chess\HarnessAgents\companion-gate-22 (ya existe). No toques ningún otro proyecto.

Despacha cada fase con un trabajador NUEVO por spawn-request e incluye SIEMPRE en el spawn-request el campo estructurado "cima": {"taskId": "<id>", "phase": "<FASE>"} sin verdict, como indica PROTOCOL.md (sección "assigning a phase"). Espera cada resultado antes de la siguiente fase. Los resultados de los trabajadores deben ser JSON válido.

TAREA 1 — LP-COMP-GATE-1:
1. BUILD → El Beni: crear mul.js con `module.exports = (a, b) => a * b`; correr `node --check mul.js`; BUILD PASS con ese comando como evidencia.
2. TEST → Margarito: crear mul.test.js con node:test (mul(2,3) === 6); correr `node --test mul.test.js`; TEST PASS con esa evidencia.
3. AUDIT → José Juan: leer mul.js y mul.test.js y volver a correr `node --test mul.test.js`; AUDIT PASS con esa evidencia.
4. Tú registras DECISION.

TAREA 2 — LP-COMP-GATE-FAIL (después de cerrar la tarea 1):
TEST → Margarito: crear mul-wrong.test.js con node:test que afirme a propósito mul(2,2) === 5; correr `node --test mul-wrong.test.js` (fallará); reportar TEST con verdict FAIL y esa salida como evidencia. No lo corrijas.

Cuando termines ambas, avísame con un resumen corto.
