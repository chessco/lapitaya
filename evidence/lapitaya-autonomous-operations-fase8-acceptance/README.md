# FASE 8 Autonomous Operations Acceptance Evidence

## Continuation after human cleanup checkpoint

The two duplicate `PENDING_AUTHORIZATION` envelopes were rejected by the human
through the real Electron UI before this continuation. No storage mutation or
decision injection was performed by Codex.

Current continuation verdict: **FAIL — REMEDIATION REQUIRED**.

- `npm.cmd run test:autonomy`: **132/132 PASS**.
- `npm.cmd run build`: **PASS**; only the known `store.ts` static/dynamic import
  warning remains.
- Full regression was attempted. It timed out after 15 minutes and reproduced
  two unrelated existing failures in isolation: the Windows-path expectation
  in `test/agent-token-cap.test.cjs` and the Arabic terminal live-switch
  assertion in `test/arabic-terminal.test.cjs`.
- The remaining live gate cannot proceed honestly: no production caller of
  `startOperation`, `consumeIteration`, `consumeRetry`, or
  `evaluateContinuation` exists. Calling those service methods directly would
  violate the acceptance rule against injecting autonomous state.

FASE 8 remains open. FASE 9 remains not authorized.

Verdict: **FAIL — REMEDIATION REQUIRED**

La baseline automatizada pasa, pero CIMA falla en POLICY-31 (49/50) por la incompatibilidad entre la prueba de superficie IPC y el canal read-only `autonomy:getSnapshot`. El checkpoint humano y la cadena live no se ejecutaron.

Ver [acceptance document](../../docs/LA_PITAYA_AUTONOMOUS_OPERATIONS_FASE_8_ACCEPTANCE_GATE.md).
