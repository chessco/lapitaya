/**
 * Tool-call risk classifier — turns ONE concrete tool call an agent is about to
 * make (tool name + input, as the CLI's PreToolUse hook reports it) into an
 * ActionCategory and a RiskLevel.
 *
 * This is the "risk classification" step of the runtime boundary:
 *
 *   PreToolUse ─▶ classifyToolCall ─▶ authorizeToolCall (governance.ts) ─▶ allow / supervise / deny
 *
 * Deliberately a small, explicit rule table, not a model: every decision must
 * be explainable in the audit log and reproducible in a test. When in doubt the
 * rules err UP (an unknown tool is HIGH; an unrecognized shell command is
 * MEDIUM and never LOW).
 *
 * Pure: no fs, no process — main, renderer and tests share it.
 */

import { ACTION_RISK, type ActionCategory, type RiskLevel } from './autonomy';
import { canonicalizePath, isInside, type CanonicalPath } from './authSubject';
import { GOVERNANCE_SOURCES, POLICY_REGISTRY, type Operation, type ToolClassifier } from './policyRegistry';

export interface ToolCallContext {
  /** Absolute hive root (`<harnessHome>/hive`). Writes inside it are hive
   *  coordination, except the governance files listed below. */
  hiveRoot?: string | null;
  /** v0.14: the agent's working directory, so a relative path has one meaning. */
  cwd?: string | null;
  /** v0.14: realpath-aware canonicalizer supplied by main (symlinks, junctions, 8.3 names).
   *  Without it the pure lexical canonicalization is used. */
  resolvePath?: (raw: string) => CanonicalPath;
}

export interface ToolRisk {
  category: ActionCategory;
  risk: RiskLevel;
  /** One line describing the call, for logs and the approval prompt. */
  summary: string;
  /** Which rule fired — kept for the audit trail. */
  rule: string;
}

// v0.16: WHICH tools exist and how each one is classified is policy — it lives in the registry (policyRegistry.ts).
// This file keeps HOW a call's input is judged (paths, shell text): the classification rules themselves.

/** The classifier the policy binds a tool to, or null for a tool the policy does not know. */
export function classifierOf(tool: string): ToolClassifier | null {
  return POLICY_REGISTRY.getToolPolicy(tool)?.classifier ?? null;
}

/** v0.16: a shell tool, per the policy (Bash, PowerShell, shell, run_shell_command). */
export function isShellTool(tool: string): boolean {
  return classifierOf(tool) === 'shell';
}

/** v0.16: a file-writing tool, per the policy (Write, Edit, MultiEdit, NotebookEdit). */
export function isWriteTool(tool: string): boolean {
  return classifierOf(tool) === 'write';
}

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

function inputOf(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function result(category: ActionCategory, summary: string, rule: string): ToolRisk {
  return { category, risk: ACTION_RISK[category], summary: summary.slice(0, 300), rule };
}

// ─── paths ──────────────────────────────────────────────────────────────────

const SECRET_PATH = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|credentials(\.json)?|secrets?(\.[a-z]+)?|\.npmrc|\.netrc)$/;
const INFRA_PATH = /(^|\/)(\.github\/workflows\/|terraform\/|infra\/|k8s\/|kubernetes\/|helm\/)|\.tf$|(^|\/)(dockerfile|docker-compose[^/]*\.ya?ml)$/;
const AUTH_PATH = /(^|\/)(auth|authentication|authorization|permissions?|rbac|acl)(\/|\.|-|_)/;
/** Files that implement governance itself. An agent editing these could turn
 *  its own guard off, so they are HIGH no matter who asks. */
const GOV_SHARED = GOVERNANCE_SOURCES.shared.map((n) => n.toLowerCase()).join('|');
const GOV_MAIN = GOVERNANCE_SOURCES.main.map((n) => n.toLowerCase()).join('|');
const GOVERNANCE_PATH = new RegExp(`(^|\\/)(\\.claude\\/settings[^/]*\\.json|src\\/shared\\/lapitaya\\/(${GOV_SHARED})\\.ts|src\\/main\\/(${GOV_MAIN})\\.ts|src\\/shared\\/agentprovider\\.ts)$`);
/** Inside the hive: the harness-owned files an agent must not rewrite. */
const HIVE_GOVERNANCE = /(^|\/)(bin\/|lapitaya\/|registry\.json$|agents\/[^/]+\/(settings\.json|identity\.md|cursor\.json)$)/;
const DOC_PATH = /\.(md|mdx|txt|rst|adoc)$/;
const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const CONFIG_PATH = /\.(json|ya?ml|toml|ini|cfg|conf)$|(^|\/)\.[a-z]+rc(\.[a-z]+)?$/;

/** v0.14: every canonical meaning a path may have. A path the caller can resolve to ONE object
 *  (absolute, or relative with a known cwd, or a main-side resolver) has one candidate; a relative
 *  path with no known base is judged as itself AND as if it sat in the hive, and the stricter
 *  reading wins — an actor cannot pick the spelling that gets the lighter classification. */
function pathCandidates(path: string, ctx: ToolCallContext): CanonicalPath[] {
  const first = ctx.resolvePath ? ctx.resolvePath(path) : canonicalizePath(path, { base: ctx.cwd ?? null });
  if (first.absolute || first.ambiguous || !ctx.hiveRoot) return [first];
  const root = ctx.resolvePath ? ctx.resolvePath(ctx.hiveRoot) : canonicalizePath(ctx.hiveRoot);
  if (root.ambiguous || !root.absolute) return [first];
  return [first, canonicalizePath(path, { base: root.display })];
}

function hiveRootKey(ctx: ToolCallContext): string | null {
  if (!ctx.hiveRoot) return null;
  const c = ctx.resolvePath ? ctx.resolvePath(ctx.hiveRoot) : canonicalizePath(ctx.hiveRoot);
  return c.ambiguous || !c.absolute ? null : c.key.replace(/\/+$/, '');
}

const RISK_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function stricter(a: ToolRisk | null, b: ToolRisk): ToolRisk {
  if (!a) return b;
  if (RISK_RANK[b.risk] !== RISK_RANK[a.risk]) return RISK_RANK[b.risk] > RISK_RANK[a.risk] ? b : a;
  return b.category === 'governance-tamper' ? b : a;
}

function classifyCanonicalWrite(path: string, c: CanonicalPath, ctx: ToolCallContext): ToolRisk {
  if (c.ambiguous) return result('governance-tamper', `write ambiguous path ${path} (${c.reason})`, 'path-ambiguous');
  const p = c.key;
  const root = hiveRootKey(ctx);
  if (root && isInside(p, root)) {
    const rel = p === root ? '' : p.slice(root.length + 1);
    if (rel === '' || HIVE_GOVERNANCE.test(rel)) return result('governance-tamper', `write hive governance file ${path}`, 'hive-governance-path');
    return result('hive-coordination', `write hive file ${path}`, 'hive-path');
  }
  if (GOVERNANCE_PATH.test(p)) return result('governance-tamper', `write governance file ${path}`, 'governance-path');
  if (SECRET_PATH.test(p)) return result('secrets', `write secret-bearing file ${path}`, 'secret-path');
  if (INFRA_PATH.test(p)) return result('infrastructure', `write infrastructure file ${path}`, 'infra-path');
  if (AUTH_PATH.test(p)) return result('auth', `write auth/permission code ${path}`, 'auth-path');
  if (DOC_PATH.test(p)) return result('documentation', `write documentation ${path}`, 'doc-path');
  if (TEST_PATH.test(p)) return result('generate-tests', `write test ${path}`, 'test-path');
  if (CONFIG_PATH.test(p)) return result('config-change', `write config ${path}`, 'config-path');
  return result('code-change', `write ${path}`, 'code-path');
}

/** Classify a path an agent is about to WRITE. The path is canonicalized FIRST (v0.14). */
export function classifyWritePath(path: string, ctx: ToolCallContext = {}): ToolRisk {
  let out: ToolRisk | null = null;
  for (const c of pathCandidates(path, ctx)) out = stricter(out, classifyCanonicalWrite(path, c, ctx));
  return out!;
}

/** Classify a path an agent is about to READ. Only secrets are sensitive. The raw spelling and
 *  every canonical meaning are all checked, so `a/../.env` is the secret it is. */
export function classifyReadPath(path: string, ctx: ToolCallContext = {}): ToolRisk {
  const keys = [norm(path), ...pathCandidates(path, ctx).filter((c) => !c.ambiguous).map((c) => c.key)];
  if (keys.some((k) => SECRET_PATH.test(k))) return result('secrets', `read secret-bearing file ${path}`, 'secret-path');
  return result('read-code', `read ${path}`, 'read');
}

// ─── shell ──────────────────────────────────────────────────────────────────

/** HIGH shell patterns, checked against the WHOLE command (pipes included). */
const HIGH_SHELL: Array<[RegExp, ActionCategory, string]> = [
  [/\b(rm\s+-[a-z]*r[a-z]*f?|rm\s+-[a-z]*f[a-z]*r|rmdir\s+\/s|del\s+\/[sq]|remove-item\b[^|;&]*-recurse|rd\s+\/s)\b/i, 'data-deletion', 'recursive-delete'],
  [/\bfind\b[^\n;&]*-(delete|exec|execdir|ok|okdir)\b/i, 'data-deletion', 'find-destructive'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*[fd]|branch\s+-D|push\b[^|;&]*(--force|-f\b|--delete|:))/i, 'data-deletion', 'git-destructive'],
  [/\bgit\s+push\b/i, 'irreversible', 'git-push'],
  [/\b(drop\s+(table|database|schema|index)|truncate\s+(table\s+)?\w|delete\s+from\s+\w)/i, 'destructive-migration', 'sql-destructive'],
  [/\b(migrate(:|\s+)(reset|drop|fresh|rollback|down|refresh)|db:(drop|reset|wipe)|prisma\s+migrate\s+reset|prisma\s+db\s+push\b[^|;&]*--accept-data-loss|destructive[-_ ]migration)|(^|\s)--(drop-all[\w-]*|drop-tables?|drop-database|force-drop)\b/i, 'destructive-migration', 'migration-destructive'],
  [/\b(terraform\s+(apply|destroy|import)|kubectl\s+(apply|delete|create|replace|patch|scale|rollout)|helm\s+(install|upgrade|uninstall|delete|rollback)|docker\s+(push|system\s+prune)|pulumi\s+(up|destroy))\b/i, 'infrastructure', 'infra-cli'],
  [/\b(aws|gcloud|az)\s+\S+\s+(create|delete|update|put|deploy|terminate|remove|set)/i, 'infrastructure', 'cloud-cli'],
  [/\b(npm\s+publish|yarn\s+publish|pnpm\s+publish|vercel\b[^|;&]*--prod|netlify\s+deploy\b[^|;&]*--prod|firebase\s+deploy|fly\s+deploy|heroku\s+\S*deploy|cap\s+production|--env[= ]prod(uction)?\b|deploy\b[^|;&]*\bprod(uction)?\b)/i, 'production', 'production'],
  [/\b(chmod|chown|chgrp|icacls|takeown|setfacl|sudo|runas)\b/i, 'permissions', 'permissions'],
  [/\b(curl|wget|iwr|invoke-webrequest)\b[^;&]*\|\s*(sh|bash|zsh|iex|invoke-expression|powershell|pwsh)\b/i, 'irreversible', 'remote-code-exec'],
  [/\b(shutdown|reboot|mkfs|format\s+[a-z]:|diskpart|dd\s+if=)/i, 'irreversible', 'system'],
  [/(^|[\s"'=/\\])(\.env(\.[a-z]+)?|id_rsa|id_ed25519|credentials\.json|\.npmrc|\.netrc)\b/i, 'secrets', 'secret-reference']
];

/** LOW shell commands — read-only inspection and test/build/typecheck runners.
 *  Matched per segment (a compound command is LOW only if EVERY segment is). */
const LOW_SHELL: Array<[RegExp, ActionCategory]> = [
  [/^(cd|pwd|ls|dir|tree|cat|type|head|tail|less|more|wc|file|stat|du|df|echo|printf|which|where|whoami|date|find|grep|rg|ag|sort|uniq|cut|jq|diff|cmp|sed\s+-n|awk\s+'[^']*print)\b/i, 'read-code'],
  [/^git\s+(status|diff|log|show|branch(\s+-[avr]+)?\s*$|rev-parse|ls-files|blame|describe|remote\s+-v|stash\s+list|config\s+--get)\b/i, 'read-code'],
  [/^(npm|pnpm|yarn)\s+(test|t)\b|^(npm|pnpm|yarn)\s+run\s+(test[\w:-]*|typecheck[\w:-]*|check[\w:-]*)\b|^node\s+--test\b|^npx\s+(tsc|vitest|jest|mocha)\b|^(pytest|jest|vitest|mocha|go\s+test|cargo\s+test|dotnet\s+test)\b/i, 'run-tests'],
  [/^(npm|pnpm|yarn)\s+run\s+(lint[\w:-]*)\b|^npx\s+(eslint|prettier\s+--check)\b|^(eslint|ruff|flake8|pylint)\b/i, 'lint'],
  [/^(npm|pnpm|yarn)\s+run\s+build\b|^(tsc|npx\s+tsc)\b/i, 'static-analysis'],
  [/^(node|npm|npx)\s+(-v|--version)\b|^git\s+--version\b/i, 'analysis']
];

/** Governance state files, as a shell command would name them. */
const GOVERNANCE_STATE_REF = new RegExp(
  `(tasks\\.json|registry\\.json|cima-ledger\\.jsonl|traces\\.jsonl|approvals\\.json|hive[\\\\/]lapitaya[\\\\/]|agents[\\\\/][^\\\\/\\s"']+[\\\\/]settings\\.json|\\.claude[\\\\/]settings[^\\\\/\\s"']*\\.json|(cth|agy|gemini|grok)-hook|lapitaya[\\\\/](${GOV_SHARED})\\.ts|main[\\\\/](${GOV_MAIN})\\.ts)`, 'i');

/** Split a shell command into its sequential segments (&&, ||, ;, |, newlines). */
export function shellSegments(command: string): string[] {
  return command.split(/\s*(?:&&|\|\||;|\||\r?\n)\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Shell redirection, command substitution, file mutation, or destructive find options. */
const SHELL_MUTATION_OP = /(>|>>|1>|2>|>&|\|&|\$\(|\b(tee|cp|mv|rm|touch|truncate|dd)\b|\bfind\b[^\n;&]*-(delete|exec|execdir|ok|okdir)\b|`[^`]+`)/i;

/** v0.14: a shell command mutates, as far as its text says (redirection, tee, cp, mv, rm, touch, …). */
export function isShellMutation(command: string): boolean {
  return SHELL_MUTATION_OP.test(command);
}

const AGENT_DIR_ID = '([^/\\s"\'`=;|&<>()]+)';
const FOREIGN_DIR_PATTERNS: readonly RegExp[] = [
  new RegExp(`agents/${AGENT_DIR_ID}/(?:outbox|inbox)\\b`, 'gi'),
  new RegExp(`\\.\\./${AGENT_DIR_ID}/(?:outbox|inbox)\\b`, 'gi')
];

/**
 * v0.14 sender authenticity (lexical, shell side): the ids of OTHER agents whose outbox/inbox a command
 * names, after separators and `x/..` hops are folded. An agent sends only through its own outbox, so
 * a mutating command that names someone else's is a forged sender. Variables (`$D/outbox`) cannot be
 * resolved here — see docs, remaining risks.
 */
export function foreignAgentDirsInCommand(command: string, selfId: string): string[] {
  const text = command.replace(/\\/g, '/');
  const folded = (() => {
    let t = text;
    for (let i = 0; i < 20; i++) {
      const n = t.replace(/[^/\s"'`=;|&<>()]+\/\.\.(?=\/|\s|$|["'`])/g, '');
      if (n === t) break;
      t = n;
    }
    return t;
  })();
  const self = selfId.trim().toLowerCase();
  const found = new Set<string>();
  for (const t of [text, folded]) {
    for (const re of FOREIGN_DIR_PATTERNS) {
      re.lastIndex = 0;
      for (let m = re.exec(t); m; m = re.exec(t)) {
        const id = m[1].toLowerCase();
        if (id === self || /^[$%~.]/.test(id)) continue;
        found.add(id);
      }
    }
  }
  return [...found];
}

export function classifyShell(command: string): ToolRisk {
  const cmd = command.trim();
  for (const [re, category, rule] of HIGH_SHELL) {
    if (re.test(cmd)) return result(category, `run: ${cmd}`, `shell:${rule}`);
  }
  const isMutating = SHELL_MUTATION_OP.test(cmd);
  if (isMutating && GOVERNANCE_STATE_REF.test(cmd)) {
    return result('governance-tamper', `run: ${cmd}`, 'shell:governance-state');
  }
  if (!isMutating) {
    const segs = shellSegments(cmd);
    const lowCats = segs.map((s) => LOW_SHELL.find(([re]) => re.test(s))?.[1] ?? null);
    if (segs.length && lowCats.every((c) => c !== null)) {
      // Report the most meaningful LOW category (tests over plain reads).
      const cat = lowCats.find((c) => c === 'run-tests') ?? lowCats.find((c) => c !== 'read-code') ?? 'read-code';
      return result(cat as ActionCategory, `run: ${cmd}`, 'shell:low');
    }
  }
  // v0.3 / v0.11: a shell command that is not read-only and touches governance state
  if (GOVERNANCE_STATE_REF.test(cmd)) return result('governance-tamper', `run: ${cmd}`, 'shell:governance-state');
  if (isMutating) return result('code-change', `run: ${cmd}`, 'shell:mutation');
  return result('shell-command', `run: ${cmd}`, 'shell:other');
}

// ─── entry point ────────────────────────────────────────────────────────────

/** Classify one tool call. Unknown tools are HIGH (the safe default) — and v0.16's runtime refuses them outright
 *  (TOOL_UNKNOWN), because the policy registry has no capability for them. */
export function classifyToolCall(tool: string, input: unknown, ctx: ToolCallContext = {}): ToolRisk {
  const i = inputOf(input);
  switch (classifierOf(tool)) {
    case 'shell':
      return classifyShell(str(i.command));
    case 'write': {
      const path = str(i.file_path) || str(i.notebook_path) || str(i.path);
      return path ? classifyWritePath(path, ctx) : result('code-change', `${tool} (no path)`, 'write-no-path');
    }
    case 'read': {
      const path = str(i.file_path) || str(i.path);
      if (path) return classifyReadPath(path, ctx);
      return result('read-code', `${tool}`, 'read-tool');
    }
    case 'delegate':
      return result('analysis', `${tool}: ${str(i.description)}`, 'delegate');
    case 'mcp':
      return result('shell-command', `MCP ${tool}`, 'mcp');
    case 'intent':
      // Only the intent boundary evaluates this, with its own reading of the message; unclassified it is HIGH.
      return result('irreversible', 'intent (unclassified)', 'intent:unclassified-action');
    default:
      return result('irreversible', `unknown tool ${tool}`, 'unknown-tool');
  }
}

/**
 * v0.16: the OPERATION a classified call performs — derived by the runtime from its own classification of the actual
 * call (never from anything the actor declares). With the tool, it selects the capability in the policy registry.
 */
export function operationOf(classifier: ToolClassifier, cls: Pick<ToolRisk, 'category' | 'risk' | 'rule'>): Operation {
  if (classifier === 'intent') return 'evaluate';
  if (cls.category === 'governance-tamper') return 'governance-state';
  switch (classifier) {
    case 'read': return cls.risk === 'HIGH' ? 'read-secret' : 'read';
    case 'write': return cls.risk === 'HIGH' ? 'sensitive-write' : 'write';
    case 'delegate': return cls.risk === 'HIGH' ? 'high-impact' : 'delegate';
    case 'mcp': return 'invoke';
    case 'shell':
      if (cls.risk === 'HIGH') return 'high-impact';
      if (cls.risk === 'LOW') return 'inspect';
      return cls.rule === 'shell:mutation' ? 'mutate' : 'execute';
  }
}
