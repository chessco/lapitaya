/**
 * La Pitaya CIMA v0.16 — Governance Policy & Capability Registry (pure: no fs, no process, no clock).
 *
 * ONE declarative, versioned, read-only description of
 *
 *   WHAT can an actor do (capability)       — through which PROVIDER, which TOOL, which OPERATION
 *   UNDER WHAT governance (mode)             — AUTO · SUPERVISED · HUMAN_APPROVAL · DENIED
 *   WITH WHAT baseline risk                  — LOW · MEDIUM · HIGH
 *   AND WHAT runtime evidence is required
 *
 * The registry is POLICY DEFINITION, never POLICY ENFORCEMENT:
 *
 *   - it does not execute, approve, deny, change task state or write the ledger;
 *   - it has no "allow" answer at all: resolution returns a capability (a policy) or a structured refusal code;
 *   - the only component that decides ALLOW / SUPERVISED / HUMAN_APPROVAL_REQUIRED / APPROVED / DENY is still
 *     CimaRuntimeService.authorize() (through authorizeToolCall in governance.ts), and task completion is still
 *     decided by CimaRuntimeService.completionGate().
 *
 * Baselines are FLOORS. The runtime's final classification is the STRICTER of the baseline and what the actual call
 * is (operation, canonical target, context) — a baseline can raise a classification, never lower it.
 *
 * The policy lives in code (this file is itself a governance file: an agent writing it is HIGH / governance-tamper).
 * Every table is deep-frozen; nothing an agent, a provider, the renderer, Alicia, a hive message or a task payload
 * sends can add, change or remove a definition. A policy that does not validate fails CLOSED: every resolution
 * against it returns POLICY_INVALID.
 */

import type { AutonomyMode, RiskLevel } from './autonomy';
import { AGENT_PROVIDER_PRESETS, bridgeOf, type AgentProvider } from '../agentProvider';

/** Bumped whenever the meaning of any definition below changes. Recorded on every governance event and bound into
 *  every authorization subject (an approval granted under another version does not authorize). */
export const CIMA_POLICY_VERSION = 1;

// ─── vocabulary (closed sets — nothing new invented here) ──────────────────

export const RISK_LEVELS: readonly RiskLevel[] = Object.freeze(['LOW', 'MEDIUM', 'HIGH'] as RiskLevel[]);
export const AUTONOMY_MODES: readonly AutonomyMode[] = Object.freeze(['AUTO', 'SUPERVISED', 'HUMAN_APPROVAL'] as AutonomyMode[]);
/** The autonomy modes plus DENIED (a capability that never runs, whatever the risk or stage). */
export type GovernanceMode = AutonomyMode | 'DENIED';
export const GOVERNANCE_MODES: readonly GovernanceMode[] = Object.freeze(['AUTO', 'SUPERVISED', 'HUMAN_APPROVAL', 'DENIED'] as GovernanceMode[]);

export type EvidenceRequirement =
  /** A PostToolUse execution trace (traces.jsonl) — the only thing CIMA accepts as evidence of work. */
  | 'TRACE_REQUIRED'
  /** The decision must be durably recorded as a governance event before the call runs. */
  | 'GOVERNANCE_EVENT_REQUIRED'
  /** A recorded human decision (HUMAN_APPROVED, bound to the exact subject) must exist and be consumed. */
  | 'HUMAN_DECISION_REQUIRED'
  /** A runtime-recorded result (task completion: a runtime DECISION PASS). */
  | 'EXECUTION_RESULT_REQUIRED'
  | 'NONE';
export const EVIDENCE_REQUIREMENTS: readonly EvidenceRequirement[] = Object.freeze([
  'TRACE_REQUIRED', 'GOVERNANCE_EVENT_REQUIRED', 'HUMAN_DECISION_REQUIRED', 'EXECUTION_RESULT_REQUIRED', 'NONE'
] as EvidenceRequirement[]);

export type ProviderEnforcement = 'blocking' | 'observe-only' | 'none';
export const PROVIDER_ENFORCEMENTS: readonly ProviderEnforcement[] = Object.freeze(['blocking', 'observe-only', 'none'] as ProviderEnforcement[]);

/** How the runtime turns a tool's input into a risk classification (toolRisk.ts). */
/** 'intent' is the runtime's own evaluation of a proposed ACTION/REQUEST (intent boundary); it is RESERVED: a tool call
 *  that names it at PreToolUse is refused by the runtime. */
export type ToolClassifier = 'read' | 'write' | 'shell' | 'delegate' | 'mcp' | 'intent';
export const TOOL_CLASSIFIERS: readonly ToolClassifier[] = Object.freeze(['read', 'write', 'shell', 'delegate', 'mcp', 'intent'] as ToolClassifier[]);

/** The operation a classified call performs. Derived by the RUNTIME from the classification — never from the actor. */
export type Operation =
  | 'read' | 'read-secret' | 'delegate'
  | 'write' | 'sensitive-write' | 'governance-state'
  | 'inspect' | 'execute' | 'mutate' | 'high-impact'
  | 'invoke' | 'evaluate';
export const OPERATIONS: readonly Operation[] = Object.freeze([
  'read', 'read-secret', 'delegate', 'write', 'sensitive-write', 'governance-state', 'inspect', 'execute', 'mutate', 'high-impact', 'invoke', 'evaluate'
] as Operation[]);

const RANK: Readonly<Record<RiskLevel, number>> = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });
const MODE_RANK: Readonly<Record<GovernanceMode, number>> = Object.freeze({ AUTO: 0, SUPERVISED: 1, HUMAN_APPROVAL: 2, DENIED: 3 });

/** The stricter of two risks. */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel { return RANK[b] > RANK[a] ? b : a; }
/** The stricter of two governance modes. */
export function maxMode(a: GovernanceMode, b: GovernanceMode): GovernanceMode { return MODE_RANK[b] > MODE_RANK[a] ? b : a; }

// ─── the model ─────────────────────────────────────────────────────────────

export interface CapabilityDefinition {
  /** Stable technical id (ASCII `family.action`). Never a display name, a localized string or an agent name. */
  id: string;
  /** Baseline (minimum) risk. */
  risk: RiskLevel;
  /** Baseline (minimum) autonomy mode. */
  autonomy: AutonomyMode;
  /** The governance mode the capability runs under: its autonomy, or DENIED. */
  governanceMode: GovernanceMode;
  /** What must exist for a call of this capability to be legitimate (declared here; verified by the runtime). */
  evidence: readonly EvidenceRequirement[];
  /** May a call of this capability change task completion (tasks.json)? Then completionGate() judges it. */
  completionSensitive: boolean;
  /** A disabled capability is refused (CAPABILITY_DISABLED). */
  enabled: boolean;
}

export interface ProviderPolicy {
  /** Provider id (the AgentProvider value). */
  id: string;
  /** Can La Pitaya STOP this provider's tool calls? (v0.11 semantics, unchanged.) */
  enforcement: ProviderEnforcement;
  /** Its capability bridge to the runtime: 'native' (Claude settings → cth-hook), `hooks:<shim>`, `proxy:<api>`, or null. */
  bridge: string | null;
}

export interface ToolBinding {
  /** Exact tool name, or a prefix when `match` is 'prefix'. */
  tool: string;
  match: 'exact' | 'prefix';
  classifier: ToolClassifier;
  /** operation → capability id. An operation that is not listed resolves to CAPABILITY_UNKNOWN. */
  operations: Readonly<Partial<Record<Operation, string>>>;
}

export interface PolicyDefinition {
  version: number;
  capabilities: readonly CapabilityDefinition[];
  providers: readonly ProviderPolicy[];
  tools: readonly ToolBinding[];
}

// ─── the policy (v1): what the v0.15 runtime already enforced, made explicit ─

const TRACE_EVENT: readonly EvidenceRequirement[] = ['GOVERNANCE_EVENT_REQUIRED', 'TRACE_REQUIRED'];
const HUMAN: readonly EvidenceRequirement[] = ['GOVERNANCE_EVENT_REQUIRED', 'HUMAN_DECISION_REQUIRED', 'TRACE_REQUIRED'];

function cap(id: string, risk: RiskLevel, autonomy: AutonomyMode, evidence: readonly EvidenceRequirement[], completionSensitive: boolean): CapabilityDefinition {
  return { id, risk, autonomy, governanceMode: autonomy, evidence, completionSensitive, enabled: true };
}

const CAPABILITIES_V1: CapabilityDefinition[] = [
  // reading / analysis
  cap('filesystem.read', 'LOW', 'AUTO', TRACE_EVENT, false),
  cap('filesystem.read-secret', 'HIGH', 'HUMAN_APPROVAL', HUMAN, false),
  cap('web.fetch', 'LOW', 'AUTO', TRACE_EVENT, false),
  cap('agent.todo', 'LOW', 'AUTO', TRACE_EVENT, false),
  cap('agent.delegate', 'LOW', 'AUTO', TRACE_EVENT, false),
  // file mutation. Floor LOW: a doc or a hive-coordination write is LOW today and stays LOW; the classifier raises the
  // rest (code-change / config-change / generate-tests MEDIUM; secrets / infra / auth HIGH).
  cap('filesystem.write', 'LOW', 'AUTO', TRACE_EVENT, true),
  cap('filesystem.edit', 'LOW', 'AUTO', TRACE_EVENT, true),
  cap('filesystem.sensitive-write', 'HIGH', 'HUMAN_APPROVAL', HUMAN, true),
  // the machinery that enforces governance (hooks, settings, ledger, approvals, the policy code itself)
  cap('governance.state-write', 'HIGH', 'HUMAN_APPROVAL', HUMAN, true),
  // shell (the v0.11 classification is NOT redesigned: these are the outcomes it already produces)
  cap('shell.inspect', 'LOW', 'AUTO', TRACE_EVENT, true),
  cap('shell.execute', 'MEDIUM', 'SUPERVISED', TRACE_EVENT, true),
  cap('shell.mutation', 'MEDIUM', 'SUPERVISED', TRACE_EVENT, true),
  cap('shell.high-impact', 'HIGH', 'HUMAN_APPROVAL', HUMAN, true),
  // MCP: opaque external tools. MEDIUM floor — never LOW, never AUTO at the default stage.
  cap('mcp.tool', 'MEDIUM', 'SUPERVISED', TRACE_EVENT, true),
  // runtime-level capabilities (no tool binding reaches them; they label runtime facts on the ledger)
  cap('tasks.complete', 'HIGH', 'HUMAN_APPROVAL', ['GOVERNANCE_EVENT_REQUIRED', 'EXECUTION_RESULT_REQUIRED'], true),
  cap('governance.approval', 'HIGH', 'HUMAN_APPROVAL', ['GOVERNANCE_EVENT_REQUIRED', 'HUMAN_DECISION_REQUIRED'], false),
  cap('provider.spawn', 'HIGH', 'HUMAN_APPROVAL', ['GOVERNANCE_EVENT_REQUIRED', 'HUMAN_DECISION_REQUIRED'], false),
  // the intent boundary's evaluation of a proposed action (no execution: the executor's own call is re-authorized)
  cap('intent.evaluate', 'LOW', 'AUTO', ['GOVERNANCE_EVENT_REQUIRED'], false)
];

/** v0.11 provider classification, stated explicitly (cross-checked against the provider presets at validation). */
const PROVIDERS_V1: ProviderPolicy[] = [
  { id: 'claude', enforcement: 'blocking', bridge: 'native' },
  { id: 'codex', enforcement: 'blocking', bridge: 'hooks:codex' },
  { id: 'grok', enforcement: 'blocking', bridge: 'hooks:grok' },
  { id: 'gemini', enforcement: 'blocking', bridge: 'hooks:gemini' },
  { id: 'antigravity', enforcement: 'blocking', bridge: 'hooks:agy' },
  { id: 'qwen', enforcement: 'observe-only', bridge: 'proxy:openai' },
  { id: 'opencode', enforcement: 'observe-only', bridge: 'hooks:opencode' },
  { id: 'crush', enforcement: 'observe-only', bridge: 'proxy:openai' },
  { id: 'pi', enforcement: 'observe-only', bridge: 'hooks:pi' },
  { id: 'kimi', enforcement: 'none', bridge: null },
  { id: 'copilot', enforcement: 'none', bridge: null },
  { id: 'cursor', enforcement: 'none', bridge: null },
  { id: 'custom', enforcement: 'none', bridge: null }
];

const READ_OPS: Partial<Record<Operation, string>> = { read: 'filesystem.read', 'read-secret': 'filesystem.read-secret' };
const WRITE_OPS = (plain: string): Partial<Record<Operation, string>> =>
  ({ write: plain, 'sensitive-write': 'filesystem.sensitive-write', 'governance-state': 'governance.state-write' });
const SHELL_OPS: Partial<Record<Operation, string>> = {
  inspect: 'shell.inspect', execute: 'shell.execute', mutate: 'shell.mutation', 'high-impact': 'shell.high-impact', 'governance-state': 'governance.state-write'
};

function bind(tool: string, classifier: ToolClassifier, operations: Partial<Record<Operation, string>>): ToolBinding {
  return { tool, match: 'exact', classifier, operations };
}

/** The tool names the runtime has always recognised (v0.15 toolRisk.ts + cimaRuntime.ts) — now in ONE place. */
const TOOLS_V1: ToolBinding[] = [
  bind('Read', 'read', READ_OPS), bind('NotebookRead', 'read', READ_OPS),
  bind('Grep', 'read', READ_OPS), bind('Glob', 'read', READ_OPS), bind('LS', 'read', READ_OPS),
  bind('WebFetch', 'read', { read: 'web.fetch', 'read-secret': 'filesystem.read-secret' }),
  bind('WebSearch', 'read', { read: 'web.fetch', 'read-secret': 'filesystem.read-secret' }),
  bind('TodoWrite', 'read', { read: 'agent.todo', 'read-secret': 'filesystem.read-secret' }),
  bind('TodoRead', 'read', { read: 'agent.todo', 'read-secret': 'filesystem.read-secret' }),
  bind('Task', 'delegate', { delegate: 'agent.delegate' }),
  bind('Agent', 'delegate', { delegate: 'agent.delegate' }),
  bind('ExitPlanMode', 'delegate', { delegate: 'agent.delegate' }),
  bind('Write', 'write', WRITE_OPS('filesystem.write')),
  bind('Edit', 'write', WRITE_OPS('filesystem.edit')),
  bind('MultiEdit', 'write', WRITE_OPS('filesystem.edit')),
  bind('NotebookEdit', 'write', WRITE_OPS('filesystem.edit')),
  bind('Bash', 'shell', SHELL_OPS), bind('PowerShell', 'shell', SHELL_OPS),
  bind('shell', 'shell', SHELL_OPS), bind('run_shell_command', 'shell', SHELL_OPS),
  { tool: 'mcp__', match: 'prefix', classifier: 'mcp', operations: { invoke: 'mcp.tool', 'governance-state': 'governance.state-write' } },
  bind('intent', 'intent', { evaluate: 'intent.evaluate' })
];

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

export const DEFAULT_POLICY: PolicyDefinition = deepFreeze({
  version: CIMA_POLICY_VERSION, capabilities: CAPABILITIES_V1, providers: PROVIDERS_V1, tools: TOOLS_V1
});

/**
 * Source files that implement governance. Writing one (tool) or naming one in a mutating shell command is
 * governance-tamper (HIGH). ONE list, used by both the path and the shell classifier (toolRisk.ts).
 * v0.16 adds the registry itself and the v0.14/v0.15 binding and ledger code to the v0.11 list.
 */
export const GOVERNANCE_SOURCES: { readonly shared: readonly string[]; readonly main: readonly string[] } = deepFreeze({
  shared: ['autonomy', 'governance', 'toolRisk', 'cimaRuntime', 'providerGovernance', 'intent', 'policyRegistry', 'authSubject', 'governanceIntegrity'],
  main: ['hooks', 'cimaRuntime', 'intentBoundary', 'authBinding', 'ledgerChain', 'governanceStore']
});

// ─── validation ────────────────────────────────────────────────────────────

export interface PolicyValidation { ok: boolean; errors: string[] }

const CAP_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const PROVIDER_ID = /^[a-z][a-z0-9-]*$/;
const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** What the provider presets themselves imply (the v0.11 derivation) — used to detect a drifted declaration. */
export function derivedEnforcement(provider: string): ProviderEnforcement | null {
  const preset = AGENT_PROVIDER_PRESETS.find((p) => p.id === provider);
  if (!preset) return null;
  if (preset.hiveAware) return 'blocking';
  const bridge = bridgeOf(provider as AgentProvider);
  if (!bridge) return 'none';
  if (bridge.kind === 'proxy') return 'observe-only';
  return ['codex', 'agy', 'gemini', 'grok'].includes(bridge.shim) ? 'blocking' : 'observe-only';
}

/**
 * Validate a candidate policy. Detects duplicate capability / provider ids and tool bindings, invalid risk / autonomy /
 * governance mode / evidence, missing evidence policy, and conflicting definitions (a mode weaker than the risk
 * demands, a binding to a capability that does not exist, a provider that disagrees with its own bridge, …).
 */
export function validatePolicy(def: unknown): PolicyValidation {
  const errors: string[] = [];
  const e = (s: string): void => { errors.push(s); };
  if (!def || typeof def !== 'object') return { ok: false, errors: ['POLICY_NOT_AN_OBJECT'] };
  const p = def as Partial<PolicyDefinition>;
  if (!Number.isInteger(p.version) || (p.version as number) < 1) e('INVALID_VERSION');
  if (!Array.isArray(p.capabilities) || !p.capabilities.length) e('NO_CAPABILITIES');
  if (!Array.isArray(p.providers) || !p.providers.length) e('NO_PROVIDERS');
  if (!Array.isArray(p.tools) || !p.tools.length) e('NO_TOOLS');
  if (errors.length) return { ok: false, errors };

  const caps = new Map<string, CapabilityDefinition>();
  for (const c of p.capabilities as CapabilityDefinition[]) {
    const id = c && typeof c === 'object' ? c.id : undefined;
    if (typeof id !== 'string' || !CAP_ID.test(id)) { e(`INVALID_CAPABILITY_ID ${JSON.stringify(id)}`); continue; }
    if (caps.has(id)) e(`DUPLICATE_CAPABILITY ${id}`);
    const riskOk = RISK_LEVELS.includes(c.risk);
    const autoOk = AUTONOMY_MODES.includes(c.autonomy);
    const modeOk = GOVERNANCE_MODES.includes(c.governanceMode);
    if (!riskOk) e(`INVALID_RISK ${id}: ${JSON.stringify(c.risk)}`);
    if (!autoOk) e(`INVALID_AUTONOMY ${id}: ${JSON.stringify(c.autonomy)}`);
    if (!modeOk) e(`INVALID_GOVERNANCE_MODE ${id}: ${JSON.stringify(c.governanceMode)}`);
    const evOk = Array.isArray(c.evidence) && c.evidence.length > 0;
    if (!evOk) e(`MISSING_EVIDENCE_POLICY ${id}`);
    else {
      for (const r of c.evidence) if (!EVIDENCE_REQUIREMENTS.includes(r)) e(`INVALID_EVIDENCE ${id}: ${JSON.stringify(r)}`);
      if (c.evidence.includes('NONE') && c.evidence.length > 1) e(`CONFLICT ${id}: evidence NONE combined with requirements`);
    }
    if (typeof c.completionSensitive !== 'boolean') e(`INVALID_COMPLETION_FLAG ${id}`);
    if (typeof c.enabled !== 'boolean') e(`INVALID_ENABLED_FLAG ${id}`);
    if (riskOk && autoOk) {
      // Monotonicity at definition time: HIGH is human-approved, MEDIUM is at least supervised.
      if (c.risk === 'HIGH' && c.autonomy !== 'HUMAN_APPROVAL') e(`CONFLICT ${id}: HIGH risk with autonomy ${c.autonomy}`);
      if (c.risk === 'MEDIUM' && c.autonomy === 'AUTO') e(`CONFLICT ${id}: MEDIUM risk with autonomy AUTO`);
      if (modeOk && c.governanceMode !== 'DENIED' && c.governanceMode !== c.autonomy) {
        e(`CONFLICT ${id}: governanceMode ${c.governanceMode} disagrees with autonomy ${c.autonomy}`);
      }
      if (evOk && c.autonomy === 'HUMAN_APPROVAL' && !c.evidence.includes('HUMAN_DECISION_REQUIRED') && !c.evidence.includes('EXECUTION_RESULT_REQUIRED')) {
        e(`CONFLICT ${id}: HUMAN_APPROVAL without a human-decision or execution-result evidence requirement`);
      }
    }
    caps.set(id, c);
  }

  const providers = new Set<string>();
  for (const pr of p.providers as ProviderPolicy[]) {
    const id = pr && typeof pr === 'object' ? pr.id : undefined;
    if (typeof id !== 'string' || !PROVIDER_ID.test(id)) { e(`INVALID_PROVIDER_ID ${JSON.stringify(id)}`); continue; }
    if (providers.has(id)) e(`DUPLICATE_PROVIDER ${id}`);
    providers.add(id);
    if (!PROVIDER_ENFORCEMENTS.includes(pr.enforcement)) { e(`INVALID_ENFORCEMENT ${id}: ${JSON.stringify(pr.enforcement)}`); continue; }
    const derived = derivedEnforcement(id);
    if (derived === null) e(`CONFLICT provider ${id}: no such provider preset`);
    else if (derived !== pr.enforcement) e(`CONFLICT provider ${id}: declared ${pr.enforcement}, its bridge makes it ${derived}`);
    if (pr.enforcement === 'none' && pr.bridge !== null) e(`CONFLICT provider ${id}: enforcement none with a bridge`);
    if (pr.enforcement !== 'none' && (typeof pr.bridge !== 'string' || !pr.bridge)) e(`CONFLICT provider ${id}: enforcement ${pr.enforcement} without a bridge`);
  }
  for (const preset of AGENT_PROVIDER_PRESETS) if (!providers.has(preset.id)) e(`MISSING_PROVIDER ${preset.id}`);

  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const t of p.tools as ToolBinding[]) {
    const name = t && typeof t === 'object' ? t.tool : undefined;
    if (typeof name !== 'string' || !TOOL_NAME.test(name)) { e(`INVALID_TOOL ${JSON.stringify(name)}`); continue; }
    if (t.match !== 'exact' && t.match !== 'prefix') e(`INVALID_TOOL_MATCH ${name}`);
    if (!TOOL_CLASSIFIERS.includes(t.classifier)) e(`INVALID_CLASSIFIER ${name}: ${JSON.stringify(t.classifier)}`);
    if (t.match === 'prefix') {
      if (prefixes.includes(name)) e(`DUPLICATE_TOOL_BINDING ${name}`);
      else if (prefixes.some((x) => x.startsWith(name) || name.startsWith(x))) e(`CONFLICT tool prefix ${name} overlaps another prefix`);
      prefixes.push(name);
    } else {
      if (exact.has(name)) e(`DUPLICATE_TOOL_BINDING ${name}`);
      exact.add(name);
    }
    const ops = t.operations && typeof t.operations === 'object' ? Object.entries(t.operations) : [];
    if (!ops.length) e(`MISSING_OPERATIONS ${name}`);
    for (const [op, capId] of ops) {
      if (!OPERATIONS.includes(op as Operation)) e(`INVALID_OPERATION ${name}: ${op}`);
      if (typeof capId !== 'string' || !caps.has(capId)) e(`CONFLICT tool ${name}: operation ${op} → unknown capability ${JSON.stringify(capId)}`);
    }
  }
  for (const name of exact) {
    if (prefixes.some((x) => name.startsWith(x))) e(`CONFLICT tool ${name}: exact binding shadowed by a prefix binding`);
  }
  return { ok: errors.length === 0, errors };
}

// ─── the registry (read-only view over ONE validated policy) ───────────────

export type ResolutionCode = 'POLICY_INVALID' | 'PROVIDER_UNKNOWN' | 'TOOL_UNKNOWN' | 'CAPABILITY_UNKNOWN' | 'CAPABILITY_DISABLED';

export type CapabilityResolution =
  | { ok: true; capability: CapabilityDefinition; operation: Operation; binding: ToolBinding; provider: ProviderPolicy | null; policyVersion: number }
  | { ok: false; code: ResolutionCode; detail: string; policyVersion: number };

export interface ResolveContext {
  /** The agent's provider as the RUNTIME knows it (hive registry). null/undefined = unattributed (legacy record). */
  provider?: string | null;
  tool: string;
  /** The operation the runtime derived from the classified call (toolRisk.operationOf). */
  operation: Operation;
}

export interface PolicyRegistry {
  readonly version: number;
  readonly valid: boolean;
  readonly errors: readonly string[];
  getCapability(id: string): CapabilityDefinition | null;
  listCapabilities(): readonly CapabilityDefinition[];
  getProviderPolicy(provider: string): ProviderPolicy | null;
  getToolPolicy(tool: string): ToolBinding | null;
  resolveCapability(ctx: ResolveContext): CapabilityResolution;
}

/** Structural copy of plain policy data (no prototypes, no accessors) so the registry owns what it freezes. */
function plainCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Build a registry over a policy. An invalid policy yields a registry that refuses EVERYTHING (POLICY_INVALID). */
export function createPolicyRegistry(def: unknown): PolicyRegistry {
  let copy: PolicyDefinition | null = null;
  let validation: PolicyValidation;
  try {
    copy = deepFreeze(plainCopy(def as PolicyDefinition));
    validation = validatePolicy(copy);
  } catch (err) {
    copy = null;
    validation = { ok: false, errors: [`UNREADABLE_POLICY ${String(err).slice(0, 120)}`] };
  }
  const valid = validation.ok && copy !== null;
  const version = copy && Number.isInteger(copy.version) ? copy.version : 0;
  const caps = new Map<string, CapabilityDefinition>(valid ? copy!.capabilities.map((c) => [c.id, c] as const) : []);
  const providers = new Map<string, ProviderPolicy>(valid ? copy!.providers.map((x) => [x.id, x] as const) : []);
  const exact = new Map<string, ToolBinding>(valid ? copy!.tools.filter((t) => t.match === 'exact').map((t) => [t.tool, t] as const) : []);
  const prefixes: readonly ToolBinding[] = valid ? copy!.tools.filter((t) => t.match === 'prefix') : [];
  const list = Object.freeze([...caps.values()]);
  const errors = Object.freeze([...validation.errors]);

  const getToolPolicy = (tool: string): ToolBinding | null => {
    if (typeof tool !== 'string' || !tool) return null;
    const hit = exact.get(tool);
    if (hit) return hit;
    // A prefix binding needs a name after the prefix (`mcp__` alone names no tool).
    return prefixes.find((b) => tool.startsWith(b.tool) && tool.length > b.tool.length) ?? null;
  };

  const registry: PolicyRegistry = {
    version,
    valid,
    errors,
    getCapability: (id) => (typeof id === 'string' ? caps.get(id) ?? null : null),
    listCapabilities: () => list,
    getProviderPolicy: (provider) => (typeof provider === 'string' ? providers.get(provider) ?? null : null),
    getToolPolicy,
    resolveCapability(ctx) {
      const pv = version;
      if (!valid) return { ok: false, code: 'POLICY_INVALID', detail: `governance policy v${pv} failed validation: ${errors.slice(0, 3).join('; ')}`, policyVersion: pv };
      let provider: ProviderPolicy | null = null;
      if (ctx.provider !== null && ctx.provider !== undefined) {
        provider = typeof ctx.provider === 'string' ? providers.get(ctx.provider) ?? null : null;
        if (!provider) return { ok: false, code: 'PROVIDER_UNKNOWN', detail: `provider ${JSON.stringify(String(ctx.provider)).slice(0, 60)} is not in governance policy v${pv}`, policyVersion: pv };
      }
      const binding = getToolPolicy(ctx.tool);
      if (!binding) return { ok: false, code: 'TOOL_UNKNOWN', detail: `tool ${JSON.stringify(String(ctx.tool)).slice(0, 80)} is not in governance policy v${pv}`, policyVersion: pv };
      const capId = binding.operations[ctx.operation];
      const capability = capId ? caps.get(capId) ?? null : null;
      if (!capability) return { ok: false, code: 'CAPABILITY_UNKNOWN', detail: `no capability for ${ctx.tool} / ${String(ctx.operation)} in governance policy v${pv}`, policyVersion: pv };
      if (!capability.enabled) return { ok: false, code: 'CAPABILITY_DISABLED', detail: `capability ${capability.id} is disabled in governance policy v${pv}`, policyVersion: pv };
      return { ok: true, capability, operation: ctx.operation, binding, provider, policyVersion: pv };
    }
  };
  return Object.freeze(registry);
}

/** The registry the runtime uses: built ONCE, at module load, from the policy in code. */
export const POLICY_REGISTRY: PolicyRegistry = createPolicyRegistry(DEFAULT_POLICY);
