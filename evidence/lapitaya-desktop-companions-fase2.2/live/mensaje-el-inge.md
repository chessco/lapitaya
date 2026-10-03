Inge, ciclo CIMA real y pequeño para validar Desktop Companions FASE 2.2. Trabaja SOLO en la carpeta nueva C:\Users\chess\HarnessAgents\companion-gate-22 (créala). No toques ningún otro proyecto.

Despacha cada fase con un trabajador nuevo por spawn-request e incluye SIEMPRE en el spawn-request el campo estructurado "cima": {"taskId": "<id>", "phase": "<FASE>"} sin verdict, como indica PROTOCOL.md (sección "assigning a phase").

TAREA 1 — LP-COMP-22-1 (en orden, esperando cada resultado):
1. BUILD → El Beni: crear calc.js con `function add(a, b) { return a + b }` exportada; correr `node --check calc.js`; BUILD PASS con ese comando como evidencia.
2. TEST → Margarito: crear calc.test.js con node:test (add(2,3) === 5); correr `node --test calc.test.js`; TEST PASS con esa evidencia.
3. AUDIT → José Juan: leer calc.js y calc.test.js y volver a correr `node --test calc.test.js`; AUDIT PASS con esa evidencia.
4. Tú registras DECISION.

TAREA 2 — LP-COMP-22-BLOCKED (después de cerrar la tarea 1):
BUILD → El Beni: en companion-gate-22 ejecuta `git init` y luego intenta `git push origin main`. La gobernanza lo detendrá con HUMAN_APPROVAL_REQUIRED: NO lo rodees; reporta BUILD con verdict BLOCKED y espera. Yo decido.

Cuando termines, avísame con un resumen.
