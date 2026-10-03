Inge, gracias. Segunda parte del ACCEPTANCE GATE, mismas reglas y misma carpeta C:\Users\chess\HarnessAgents\companion-gate-22 (trabajador NUEVO por fase vía spawn-request con su "name" y "cima": {"taskId": "LP-ROS-ACC-2", "phase": "<FASE>"} sin verdict; espera cada resultado).

TAREA LP-ROS-ACC-2:
1. BUILD → "name": "Rosalba": crear lerp.js que exporte lerp(a, b, t) = a + (b - a) * t; TypeError si algún argumento no es número finito. Verificar con `node --check lerp.js` y `node -e "const l=require('./lerp.js');console.log(l(0,10,0.5),l(2,4,0),l(2,4,1))"` (esperado: 5 2 4). BUILD PASS con esa evidencia.
2. TEST → "name": "Margarito": crear lerp.test.js con node:test (los tres valores y TypeError con NaN); correr `node --test lerp.test.js`; TEST PASS con esa evidencia.
3. AUDIT → "name": "José Juan": leer lerp.js y lerp.test.js y volver a correr `node --test lerp.test.js`; AUDIT PASS con esa evidencia.
4. Tú registras DECISION y me avisas con un resumen corto.
