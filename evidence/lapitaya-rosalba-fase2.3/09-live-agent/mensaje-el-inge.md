Inge, FASE 2.3: ya tienes a Rosalba (Senior Software Developer, BUILD) en el equipo; revisa PROTOCOL.md ("name" en el spawn-request). Ciclo CIMA real y pequeño, SOLO en C:\Users\chess\HarnessAgents\companion-gate-22. No toques ningún otro proyecto.

TAREA LP-ROS-LIVE-1 — módulo de estadísticas con validación (es trabajo de Rosalba: implementación con casos borde). Un trabajador NUEVO por fase vía spawn-request, con el campo estructurado "cima": {"taskId": "LP-ROS-LIVE-1", "phase": "<FASE>"} sin verdict; resultados en JSON válido; espera cada resultado.

1. BUILD → spawn-request con "name": "Rosalba": crear stats.js que exporte mean(xs), median(xs) y stddev(xs) (desviación estándar poblacional); deben lanzar TypeError si xs no es un arreglo no vacío de números finitos; median no debe mutar el arreglo de entrada. Verificar con `node --check stats.js` y `node -e "const s=require('./stats.js');console.log(s.mean([1,2,3,4]),s.median([3,1,2]),s.stddev([2,4,4,4,5,5,7,9]))"` (esperado: 2.5 2 2). BUILD PASS con esa evidencia.
2. TEST → "name": "Margarito": crear stats.test.js con node:test que cubra los tres resultados, los TypeError (arreglo vacío, NaN, no-arreglo) y que median no muta la entrada; correr `node --test stats.test.js`; TEST PASS con esa evidencia.
3. AUDIT → "name": "José Juan": leer stats.js y stats.test.js y volver a correr `node --test stats.test.js`; AUDIT PASS con esa evidencia. Rosalba NO audita su propio trabajo.
4. Tú registras DECISION y me avisas con un resumen corto.
