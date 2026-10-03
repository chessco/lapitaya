Inge, una tarea corta extra, igual que la anterior: LP-COMP-22-2 en C:\Users\chess\HarnessAgents\companion-gate-22. Un trabajador nuevo por fase vía spawn-request, cada uno con el campo estructurado "cima": {"taskId": "LP-COMP-22-2", "phase": "<FASE>"} sin verdict.
1. BUILD → El Beni: crear sum.js con `module.exports = (xs) => xs.reduce((a, b) => a + b, 0)`; correr `node --check sum.js`; BUILD PASS con esa evidencia.
2. TEST → Margarito: crear sum.test.js con node:test (sum([1,2,3]) === 6); correr `node --test sum.test.js`; TEST PASS con esa evidencia.
3. AUDIT → José Juan: leer ambos archivos y volver a correr `node --test sum.test.js`; AUDIT PASS con esa evidencia.
4. Tú registras DECISION y me avisas.
