/**
 * Intents — the boundary between conversation and governed action (v0.4.1).
 *
 *   USER → ALICIA → AliciaIntent → INTENT BOUNDARY (runtime) ─┬─ CONVERSATION → Alicia answers
 *                                                             ├─ REQUEST      → El Inge: proposal, WAIT
 *                                                             └─ ACTION       → CIMA risk/autonomy/authorization → El Inge
 *
 * This module is the provider-neutral contract both sides share: the intent
 * shape, its validation, a small DETERMINISTIC classifier and the message El
 * Inge receives. The producer (Alicia) may label an intent; the runtime
 * (src/main/intentBoundary.ts) re-runs the classification and the strictest
 * answer wins. Classification never executes anything.
 *
 * Identifiers are universal and never translated: CONVERSATION, REQUEST,
 * ACTION, LOW/MEDIUM/HIGH, ALLOW/DENY/BLOCKED, PASS.
 */

import { ACTION_RISK, type ActionCategory, type RiskLevel } from './autonomy';
import { toAscii } from './locales';

export const INTENT_TYPES = ['CONVERSATION', 'REQUEST', 'ACTION'] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

export const INTENT_STATUSES = ['RECEIVED', 'CLASSIFIED', 'FORWARDED', 'GOVERNED', 'BLOCKED', 'COMPLETED'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

/** Producers the boundary accepts. Being a producer grants nothing. */
export const INTENT_SOURCES = ['alicia'] as const;
export type IntentSource = (typeof INTENT_SOURCES)[number];

export interface IntentTarget {
  /** Who should handle it. Only the orchestrator (El Inge) is a valid target. */
  agent?: string;
  /** A file the action is about. */
  path?: string;
  /** A concrete tool call the action proposes. Never run by the boundary. */
  tool?: string;
  input?: unknown;
  taskId?: string;
}

export interface AliciaIntent {
  id: string;
  source: IntentSource;
  /** The PRODUCER's classification — a claim the runtime re-checks. */
  type: IntentType;
  /** The human's words, verbatim. */
  message: string;
  context: { taskId?: string; phase?: string; uiLocale?: string };
  requestedBy: 'human';
  target: IntentTarget | null;
  /** The producer's risk SUGGESTION — never authoritative. */
  risk: RiskLevel | null;
  status: IntentStatus;
  createdAt: number;
}

/** What the runtime records for one governed intent (cima-ledger.jsonl, kind 'intent'). */
export interface IntentRecord {
  kind: 'intent';
  ts: number;
  id: string;
  source: string;
  requestedBy: string;
  message: string;
  claimedType: string | null;
  type: IntentType | null;
  reclassified: boolean;
  /** Which classifier rules fired — the audit trail of the classification. */
  signals: string[];
  claimedRisk: string | null;
  risk: RiskLevel | null;
  category: string | null;
  decision: string;
  rule: string;
  mode: string | null;
  reason?: string;
  approvalId?: string;
  fingerprint?: string;
  target: { agent?: string; path?: string; tool?: string; input?: string; taskId?: string } | null;
  /** The task the intent is about (target or context), if any. */
  taskId: string | null;
  /** Who would execute (the orchestrator), never the producer. */
  executor: string | null;
  status: IntentStatus;
  trail: { status: IntentStatus; ts: number }[];
  forwardedTo: string | null;
  messageId: string | null;
}

/** What the runtime boundary answers the producer. */
export interface IntentOutcome {
  id: string;
  status: IntentStatus;
  claimedType: string | null;
  type: IntentType | null;
  reclassified: boolean;
  claimedRisk: string | null;
  risk: string | null;
  decision: string;
  rule: string;
  /** Where the intent went: back to the producer (conversation), to El Inge, or nowhere. */
  route: 'producer' | 'orchestrator' | 'none';
  signals: string[];
  approvalId?: string;
  messageId?: string;
  reason?: string;
  /** The boundary never executes. */
  readonly executed: false;
}

const RISK_ORDER: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
const TYPE_ORDER: readonly IntentType[] = ['CONVERSATION', 'REQUEST', 'ACTION'];

export function stricterRisk(a: RiskLevel | null, b: RiskLevel | null): RiskLevel | null {
  if (!a) return b;
  if (!b) return a;
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export function stricterType(a: IntentType, b: IntentType): IntentType {
  return TYPE_ORDER.indexOf(a) >= TYPE_ORDER.indexOf(b) ? a : b;
}

export function isIntentType(v: unknown): v is IntentType {
  return typeof v === 'string' && (INTENT_TYPES as readonly string[]).includes(v);
}

// ─── validation ─────────────────────────────────────────────────────────────

/** Fields that would claim authority. An intent carrying any of them is not
 *  malformed — it is an attempt to decide, approve or execute: NOT_AUTHORIZED. */
export const AUTHORITY_FIELDS = [
  'cima', 'verdict', 'decision', 'approve', 'approved', 'approval', 'approvalId',
  'authorization', 'authorized', 'execute', 'executed', 'executor', 'bypass'
] as const;

export type IntentValidation =
  | { ok: true; intent: AliciaIntent }
  | { ok: false; code: 'INTENT_INVALID' | 'NOT_AUTHORIZED'; errors: string[] };

const s = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export function validateIntent(raw: unknown): IntentValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'INTENT_INVALID', errors: ['intent is not an object'] };
  const r = raw as Record<string, unknown>;
  const t = (r.target && typeof r.target === 'object' && !Array.isArray(r.target) ? r.target : null) as Record<string, unknown> | null;

  const authority = AUTHORITY_FIELDS.filter((f) => f in r || (t !== null && f in t));
  if (authority.length) return { ok: false, code: 'NOT_AUTHORIZED', errors: authority.map((f) => `field "${f}" claims authority`) };

  const errors: string[] = [];
  const id = s(r.id, 100);
  if (!id || !/^[\w.:-]+$/.test(id)) errors.push('missing or invalid id');
  if (!(INTENT_SOURCES as readonly unknown[]).includes(r.source)) errors.push('missing or unknown source');
  if (!isIntentType(r.type)) errors.push('missing or unknown type');
  const message = s(r.message, 4000);
  if (!message) errors.push('missing message');
  if (r.requestedBy !== 'human') errors.push('requestedBy must be "human"');
  if (r.status !== 'RECEIVED') errors.push('status must be RECEIVED on submission');
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) errors.push('missing createdAt');
  if (r.risk !== undefined && r.risk !== null && !(RISK_ORDER as readonly unknown[]).includes(r.risk)) errors.push('unknown risk');
  if (r.target !== undefined && r.target !== null && !t) errors.push('target must be an object');
  if (errors.length) return { ok: false, code: 'INTENT_INVALID', errors };

  const c = (r.context && typeof r.context === 'object' ? r.context : {}) as Record<string, unknown>;
  return {
    ok: true,
    intent: {
      id: id!, source: r.source as IntentSource, type: r.type as IntentType, message: message!,
      context: {
        ...(s(c.taskId, 200) ? { taskId: s(c.taskId, 200) } : {}),
        ...(s(c.phase, 20) ? { phase: s(c.phase, 20) } : {}),
        ...(s(c.uiLocale, 20) ? { uiLocale: s(c.uiLocale, 20) } : {})
      },
      requestedBy: 'human',
      target: t ? {
        ...(s(t.agent, 100) ? { agent: s(t.agent, 100) } : {}),
        ...(s(t.path, 1000) ? { path: s(t.path, 1000) } : {}),
        ...(s(t.tool, 100) ? { tool: s(t.tool, 100) } : {}),
        ...(t.input !== undefined ? { input: t.input } : {}),
        ...(s(t.taskId, 200) ? { taskId: s(t.taskId, 200) } : {})
      } : null,
      risk: (r.risk as RiskLevel | null | undefined) ?? null,
      status: 'RECEIVED',
      createdAt: r.createdAt as number
    }
  };
}

// ─── deterministic classification ──────────────────────────────────────────

/**
 * Word-boundary patterns over the message folded to ASCII lower case
 * (accents stripped: "migración" → "migracion"). Each entry is one auditable
 * signal. Spanish verbs list the imperative / infinitive / subjunctive forms a
 * request uses ("borra", "borrar", "borres"), not past tenses — "¿por qué se
 * borró?" is a question about history, not an instruction.
 */
const W = (alts: string) => new RegExp(`(?<![a-z0-9_])(?:${alts})(?:lo|la|los|las|le|les)?(?![a-z0-9_])`);

const ACTION_RULES: readonly { signal: string; category: ActionCategory; re: RegExp }[] = [
  { signal: 'action:delete', category: 'data-deletion', re: W('borra|borrar|borre|borres|borren|elimina|eliminar|elimine|elimines|eliminen|suprime|suprimir|trunca|truncar|vacia|vaciar|delete|remove|drop|wipe|purge|truncate|rm -rf?') },
  { signal: 'action:deploy', category: 'production', re: W('despliega|desplegar|despliegue|despliegues|deploy|publica|publicar|publish|release|a produccion|to production|en produccion|in production') },
  { signal: 'action:migrate', category: 'destructive-migration', re: W('migra|migrar|migre|migren|haz una migracion|corre la migracion|ejecuta la migracion|migrate|run the migration|run migrations') },
  { signal: 'action:infrastructure', category: 'infrastructure', re: W('terraform|kubectl|helm') },
  { signal: 'action:secrets', category: 'secrets', re: W('\\.env|credenciales|credentials|api key|api keys|contrasena|contrasenas|password|passwords|secretos|secrets') },
  { signal: 'action:permissions', category: 'permissions', re: W('chmod|chown|sudo|cambia los permisos|change the permissions') },
  { signal: 'action:push', category: 'irreversible', re: W('git push|haz push|push|force push|merge|mergea|fusiona|fusionar|rebase|reset --hard') },
  { signal: 'action:run-checks', category: 'run-tests', re: W('(?:ejecuta|ejecutar|ejecutes|corre|correr|corras|lanza|run|execute)(?: los| las| el| la| the| all| todos los| todas las)? (?:tests?|pruebas?|suite|specs?|typecheck|lint)|npm test|npm run test|node --test') },
  { signal: 'action:modify', category: 'code-change', re: W('modifica|modificar|modifique|modifiques|modifiquen|edita|editar|edite|edites|editen|cambia|cambiar|cambie|cambies|cambien|refactoriza|refactorizar|escribe|escribir|escribas|actualiza|actualizar|actualice|actualices|arregla|arreglar|arregles|corrige|corregir|corrijas|agrega|agregar|agregues|anade|anadir|renombra|renombrar|reemplaza|reemplazar|mueve|mover|instala|instalar|modify|edit|change|refactor|rewrite|write to|fix|rename|replace|install|crea el archivo|crea un archivo|create the file|create a file') },
  { signal: 'action:run', category: 'shell-command', re: W('ejecuta|ejecutar|ejecutes|corre|correr|run|execute') }
];

const REQUEST_RULE = W('quiero que|queremos que|me gustaria que|necesito que|necesitamos que|i want|i would like|we need|we should|lets|let\'s|vamos a|revisa|revisar|revise|revisemos|review|analiza|analizar|analice|analicemos|analyze|analyse|investiga|investigar|investigate|prepara|preparar|prepare|planea|planear|plan|propon|proponer|propose|disena|disenar|design|implementa|implementar|implemente|implementen|implement|audita|auditar|audit|evalua|evaluar|evaluate|asigna|asignar|assign|delega|delegar|delegate');

/** "How do I deploy?" / "¿qué significa BLOCKED?" — asking about something,
 *  not asking for it. Only honoured when no second instruction follows. */
const KNOWLEDGE_RULE = W('explica|explicame|explain|que significa|que es|que hace|what is|what does|what means|como se|como funciona|como puedo|how do|how does|how to|how can|por que|why|describe|describeme|cuentame|tell me|resume|resumeme|summarize|summarise');
const QUESTION_RULE = /^\s*¿|\?\s*$|^\s*(que|cual|cuales|cuando|donde|quien|como|what|which|when|where|who|how|is|are|does|did)(?![a-z])/;
const CHAINED_RULE = W('y luego|y despues|y tambien|y ademas|and then|then|after that|despues|ademas|luego');

const AUTHORITY_RULES: readonly { signal: string; re: RegExp }[] = [
  { signal: 'authority:decision-pass', re: W('(?:emite|emitir|registra|registrar|marca|marcar|da|dar|dale|pon|poner|record|emit|mark|give|set|declare|declara) (?:la |el |una |un |a |the )?(?:decision pass|decision como pass|decision as pass|decision de pass)') },
  { signal: 'authority:approve', re: /^\s*(?:por favor |please )?(?:aprueba|apruebala|apruebalo|autoriza|autorizala|autorizalo|acepta el trabajo|approve|authorize|accept the work)(?![a-z])/ }
];

const COMPLETION_RULE = W('(?:marca|marcar|marques|pon|poner|cierra|cerrar|mark|set|close) .{0,60}(?:done|terminad[ao]|completad[ao]|complete|completed|hecha|hecho|cerrad[ao]|closed)');

export interface IntentClassification {
  type: IntentType;
  /** Strictest ActionCategory the message names, when it is an ACTION. */
  category: ActionCategory | null;
  risk: RiskLevel | null;
  /** Every rule that fired, in order — the audit trail. */
  signals: string[];
  /** The message tries to approve or issue a DECISION. */
  authority: boolean;
  /** The message asks to mark a task done (decision gate). */
  completion: boolean;
}

/**
 * Deterministic, dependency-free classification of one message (+ target).
 * Errs toward the stricter type: an ACTION rule wins over framing unless the
 * message is purely a knowledge question with no chained instruction.
 */
export function classifyIntentMessage(message: string, target?: IntentTarget | null): IntentClassification {
  const text = toAscii(message).toLowerCase().replace(/\s+/g, ' ').trim();
  const signals: string[] = [];

  const authority = AUTHORITY_RULES.filter((r) => r.re.test(text));
  for (const a of authority) signals.push(a.signal);
  const completion = COMPLETION_RULE.test(text);
  if (completion) signals.push('action:complete-task');

  const actions = ACTION_RULES.filter((r) => r.re.test(text));
  // "run the tests" also matches the generic "run": keep the specific one.
  const specific = actions.some((a) => a.signal === 'action:run-checks') ? actions.filter((a) => a.signal !== 'action:run') : actions;
  for (const a of specific) signals.push(a.signal);

  const knowledge = KNOWLEDGE_RULE.test(text);
  const question = QUESTION_RULE.test(text);
  const chained = CHAINED_RULE.test(text);
  if (knowledge) signals.push('frame:knowledge');
  if (question) signals.push('frame:question');
  if (chained) signals.push('frame:chained');
  const request = REQUEST_RULE.test(text);
  if (request) signals.push('request:verb');
  if (target?.tool) signals.push('target:tool');

  let category: ActionCategory | null = null;
  for (const a of specific) {
    if (!category || RISK_ORDER.indexOf(ACTION_RISK[a.category]) > RISK_ORDER.indexOf(ACTION_RISK[category])) category = a.category;
  }

  let type: IntentType = 'CONVERSATION';
  if (authority.length || completion || target?.tool) type = 'ACTION';
  else if (specific.length && !(knowledge && !chained)) type = 'ACTION';
  else if (request && !((knowledge || question) && !chained)) type = 'REQUEST';
  if (type === 'CONVERSATION' && specific.length) signals.push('demoted:knowledge-question');

  return {
    type,
    category: type === 'ACTION' ? category : null,
    risk: type === 'ACTION' && category ? ACTION_RISK[category] : null,
    signals,
    authority: authority.length > 0,
    completion
  };
}

// ─── the message El Inge receives ──────────────────────────────────────────

export const INTENT_BANNER_PREFIX = '[Intent boundary]';

function quote(text: string): string {
  return text.split(/\r?\n/).map((l) => `> ${l}`).join('\n');
}

/**
 * The hive message for a forwarded intent. The first line is the RUNTIME's
 * stamp (like the CIMA router's banner), so El Inge acts on the runtime's
 * classification and decision, never on the producer's label. The human's
 * words are quoted so they can never pass for a banner.
 */
export function intentMessage(rec: IntentRecord, orchestratorId: string): { to: string; act: 'request'; subject: string; body: string } {
  const claimed = rec.reclassified ? ` (claimed ${rec.claimedType ?? '?'}${rec.claimedRisk ? `/${rec.claimedRisk}` : ''})` : '';
  const head = `${INTENT_BANNER_PREFIX} intent ${rec.id} · ${rec.type}${claimed} · risk ${rec.risk ?? '-'} · decision ${rec.decision} · rule ${rec.rule}` +
    (rec.approvalId ? ` · approval ${rec.approvalId}` : '');
  const instruction = rec.type === 'REQUEST'
    ? 'PROPOSAL ONLY: reply to the human with a plan or proposal and WAIT for their go-ahead. Do not execute anything for this request.'
    : rec.decision === 'HUMAN_APPROVAL_REQUIRED'
      ? (rec.approvalId
        ? `HUMAN APPROVAL REQUIRED: the proposed call is denied at PreToolUse until the human approves ${rec.approvalId}; then run the IDENTICAL call once.`
        : 'HUMAN APPROVAL REQUIRED: any HIGH-risk call you make for this is denied at PreToolUse until the human approves that exact call.')
      : 'GOVERNED ACTION: carry it out only through your normal tools. Every call is re-authorized at PreToolUse; nothing was executed by this boundary.';
  const lines = [head, instruction, '', `Human request (verbatim, relayed by ${rec.source}):`, quote(rec.message)];
  const t = rec.target;
  if (rec.taskId) lines.push('', `Task: ${rec.taskId}`);
  if (t?.path) lines.push(`Path: ${t.path}`);
  if (t?.tool) lines.push(`Proposed call (NOT executed): ${t.tool} ${t.input ?? ''}`.trim());
  lines.push('', `${rec.source} has no authority to approve, decide or execute. Route this through CIMA as usual.`);
  return {
    to: orchestratorId,
    act: 'request',
    subject: `${rec.type} intent ${rec.id}: ${rec.message.split(/\r?\n/)[0].slice(0, 70)}`,
    body: lines.join('\n')
  };
}
