/**
 * Alicia's event model — a READ-ONLY view of facts the core already produces.
 *
 * There is no new event bus. Each adapter below translates an EXISTING source
 * into AliciaEvents:
 *
 *   CimaRuntimeService.onEvent   (main → `lapitaya:governance`)   fromRuntimeEvent()
 *   HookServer hook stream       (main → `hive:hookEvent`)        fromHookEvent()
 *   hive/tasks.json              (HiveManager.tasks())            taskEvents(before, after)
 *
 * Events are locale-free facts. Technical identifiers (phase, verdict, risk,
 * rule, decision, tool, reason) are copied VERBATIM into `technical`; only the
 * presentation layer (messages.ts / notifications.ts) puts words around them.
 * An adapter never invents a field the source did not carry.
 */

import { isCimaPhase, type CimaPhase } from '../cima';
import type { CimaAssignment, CimaRecord, RuntimeVerdict, VerifiedEvidence } from '../cimaRuntime';
import type { Approval } from '../governance';
import type { HookEvent } from '../../hookEvents';

export const ALICIA_EVENT_TYPES = [
  'task.created', 'task.started', 'task.blocked', 'task.completed',
  'agent.started', 'agent.completed', 'agent.failed',
  'cima.phase.assigned', 'cima.phase.changed',
  'governance.blocked', 'governance.supervised',
  'approval.required', 'approval.granted', 'approval.denied',
  'audit.completed', 'workflow.completed',
  'intent.received', 'intent.classified', 'intent.forwarded', 'intent.governed', 'intent.blocked',
  'error'
] as const;
export type AliciaEventType = (typeof ALICIA_EVENT_TYPES)[number];

/** Where a fact came from — the source of truth Alicia is only observing. */
export type AliciaSource = 'cima-runtime' | 'governance' | 'hive' | 'task-ledger' | 'hooks' | 'ui' | 'user';

/** Runtime detail, verbatim. Never translated, never summarized. */
export interface AliciaTechnical {
  risk?: string;
  category?: string;
  mode?: string;
  decision?: string;
  rule?: string;
  tool?: string;
  /** The runtime's own reason text, exactly as it produced it. */
  reason?: string;
  violations?: readonly string[];
  approvalId?: string;
  claimed?: RuntimeVerdict;
}

export interface AliciaEvent {
  type: AliciaEventType;
  ts: number;
  source: AliciaSource;
  taskId?: string;
  agentId?: string;
  /** For assignments: who handed the phase over. */
  fromAgentId?: string;
  phase?: CimaPhase;
  verdict?: RuntimeVerdict;
  /** Human-readable subject the source already had (task title, approval summary). */
  subject?: string;
  technical?: AliciaTechnical;
  /** Evidence exactly as the runtime recorded it (verified flags included). */
  evidence?: readonly VerifiedEvidence[];
  /** Id of the source record (approval id, message id, trace id) — the audit link. */
  ref?: string;
}

export function isAliciaEventType(v: unknown): v is AliciaEventType {
  return typeof v === 'string' && (ALICIA_EVENT_TYPES as readonly string[]).includes(v);
}

// ─── CimaRuntimeService.onEvent ────────────────────────────────────────────

/** The payload CimaRuntimeService emits (and main forwards on `lapitaya:governance`). */
export interface RuntimeEventLike {
  type: string;
  data: unknown;
}

const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function fromApproval(type: AliciaEventType, a: Approval, ts: number, decision: string): AliciaEvent {
  return {
    type, ts, source: 'governance', agentId: a.agentId, subject: a.summary, ref: a.id,
    technical: { risk: a.risk, category: a.category, tool: a.tool, decision, mode: 'HUMAN_APPROVAL', approvalId: a.id }
  };
}

function fromCimaRecord(r: CimaRecord): AliciaEvent[] {
  const base = { ts: r.ts, source: 'cima-runtime' as const, taskId: r.taskId, agentId: r.agentId, phase: r.phase, ref: r.messageId };
  const technical: AliciaTechnical = {
    claimed: r.claimed,
    decision: r.verdict,
    ...(r.violations.length ? { rule: r.violations[0], violations: [...r.violations], reason: r.reasons.join(' ') } : {})
  };
  const evidence = r.evidence.map((e) => ({ ...e }));
  if (r.violations.length) {
    // The runtime REJECTED the claim: it did not move the task.
    return [{ ...base, type: 'governance.blocked', verdict: r.verdict, technical, evidence }];
  }
  const out: AliciaEvent[] = [{ ...base, type: 'cima.phase.changed', verdict: r.verdict, technical, evidence }];
  if (r.phase === 'AUDIT' && r.verdict !== 'BLOCKED') out.push({ ...base, type: 'audit.completed', verdict: r.verdict, technical, evidence });
  if (r.phase === 'DECISION' && r.verdict === 'PASS') out.push({ ...base, type: 'workflow.completed', verdict: r.verdict, technical, evidence });
  return out;
}

function fromAssignment(a: CimaAssignment): AliciaEvent {
  return {
    type: 'cima.phase.assigned', ts: a.ts, source: 'cima-runtime', taskId: a.taskId, phase: a.phase,
    agentId: a.to, fromAgentId: a.from, ref: a.messageId
  };
}

/**
 * Translate one CimaRuntimeService event. Unknown or malformed payloads yield
 * no events (Alicia stays silent rather than guessing).
 */
export function fromRuntimeEvent(e: RuntimeEventLike | null | undefined, now: number): AliciaEvent[] {
  if (!e || typeof e.type !== 'string') return [];
  const d = obj(e.data);
  switch (e.type) {
    case 'approval-request':
      if (!str(d.id) || !str(d.agentId)) return [];
      return [fromApproval('approval.required', d as unknown as Approval, now, 'HUMAN_APPROVAL_REQUIRED')];
    case 'approval-decided': {
      if (!str(d.id) || !str(d.agentId)) return [];
      const a = d as unknown as Approval;
      if (a.status === 'approved') return [fromApproval('approval.granted', a, a.decidedAt ?? now, 'HUMAN_APPROVED')];
      if (a.status === 'rejected') return [fromApproval('approval.denied', a, a.decidedAt ?? now, 'HUMAN_REJECTED')];
      return [];
    }
    case 'supervised':
      return [{
        type: 'governance.supervised', ts: now, source: 'governance', agentId: str(d.agentId), subject: str(d.summary),
        technical: { decision: 'SUPERVISED', mode: 'SUPERVISED', risk: 'MEDIUM', tool: str(d.tool), category: str(d.category) }
      }];
    case 'completion-blocked':
      if (!str(d.taskId)) return [];
      return [{
        type: 'governance.blocked', ts: now, source: 'governance', taskId: str(d.taskId), phase: 'DECISION',
        technical: { decision: 'DENY', rule: 'DECISION_GATE', risk: 'HIGH', tool: str(d.via), reason: str(d.reason) }
      }];
    case 'intent': {
      // One ledger record per governed intent; its trail becomes the intent.* events.
      if (d.kind !== 'intent' || !str(d.id) || !Array.isArray(d.trail)) return [];
      const t = obj(d.target);
      const technical: AliciaTechnical = {
        decision: str(d.decision), rule: str(d.rule), risk: str(d.risk), category: str(d.category),
        mode: str(d.mode), reason: str(d.reason), approvalId: str(d.approvalId), tool: str(t.tool)
      };
      return (d.trail as unknown[]).flatMap((step) => {
        const st = str(obj(step).status)?.toLowerCase();
        const type = `intent.${st}`;
        if (!isAliciaEventType(type)) return [];
        const ts = typeof obj(step).ts === 'number' ? obj(step).ts as number : now;
        return [{ type, ts, source: 'governance' as const, taskId: str(d.taskId) ?? str(t.taskId), agentId: str(d.source), subject: str(d.message), ref: str(d.id), technical }];
      });
    }
    case 'cima-record': {
      if (d.kind === 'cima-assignment' && str(d.taskId) && isCimaPhase(d.phase)) return [fromAssignment(d as unknown as CimaAssignment)];
      if (d.kind === 'cima' && str(d.taskId) && isCimaPhase(d.phase) && Array.isArray(d.violations) && Array.isArray(d.evidence)) {
        return fromCimaRecord(d as unknown as CimaRecord);
      }
      return [];
    }
    default:
      return [];
  }
}

// ─── HookServer hook stream ────────────────────────────────────────────────

/** Agent lifecycle from the hook stream. Tool-level chatter is not an Alicia event. */
export function fromHookEvent(h: HookEvent | null | undefined, now: number): AliciaEvent[] {
  if (!h || !h.agentId) return [];
  const base = { ts: now, source: 'hooks' as const, agentId: h.agentId };
  switch (h.event) {
    case 'SessionStart': return [{ ...base, type: 'agent.started' }];
    case 'Stop': return [{ ...base, type: 'agent.completed' }];
    case 'StopFailure':
    case 'PostToolUseFailure':
      return [{ ...base, type: 'agent.failed', technical: { tool: h.tool, reason: h.message } }];
    default: return [];
  }
}

// ─── hive/tasks.json ───────────────────────────────────────────────────────

interface TaskLike { id?: unknown; title?: unknown; status?: unknown; assignee?: unknown }

function taskList(ledger: unknown): TaskLike[] {
  const l = Array.isArray(ledger) ? ledger : obj(ledger).tasks;
  return Array.isArray(l) ? (l as TaskLike[]).filter((t) => t && typeof t.id === 'string') : [];
}

const STATUS_EVENT: Readonly<Record<string, AliciaEventType>> = {
  doing: 'task.started', blocked: 'task.blocked', done: 'task.completed'
};

/** Task transitions between two reads of the task ledger. */
export function taskEvents(before: unknown, after: unknown, now: number): AliciaEvent[] {
  const prev = new Map(taskList(before).map((t) => [t.id as string, t]));
  const out: AliciaEvent[] = [];
  for (const t of taskList(after)) {
    const id = t.id as string;
    const base = { ts: now, source: 'task-ledger' as const, taskId: id, subject: str(t.title), agentId: str(t.assignee) };
    const old = prev.get(id);
    if (!old) out.push({ ...base, type: 'task.created' });
    const status = str(t.status);
    if (status && status !== str(old?.status) && STATUS_EVENT[status]) out.push({ ...base, type: STATUS_EVENT[status] });
  }
  return out;
}
