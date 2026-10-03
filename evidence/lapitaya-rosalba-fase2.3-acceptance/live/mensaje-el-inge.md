Inge, ACCEPTANCE GATE de FASE 2.3. Ciclo CIMA real, pequeño y aislado, SOLO en C:\Users\chess\HarnessAgents\companion-gate-22. No toques ningún otro proyecto.

TAREA LP-ROS-ACC-1 — función clamp con validación (trabajo de Rosalba: casos borde). Un trabajador NUEVO por fase vía spawn-request, con el "name" del rol y el campo estructurado "cima": {"taskId": "LP-ROS-ACC-1", "phase": "<FASE>"} sin verdict, como indica PROTOCOL.md. Espera cada resultado antes de la siguiente fase.

1. BUILD → "name": "Rosalba": crear clamp.js que exporte clamp(x, min, max); TypeError si algún argumento no es número finito; RangeError si min > max. Verificar con `node --check clamp.js` y `node -e "const c=require('./clamp.js');console.log(c(5,0,3),c(-1,0,3),c(2,0,3))"` (esperado: 3 0 2). BUILD PASS con esa evidencia.
2. TEST → "name": "Margarito": crear clamp.test.js con node:test (los tres valores, TypeError con NaN, RangeError con min>max); correr `node --test clamp.test.js`; TEST PASS con esa evidencia.
3. AUDIT → "name": "José Juan": leer clamp.js y clamp.test.js y volver a correr `node --test clamp.test.js`; AUDIT PASS con esa evidencia. Rosalba no audita su propio trabajo.
4. Tú registras DECISION y me avisas con un resumen corto.
