# POLICY-31 — análisis (racional de ingeniería estructurado)

## Aserción exacta (test/lapitaya-cima-v0.16.test.cjs:487-502)
- L490-492: canales de `src/preload/index.ts` (`ipcRenderer.invoke|send|sendSync('<canal>'`) no deben contener /policy|capabilit|risk|autonomy/i.
- L493: el preload no referencia policyRegistry / CIMA_POLICY_VERSION / createPolicyRegistry.
- L494: canales `ipcMain.handle|on('<canal>'` de `src/main/index.ts` no deben contener /policy|capabilit|risk|autonomy/i.
- L495: main no cablea política propia.
- L496-501: el registro de política es inmutable (frozen) y su forma pública es fija.

## Invariante protegido
"El renderer no puede redefinir política": no existe ningún canal IPC en el
espacio de nombres de gobernanza (policy / capability / risk / autonomy); la
autoridad vive solo en el runtime CIMA y en el registro congelado.

## Por qué fallaba autonomy:getSnapshot
- Falla en L494 (lado main), no en L492: el preload NO expone ningún canal `autonomy:*`.
- bc0ca522 registró 5 handlers en main: autonomy:getSnapshot, listEnvelopes,
  getEnvelope, listOperations, getOperation. El primero que evalúa el bucle es getSnapshot.
- Causa: clasificación por espacio de nombres. "autonomy" es un namespace reservado
  de gobernanza en CIMA v0.16; FASE 8 abrió canales en ese namespace.

## Clasificación de la causa (de las opciones del prompt)
- missing allowlist entry: NO (POLICY-31 no tiene allowlist; es una prohibición por namespace).
- naming convention / channel classification: SÍ — canales en namespace reservado.
- preload exposure: NO expuestos (por eso no eran alcanzables).
- architecture mismatch: SÍ — FASE 8 duplicó una vía de lectura que ya existe en
  la proyección canónica `company:getSnapshot` / `company:getOperations` → `operations.autonomy`.
- defecto de seguridad explotable: NO hoy (inalcanzables desde el renderer), pero
  eran superficie IPC muerta en un namespace de gobernanza: exponerlos en el preload
  más adelante habría abierto la puerta sin revisión de CIMA.
- test fixture: NO — el test es correcto y estricto; no se modificó.

## Evidencia
- before-policy31-focused.txt: 0/1, AssertionError actual 'autonomy:getSnapshot' en L494:82.
