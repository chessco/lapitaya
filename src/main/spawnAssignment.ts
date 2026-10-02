/**
 * Spawn-time CIMA phase assignment — Desktop Companions FASE 2.2 (F1).
 *
 * El Inge delegates phases by SPAWNING workers (spawn-requests/<id>.json), and that path
 * delivered the objective as plain text: the runtime never saw the hand-off, so no
 * `cima-assignment` ever reached the ledger (0 in the live gate). A spawn request may now
 * carry the same structured `cima` field the hive already honours on outbox messages:
 *
 *   { "cima": { "taskId": "<task id>", "phase": "BUILD" } }
 *
 * It is recorded through the runtime's EXISTING path — `CimaRuntimeService.handle(from, to,
 * cima, messageId)`, exactly what the outbox router does — so the assignment lands in the
 * hash-chained, MAC'd ledger and is emitted on `onEvent` like any other. Nothing here is a
 * second source of truth, and no phase is ever inferred from the objective's text.
 *
 * Only an ASSIGNMENT is accepted (taskId + phase, no verdict). A `cima` carrying a verdict
 * would be a claim submitted in the orchestrator's name by whoever wrote the request file,
 * so it is refused, not evaluated.
 */

import { parseAssignment } from '../shared/lapitaya/cimaRuntime';

export interface SpawnAssignmentRuntime {
  handle(from: string, to: string, cima: unknown, messageId?: string): { kind: string };
}

export type SpawnAssignmentResult =
  | { recorded: true }
  | { recorded: false; reason: 'none' | 'not-an-assignment' | 'not-recorded' | 'error'; detail?: string };

export function recordSpawnAssignment(opts: {
  runtime: SpawnAssignmentRuntime;
  /** The orchestrator the spawn path acts for (hive godId). */
  from: string;
  /** The spawned worker's hive id. */
  to: string;
  cima: unknown;
  /** Id of the dispatch message that carried the objective — the audit link. */
  messageId: string;
  now?: number;
}): SpawnAssignmentResult {
  const { runtime, from, to, cima, messageId } = opts;
  if (cima === undefined || cima === null) return { recorded: false, reason: 'none' };
  if (!parseAssignment(cima, from, to, opts.now ?? Date.now(), messageId)) {
    return { recorded: false, reason: 'not-an-assignment', detail: 'a spawn "cima" must be {taskId, phase} with no verdict' };
  }
  try {
    const rec = runtime.handle(from, to, cima, messageId);
    return rec?.kind === 'cima-assignment' ? { recorded: true } : { recorded: false, reason: 'not-recorded', detail: String(rec?.kind ?? 'unknown') };
  } catch (e) {
    return { recorded: false, reason: 'error', detail: String(e).slice(0, 200) };
  }
}
