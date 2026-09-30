/**
 * La Pitaya agent roster — who the team is, independent of the runtime.
 *
 * The upstream runtime has exactly one built-in agent (the orchestrator, "god")
 * plus agents the human hires at will. La Pitaya does NOT replace that engine:
 *
 *   - El Inge IS the god. Only its default name changes (godIdentity.ts); the
 *     spawn path, hive protocol and rename support are untouched.
 *   - Valentin, El Beni, Margarito, Jose Juan and El Tutu are ROLE PRESETS on
 *     top of the existing hire flow (Add Agent → La Pitaya team). Picking one
 *     pre-fills name, sprite, description and goal; the human still reviews the
 *     command and clicks spawn, exactly like any other hire.
 *   - Alicia is a NEW capability (AI companion), not a hive worker. Her boundary
 *     lives in ./alicia.ts and she is not spawned in this phase.
 *
 * Names are identity, never translated. The only locale difference is spelling:
 * es-MX keeps the accents, en-US uses the exact ASCII form.
 */

import type { CimaPhase } from './cima';
import { isEnglish, toAscii } from './locales';

export type LaPitayaAgentId =
  | 'el-inge' | 'valentin' | 'el-beni' | 'margarito' | 'jose-juan' | 'el-tutu' | 'alicia';

export type LaPitayaRole =
  | 'orchestrator' | 'architect' | 'builder' | 'tester' | 'auditor' | 'learner' | 'companion';

/** How an agent exists at runtime. */
export type AgentRuntimeKind =
  /** The hive's built-in orchestrator (`isGod`). Auto-spawned. */
  | 'god'
  /** A hireable role preset for the existing Add-Agent flow. */
  | 'hire-preset'
  /** Not a hive agent — a La Pitaya capability with its own boundary. */
  | 'capability';

export interface LaPitayaAgent {
  id: LaPitayaAgentId;
  /** Canonical spelling with diacritics (the es-MX form). */
  name: string;
  role: LaPitayaRole;
  /** Stable English role label, e.g. "Primary Orchestrator". Not localized
   *  here — the UI localizes via i18n key `lapitaya.roles.<role>`. */
  roleLabel: string;
  runtime: AgentRuntimeKind;
  /** The CIMA phases this agent owns. */
  cimaPhases: readonly CimaPhase[];
  /** Upstream concept this maps from (documentation + migration trail). */
  upstream: string;
  /** Office sprite id this agent wears (scene/office/cast.ts). */
  character?: string;
  /** Hire presets only: the one-line role and standing goal handed to the agent.
   *  English on purpose — they are agent prompts; agentLocale adds a language line. */
  description?: string;
  goal?: string;
}

const HARD_RULES =
  'CIMA rules: Builder != Auditor (never approve your own work). Evidence First (no PASS without ' +
  'command output, exit codes or test results, quoted verbatim). Human Governance (production, ' +
  'security, auth, permissions, infrastructure, destructive migrations and data deletion need explicit ' +
  'human approval — ask El Inge to escalate).';

export const LA_PITAYA_AGENTS: readonly LaPitayaAgent[] = [
  {
    id: 'el-inge',
    name: 'El Inge',
    role: 'orchestrator',
    roleLabel: 'Primary Orchestrator',
    runtime: 'god',
    cimaPhases: ['CONTEXT', 'DECISION', 'ITERATE'],
    upstream: 'Michael / god / orchestrator (isGod)',
    character: 'michael'
  },
  {
    id: 'valentin',
    name: 'Valentín',
    role: 'architect',
    roleLabel: 'Architect',
    runtime: 'hire-preset',
    cimaPhases: ['ARCHITECT'],
    upstream: 'new role (hire preset)',
    character: 'oscar',
    description: 'Architect — scopes work, designs the change, sets acceptance criteria',
    goal:
      'For every request routed to you: study the code and context READ-ONLY, define scope, propose the ' +
      'smallest sound design, list risks, and write explicit acceptance criteria. Hand the plan to El Beni ' +
      'through El Inge. Do not modify code yourself. ' + HARD_RULES
  },
  {
    id: 'el-beni',
    name: 'El Beni',
    role: 'builder',
    roleLabel: 'Builder',
    runtime: 'hire-preset',
    cimaPhases: ['BUILD'],
    upstream: 'new role (hire preset)',
    character: 'jim',
    description: 'Builder — implements the authorized scope and delivers evidence',
    goal:
      'Implement exactly the scope Valentin approved — nothing more. Run the relevant build/typecheck/tests, ' +
      'attach the raw output and exit codes as evidence, then hand off to Margarito (test) and Jose Juan ' +
      '(audit) through El Inge. You cannot approve your own work. ' + HARD_RULES
  },
  {
    id: 'margarito',
    name: 'Margarito',
    role: 'tester',
    roleLabel: 'Tester',
    runtime: 'hire-preset',
    cimaPhases: ['TEST'],
    upstream: 'new role (hire preset)',
    character: 'dwight',
    description: 'Tester — verifies behavior, writes tests, finds regressions',
    goal:
      'For every change handed to you: run the existing tests, add tests where coverage is missing, verify ' +
      'the acceptance criteria, compare against the baseline for regressions, and record verbatim evidence. ' +
      'Report results; do not give final approval. ' + HARD_RULES
  },
  {
    id: 'jose-juan',
    name: 'José Juan',
    role: 'auditor',
    roleLabel: 'Auditor',
    runtime: 'hire-preset',
    cimaPhases: ['AUDIT'],
    upstream: 'new role (hire preset)',
    character: 'angela',
    description: 'Auditor — independent review of security, architecture, quality and evidence',
    goal:
      'Independently inspect each change: security, architecture, quality, regressions, contract compliance ' +
      'and whether the evidence actually supports the claims. Produce structured findings ' +
      '(severity, file:line, failure scenario, recommendation). NEVER modify the code you audit. ' + HARD_RULES
  },
  {
    id: 'el-tutu',
    name: 'El Tutú',
    role: 'learner',
    roleLabel: 'Learner',
    runtime: 'hire-preset',
    cimaPhases: ['LEARN', 'DECISION'],
    upstream: 'new role (hire preset)',
    character: 'kevin',
    description: 'Learner — consolidates evidence and findings into lessons and a Decision Candidate',
    goal:
      'After each CIMA cycle: consolidate the evidence and findings, classify them, extract lessons into ' +
      'memory, record open uncertainties, and produce a Decision Candidate (proceed / iterate / escalate) ' +
      'for El Inge and the human. Never take an irreversible decision yourself. ' + HARD_RULES
  },
  {
    id: 'alicia',
    name: 'Alicia',
    role: 'companion',
    roleLabel: 'AI Companion',
    runtime: 'capability',
    cimaPhases: [],
    upstream: 'new capability (not a replacement for any upstream agent)'
  }
];

export const LA_PITAYA_AGENT_BY_ID: Readonly<Record<LaPitayaAgentId, LaPitayaAgent>> =
  Object.fromEntries(LA_PITAYA_AGENTS.map((a) => [a.id, a])) as Record<LaPitayaAgentId, LaPitayaAgent>;

/** The orchestrator's default name — godIdentity.ts re-exports this. */
export const EL_INGE_NAME = LA_PITAYA_AGENT_BY_ID['el-inge'].name;

/** The agents the human can hire from the Add-Agent modal, in CIMA order. */
export const LA_PITAYA_HIRE_PRESETS: readonly LaPitayaAgent[] =
  LA_PITAYA_AGENTS.filter((a) => a.runtime === 'hire-preset');

/**
 * An agent's display name for a locale. es-MX (and any non-English locale)
 * keeps the canonical accented spelling; en-US drops diacritics
 * (Valentín → Valentin, José Juan → Jose Juan, El Tutú → El Tutu).
 */
export function agentDisplayName(id: LaPitayaAgentId, locale: string | null | undefined): string {
  const name = LA_PITAYA_AGENT_BY_ID[id].name;
  return isEnglish(locale) ? toAscii(name) : name;
}

/** Which La Pitaya agent wears a given office sprite, if any. */
export function agentForCharacter(character: string | null | undefined): LaPitayaAgent | undefined {
  return character ? LA_PITAYA_AGENTS.find((a) => a.character === character) : undefined;
}

/** Find a La Pitaya agent by a typed name in either spelling, case-insensitive. */
export function agentByName(name: string | null | undefined): LaPitayaAgent | undefined {
  const q = toAscii(name?.trim() ?? '').toLowerCase();
  if (!q) return undefined;
  return LA_PITAYA_AGENTS.find((a) => toAscii(a.name).toLowerCase() === q);
}

/** The line appended to a hire preset's goal so the agent writes in agentLocale.
 *  Evidence (command output, logs, code) is always quoted verbatim. */
export function agentLanguageDirective(agentLocale: string | null | undefined): string {
  if (!agentLocale || isEnglish(agentLocale)) return '';
  return ` Write your messages and reports in ${agentLocale}; quote commands, code, logs and test output verbatim, untranslated.`;
}
