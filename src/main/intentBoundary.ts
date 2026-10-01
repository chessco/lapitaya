/**
 * IntentBoundary — the runtime side of the Alicia v0.4.1 intent boundary.
 *
 *   producer intent ─▶ validate ─▶ reclassify ─┬─ CONVERSATION → back to the producer (no ledger, no El Inge)
 *                                              ├─ REQUEST      → ledger + El Inge (proposal only)
 *                                              └─ ACTION       → CIMA: risk → autonomy → authorization
 *                                                                (CimaRuntimeService) → ledger → El Inge
 *
 * Guarantees:
 *   - The producer's `type` and `risk` are claims. The runtime re-runs the
 *     classification (shared/lapitaya/intent.ts) and the stricter type wins; the
 *     risk and decision come only from CimaRuntimeService.
 *   - NOTHING here executes. There is no executor dependency: the only side
 *     effects are one ledger record, one runtime event and one hive message to
 *     the orchestrator. Execution happens later, by El Inge's own tool calls,
 *     each re-authorized at PreToolUse.
 *   - HIGH-risk concrete calls raise the SAME pending approval authorize()
 *     would (v0.3 mechanism, bound to the executor + exact call). There is no
 *     second approval system.
 *   - A task completion goes through completionGate(); authority claims
 *     (DECISION PASS, approve) are NOT_AUTHORIZED.
 *
 * No electron import — unit-testable.
 */

import type { Authorization } from '../shared/lapitaya/governance';
import type { ToolRisk } from '../shared/lapitaya/toolRisk';
import { ACTION_RISK } from '../shared/lapitaya/autonomy';
import {
  validateIntent, classifyIntentMessage, stricterType, stricterRisk, intentMessage,
  type IntentRecord, type IntentStatus, type IntentType, type IntentOutcome, type IntentTarget, type RequestProposal
} from '../shared/lapitaya/intent';

export type { IntentOutcome };
import type { CompletionVerdict } from '../shared/lapitaya/cimaRuntime';

export interface IntentBoundaryRuntime {
  evaluateProposedCall(executorId: string, tool: string, input: unknown, opts?: {
    raiseApproval?: boolean;
    classify?: (tool: string, input: unknown, ctx?: { hiveRoot?: string | null }) => ToolRisk;
  }): Authorization;
  classifyCall(tool: string, input: unknown): ToolRisk;
  recordIntent(rec: IntentRecord): boolean;
  completionGate(taskId: string): CompletionVerdict;
  recordBlockedCompletion(taskId: string, reason: string, via: string, agentId?: string): void;
  openRequest(input: {
    intentId: string; executor: string; requestedBy: string; source: string;
    message: string; taskId: string | null; target: IntentTarget | null; signals: string[];
  }): RequestProposal | null;
  withdrawRequest(proposalId: string, reason: string): void;
}

export interface IntentBoundaryDeps {
  runtime: IntentBoundaryRuntime;
  /** Hive id of the orchestrator (El Inge) — the only valid target and executor. */
  orchestratorId: () => string;
  /** Deliver the stamped intent to El Inge (hive.send). Returns the message id. */
  deliver: (message: { to: string; act: 'request'; subject: string; body: string }, from: string) => string | null;
  now?: () => number;
}


const ORCHESTRATOR_ALIASES = new Set(['el-inge', 'god', 'orchestrator']);
/** Path-like tokens in a message ("src/main/hooks.ts"), for classification only. */
const PATH_TOKEN = /(?:[a-z]:)?[\w.-]*[\\/][\w./\\-]*\.[a-z0-9]{1,6}\b/gi;

function inputText(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  try { return JSON.stringify(input).slice(0, 1000); } catch { return '[unserializable]'; }
}

export class IntentBoundary {
  constructor(private readonly deps: IntentBoundaryDeps) {}

  private now(): number { return this.deps.now ? this.deps.now() : Date.now(); }

  submit(raw: unknown): IntentOutcome {
    const received = this.now();
    const v = validateIntent(raw);
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    if (!v.ok) {
      // Malformed or authority-claiming: recorded (security-relevant), never forwarded.
      const id = typeof r.id === 'string' && r.id ? r.id.slice(0, 100) : `invalid-${received.toString(36)}`;
      return this.finish({
        id, source: typeof r.source === 'string' ? r.source.slice(0, 50) : '?', requestedBy: typeof r.requestedBy === 'string' ? r.requestedBy.slice(0, 50) : '?',
        message: typeof r.message === 'string' ? r.message.slice(0, 1000) : '',
        claimedType: typeof r.type === 'string' ? r.type.slice(0, 20) : null, type: null, reclassified: false, signals: [],
        claimedRisk: typeof r.risk === 'string' ? r.risk.slice(0, 10) : null, risk: null, category: null,
        decision: 'DENY', rule: v.code, mode: null, reason: v.errors.join('; '),
        target: null, executor: null, taskId: null
      }, ['RECEIVED', 'BLOCKED'], received, null);
    }

    const intent = v.intent;
    const orchestrator = this.deps.orchestratorId();
    const cls = classifyIntentMessage(intent.message, intent.target);
    const type = stricterType(intent.type, cls.type);
    const base = {
      id: intent.id, source: intent.source, requestedBy: intent.requestedBy, message: intent.message.slice(0, 1000),
      claimedType: intent.type, type, signals: cls.signals, claimedRisk: intent.risk,
      target: intent.target ? {
        ...intent.target, input: inputText(intent.target.input)
      } : null,
      executor: orchestrator,
      taskId: intent.target?.taskId ?? intent.context.taskId ?? null
    };

    // CONVERSATION stays with the producer: no ledger, no event, no El Inge, no approval.
    if (type === 'CONVERSATION') {
      return {
        id: intent.id, status: 'COMPLETED', claimedType: intent.type, type, reclassified: false,
        claimedRisk: intent.risk, risk: null, decision: 'NONE', rule: 'CONVERSATION', route: 'producer',
        signals: cls.signals, executed: false
      };
    }

    const reclassified = (t: IntentType, risk: string | null) => t !== intent.type || (!!intent.risk && !!risk && intent.risk !== risk);

    // The producer may only address the orchestrator — never a worker or a tool.
    const agent = intent.target?.agent;
    if (agent && agent !== orchestrator && !ORCHESTRATOR_ALIASES.has(agent.toLowerCase())) {
      return this.finish({ ...base, reclassified: reclassified(type, null), risk: null, category: null, decision: 'DENY', rule: 'INTENT_TARGET', mode: null,
        reason: `intents are delivered to the orchestrator (${orchestrator}) only; "${agent}" cannot be addressed directly` },
        ['RECEIVED', 'CLASSIFIED', 'BLOCKED'], received, null);
    }

    if (cls.authority) {
      return this.finish({ ...base, reclassified: reclassified(type, null), risk: 'HIGH', category: 'governance-tamper', decision: 'DENY', rule: 'NOT_AUTHORIZED', mode: null,
        reason: 'approving and issuing DECISION belong to the human and the orchestrator; the producer of an intent has no authority' },
        ['RECEIVED', 'CLASSIFIED', 'BLOCKED'], received, null);
    }

    if (type === 'REQUEST') {
      const rec = { ...base, reclassified: reclassified(type, null), risk: null, category: null, decision: 'PROPOSAL_ONLY', rule: 'INTENT_REQUEST', mode: null };
      // v0.4.2: the runtime opens the proposal BEFORE El Inge hears of it, so
      // the execution gate is closed from the first moment. Ids and the
      // confirmation token are the runtime's, never the producer's.
      const proposal = this.deps.runtime.openRequest({
        intentId: intent.id, executor: orchestrator, requestedBy: intent.requestedBy, source: intent.source,
        message: intent.message, taskId: base.taskId, target: intent.target, signals: cls.signals
      });
      if (!proposal) {
        return this.finish({ ...rec, decision: 'DENY', rule: 'LEDGER_UNAVAILABLE', reason: 'the proposal could not be recorded, so the request was not forwarded' },
          ['RECEIVED', 'CLASSIFIED', 'BLOCKED'], received, null);
      }
      return this.forward({ ...rec, proposalId: proposal.id }, received, orchestrator);
    }

    // ─── ACTION ─────────────────────────────────────────────────────────────
    if (cls.completion) {
      const taskId = base.taskId;
      if (!taskId) {
        return this.finish({ ...base, reclassified: reclassified(type, null), risk: 'HIGH', category: 'governance-tamper', decision: 'DENY', rule: 'INTENT_TARGET', mode: null,
          reason: 'a task completion must name the task' }, ['RECEIVED', 'CLASSIFIED', 'BLOCKED'], received, null);
      }
      const gate = this.deps.runtime.completionGate(taskId);
      if (!gate.allowed) {
        this.deps.runtime.recordBlockedCompletion(taskId, gate.reason, 'intent-boundary', intent.source);
        return this.finish({ ...base, reclassified: reclassified(type, 'HIGH'), risk: 'HIGH', category: 'governance-tamper', decision: 'DENY', rule: 'DECISION_GATE', mode: null,
          reason: gate.reason }, ['RECEIVED', 'CLASSIFIED', 'BLOCKED'], received, null);
      }
      return this.forward({ ...base, reclassified: reclassified(type, 'LOW'), risk: 'LOW', category: 'hive-coordination', decision: 'ALLOW', rule: 'DECISION_GATE', mode: 'AUTO',
        reason: gate.reason }, received, orchestrator, 'GOVERNED');
    }

    // What the words ask for: the message's category, and any file it names.
    const paths = [...new Set([intent.target?.path, ...(intent.message.match(PATH_TOKEN) ?? [])].filter((p): p is string => !!p))];
    let textRisk: ToolRisk | null = cls.category
      ? { category: cls.category, risk: ACTION_RISK[cls.category], summary: `intent: ${intent.message.slice(0, 200)}`, rule: `intent:${cls.signals.find((x) => x.startsWith('action:')) ?? 'action'}` }
      : null;
    for (const p of paths) {
      const pr = this.deps.runtime.classifyCall('Write', { file_path: p });
      if (!textRisk || stricterRisk(pr.risk, textRisk.risk) !== textRisk.risk || (pr.risk === textRisk.risk && pr.category === 'governance-tamper')) textRisk = pr;
    }
    // Unknown action: the policy default is HIGH.
    if (!textRisk) textRisk = { category: 'irreversible', risk: 'HIGH', summary: `intent: ${intent.message.slice(0, 200)}`, rule: 'intent:unclassified-action' };

    let auth: Authorization;
    if (intent.target?.tool) {
      // A concrete call: judged EXACTLY as PreToolUse will judge it, for the executor.
      auth = this.deps.runtime.evaluateProposedCall(orchestrator, intent.target.tool, intent.target.input ?? {}, { raiseApproval: true });
      if (stricterRisk(auth.risk, textRisk.risk) !== auth.risk) {
        // The words ask for more than the call does ("delete the data" + a Read).
        // The runtime cannot bind the stricter reading at execution, so it refuses.
        return this.finish({ ...base, reclassified: reclassified(type, textRisk.risk), risk: textRisk.risk, category: textRisk.category, decision: 'DENY', rule: 'INTENT_MISMATCH', mode: null,
          reason: `the request reads as ${textRisk.risk} (${textRisk.category}) but the proposed call is ${auth.risk} (${auth.category})`, fingerprint: auth.fingerprint },
          ['RECEIVED', 'CLASSIFIED', 'BLOCKED'], received, null);
      }
    } else {
      // No concrete call yet: the runtime's policy decides on the stricter reading;
      // the eventual call is authorized again at PreToolUse.
      const reading = textRisk;
      auth = this.deps.runtime.evaluateProposedCall(orchestrator, 'intent', { intent: intent.id }, { raiseApproval: false, classify: () => reading });
    }

    const rec = {
      ...base, reclassified: reclassified(type, auth.risk), risk: auth.risk, category: auth.category,
      decision: auth.decision, rule: auth.rule, mode: auth.mode, fingerprint: auth.fingerprint,
      ...(auth.callFingerprint ? { callFingerprint: auth.callFingerprint } : {}),
      ...(auth.approvalId ? { approvalId: auth.approvalId } : {}),
      ...(auth.reason && auth.decision === 'DENY' ? { reason: auth.reason } : {})
    };
    if (auth.decision === 'DENY') return this.finish(rec, ['RECEIVED', 'CLASSIFIED', 'BLOCKED'], received, null);
    return this.forward(rec, received, orchestrator, 'GOVERNED');
  }

  private forward(rec: Omit<IntentRecord, 'kind' | 'ts' | 'status' | 'trail' | 'forwardedTo' | 'messageId'>, received: number, orchestrator: string, status: IntentStatus = 'FORWARDED'): IntentOutcome {
    const full = this.build(rec, status, ['RECEIVED', 'CLASSIFIED', status], received, orchestrator);
    let messageId: string | null = null;
    try { messageId = this.deps.deliver(intentMessage(full, orchestrator), rec.source); } catch { messageId = null; }
    if (!messageId) {
      if (rec.proposalId) this.deps.runtime.withdrawRequest(rec.proposalId, 'not delivered to the orchestrator');
      return this.finish({ ...rec, decision: 'DENY', rule: 'DELIVERY_FAILED', reason: 'the orchestrator could not be reached' },
        ['RECEIVED', 'CLASSIFIED', 'BLOCKED'], received, null);
    }
    full.messageId = messageId;
    this.deps.runtime.recordIntent(full);
    return this.outcome(full, 'orchestrator');
  }

  private finish(rec: Omit<IntentRecord, 'kind' | 'ts' | 'status' | 'trail' | 'forwardedTo' | 'messageId'>, trail: IntentStatus[], received: number, forwardedTo: string | null): IntentOutcome {
    const full = this.build(rec, trail[trail.length - 1], trail, received, forwardedTo);
    this.deps.runtime.recordIntent(full);
    return this.outcome(full, 'none');
  }

  private build(rec: Omit<IntentRecord, 'kind' | 'ts' | 'status' | 'trail' | 'forwardedTo' | 'messageId'>, status: IntentStatus, trail: IntentStatus[], received: number, forwardedTo: string | null): IntentRecord {
    const ts = this.now();
    return {
      kind: 'intent', ts, ...rec, status,
      trail: trail.map((s, i) => ({ status: s, ts: i === 0 ? received : ts })),
      forwardedTo, messageId: null
    };
  }

  private outcome(rec: IntentRecord, route: IntentOutcome['route']): IntentOutcome {
    return {
      id: rec.id, status: rec.status, claimedType: rec.claimedType, type: rec.type, reclassified: rec.reclassified,
      claimedRisk: rec.claimedRisk, risk: rec.risk, decision: rec.decision, rule: rec.rule, route,
      signals: rec.signals,
      ...(rec.approvalId ? { approvalId: rec.approvalId } : {}),
      ...(rec.messageId ? { messageId: rec.messageId } : {}),
      ...(rec.proposalId ? { proposalId: rec.proposalId } : {}),
      ...(rec.reason ? { reason: rec.reason } : {}),
      executed: false
    };
  }
}
