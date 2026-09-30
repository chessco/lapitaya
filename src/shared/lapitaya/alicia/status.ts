/**
 * CimaStatus — what Alicia can know about one task's CIMA workflow.
 *
 * DERIVED, never stored: it is recomputed from the runtime's own records
 * (CimaRuntimeService.cimaRecords / completionGate / listApprovals) every time
 * it is asked for, and returned deep-frozen. Alicia holds a snapshot, not the
 * state: mutating it throws in strict mode and can never reach the ledger.
 *
 * The phase results follow the runtime's rule (taskPhaseVerdicts): a record the
 * runtime REJECTED stays visible as `blocked`, but does not move the task.
 */

import { CIMA_WORKFLOW, type CimaPhase } from '../cima';
import {
  taskPhaseVerdicts,
  type CimaAssignment, type CimaRecord, type CompletionVerdict, type RuntimeVerdict
} from '../cimaRuntime';
import type { Approval } from '../governance';
import type { RiskLevel } from '../autonomy';

export interface CimaPhaseStatus {
  readonly phase: CimaPhase;
  readonly verdict: RuntimeVerdict;
  readonly agentId: string;
  readonly evidenceCount: number;
  readonly verifiedEvidenceCount: number;
  readonly ts: number;
}

export interface CimaStatus {
  readonly taskId: string;
  /** The task has CIMA history — the decision gate applies to it. */
  readonly governed: boolean;
  /** The last phase the runtime ACCEPTED, or null. */
  readonly phase: CimaPhase | null;
  /** The runtime's verdict for that phase. */
  readonly status: RuntimeVerdict | null;
  readonly agent: string | null;
  /** Highest risk among pending approvals for agents working on this task. */
  readonly risk: RiskLevel | null;
  /** The latest accepted DECISION verdict, or null. */
  readonly decision: RuntimeVerdict | null;
  readonly evidenceCount: number;
  /** The latest claim for this task was rejected by the runtime. */
  readonly blocked: boolean;
  readonly requiresApproval: boolean;
  /** completionGate(taskId), verbatim — Alicia never recomputes it. */
  readonly completion: Readonly<CompletionVerdict> | null;
  /** Accepted phase results in workflow order (BUILD → PASS, TEST → PASS, …). */
  readonly pipeline: readonly CimaPhaseStatus[];
  /** The rejected claims, newest last, with the runtime's rule ids. */
  readonly rejected: readonly { readonly phase: CimaPhase; readonly agentId: string; readonly violations: readonly string[]; readonly ts: number }[];
}

export interface CimaStatusSources {
  taskId: string;
  /** The runtime's records for this task (CimaRuntimeService.cimaRecords(taskId)). */
  records: readonly CimaRecord[];
  assignments?: readonly CimaAssignment[];
  approvals?: readonly Approval[];
  /** CimaRuntimeService.completionGate(taskId). */
  completion?: CompletionVerdict | null;
}

const RISK_ORDER: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

export function deriveCimaStatus(src: CimaStatusSources): CimaStatus {
  const records = src.records.filter((r) => r.taskId === src.taskId);
  const assignments = (src.assignments ?? []).filter((a) => a.taskId === src.taskId);
  const accepted = records.filter((r) => r.violations.length === 0);
  const verdicts = taskPhaseVerdicts({ records, traces: [], godId: '' }, src.taskId);

  const pipeline: CimaPhaseStatus[] = [];
  for (const phase of CIMA_WORKFLOW) {
    const latest = [...accepted].reverse().find((r) => r.phase === phase);
    if (!latest || verdicts[phase] === undefined) continue;
    pipeline.push({
      phase,
      verdict: latest.verdict,
      agentId: latest.agentId,
      evidenceCount: latest.evidence.length,
      verifiedEvidenceCount: latest.evidence.filter((e) => e.verified).length,
      ts: latest.ts
    });
  }

  const last = accepted.length ? accepted[accepted.length - 1] : null;
  const newest = records.length ? records[records.length - 1] : null;
  const decision = [...accepted].reverse().find((r) => r.phase === 'DECISION') ?? null;

  const involved = new Set<string>([...records.map((r) => r.agentId), ...assignments.map((a) => a.to)]);
  const pending = (src.approvals ?? []).filter((a) => a.status === 'pending' && involved.has(a.agentId));
  const risk = pending.reduce<RiskLevel | null>((acc, a) =>
    acc === null || RISK_ORDER.indexOf(a.risk) > RISK_ORDER.indexOf(acc) ? a.risk : acc, null);

  return deepFreeze({
    taskId: src.taskId,
    governed: records.length > 0 || assignments.length > 0 || !!src.completion?.governed,
    phase: last?.phase ?? null,
    status: last?.verdict ?? null,
    agent: last?.agentId ?? null,
    risk,
    decision: decision?.verdict ?? null,
    evidenceCount: last?.evidence.length ?? 0,
    blocked: !!newest && newest.violations.length > 0,
    requiresApproval: pending.length > 0,
    completion: src.completion ? { ...src.completion } : null,
    pipeline,
    rejected: records.filter((r) => r.violations.length > 0)
      .map((r) => ({ phase: r.phase, agentId: r.agentId, violations: [...r.violations], ts: r.ts }))
  });
}
